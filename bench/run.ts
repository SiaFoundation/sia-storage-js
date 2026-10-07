/**
 * Streaming benchmark: plays a shared video in Google Chrome through the
 * built SDK and its prebuilt service worker, against the real indexer and
 * real hosts, and reports how long each step took.
 *
 * Each play starts a brand new browser profile, presses Play, records for a
 * fixed window, then reloads the page and plays again. The reload matters:
 * Chrome keeps its WebTransport connection penalties for the whole profile
 * when the connections come from a service worker, so a fault that only
 * shows on a second play is invisible to a single one.
 *
 * With `--base <dir>` one run measures two builds. Every round plays the
 * same video on both, back to back, alternating which goes first, so both
 * meet the same hosts at nearly the same moment.
 *
 * Without BENCH_FILE_ID it lists the share's videos and plays a different
 * one, picked at random, in each round.
 *
 * It needs Google Chrome itself. Playwright's bundled Chromium cannot decode
 * H.264, which most shared video is.
 *
 *   BENCH_SHARE_SEED=<seed> [BENCH_FILE_ID=<object id>] bun run bench
 *
 * Options: --rounds 3, --window 45 (seconds), --budget-mb <MB>, --warm,
 * --sdk <dir>, --base <dir>, --out <file>, --headed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { type BrowserContext, chromium, type Page } from 'playwright'
import {
  type BenchEvent,
  type BenchResult,
  type BuildName,
  budgetReachedAt,
  METRICS,
  type Metric,
  medians,
  type PlayMetrics,
  type Plays,
  summarizePlay,
  type Video,
} from './summary'

const ROOT = join(import.meta.dir, '..')

// Indexer latency can rise and fall on a regular cycle. A random wait before
// each round keeps a run from falling into step with one, which would put the
// slow moment on the same play every time.
const JITTER_MS = 45_000

// A viewer looks at the page for a moment before pressing Play.
const PLAY_DELAY_MS = 5000

// One build's two plays normally take a minute or two. A browser that hangs,
// which has happened with Chrome itself, is closed and its round left out, so
// a run still ends.
const BROWSER_TIMEOUT_MS = 8 * 60_000
const CLOSE_TIMEOUT_MS = 10_000
const WATCHDOG_MS = 15_000

// Listing a share of many files is one response of hundreds of megabytes
// from indexers without `objectSummaries`. It fails now and then, and when
// the indexer is busy it fails for most of a minute, so the attempts are
// spread over two.
const LIST_ATTEMPTS = 5
const LIST_RETRY_MS = 30_000

const { values: options } = parseArgs({
  options: {
    rounds: { type: 'string', default: '3' },
    window: { type: 'string', default: '45' },
    'budget-mb': { type: 'string' },
    warm: { type: 'boolean', default: false },
    sdk: { type: 'string' },
    base: { type: 'string' },
    out: { type: 'string' },
    headed: { type: 'boolean', default: false },
  },
})

const seed = process.env.BENCH_SHARE_SEED
// A workflow passes an unset secret as an empty string.
const fileId = process.env.BENCH_FILE_ID || undefined
const rounds = Number(options.rounds)
const windowMs = Number(options.window) * 1000
const budgetMb =
  options['budget-mb'] === undefined ? undefined : Number(options['budget-mb'])
if (!seed) {
  console.error('Set BENCH_SHARE_SEED, and BENCH_FILE_ID to play one file.')
  process.exit(2)
}
if (!(rounds >= 1) || !(windowMs > 0) || Number.isNaN(budgetMb)) {
  console.error('--rounds, --window and --budget-mb take numbers above zero.')
  process.exit(2)
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
}
const SERVED = ['/bench/page/', '/dist/', '/wasm/']

/**
 * Serves the page from this repository and `dist/` and `wasm/` from
 * `sdkRoot`, so every build is measured with the same page. Each build gets
 * its own port, which makes it its own origin with its own service worker.
 */
function serve(sdkRoot: string) {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = normalize(new URL(request.url).pathname)
      const type = TYPES[extname(path)]
      const fromSdk = path.startsWith('/dist/') || path.startsWith('/wasm/')
      const file = Bun.file(join(fromSdk ? sdkRoot : ROOT, path))
      if (
        !type ||
        !SERVED.some((prefix) => path.startsWith(prefix)) ||
        !(await file.exists())
      ) {
        return new Response('Not found', { status: 404 })
      }
      return new Response(file, {
        headers: { 'Content-Type': type, 'Cache-Control': 'no-store' },
      })
    },
  })
}

// The build being measured is the head. `--base` adds one to compare it with.
const builds = [
  ...(options.base ? [{ name: 'base' as BuildName, sdk: resolve(options.base) }] : []),
  { name: 'head' as BuildName, sdk: resolve(options.sdk ?? ROOT) },
].map((build) => ({ ...build, port: serve(build.sdk).port! }))

function pageUrl(port: number, fragment: Record<string, string>) {
  // The seed rides in the fragment, which a browser never sends to a server.
  const params = new URLSearchParams({ seed: seed!, ...fragment })
  if (process.env.BENCH_INDEXER_URL) params.set('indexer', process.env.BENCH_INDEXER_URL)
  return `http://127.0.0.1:${port}/bench/page/index.html#${params}`
}

/**
 * An error's first line, for the results file and the pull request comment.
 * A navigation error quotes the page URL, whose fragment holds the seed.
 */
function reason(error: unknown) {
  return String(error)
    .split('\n')[0]!
    .replaceAll(seed!, '<seed>')
    .replace(/#seed=\S*/g, '#…')
    .slice(0, 200)
}

// Read from the first browser, for the report.
let chromeVersion: string | undefined

/** Runs `use` in Chrome on a brand new profile, and always cleans up. */
async function withBrowser<T>(use: (page: Page) => Promise<T>): Promise<T> {
  const profile = mkdtempSync(join(tmpdir(), 'sia-bench-'))
  let context: BrowserContext | undefined
  // Playwright under Bun has been seen to wait forever once Chrome has gone
  // away, with no error and no crash report. So the job races a timeout and
  // a check every few seconds that a Chrome with this profile still runs.
  let timer: ReturnType<typeof setTimeout> | undefined
  let watchdog: ReturnType<typeof setInterval> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Chrome did not finish within ${BROWSER_TIMEOUT_MS / 60_000} minutes`)),
      BROWSER_TIMEOUT_MS,
    )
    watchdog = setInterval(() => {
      const running = Bun.spawnSync(['pgrep', '-f', '--', `--user-data-dir=${profile}`])
      if (running.exitCode !== 0) reject(new Error('Chrome exited during the play'))
    }, WATCHDOG_MS)
  })
  try {
    return await Promise.race([
      (async () => {
        context = await chromium.launchPersistentContext(profile, {
          channel: 'chrome',
          headless: !options.headed,
          viewport: { width: 1280, height: 800 },
        })
        const page = context.pages()[0] ?? (await context.newPage())
        // Headless Chrome reports a reduced version, such as 155.0.0.0, in
        // its user agent. The DevTools protocol has the full one.
        if (!chromeVersion) {
          const session = await context.newCDPSession(page)
          const { product } = await session.send('Browser.getVersion')
          chromeVersion = product.replace(/^\D+\//, '')
        }
        return use(page)
      })(),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
    clearInterval(watchdog)
    // Closing can wait forever too, so it gets a few seconds and then the
    // browser is killed by its profile folder.
    const closed = context
      ? await Promise.race([
          context.close().then(
            () => true,
            () => false,
          ),
          Bun.sleep(CLOSE_TIMEOUT_MS).then(() => false),
        ])
      : false
    // Without `--`, pkill reads the pattern's leading dashes as an option.
    if (!closed) Bun.spawnSync(['pkill', '-f', '--', `--user-data-dir=${profile}`])
    rmSync(profile, { recursive: true, force: true })
  }
}

async function waitForState(page: Page, done: 'listed' | 'ready') {
  const state = page.locator('#state')
  await state.filter({ hasText: new RegExp(`^(${done}|failed)`) }).waitFor({ timeout: 120_000 })
  const text = await state.textContent()
  if (text !== done) throw new Error(`The page ${text}`)
}

/** The share's videos, listed by the page. */
function listVideos(port: number): Promise<Video[]> {
  return withBrowser(async (page) => {
    await page.goto(pageUrl(port, { list: 'videos' }))
    await waitForState(page, 'listed')
    return (await page.evaluate(
      () => (window as unknown as { bench: { videos: unknown } }).bench.videos,
    )) as Video[]
  })
}

/**
 * One play on the page as it stands: wait, press Play, record until the
 * window closes or the budget has reached the video, and summarize.
 */
async function play(page: Page): Promise<PlayMetrics> {
  await waitForState(page, 'ready')
  await page.waitForTimeout(PLAY_DELAY_MS)
  await page.locator('#play').click()
  const deadline = Date.now() + windowMs
  const events: BenchEvent[] = []
  for (;;) {
    await page.waitForTimeout(Math.max(0, Math.min(1000, deadline - Date.now())))
    const added = (await page.evaluate(
      (from) =>
        (window as unknown as { bench: { events: unknown[] } }).bench.events.slice(from),
      events.length,
    )) as BenchEvent[]
    events.push(...added)
    if (Date.now() >= deadline) break
    if (budgetMb !== undefined && budgetReachedAt(events, budgetMb) !== null) break
  }
  return summarizePlay(events, windowMs, budgetMb)
}

/** One build's plays of one video: the first, then after a reload. */
function playBuild(port: number, video: Video): Promise<Plays> {
  return withBrowser(async (page) => {
    await page.goto(
      pageUrl(port, { file: video.id, ...(options.warm ? { warm: '1' } : {}) }),
    )
    const first = await play(page)
    await page.reload()
    const reload = await play(page)
    return { first, reload }
  })
}

/** `count` videos in random order, each once until all have played. */
function pick(videos: Video[], count: number) {
  const shuffled = [...videos]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  return Array.from({ length: count }, (_, i) => shuffled[i % shuffled.length]!)
}

let videos: Video[]
if (fileId) {
  videos = Array.from({ length: rounds }, () => ({ id: fileId }))
} else {
  for (let attempt = 1; ; attempt++) {
    try {
      // The head is the likelier build to have `objectSummaries`, which lists
      // a share of many files without their storage layouts.
      const all = await listVideos(builds.at(-1)!.port)
      if (all.length === 0) throw new Error('The share has no videos')
      console.log(`${all.length} videos in the share`)
      videos = pick(all, rounds)
      break
    } catch (error) {
      console.error(`Listing the share failed, attempt ${attempt} of ${LIST_ATTEMPTS}: ${reason(error)}`)
      if (attempt === LIST_ATTEMPTS) process.exit(1)
      await Bun.sleep(LIST_RETRY_MS)
    }
  }
}

const result: BenchResult = {
  windowMs,
  budgetMb,
  random: !fileId,
  rounds: [],
  failures: [],
}
for (let i = 0; i < rounds; i++) {
  const { id, name } = videos[i]!
  const video = { id: id.slice(0, 8), ...(name ? { name } : {}) }
  const label = `round ${i + 1} of ${rounds}, ${name ? `${name} ` : ''}(${video.id})`
  // Alternating which build goes first keeps one from always meeting the
  // hosts after the other has just read from them.
  const order = i % 2 === 0 ? builds : [...builds].reverse()
  await Bun.sleep(Math.random() * JITTER_MS)
  const plays: Partial<Record<BuildName, Plays>> = {}
  let failed = false
  for (const build of order) {
    try {
      plays[build.name] = await playBuild(build.port, videos[i]!)
    } catch (error) {
      result.failures.push({ round: i + 1, build: build.name, video, reason: reason(error) })
      console.log(`${label}: failed on ${build.name}, ${reason(error)}`)
      failed = true
      break
    }
  }
  // The other build's plays of a failed round are dropped too, so every
  // comparison is between plays of the same video.
  if (failed) continue
  result.rounds.push({ round: i + 1, video, head: plays.head!, base: plays.base })
  console.log(`${label}: done`)
}
if (result.rounds.length === 0) {
  console.error('Every round failed.')
  process.exit(1)
}
result.chrome = chromeVersion

const output = options.out ?? join(import.meta.dir, 'results', 'run.json')
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`)

const UNITS: Partial<Record<Metric, string>> = { indexerMb: 'MB', mbPerSecond: 'MB/s' }

function show(metric: Metric, value: number | null) {
  if (value === null) return '-'
  if (metric.endsWith('Ms')) return (value / 1000).toFixed(1)
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

// One column per play of each build, holding its plays over the rounds.
const columns = (['first', 'reload'] as const).flatMap((play) =>
  builds.map((build) => {
    const plays = result.rounds.map((r) => r[build.name]![play])
    return { play, build: build.name, plays, medians: medians(plays) }
  }),
)
const line = (label: string, cells: string[]) =>
  console.log(`${label.padEnd(40)}${cells.map((c) => c.padStart(8)).join('')}`)

const recorded =
  budgetMb === undefined
    ? `${options.window} s after Play`
    : `${options.window} s after Play or until ${budgetMb} MB reached the video`
const lost = result.failures.length ? ` (${result.failures.length} failed)` : ''
console.log(`\nmedians of ${result.rounds.length} rounds${lost}, ${recorded}`)
line('', columns.map((c) => c.play))
if (builds.length > 1) line('', columns.map((c) => c.build))
for (const metric of Object.keys(METRICS) as Metric[]) {
  const unit = metric.endsWith('Ms') ? 's' : UNITS[metric]
  line(
    `${METRICS[metric].label}${unit ? ` (${unit})` : ''}`,
    columns.map((c) => show(metric, c.medians[metric])),
  )
}
line('Froze or never moved (plays)', columns.map((c) => String(c.plays.filter((p) => p.froze).length)))
if (options.warm) {
  for (const column of columns.filter((c) => c.play === 'first')) {
    const warmed = column.plays.filter((p) => p.warmed).length
    if (warmed < column.plays.length) {
      console.log(`${column.build}: ${warmed} of ${column.plays.length} first plays warmed. A build without warm() is not warmed.`)
    }
  }
}
console.log(`\nsaved ${output}`)
// The servers would keep the process alive.
process.exit(0)

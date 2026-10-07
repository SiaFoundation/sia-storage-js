/**
 * Turns the benchmark page's events into the numbers the benchmark reports.
 *
 * One page load is one play. Its events are the page's own marks, the hooks'
 * reports from the page and the service worker, and the video element's
 * events. A play is summarized as a timeline of its steps and a few counts,
 * and every reported number is read from that with `METRICS`.
 */

export type BenchEvent = {
  // Milliseconds since the epoch.
  at: number
  from: 'page' | 'worker' | 'media'
  name: string
  [detail: string]: unknown
}

/**
 * The steps of one play, in the order a viewer meets them. The first five
 * happen before Play. The worker's calls and its first host connection fall
 * before Play when a warm-up made them. The last three are moments, not spans.
 */
export const STEPS = [
  'sdk',
  'connect',
  'find',
  'url',
  'warm',
  'workerHosts',
  'workerLookup',
  'firstHost',
  'firstByte',
  'picture',
  'moving',
] as const

export type StepName = (typeof STEPS)[number]

/** A step's start and end. A moment has the same start and end. */
export type Step = { startMs: number; endMs: number }

/**
 * When each step of one play started and ended, in milliseconds after the
 * page started loading. A step that did not happen is absent.
 */
export type Timeline = {
  // The Play click, or null when there was none.
  playMs: number | null
  steps: Partial<Record<StepName, Step>>
}

export type PlayMetrics = {
  timeline: Timeline
  // Megabytes handed to the video element per second recorded.
  mbPerSecond: number
  // Never moved, or stopped for data for more than a second after it had.
  froze: boolean
  // Connections closed by the SDK before their handshake finished. Chrome
  // counts each as a failed connection and penalizes repeats.
  closedWhileConnecting: number
  // Connections Chrome refused outright because of those penalties.
  refused: number
  priceRequestsPerHost: number | null
  // Megabytes the page read from the indexer.
  indexerMb: number
  // The page asked for a warm-up and the build had `warm()` to do it.
  warmed: boolean
}

// The messages Chrome rejects a WebTransport's `ready` with.
const CLOSED_WHILE_CONNECTING = 'close() is called while connecting.'
const REFUSED = 'Connection lost.'

const FROZEN_THRESHOLD_MS = 1000

function number(event: BenchEvent | undefined, key: string) {
  const value = event?.[key]
  return typeof value === 'number' ? value : undefined
}

const lastClick = (sorted: BenchEvent[]) =>
  sorted.filter((e) => e.name === 'play-clicked').at(-1)

/**
 * Bytes handed to the video element after the click, as a running total with
 * the time of each step. Each range request reports its own count, so the
 * total is the sum of each request's latest count. Request IDs start again
 * when the service worker restarts, so a request is known by its ID and the
 * number of `worker-boot` events before it. A request that began before the
 * click, such as a warm-up read or the previous page's video, is left out.
 */
function deliveries(sorted: BenchEvent[], click: BenchEvent) {
  let boots = 0
  const counted = new Map<string, number>()
  let total = 0
  const steps: { at: number; total: number }[] = []
  for (const event of sorted) {
    if (event.from !== 'worker') continue
    if (event.name === 'worker-boot') {
      boots++
      continue
    }
    const key = `${boots}:${String(event.request)}`
    if (event.name === 'request-start') {
      if (event.at >= click.at) counted.set(key, 0)
      continue
    }
    if (event.name !== 'request-progress' && event.name !== 'request-end') continue
    const before = counted.get(key)
    const bytes = number(event, 'bytes') ?? 0
    if (before === undefined || bytes <= before) continue
    total += bytes - before
    counted.set(key, bytes)
    steps.push({ at: event.at, total })
  }
  return steps
}

/**
 * When the video had been handed `budgetMb` megabytes since the last Play
 * click, or null if it has not been yet.
 */
export function budgetReachedAt(events: BenchEvent[], budgetMb: number) {
  const sorted = [...events].sort((a, b) => a.at - b.at)
  const click = lastClick(sorted)
  if (!click) return null
  const step = deliveries(sorted, click).find((s) => s.total >= budgetMb * 1e6)
  return step?.at ?? null
}

/**
 * Summarizes the play that follows the last Play click. It is recorded for
 * `windowMs`, or until `budgetMb` megabytes have reached the video when that
 * comes first, and nothing after that counts.
 */
export function summarizePlay(
  events: BenchEvent[],
  windowMs: number,
  budgetMb?: number,
): PlayMetrics {
  const sorted = [...events].sort((a, b) => a.at - b.at)
  const click = lastClick(sorted)
  const delivered = click ? deliveries(sorted, click) : []
  const budgetAt =
    budgetMb === undefined
      ? undefined
      : delivered.find((s) => s.total >= budgetMb * 1e6)?.at
  const end = click ? Math.min(click.at + windowMs, budgetAt ?? Infinity) : 0
  const played = click
    ? sorted.filter((e) => e.at >= click.at && e.at <= end)
    : []
  const recordedMs = click ? end - click.at : 0
  const bytes = delivered.filter((s) => s.at <= end).at(-1)?.total ?? 0

  // A `waiting` before the video first moves is startup, which the `moving`
  // step already times. After that, a stop lasts from the first `waiting`
  // until the video moves again, however many `waiting` events come between.
  let frozenMs = 0
  let moved = false
  let waitingSince: number | undefined
  for (const event of played) {
    if (event.from !== 'media') continue
    if (event.name === 'playing') {
      if (waitingSince !== undefined) frozenMs += event.at - waitingSince
      waitingSince = undefined
      moved = true
    } else if (event.name === 'waiting' && moved) {
      waitingSince ??= event.at
    }
  }
  // Still stopped when recording ended.
  if (waitingSince !== undefined) frozenMs += end - waitingSince

  const worker = sorted.filter((e) => e.from === 'worker')
  const failedWith = (message: string) =>
    worker.filter((e) => e.name === 'host-failed' && e.error === message).length
  const priceRequests = worker.filter(
    (e) => e.name === 'rpc-request' && e.call === 'Settings',
  )
  const pricedHosts = new Set(priceRequests.map((e) => e.host)).size
  const indexerBytes = sorted
    .filter((e) => e.from === 'page' && e.name === 'http-body' && isIndexer(e.url))
    .reduce((sum, e) => sum + (number(e, 'bytes') ?? 0), 0)

  return {
    timeline: summarizeTimeline(sorted, click, played),
    mbPerSecond: recordedMs > 0 ? bytes / 1e6 / (recordedMs / 1000) : 0,
    froze: !moved || frozenMs > FROZEN_THRESHOLD_MS,
    closedWhileConnecting: failedWith(CLOSED_WHILE_CONNECTING),
    refused: failedWith(REFUSED),
    priceRequestsPerHost:
      pricedHosts > 0 ? priceRequests.length / pricedHosts : null,
    indexerMb: indexerBytes / 1e6,
    warmed: sorted.some((e) => e.from === 'page' && e.name === 'warm-done'),
  }
}

/**
 * Each step's start and end from the page's start, which the page marks at
 * navigation. `played` is the events recorded after the click, so a first
 * byte, picture or movement after recording ended is not a step.
 */
function summarizeTimeline(
  sorted: BenchEvent[],
  click: BenchEvent | undefined,
  played: BenchEvent[],
): Timeline {
  const page = sorted.filter((e) => e.from === 'page')
  const origin = page.find((e) => e.name === 'page-start')?.at ?? 0
  const steps: Timeline['steps'] = {}
  const set = (name: StepName, start: number, end: number) => {
    steps[name] = { startMs: start - origin, endMs: end - origin }
  }
  // The page marks a step when it finishes, with how long it took. A step
  // that failed is not a step taken.
  const marked = (step: StepName, name: string) => {
    const mark = page.find((e) => e.name === name && e.error === undefined)
    if (mark) set(step, mark.at - (number(mark, 'ms') ?? 0), mark.at)
  }
  marked('sdk', 'page-wasm')
  marked('connect', 'page-connect')
  marked('find', 'page-object')
  marked('url', 'stream-url-ready')
  const warmStart = page.find((e) => e.name === 'warm-start')
  const warmDone = page.find((e) => e.name === 'warm-done')
  if (warmStart && warmDone) set('warm', warmStart.at, warmDone.at)
  const hosts = workerCalls(sorted, isHosts)
  if (hosts) set('workerHosts', hosts.start, hosts.end)
  const lookup = workerCalls(sorted, isLookup)
  if (lookup) set('workerLookup', lookup.start, lookup.end)
  const dial = sorted.find((e) => e.from === 'worker' && e.name === 'host-connect')
  const ready =
    dial &&
    sorted.find((e) => e.from === 'worker' && e.name === 'host-ready' && e.at >= dial.at)
  if (dial && ready) set('firstHost', dial.at, ready.at)
  const moment = (step: StepName, name: string, from?: BenchEvent['from']) => {
    const event = played.find(
      (e) => e.name === name && (from === undefined || e.from === from),
    )
    if (event) set(step, event.at, event.at)
  }
  moment('firstByte', 'request-first-byte')
  moment('picture', 'canplay', 'media')
  moment('moving', 'playing', 'media')
  return { playMs: click ? click.at - origin : null, steps }
}

// Paths only, since the hooks drop query strings.
const isHosts = (url: unknown) => typeof url === 'string' && url.endsWith('/shared/hosts')
const isLookup = (url: unknown) =>
  typeof url === 'string' && /\/shared\/objects\/[0-9a-f]{64}$/.test(url)
const isIndexer = (url: unknown) => typeof url === 'string' && /\/shared(\/|$)/.test(url)

/**
 * From the worker's first matching call to the last one's last byte, as epoch
 * milliseconds. Calls that overlap count once, which is how long the step
 * held up whatever waited on it. Null when there was no call, or one never
 * answered.
 */
function workerCalls(events: BenchEvent[], match: (url: unknown) => boolean) {
  const matching = events.filter((e) => e.from === 'worker' && match(e.url))
  const starts = matching.filter((e) => e.name === 'http-start')
  if (starts.length === 0) return null
  // Each call ends at its last byte, or at its headers when no body was timed.
  const ends = starts.map((start) => {
    const of = (name: string) =>
      number(matching.find((e) => e.name === name && e.id === start.id), 'ms')
    const ms = of('http-body') ?? of('http-end')
    return ms === undefined ? undefined : start.at + ms
  })
  if (ends.some((end) => end === undefined)) return null
  return { start: starts[0]!.at, end: Math.max(...(ends as number[])) }
}

const step = (play: PlayMetrics, name: StepName) => play.timeline.steps[name]

/** How long a step took, or null when the play did not take it. */
const took = (name: StepName) => (play: PlayMetrics) => {
  const s = step(play, name)
  return s ? s.endMs - s.startMs : null
}

/**
 * Milliseconds from Play until a step ended, 0 when it ended before Play,
 * and null when the play did not reach it.
 */
const afterPlay = (name: StepName) => (play: PlayMetrics) => {
  const s = step(play, name)
  const { playMs } = play.timeline
  return s && playMs !== null ? Math.max(0, s.endMs - playMs) : null
}

/**
 * How long a step ran after Play. 0 for a step that did not happen or that a
 * warm-up finished before Play, so a build that skips it or does it early
 * shows as time saved.
 */
const tookAfterPlay = (name: StepName) => (play: PlayMetrics) => {
  const s = step(play, name)
  const { playMs } = play.timeline
  if (!s || playMs === null || s.endMs <= playMs) return 0
  return s.endMs - Math.max(s.startMs, playMs)
}

type Read = (play: PlayMetrics) => number | null

/** Every number the benchmark reports, read from one play. */
export const METRICS = {
  connectMs: { label: 'Connect to the indexer', of: took('connect') },
  findMs: { label: 'Find the file', of: took('find') },
  indexerMb: { label: 'Read from the indexer', of: (p) => p.indexerMb },
  urlMs: { label: 'Make the stream URL', of: took('url') },
  warmMs: { label: 'Warm up hosts', of: took('warm') },
  workerHostsMs: { label: 'Worker loads the host list', of: tookAfterPlay('workerHosts') },
  workerLookupMs: { label: 'Worker looks the file up', of: tookAfterPlay('workerLookup') },
  firstHostMs: { label: 'First host connected', of: afterPlay('firstHost') },
  firstByteMs: { label: 'First byte', of: afterPlay('firstByte') },
  pictureMs: { label: 'Picture', of: afterPlay('picture') },
  movingMs: { label: 'Video moving', of: afterPlay('moving') },
  mbPerSecond: { label: 'Delivered to the video', of: (p) => p.mbPerSecond },
  closedWhileConnecting: {
    label: 'Connections dropped while opening',
    of: (p) => p.closedWhileConnecting,
  },
  refused: { label: 'Connections Chrome refused', of: (p) => p.refused },
  priceRequestsPerHost: {
    label: 'Price requests per host',
    of: (p) => p.priceRequestsPerHost,
  },
} satisfies Record<string, { label: string; of: Read }>

export type Metric = keyof typeof METRICS

export type Medians = Record<Metric, number | null>

/**
 * The middle value, the lower of two. Null, a step never reached, sorts as
 * the worst, so the median is null when most plays never reached it.
 */
function median(values: (number | null)[]) {
  if (values.length === 0) return null
  const sorted = [...values].sort(
    (a, b) => (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY),
  )
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null
}

export function medians(plays: PlayMetrics[]): Medians {
  const result = {} as Medians
  for (const metric of Object.keys(METRICS) as Metric[]) {
    result[metric] = median(plays.map(METRICS[metric].of))
  }
  return result
}

/**
 * Each step's median start and duration over a build's plays, for a
 * waterfall. A step whose median start falls before Play is under `before`,
 * timed from the page's start. The rest are under `after`, timed from Play,
 * since the wait before Play differs from play to play. A step most plays
 * skipped is absent.
 */
export type StepMedians = {
  before: Partial<Record<StepName, Step>>
  after: Partial<Record<StepName, Step>>
}

export function stepMedians(plays: PlayMetrics[]): StepMedians {
  const result: StepMedians = { before: {}, after: {} }
  for (const name of STEPS) {
    const duration = median(plays.map(took(name)))
    if (duration === null) continue
    const fromPlay = median(
      plays.map((p) => {
        const s = step(p, name)
        const { playMs } = p.timeline
        return s && playMs !== null ? s.startMs - playMs : null
      }),
    )
    if (fromPlay !== null && fromPlay >= 0) {
      result.after[name] = { startMs: fromPlay, endMs: fromPlay + duration }
      continue
    }
    const startMs = median(plays.map((p) => step(p, name)?.startMs ?? null))
    if (startMs !== null) result.before[name] = { startMs, endMs: startMs + duration }
  }
  return result
}

export type BuildName = 'base' | 'head'

/** One build's plays of one video: the first, then after a reload. */
export type Plays = { first: PlayMetrics; reload: PlayMetrics }

// The file's ID cut to 8 characters, and its name when the share lists it.
export type Video = { id: string; name?: string }

/** What `run.ts` writes and `report.ts` reads. */
export type BenchResult = {
  windowMs: number
  budgetMb?: number
  chrome?: string
  // Whether each round picked a video at random from the share.
  random: boolean
  // `base` is absent from a run of one build.
  rounds: { round: number; video: Video; head: Plays; base?: Plays }[]
  // A round in which either build failed, left out of `rounds`.
  failures: { round: number; build: BuildName; video: Video; reason: string }[]
}

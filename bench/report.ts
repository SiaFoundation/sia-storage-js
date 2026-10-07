/**
 * Turns a results file of two builds, written by `run.ts --base`, into the
 * Markdown comment the benchmark workflow posts on a pull request.
 *
 * The comment says how the plays were run and gives four headline numbers.
 * Under them, in collapsible sections, every step that changed is drawn as a
 * pair of bars, a waterfall shows what waited on what, and a table gives each
 * round's times. The charts are text in fenced code blocks, which GitHub
 * shows in a fixed-width font, so the bars line up. In a `diff` block GitHub
 * colours a line that starts with `+` green and one that starts with `-` red,
 * which is how a change is marked better or worse.
 *
 *   bun run bench/report.ts --results results.json --out comment.md
 *
 * `--base-name` and `--head-name` name the two builds' branches. `--run-id`,
 * `--run-url`, `--sha` and `--rust-ref` fill in the last line, which is left
 * out without a run ID.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  type BenchResult,
  type BuildName,
  METRICS,
  type Medians,
  type Metric,
  medians,
  type PlayMetrics,
  STEPS,
  type StepMedians,
  type StepName,
  stepMedians,
  type Video,
} from './summary'

type Play = 'first' | 'reload'

/** The branch of each build. */
export type Names = Record<BuildName, string>

/** The CI run that measured the results, for the comment's last line. */
export type Run = { id?: string; url?: string; sha?: string; rustRef?: string }

/** The comment's first line, so the workflow can find and update it. */
export const MARKER = '<!-- sia-storage-bench -->'

const MINUS = '−'

// A time is drawn and placed at the tenth of a second it is shown at, so a
// bar never disagrees with the number printed after it.
const tenths = (ms: number) => Math.round(ms / 100)
const showTenths = (t: number) => `${(t / 10).toFixed(1)} s`
const seconds = (ms: number) => showTenths(tenths(ms))
const oneDecimal = (value: number) => Math.round(value * 10) / 10

/**
 * The head's time minus the base's, as `+1.2 s` or `−0.4 s`. It subtracts
 * the two times as they are shown, so a reader who does the same gets the
 * same answer.
 */
function changeText(base: number, head: number) {
  const t = tenths(head) - tenths(base)
  if (t === 0) return '0.0 s'
  return `${t > 0 ? '+' : MINUS}${showTenths(Math.abs(t))}`
}

/** Text that cannot break a Markdown table or open an HTML tag. */
const cell = (text: string) =>
  text
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`/g, "'")

// The left-aligned blocks of one to seven eighths of a character.
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/**
 * A bar `chars` characters long, to the nearest eighth of a character. It is
 * never shorter than one eighth, so a zero still shows where it is.
 */
export function bar(chars: number) {
  const eighths = Math.max(1, Math.round(chars * 8))
  return `${'█'.repeat(Math.floor(eighths / 8))}${EIGHTHS[eighths % 8]}`
}

type Pair<T> = [base: T, head: T]

/** One number on both builds: its medians, and its value in each round. */
export type Measured = {
  values: Pair<number | null>
  rounds: Pair<number | null>[]
}

/** A `diff` block's first column: green, red, or no colour. */
export type Colour = '+' | '-' | ' '

/**
 * Whether a change is worth colouring, and which way. Real hosts and a busy
 * indexer make every number noisy. One slow indexer answer can add 10 s to a
 * play, and it lands on either build by chance. So a change must be big in
 * the medians and in the rounds.
 *
 * Big is a time that moved by more than 0.5 s and more than 10% of the base,
 * or a count or a rate that moved by more than 25% of the base and by at
 * least 1. The rounds must show it too: all but at most one of them, and at
 * least two, changed by that much the way the medians did, and none moved
 * the other way by any amount. A round in which both builds got the same
 * number counts for neither side.
 *
 * One round the other way is enough to withhold the colour because five
 * rounds cannot tell a fluke from a tie. With two builds that perform the
 * same, four or more of five rounds favour the same one 3 times in 8, and
 * all five do 1 time in 16.
 *
 * `plays` is a count of plays, such as how many froze. It has one number for
 * the whole run, so it is coloured when the builds differ by at least half
 * the rounds and by at least two plays.
 *
 * Lower is better unless `higherIsBetter`. With `never`, a missing value is a
 * step the build never reached, which is worse than any time. Without it a
 * missing value is not compared.
 */
export function colour(
  measured: Measured,
  kind: 'time' | 'amount' | 'plays',
  options: { higherIsBetter?: boolean; never?: boolean } = {},
): Colour {
  const rank = (value: number | null) =>
    value ?? (options.never ? Number.POSITIVE_INFINITY : null)
  // The head's value minus the base's when that is a big change, else 0.
  const change = ([base, head]: Pair<number | null>) => {
    const [b, h] = [rank(base), rank(head)]
    if (b === null || h === null || b === h) return 0
    const size = Math.abs(h - b)
    const big =
      kind === 'plays'
        ? size >= Math.max(2, measured.rounds.length / 2)
        : kind === 'time'
          ? size > 500 && size > 0.1 * Math.abs(b)
          : size > 0.25 * Math.abs(b) && size >= 1
    // A build that never reached the step differs by more than any time.
    return big || !Number.isFinite(size) ? h - b : 0
  }
  const overall = change(measured.values)
  if (overall === 0) return ' '
  if (kind !== 'plays') {
    const agree = measured.rounds.map(change).filter((c) => c !== 0 && c > 0 === overall > 0)
    const otherWay = measured.rounds.some(([base, head]) => {
      const [b, h] = [rank(base), rank(head)]
      return b !== null && h !== null && b !== h && h > b !== overall > 0
    })
    if (otherWay || agree.length < Math.max(2, measured.rounds.length - 1)) return ' '
  }
  return overall > 0 === Boolean(options.higherIsBetter) ? '+' : '-'
}

// Tick steps in seconds. An axis takes the finest whose labels land on whole
// characters at least 10 apart, so each label has room.
const TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 1200]

// Characters per second or per unit, one significant digit, largest first.
const SCALES = [10, 1, 0.1, 0.01].flatMap((power) =>
  [9, 8, 7, 6, 5, 4, 3, 2, 1].map((digit) => Number((digit * power).toFixed(2))),
)

// Rounds away floating-point noise, such as 0.1 * 3 coming out as 0.30000000000000004.
const exact = (value: number) => Number(value.toFixed(6))

type Axis = { perSecond: number; tick: number; ticks: number; width: number }

/** An axis at `perSecond` characters a second, with a tick past `maxTenths`. */
function axisAt(perSecond: number, maxTenths: number): Axis | undefined {
  const tick = TICKS.find((t) => {
    const apart = exact(t * perSecond)
    return apart >= 10 && Number.isInteger(apart)
  })
  if (tick === undefined) return undefined
  const ticks = Math.floor(maxTenths / Math.round(tick * 10)) + 1
  return { perSecond, tick, ticks, width: exact(ticks * tick * perSecond) }
}

function axisLine(axis: Axis) {
  let line = ''
  for (let i = 0; i <= axis.ticks; i++) {
    line = `${line.padEnd(exact(i * axis.tick * axis.perSecond))}${exact(i * axis.tick)}s`
  }
  return line
}

/**
 * The column a time in tenths of a second falls in. A time exactly between
 * two columns takes the earlier one, so a step that starts where a
 * half-column bar ends sits under that bar, not a column past it, which
 * would read as a gap.
 */
const column = (t: number, perSecond: number) => Math.ceil(exact((t * perSecond) / 10) - 0.5)

/** The largest one-digit scale at which `max` is no longer than `width`. */
function amountScale(max: number, width: number) {
  if (max <= 0) return 1
  const fits = width / max
  const power = 10 ** Math.floor(Math.log10(fits))
  // The nudge keeps 36 / 1.2, which comes out as 29.999999999999996, at 30.
  return Math.floor(fits / power + 1e-9) * power
}

type Cell = {
  // The number drawn, at the precision shown, or null for text alone.
  value: number | null
  text: string
}

type Row = {
  label: string
  kind: 'time' | 'amount'
  base: Cell
  head: Cell
  colour: Colour
  // Times only, when both builds have one.
  change?: string
  // How the sentence under the chart names the row when it is left out. A
  // `zero` is a noun, gathered with the section's others into "no A or B".
  same: { phrase: string } | { zero: string }
}

type Section = { title: string; suffix: string; rows: Row[] }

/** One play of every round, on both builds. */
type Context = { plays: Pair<PlayMetrics>[]; medians: Pair<Medians> }

function context(result: BenchResult, play: Play): Context {
  const plays = result.rounds.map((r) => [r.base![play], r.head[play]] as Pair<PlayMetrics>)
  return {
    plays,
    medians: [medians(plays.map((p) => p[0])), medians(plays.map((p) => p[1]))],
  }
}

const measured = (c: Context, metric: Metric): Measured => ({
  values: c.medians.map((m) => m[metric]) as Pair<number | null>,
  rounds: c.plays.map((pair) => pair.map(METRICS[metric].of) as Pair<number | null>),
})

/** How many of the plays `is` holds for, on each build, and round by round. */
const counted = (c: Context, is: (play: PlayMetrics) => boolean): Measured => {
  const rounds = c.plays.map((pair) => pair.map((p) => Number(is(p))) as Pair<number>)
  return {
    values: [0, 1].map((build) => rounds.filter((r) => r[build] === 1).length) as Pair<number>,
    rounds,
  }
}

/** What a time of 0 is shown as, and how the sentence names it. */
type Zero = (plays: PlayMetrics[]) => { text: string; same: string }

/**
 * A worker call that took no time after Play: a warm-up made it before Play,
 * or the build did not need it.
 */
const skipped =
  (step: StepName, early: string, unneeded: string): Zero =>
  (plays) =>
    plays.some((p) => p.timeline.steps[step])
      ? { text: 'before Play', same: early }
      : { text: 'not needed', same: unneeded }

/**
 * A time. A build with no time for it never reached the step, unless
 * `missing` says what it means instead, such as a build that was not warmed.
 * Such a row is left out when neither build has a time. With `zero`, a time
 * of 0 is shown as text with no bar.
 */
function time(
  c: Context,
  metric: Metric,
  same: (text: string) => string,
  options: { zero?: Zero; missing?: string } = {},
): Row | undefined {
  const m = measured(c, metric)
  const [base, head] = m.values
  if (options.missing !== undefined && base === null && head === null) return undefined
  const zero = (build: 0 | 1) => options.zero?.(c.plays.map((p) => p[build]))
  const at = (ms: number | null, build: 0 | 1): Cell => {
    if (ms === null) return { value: null, text: options.missing ?? 'never' }
    const none = ms === 0 ? zero(build) : undefined
    return none ? { value: null, text: none.text } : { value: tenths(ms) / 10, text: seconds(ms) }
  }
  return {
    label: METRICS[metric].label,
    kind: 'time',
    base: at(base, 0),
    head: at(head, 1),
    change: base === null || head === null ? undefined : changeText(base, head),
    colour: colour(m, 'time', { never: options.missing === undefined }),
    same: { phrase: (base === 0 && zero(0)?.same) || same(at(base, 0).text) },
  }
}

/** A count or a rate, drawn on a scale of its own row. */
function amount(
  label: string,
  m: Measured,
  text: (value: number) => string,
  same: (text: string) => string,
  options: { zero?: string; higherIsBetter?: boolean; plays?: boolean } = {},
): Row {
  const [base, head] = m.values
  const at = (v: number | null): Cell =>
    v === null ? { value: null, text: '–' } : { value: oneDecimal(v), text: text(oneDecimal(v)) }
  return {
    label,
    kind: 'amount',
    base: at(base),
    head: at(head),
    colour: colour(m, options.plays ? 'plays' : 'amount', options),
    same:
      options.zero !== undefined && base === 0
        ? { zero: options.zero }
        : { phrase: same(at(base).text) },
  }
}

const count = (n: number) => String(n)

function sections(first: Context, reload: Context): Section[] {
  const moving = (c: Context) => time(c, 'movingMs', (t) => `video moving at ${t}`)
  const firstByte = (c: Context) => time(c, 'firstByteMs', (t) => `first byte at ${t}`)
  // The picture almost always appears as the video starts moving, so it gets
  // a row only when that is not so on one of the builds.
  const picture = first.medians.some((m) => never(m.pictureMs) !== never(m.movingMs))
  const refused = (c: Context) =>
    amount(
      METRICS.refused.label,
      measured(c, 'refused'),
      count,
      (t) => `${t} refused connections`,
      { zero: 'refused connections' },
    )
  const rows = (list: (Row | undefined)[]) => list.filter((row) => row !== undefined)
  return [
    {
      title: 'BEFORE PLAY',
      suffix: '',
      rows: rows([
        time(first, 'connectMs', (t) => `${t} to connect to the indexer`),
        time(first, 'findMs', (t) => `${t} to find the file`),
        amount(
          METRICS.indexerMb.label,
          measured(first, 'indexerMb'),
          (v) => `${v.toFixed(1)} MB`,
          (t) => `${t} read from the indexer`,
        ),
        time(first, 'urlMs', (t) =>
          t === '0.0 s' ? 'the stream URL made at once' : `${t} to make the stream URL`,
        ),
        time(first, 'warmMs', (t) => `${t} to warm up hosts`, { missing: 'not warmed' }),
      ]),
    },
    {
      title: 'AFTER PRESSING PLAY',
      suffix: '',
      rows: rows([
        time(first, 'workerHostsMs', (t) => `${t} for the worker's host list`, {
          zero: skipped('workerHosts', 'the host list loaded before Play', 'no host list needed'),
        }),
        time(first, 'workerLookupMs', (t) => `${t} for the worker's file lookup`, {
          zero: skipped('workerLookup', 'the file looked up before Play', 'no file lookup needed'),
        }),
        time(first, 'firstHostMs', (t) => `first host connected at ${t}`, {
          zero: () => ({ text: 'at once', same: 'first host connected at once' }),
        }),
        firstByte(first),
        picture ? time(first, 'pictureMs', (t) => `picture at ${t}`) : undefined,
        moving(first),
      ]),
    },
    {
      title: 'AFTER A RELOAD',
      suffix: ' after a reload',
      rows: rows([firstByte(reload), moving(reload), refused(reload)]),
    },
    {
      title: 'PLAYBACK, FIRST PLAY',
      suffix: ' on the first play',
      rows: [
        amount(
          METRICS.mbPerSecond.label,
          measured(first, 'mbPerSecond'),
          (v) => `${v.toFixed(1)} MB/s`,
          (t) => `${t} delivered`,
          { higherIsBetter: true },
        ),
        amount(
          METRICS.closedWhileConnecting.label,
          measured(first, 'closedWhileConnecting'),
          count,
          (t) => `${t} connections dropped while opening`,
          { zero: 'connections dropped while opening' },
        ),
        amount(
          METRICS.priceRequestsPerHost.label,
          measured(first, 'priceRequestsPerHost'),
          (v) => v.toFixed(1),
          (t) => `${t} price requests per host`,
        ),
        amount(
          'Froze',
          counted(first, (p) => p.froze),
          (n) => `${n} of ${first.plays.length}`,
          (t) => `${t} froze`,
          { zero: 'freezes', plays: true },
        ),
        refused(first),
      ],
    },
  ]
}

const shown = (row: Row) => row.base.text !== row.head.text

/** "A", "A or B", "A, B or C". */
function either(nouns: string[]) {
  return nouns.length < 2
    ? nouns.join('')
    : `${nouns.slice(0, -1).join(', ')} or ${nouns.at(-1)}`
}

/**
 * The rows both builds share, as one sentence. A section's zero counts are
 * gathered into one "no A or B", and the section's suffix, such as "after a
 * reload", ends its last phrase.
 */
function sameSentence(list: Section[]) {
  const phrases = list.flatMap((section) => {
    const rows = section.rows.filter((r) => !shown(r))
    const zeros = rows.flatMap((r) => ('zero' in r.same ? [r.same.zero] : []))
    const out: string[] = []
    for (const row of rows) {
      if ('phrase' in row.same) out.push(row.same.phrase)
      else if (row.same.zero === zeros[0]) out.push(`no ${either(zeros)}`)
    }
    if (out.length > 0) out[out.length - 1] += section.suffix
    return out
  })
  return phrases.length === 0 ? '' : `Same on both builds, so not shown: ${phrases.join(', ')}.`
}

const COMPARE_WIDTH = 36
// The column the change ends at. It is right-aligned so the units line up.
const CHANGE_END = 72
const CHANGE_WIDTH = 8

/**
 * Every row whose builds differ, base over head, in sections. The times in a
 * section share one scale, drawn as an axis under its title. A count or a
 * rate is drawn on a scale of its own row, since refused connections and
 * megabytes a second have nothing in common. Only the head's line is
 * coloured, and only a time has its change at the end.
 */
function stepsThatChanged(list: Section[]) {
  const blocks = list.flatMap((section) => {
    const rows = section.rows.filter(shown)
    if (rows.length === 0) return []
    const lines = [`  ${section.title}`]
    const times = rows.filter((r) => r.kind === 'time')
    const maxTenths = Math.max(
      0,
      ...times.flatMap((r) => [r.base.value ?? 0, r.head.value ?? 0]).map((v) => Math.round(v * 10)),
    )
    const axis =
      times.length > 0
        ? SCALES.map((s) => axisAt(s, maxTenths)).find(
            (a) => a !== undefined && a.width <= COMPARE_WIDTH,
          )
        : undefined
    if (axis) lines.push(`${' '.repeat(16)}${axisLine(axis)}`)
    for (const row of rows) {
      const perUnit =
        row.kind === 'time'
          ? axis!.perSecond
          : amountScale(Math.max(row.base.value ?? 0, row.head.value ?? 0), COMPARE_WIDTH)
      const chart = (c: Cell) => (c.value === null ? c.text : `${bar(c.value * perUnit)} ${c.text}`)
      lines.push(`  ${row.label}`, `    ${'base'.padEnd(12)}${chart(row.base)}`)
      const head = `${row.colour}   ${'this PR'.padEnd(12)}${chart(row.head)}`
      lines.push(
        row.change === undefined
          ? head
          : `${head.padEnd(CHANGE_END - CHANGE_WIDTH)}${row.change.padStart(CHANGE_WIDTH)}`,
      )
    }
    return [lines.join('\n')]
  })
  return blocks.length === 0 ? '' : `\`\`\`diff\n${blocks.join('\n\n')}\n\`\`\``
}

const WATERFALL_LABELS: Partial<Record<StepName, string>> = {
  sdk: 'load the SDK',
  connect: 'connect',
  find: 'find the file',
  url: 'make stream URL',
  warm: 'warm up hosts',
  workerHosts: 'host list',
  workerLookup: 'file lookup',
  firstHost: 'first host',
  firstByte: 'first byte',
  moving: 'video moving',
}
const MOMENTS: ReadonlySet<StepName> = new Set(['firstByte', 'picture', 'moving'])
const WATERFALL_INDENT = 20
const WATERFALL_WIDTH = 76

type Mark =
  | { kind: 'bar'; label: string; start: number; length: number }
  | { kind: 'play'; at: number }
  | { kind: 'point'; label: string; at: number; afterPlay: number }

/**
 * One build's steps, in tenths of a second from the page's start. Play is
 * placed where the last step before it ended, which cuts out the viewer's
 * wait, and the steps after it are placed from there.
 */
function marks(steps: StepMedians): Mark[] {
  const list: Mark[] = []
  let play = 0
  for (const name of STEPS) {
    const step = steps.before[name]
    const label = WATERFALL_LABELS[name]
    if (!step || !label || MOMENTS.has(name)) continue
    const start = tenths(step.startMs)
    const length = tenths(step.endMs - step.startMs)
    list.push({ kind: 'bar', label, start, length })
    play = Math.max(play, start + length)
  }
  list.push({ kind: 'play', at: play })
  for (const name of STEPS) {
    const step = steps.after[name]
    const label = WATERFALL_LABELS[name]
    if (!step || !label) continue
    const start = tenths(step.startMs)
    list.push(
      MOMENTS.has(name)
        ? { kind: 'point', label, at: play + start, afterPlay: start }
        : { kind: 'bar', label, start: play + start, length: tenths(step.endMs - step.startMs) },
    )
  }
  return list
}

function drawWaterfall(title: string, builds: { name: string; marks: Mark[] }[], axis: Axis) {
  const lines = [`  ${title}`, `${' '.repeat(WATERFALL_INDENT)}${axisLine(axis)}`]
  const at = (label: string, t: number, rest: string) =>
    `    ${label.padEnd(WATERFALL_INDENT - 4)}${' '.repeat(column(t, axis.perSecond))}${rest}`
  for (const build of builds) {
    lines.push(`  ${build.name}`)
    for (const mark of build.marks) {
      if (mark.kind === 'bar') {
        const length = bar((mark.length * axis.perSecond) / 10)
        lines.push(at(mark.label, mark.start, `${length} ${showTenths(mark.length)}`))
      } else if (mark.kind === 'play') {
        lines.push(at('Play', mark.at, '▼'))
      } else {
        lines.push(at(mark.label, mark.at, `▏ ${showTenths(mark.afterPlay)} after Play`))
      }
    }
  }
  return lines
}

/**
 * One play's waterfall for both builds on one scale, the largest at which
 * every line fits in WATERFALL_WIDTH characters. The picture is left out,
 * since it almost always lands with the video moving.
 */
export function waterfall(title: string, builds: { name: string; steps: StepMedians }[]) {
  const drawn = builds.map((b) => ({ name: b.name, marks: marks(b.steps) }))
  const maxTenths = Math.max(
    0,
    ...drawn.flatMap((b) => b.marks.map((m) => (m.kind === 'bar' ? m.start + m.length : m.at))),
  )
  let lines: string[] = []
  for (const scale of SCALES) {
    const axis = axisAt(scale, maxTenths)
    if (!axis) continue
    lines = drawWaterfall(title, drawn, axis)
    if (lines.every((l) => l.length <= WATERFALL_WIDTH)) break
  }
  return lines.join('\n')
}

/**
 * A video's name without its extension, the share's `nasa-NNNN-` prefix, a
 * leading `nasa-` or date, or a trailing numeric ID.
 */
export function shortName(name: string) {
  return name
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/^nasa-\d+-/, '')
    .replace(/^nasa-/, '')
    .replace(/^\d{1,2}-\d{1,2}-\d{2,4}-/, '')
    .replace(/-\d{4,}$/, '')
}

const never = (ms: number | null) => (ms === null ? 'never' : seconds(ms))

/** Each round's video and its moving times, with failed rounds in place. */
function roundsTable(result: BenchResult) {
  // "3.7 / 3.9 s" when both moved, so the unit is written once.
  const pair = (base: number | null, head: number | null) =>
    base !== null && head !== null
      ? `${(tenths(base) / 10).toFixed(1)} / ${seconds(head)}`
      : `${never(base)} / ${never(head)}`
  const moving = METRICS.movingMs.of
  const video = (v: Video) => `\`${v.id}\`${v.name ? ` ${cell(shortName(v.name))}` : ''}`
  const rows = [
    ...result.rounds.map((r) => ({
      round: r.round,
      line: `| ${r.round} | ${video(r.video)} | ${pair(moving(r.base!.first), moving(r.head.first))} | ${pair(moving(r.base!.reload), moving(r.head.reload))} |`,
    })),
    ...result.failures.map((f) => ({
      round: f.round,
      line: `| ${f.round} | ${video(f.video)} | failed on ${f.build === 'base' ? 'base' : 'this PR'} | |`,
    })),
  ].sort((a, b) => a.round - b.round)
  return [
    '| | Video | Moving, base / PR | After a reload |',
    '| ---: | --- | ---: | ---: |',
    ...rows.map((r) => r.line),
  ].join('\n')
}

/**
 * Which builds warmed host connections before Play. The page warms only a
 * build that has `warm()`, so with `--warm` one side can go unwarmed.
 */
export function warmLine(result: BenchResult) {
  const warmed = (build: BuildName) =>
    result.rounds.some((r) => r[build]?.first.warmed || r[build]?.reload.warmed)
  const base = warmed('base')
  const head = warmed('head')
  const who = base && head ? 'both' : head ? 'only this PR' : base ? 'only the base' : 'neither build'
  return `${who} warmed host connections before Play`
}

function headline(first: Context, reload: Context) {
  const moving = (c: Context) => {
    const m = measured(c, 'movingMs')
    const [base, head] = m.values
    return {
      colour: colour(m, 'time', { never: true }),
      cells: [never(base), never(head), base === null || head === null ? '' : changeText(base, head)],
    }
  }
  const amountRow = (m: Measured, kind: 'amount' | 'plays', text: (n: number) => string) => ({
    colour: colour(m, kind),
    cells: [text(m.values[0] ?? 0), text(m.values[1] ?? 0), ''],
  })
  const rows = [
    { name: 'Moving after Play', ...moving(first) },
    { name: 'Moving after a reload', ...moving(reload) },
    {
      name: 'Never moved, after reload',
      ...amountRow(
        counted(reload, (p) => METRICS.movingMs.of(p) === null),
        'plays',
        (n) => `${n} of ${reload.plays.length}`,
      ),
    },
    {
      name: 'Refused hosts, after reload',
      ...amountRow(measured(reload, 'refused'), 'amount', count),
    },
  ]
  const line = (start: string, cells: string[]) =>
    `${start}${cells[0]!.padStart(8)}${cells[1]!.padStart(10)}${cells[2]!.padStart(10)}`.trimEnd()
  return [
    '```diff',
    line(' '.repeat(30), ['base', 'this PR', 'change']),
    ...rows.map((r) => line(`${r.colour} ${r.name.padEnd(28)}`, r.cells)),
    '```',
  ].join('\n')
}

function setup(result: BenchResult) {
  const finished = result.rounds.length
  const total = finished + result.failures.length
  const chrome = result.chrome ? `Chrome ${result.chrome.split('.')[0]}` : 'Chrome'
  const budget = result.budgetMb === undefined ? '' : ` or ${result.budgetMb} MB`
  const video = result.random ? 'one random video from the share' : 'the same file'
  return [
    `${total === 1 ? 'One round' : `Each of ${total} rounds`} played ${video} on both builds, then played it again after a reload.`,
    `Production indexer and hosts, ${chrome}, up to ${result.windowMs / 1000} s${budget} per play.`,
    finished === total
      ? 'Medians of the rounds.'
      : finished === 1
        ? 'Numbers from the one round that finished.'
        : `Medians of the ${finished} rounds that finished.`,
    'Green is better and red is worse, only for a change over 0.5 s and 10% that no round contradicts.',
  ].join(' ')
}

function footer(run: Run) {
  if (!run.id) return []
  const id = run.url ? `[${run.id}](${run.url})` : run.id
  const sha = run.sha ? ` on ${run.sha.slice(0, 7)}` : ''
  const rust = run.rustRef ? ` with sia-sdk-rs ${run.rustRef}` : ''
  return ['', `<sub>Run ${id}${sha}${rust} · numbers for every play are in its artifact</sub>`]
}

export function renderReport(result: BenchResult, names: Names, run: Run = {}) {
  if (result.rounds.some((r) => !r.base)) {
    throw new Error('The results are of one build. Run with --base.')
  }
  const first = context(result, 'first')
  const reload = context(result, 'reload')
  const list = sections(first, reload)
  const changed = stepsThatChanged(list)
  const same = sameSentence(list)
  const both = (title: string, c: Context) =>
    waterfall(title, [
      { name: 'base', steps: stepMedians(c.plays.map((p) => p[0])) },
      { name: 'this PR', steps: stepMedians(c.plays.map((p) => p[1])) },
    ])
  return [
    MARKER,
    '### Streaming benchmark',
    '',
    setup(result),
    '',
    `Base \`${cell(names.base)}\` · This PR \`${cell(names.head)}\` · ${warmLine(result)}`,
    '',
    headline(first, reload),
    '',
    '<details open><summary><b>Every step that changed</b></summary>',
    '',
    ...(changed ? [changed] : []),
    ...(same ? [same] : []),
    '</details>',
    '',
    '<details><summary><b>Waterfall: what waited on what</b></summary>',
    '',
    "Time from opening the link. The viewer's wait before pressing Play is cut out.",
    '',
    '```',
    both('FIRST PLAY', first),
    '',
    both('AFTER A RELOAD', reload),
    '```',
    '</details>',
    '',
    '<details><summary><b>Each round</b></summary>',
    '',
    roundsTable(result),
    '</details>',
    ...footer(run),
  ].join('\n')
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      results: { type: 'string' },
      'base-name': { type: 'string', default: 'main' },
      'head-name': { type: 'string', default: 'HEAD' },
      'run-id': { type: 'string' },
      'run-url': { type: 'string' },
      sha: { type: 'string' },
      'rust-ref': { type: 'string' },
      out: { type: 'string' },
    },
  })
  if (!values.results || !values.out) {
    console.error('Usage: report.ts --results <file> --out <file>')
    process.exit(2)
  }
  const result = JSON.parse(readFileSync(values.results, 'utf8')) as BenchResult
  // A workflow passes an unset input as an empty string.
  const run = {
    id: values['run-id'] || undefined,
    url: values['run-url'] || undefined,
    sha: values.sha || undefined,
    rustRef: values['rust-ref'] || undefined,
  }
  const names = { base: values['base-name'], head: values['head-name'] }
  writeFileSync(values.out, `${renderReport(result, names, run)}\n`)
}

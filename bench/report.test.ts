import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  bar,
  colour,
  MARKER,
  type Measured,
  renderReport,
  shortName,
  warmLine,
  waterfall,
} from './report'
import type { BenchResult, PlayMetrics, Step, StepMedians, Timeline } from './summary'

// The results of CI run 37990737474, which compared feat/stream-warm-up with
// its base, and the comment they render as. The file is that run's artifact
// with one play per line and times rounded to the millisecond.
const FIXTURES = join(import.meta.dir, 'fixtures')
const recorded = JSON.parse(readFileSync(join(FIXTURES, 'results.json'), 'utf8')) as BenchResult
const golden = readFileSync(join(FIXTURES, 'comment.md'), 'utf8')
const names = { base: 'feat/shared-stream-handoff', head: 'feat/stream-warm-up' }
const run = { id: '37990737474', sha: 'df3c358d546124e8cdffafadb5551d614fdd432d' }

type Sample = {
  connect?: number
  // Null for a play that never moved.
  moving?: number | null
  refused?: number
  warmed?: boolean
}

const at = (startMs: number, endMs = startMs): Step => ({ startMs, endMs })

/**
 * A play that connects in 0.5 s, presses Play 10 s in, gets its first byte
 * 2 s later and moves at 3 s, unless `sample` says otherwise.
 */
function play(sample: Sample = {}): PlayMetrics {
  const playMs = 10_000
  const connected = 100 + (sample.connect ?? 500)
  const steps: Timeline['steps'] = {
    sdk: at(0, 100),
    connect: at(100, connected),
    find: at(connected, connected + 200),
    url: at(connected + 200),
    workerHosts: at(playMs, playMs + 300),
    firstHost: at(playMs + 300, playMs + 500),
    firstByte: at(playMs + 2000),
  }
  const moving = sample.moving === undefined ? 3000 : sample.moving
  if (moving !== null) {
    steps.picture = at(playMs + moving)
    steps.moving = at(playMs + moving)
  }
  return {
    timeline: { playMs, steps },
    mbPerSecond: 1.2,
    froze: moving === null,
    closedWhileConnecting: 0,
    refused: sample.refused ?? 0,
    priceRequestsPerHost: 1,
    indexerMb: 0.6,
    warmed: sample.warmed ?? false,
  }
}

/** A result of one round per pair, each build playing the same way twice. */
function result(rounds: [base: Sample, head: Sample][]): BenchResult {
  return {
    windowMs: 30_000,
    budgetMb: 60,
    chrome: '154.0.8037.97',
    random: true,
    failures: [],
    rounds: rounds.map(([base, head], i) => ({
      round: i + 1,
      video: { id: `0000000${i}`, name: `nasa-000${i}-launch.mp4` },
      base: { first: play(base), reload: play(base) },
      head: { first: play(head), reload: play(head) },
    })),
  }
}

const rounds = (count: number, base: Sample, head: Sample) =>
  Array.from({ length: count }, () => [base, head] as [Sample, Sample])

/** The lines inside the report's fenced code blocks. */
function codeLines(markdown: string) {
  const lines: string[] = []
  let inside = false
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) inside = !inside
    else if (inside) lines.push(line)
  }
  return lines
}

/** The block of every step that changed, and the sentence after it. */
function changedPart(markdown: string) {
  return markdown
    .split('<details open><summary><b>Every step that changed</b></summary>\n\n')[1]!
    .split('\n</details>')[0]!
}

describe('renderReport', () => {
  test('renders the recorded run as fixtures/comment.md', () => {
    expect(`${renderReport(recorded, names, run)}\n`).toBe(golden)
  })

  test('starts with the marker the workflow finds the comment by', () => {
    expect(golden.split('\n')[0]).toBe(MARKER)
  })

  test('links the run when its URL is known, and has no last line without a run', () => {
    const url = 'https://github.com/SiaFoundation/sia-storage-js/actions/runs/37990737474'
    expect(renderReport(recorded, names, { ...run, url, rustRef: 'abc123' })).toEndWith(
      `<sub>Run [37990737474](${url}) on df3c358 with sia-sdk-rs abc123 · numbers for every play are in its artifact</sub>`,
    )
    expect(renderReport(recorded, names)).toEndWith('</details>')
  })

  test('refuses results of one build', () => {
    const single = result(rounds(2, {}, {}))
    for (const round of single.rounds) delete round.base
    expect(() => renderReport(single, names)).toThrow('Run with --base')
  })

  test('notes a failed round in its place in the table and counts it in the setup', () => {
    const failing = result(rounds(3, {}, {}))
    failing.rounds[2]!.round = 4
    failing.failures = [
      {
        round: 3,
        build: 'head',
        video: { id: 'a1b2c3d4', name: 'nasa-0001-apollo.mp4' },
        reason: 'TimeoutError',
      },
    ]
    const rendered = renderReport(failing, names)
    expect(rendered).toContain('Each of 4 rounds played one random video')
    expect(rendered).toContain('Medians of the 3 rounds that finished.')
    expect(rendered).toContain('| 3 | `a1b2c3d4` apollo | failed on this PR | |\n| 4 | `00000002`')
  })

  test('the change is the head\'s time minus the base\'s, as both are shown', () => {
    // 7.94 s and 8.06 s are 0.12 s apart, and are shown as 7.9 s and 8.1 s.
    const rendered = renderReport(result(rounds(3, { moving: 7940 }, { moving: 8060 })), names)
    expect(rendered).toContain('  Moving after Play              7.9 s     8.1 s    +0.2 s')
  })
})

describe('colour', () => {
  // Three rounds that all changed the way the medians did.
  const steady = (base: number | null, head: number | null): Measured => ({
    values: [base, head],
    rounds: [
      [base, head],
      [base, head],
      [base, head],
    ],
  })

  test('a time is coloured only past 0.5 s and 10% of the base', () => {
    expect(colour(steady(2000, 2500), 'time')).toBe(' ')
    expect(colour(steady(10_000, 10_600), 'time')).toBe(' ')
    expect(colour(steady(5000, 5600), 'time')).toBe('-')
    expect(colour(steady(5000, 4400), 'time')).toBe('+')
  })

  test('a count is coloured only past 25% of the base and by at least 1', () => {
    expect(colour(steady(4, 5), 'amount')).toBe(' ')
    expect(colour(steady(4, 6), 'amount')).toBe('-')
    expect(colour(steady(0, 1), 'amount')).toBe('-')
    expect(colour(steady(0, 0.5), 'amount')).toBe(' ')
    expect(colour(steady(16, 4), 'amount')).toBe('+')
  })

  test('a higher delivery rate is better', () => {
    expect(colour(steady(1.1, 2.3), 'amount', { higherIsBetter: true })).toBe('+')
    expect(colour(steady(2, 0.8), 'amount', { higherIsBetter: true })).toBe('-')
  })

  test('a change is coloured only when no round goes the other way', () => {
    const faster: [number, number] = [9000, 4000]
    const slower: [number, number] = [4000, 9000]
    const slightlySlower: [number, number] = [5000, 5100]
    const tied: [number, number] = [5000, 5000]
    const medians: [number, number] = [9000, 4000]
    const of = (...rounds: [number, number][]) => colour({ values: medians, rounds }, 'time')
    expect(of(faster, faster, faster, faster, faster)).toBe('+')
    expect(of(faster, faster, faster, faster, tied)).toBe('+')
    expect(of(faster, faster, faster, faster, slightlySlower)).toBe(' ')
    expect(of(faster, faster, faster, faster, slower)).toBe(' ')
    expect(of(faster, faster, faster, tied, tied)).toBe(' ')
    expect(of(faster, faster, tied)).toBe('+')
    // One round cannot agree with itself.
    expect(of(faster)).toBe(' ')
  })

  test('four rounds one way and one slightly the other way get no colour', () => {
    // First plays in CI run 38002281676, on a pull request that does not
    // touch the SDK.
    const fluke: Measured = {
      values: [7400, 5700],
      rounds: [
        [null, 11_700],
        [5700, 6200],
        [7400, 4900],
        [7500, 4200],
        [6500, 5700],
      ],
    }
    expect(colour(fluke, 'time', { never: true })).toBe(' ')
  })

  test('a round where both builds got the same number counts for neither side', () => {
    // Connections Chrome refused after a reload in CI run 38000561203, where
    // one round refused none on either build.
    const refused: Measured = {
      values: [205, 0],
      rounds: [
        [310, 0],
        [205, 0],
        [240, 0],
        [0, 0],
        [120, 0],
      ],
    }
    expect(colour(refused, 'amount')).toBe('+')
  })

  test('a slow indexer that landed on one build in 3 of 5 rounds gets no colour', () => {
    // Connecting to the indexer in CI run 37994617483, on a pull request that
    // does not change it.
    const stalls: Measured = {
      values: [10_900, 300],
      rounds: [
        [10_900, 300],
        [13_500, 300],
        [400, 300],
        [5400, 300],
        [11_800, 12_000],
      ],
    }
    expect(colour(stalls, 'time')).toBe(' ')
  })

  test('a count of plays is coloured when it differs by half the rounds and by two', () => {
    const of = (base: number, head: number, rounds: number) =>
      colour({ values: [base, head], rounds: Array.from({ length: rounds }, () => [0, 0]) }, 'plays')
    expect(of(0, 3, 5)).toBe('-')
    expect(of(3, 0, 5)).toBe('+')
    expect(of(0, 2, 5)).toBe(' ')
    expect(of(1, 2, 5)).toBe(' ')
    expect(of(0, 2, 3)).toBe('-')
    expect(of(0, 1, 1)).toBe(' ')
  })

  test('a step a build never reached is worse than any time, when told so', () => {
    expect(colour(steady(null, 3000), 'time', { never: true })).toBe('+')
    expect(colour(steady(3000, null), 'time', { never: true })).toBe('-')
    expect(colour(steady(null, null), 'time', { never: true })).toBe(' ')
    expect(colour(steady(null, 3000), 'time')).toBe(' ')
  })

  test('two runs of the same build that differ only by noise get no colour', () => {
    // The reloads of CI run 37978651585, which compared a pull request that
    // does not touch the SDK with its base: 3 rounds slower, 2 faster.
    const noise: Measured = {
      values: [24_100, 13_900],
      rounds: [
        [5700, 11_000],
        [24_600, 13_900],
        [15_200, null],
        [null, 13_200],
        [24_100, null],
      ],
    }
    expect(colour(noise, 'time', { never: true })).toBe(' ')
  })

  test('only the PR line of a changed row is coloured', () => {
    const coloured = changedPart(golden)
      .split('\n')
      .filter((l) => /^[+-]/.test(l))
    expect(coloured.length).toBeGreaterThan(0)
    expect(coloured.filter((l) => !/^[+-] {3}this PR /.test(l))).toEqual([])
  })
})

describe('every step that changed', () => {
  test('rows both builds share are left out and named in one sentence', () => {
    const part = changedPart(renderReport(result(rounds(3, {}, {})), names))
    expect(part).toStartWith('Same on both builds, so not shown: 0.5 s to connect to the indexer, ')
    expect(part).toContain(', no file lookup needed, first host connected at 0.5 s, ')
    expect(part).toEndWith(
      ', 1.2 MB/s delivered, no connections dropped while opening, freezes or refused connections, 1.0 price requests per host on the first play.',
    )
  })

  test('a section with nothing changed is left out with its title', () => {
    const part = changedPart(renderReport(result(rounds(3, {}, { connect: 1500 })), names))
    expect(part).toContain('  BEFORE PLAY\n')
    expect(part).not.toContain('AFTER PRESSING PLAY')
    expect(part).not.toContain('0.5 s to connect to the indexer')
  })

  test('the change ends at the same column on every line that has one', () => {
    const withChange = changedPart(golden)
      .split('\n')
      .filter((l) => /this PR .* s {2,}[+−]?\d+\.\d s$/.test(l))
    expect(withChange.length).toBeGreaterThan(0)
    expect(withChange.filter((l) => l.length !== 72)).toEqual([])
  })

  test('the times in a section share one scale that fits 36 characters', () => {
    const part = changedPart(renderReport(result(rounds(3, { connect: 12_700 }, {})), names))
    // 12.7 s at 2 characters a second, with a tick every 5 s.
    expect(part).toContain(`  BEFORE PLAY\n${' '.repeat(16)}0s        5s        10s       15s\n`)
    expect(part).toContain(`    base        ${bar(25.4)} 12.7 s\n`)
    expect(part).toContain(`+   this PR     ${bar(1)} 0.5 s`)
  })
})

describe('waterfall', () => {
  // A base that finds the file and then waits on its host list after Play,
  // and a head whose warm-up opens the hosts before Play.
  const base: StepMedians = {
    before: {
      sdk: { startMs: 0, endMs: 200 },
      connect: { startMs: 200, endMs: 2200 },
      find: { startMs: 2200, endMs: 3000 },
    },
    after: {
      workerHosts: { startMs: 0, endMs: 500 },
      firstHost: { startMs: 500, endMs: 1000 },
      firstByte: { startMs: 1500, endMs: 1500 },
      picture: { startMs: 2900, endMs: 2900 },
      moving: { startMs: 3000, endMs: 3000 },
    },
  }
  const head: StepMedians = {
    before: {
      sdk: { startMs: 0, endMs: 200 },
      connect: { startMs: 200, endMs: 1200 },
      find: { startMs: 1200, endMs: 1600 },
      warm: { startMs: 1600, endMs: 4000 },
      workerHosts: { startMs: 1700, endMs: 2500 },
      firstHost: { startMs: 2500, endMs: 3000 },
    },
    after: {
      firstByte: { startMs: 300, endMs: 300 },
      moving: { startMs: 1000, endMs: 1000 },
    },
  }
  // The label, then the column counted from the chart's start, then what is
  // drawn there.
  const drawnAt = (label: string, column: number, drawn: string) =>
    `    ${label.padEnd(16)}${' '.repeat(column)}${drawn}`

  test('places steps before Play from the page start and the rest from Play', () => {
    // The base's video moves 6.0 s in, so 6 characters a second is the most
    // that keeps its line within 76 characters.
    expect(
      waterfall('FIRST PLAY', [
        { name: 'base', steps: base },
        { name: 'this PR', steps: head },
      ]).split('\n'),
    ).toEqual([
      '  FIRST PLAY',
      `${' '.repeat(20)}0s          2s          4s          6s          8s`,
      '  base',
      drawnAt('load the SDK', 0, '█▎ 0.2 s'),
      drawnAt('connect', 1, '████████████ 2.0 s'),
      drawnAt('find the file', 13, '████▊ 0.8 s'),
      drawnAt('Play', 18, '▼'),
      drawnAt('host list', 18, '███ 0.5 s'),
      drawnAt('first host', 21, '███ 0.5 s'),
      drawnAt('first byte', 27, '▏ 1.5 s after Play'),
      drawnAt('video moving', 36, '▏ 3.0 s after Play'),
      '  this PR',
      drawnAt('load the SDK', 0, '█▎ 0.2 s'),
      drawnAt('connect', 1, '██████ 1.0 s'),
      drawnAt('find the file', 7, '██▍ 0.4 s'),
      drawnAt('warm up hosts', 10, '██████████████▍ 2.4 s'),
      drawnAt('host list', 10, '████▊ 0.8 s'),
      drawnAt('first host', 15, '███ 0.5 s'),
      // Play is where the warm-up, the last step before it, ended.
      drawnAt('Play', 24, '▼'),
      drawnAt('first byte', 26, '▏ 0.3 s after Play'),
      drawnAt('video moving', 30, '▏ 1.0 s after Play'),
    ])
  })

  test('a step that starts exactly half a column in is drawn in the earlier column', () => {
    // A video that moves 30 s after Play is drawn at 1 character a second, so
    // a find that starts 0.5 s in starts half a column in.
    const drawn = waterfall('AFTER A RELOAD', [
      {
        name: 'base',
        steps: {
          before: { connect: { startMs: 0, endMs: 500 }, find: { startMs: 500, endMs: 600 } },
          after: { moving: { startMs: 30_000, endMs: 30_000 } },
        },
      },
    ])
    expect(drawn).toContain(
      `${drawnAt('connect', 0, '▌ 0.5 s')}\n${drawnAt('find the file', 0, '▏ 0.1 s')}`,
    )
  })

  test('a step a build did not take is left out', () => {
    const drawn = waterfall('AFTER A RELOAD', [
      { name: 'base', steps: { before: {}, after: { firstByte: { startMs: 900, endMs: 900 } } } },
    ])
    const lines = drawn.split('\n').slice(2)
    expect(lines.map((l) => l.trim().split(/ {2,}/)[0])).toEqual(['base', 'Play', 'first byte'])
    expect(lines[1]).toBe(drawnAt('Play', 0, '▼'))
  })
})

describe('line widths', () => {
  test('every line inside a code block is at most 78 characters', () => {
    const slow: Sample = { connect: 41_000, moving: 59_900, refused: 12_345 }
    const long = { ...result(rounds(3, slow, { moving: 100 })), windowMs: 60_000 }
    for (const rendered of [golden, renderReport(long, names, run)]) {
      const lines = codeLines(rendered)
      expect(lines.length).toBeGreaterThan(20)
      expect(lines.filter((l) => l.length > 78)).toEqual([])
    }
  })
})

describe('warmLine', () => {
  const warmed = (base: boolean, head: boolean) =>
    warmLine(result(rounds(2, { warmed: base }, { warmed: head })))

  test('names which builds warmed host connections before Play', () => {
    expect(warmed(true, true)).toBe('both warmed host connections before Play')
    expect(warmed(false, true)).toBe('only this PR warmed host connections before Play')
    expect(warmed(true, false)).toBe('only the base warmed host connections before Play')
    expect(warmed(false, false)).toBe('neither build warmed host connections before Play')
  })
})

describe('shortName', () => {
  test('drops the share prefix, a leading date, a trailing ID and the extension', () => {
    expect(
      shortName('nasa-0113-7-1-19-andrew-morgan-interviews-from-gctc-russia-12211.mp4'),
    ).toBe('andrew-morgan-interviews-from-gctc-russia')
    expect(shortName('nasa-0421-nasa-spacex-clps-im-1-launch-720p.mp4')).toBe(
      'spacex-clps-im-1-launch-720p',
    )
    expect(shortName('Apollo 11.mov')).toBe('Apollo 11')
  })
})

describe('bar', () => {
  test('ends in an eighth block for a fraction of a character', () => {
    expect(bar(3)).toBe('███')
    expect(bar(2.5)).toBe('██▌')
    expect(bar(1.375)).toBe('█▍')
  })

  test('a zero still draws the thinnest block', () => {
    expect(bar(0)).toBe('▏')
  })
})

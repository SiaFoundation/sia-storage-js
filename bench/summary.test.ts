import { describe, expect, test } from 'bun:test'
import {
  type BenchEvent,
  budgetReachedAt,
  METRICS,
  type Metric,
  medians,
  type PlayMetrics,
  type Step,
  stepMedians,
  summarizePlay,
  type Timeline,
} from './summary'

const PLAY = 100_000
const WINDOW = 45_000

function event(
  from: BenchEvent['from'],
  name: string,
  afterPlayMs: number,
  detail: Record<string, unknown> = {},
): BenchEvent {
  return { at: PLAY + afterPlayMs, from, name, ...detail }
}

const click = event('page', 'play-clicked', 0)
// The page started 30 s before Play.
const start = event('page', 'page-start', -30_000)
const http = (name: string, at: number, url: string, detail = {}) =>
  event('worker', name, at, { url: `https://sia.storage${url}`, ...detail })
const LOOKUP = `/shared/objects/${'ab'.repeat(32)}`

const read = (play: PlayMetrics, metric: Metric) => METRICS[metric].of(play)

describe('summarizePlay', () => {
  test('the first byte, the picture and the video moving are timed from the Play click', () => {
    const play = summarizePlay(
      [
        click,
        event('worker', 'request-first-byte', 3000),
        event('media', 'canplay', 5000),
        event('media', 'playing', 17_000),
      ],
      WINDOW,
    )
    expect(read(play, 'firstByteMs')).toBe(3000)
    expect(read(play, 'pictureMs')).toBe(5000)
    expect(read(play, 'movingMs')).toBe(17_000)
    expect(play.froze).toBe(false)
  })

  test('a play that never moves counts as frozen', () => {
    const play = summarizePlay([click, event('worker', 'request-first-byte', 900)], WINDOW)
    expect(read(play, 'movingMs')).toBeNull()
    expect(play.froze).toBe(true)
  })

  test('a step reached after the window does not count', () => {
    const play = summarizePlay([click, event('media', 'canplay', WINDOW + 1)], WINDOW)
    expect(read(play, 'pictureMs')).toBeNull()
  })

  const frozeAfter = (...media: [name: string, at: number][]) =>
    summarizePlay([click, ...media.map(([name, at]) => event('media', name, at))], WINDOW).froze

  test('a stop for data of more than a second after the video has moved is a freeze', () => {
    expect(frozeAfter(['playing', 2000], ['waiting', 10_000], ['playing', 14_000])).toBe(true)
    expect(frozeAfter(['playing', 2000], ['waiting', 10_000], ['playing', 10_600])).toBe(false)
  })

  test('a video still waiting when the window closes is frozen to its end', () => {
    expect(frozeAfter(['playing', 2000], ['waiting', 30_000])).toBe(true)
  })

  test('waiting for data before the video first moves is not a freeze', () => {
    expect(frozeAfter(['waiting', 500], ['canplay', 5000], ['playing', 5500])).toBe(false)
  })

  test('a stop with several waiting events is timed from the first', () => {
    expect(
      frozeAfter(['playing', 2000], ['waiting', 10_000], ['waiting', 10_800], ['playing', 11_300]),
    ).toBe(true)
  })

  const request = (id: number, at: number) =>
    event('worker', 'request-start', at, { request: id })
  const progress = (id: number, at: number, mb: number) =>
    event('worker', 'request-progress', at, { request: id, bytes: mb * 1e6 })

  test('megabytes delivered is each request\'s latest count, summed', () => {
    const play = summarizePlay(
      [
        click,
        request(1, 100),
        progress(1, 5000, 4),
        progress(1, 6000, 10),
        request(2, 7000),
        progress(2, 9000, 4),
        progress(2, 40_000, 30),
        progress(2, WINDOW + 500, 500),
      ],
      WINDOW,
    )
    expect(play.mbPerSecond).toBeCloseTo(40 / 45)
  })

  test('a request ID used again after the worker restarts is a new request', () => {
    const play = summarizePlay(
      [
        click,
        request(1, 100),
        progress(1, 5000, 10),
        event('worker', 'worker-boot', 20_000),
        request(1, 20_100),
        progress(1, 22_000, 6),
      ],
      WINDOW,
    )
    expect(play.mbPerSecond).toBeCloseTo(16 / 45)
  })

  test('a request that began before Play is not counted', () => {
    const play = summarizePlay(
      [request(1, -2000), click, progress(1, 500, 50), request(2, 600), progress(2, 3000, 8)],
      WINDOW,
    )
    expect(play.mbPerSecond).toBeCloseTo(8 / 45)
  })

  test('recording stops once the budget has reached the video', () => {
    const events = [
      click,
      request(1, 100),
      progress(1, 4000, 30),
      progress(1, 8000, 61),
      event('media', 'playing', 9000),
      progress(1, 12_000, 90),
    ]
    expect(budgetReachedAt(events, 60)).toBe(PLAY + 8000)
    const play = summarizePlay(events, WINDOW, 60)
    expect(play.mbPerSecond).toBeCloseTo(61 / 8)
    // The video moved after the budget was reached, so not while recording.
    expect(read(play, 'movingMs')).toBeNull()
  })

  test('a budget the play never reaches leaves the full window', () => {
    const events = [click, request(1, 100), progress(1, 4000, 20)]
    expect(budgetReachedAt(events, 60)).toBeNull()
    expect(summarizePlay(events, WINDOW, 60).mbPerSecond).toBeCloseTo(20 / 45)
  })

  test('failed connections are split by who ended them', () => {
    const failed = (error: string) => event('worker', 'host-failed', 200, { error })
    const play = summarizePlay(
      [
        click,
        failed('close() is called while connecting.'),
        failed('Connection lost.'),
        failed('Connection lost.'),
        failed('Opening handshake failed.'),
      ],
      WINDOW,
    )
    expect(play.closedWhileConnecting).toBe(1)
    expect(play.refused).toBe(2)
  })

  test('price requests are averaged over the hosts asked', () => {
    const price = (host: string) =>
      event('worker', 'rpc-request', 300, { host, call: 'Settings' })
    const play = summarizePlay(
      [
        click,
        price('a:1'),
        price('a:1'),
        price('a:1'),
        price('b:1'),
        event('worker', 'rpc-request', 300, { host: 'a:1', call: 'ReadSector' }),
      ],
      WINDOW,
    )
    expect(play.priceRequestsPerHost).toBe(2)
  })

  test('counts the megabytes the page read from the indexer', () => {
    const body = (at: number, path: string, bytes: number) =>
      event('page', 'http-body', at, { url: `https://sia.storage${path}`, bytes })
    const play = summarizePlay(
      [body(-20_000, '/shared/objects', 57_600_000), body(-30_000, '/shared/hosts', 20_000), click],
      WINDOW,
    )
    expect(play.indexerMb).toBeCloseTo(57.62)
  })

  test('a play is warmed only when the build ran warm()', () => {
    const warmed = summarizePlay(
      [event('page', 'warm-start', -3000), event('page', 'warm-done', -2000), click],
      WINDOW,
    )
    expect(warmed.warmed).toBe(true)
    expect(summarizePlay([click], WINDOW).warmed).toBe(false)
  })
})

describe('timeline', () => {
  test('steps before Play are timed from the page start, from their marks\' durations', () => {
    const play = summarizePlay(
      [
        start,
        event('page', 'page-wasm', -29_000, { ms: 600 }),
        event('page', 'page-connect', -25_000, { ms: 4000 }),
        event('page', 'page-object', -24_000, { ms: 1000 }),
        event('page', 'stream-url-ready', -23_900, { ms: 100 }),
        event('page', 'warm-start', -23_900),
        event('page', 'warm-done', -22_000),
        click,
      ],
      WINDOW,
    )
    expect(play.timeline).toEqual({
      playMs: 30_000,
      steps: {
        sdk: { startMs: 400, endMs: 1000 },
        connect: { startMs: 1000, endMs: 5000 },
        find: { startMs: 5000, endMs: 6000 },
        url: { startMs: 6000, endMs: 6100 },
        warm: { startMs: 6100, endMs: 8000 },
      },
    })
    expect(read(play, 'connectMs')).toBe(4000)
    expect(read(play, 'findMs')).toBe(1000)
  })

  test('the worker\'s calls run from the first start to the last one\'s last byte', () => {
    const play = summarizePlay(
      [
        start,
        click,
        http('http-start', 100, '/shared/hosts', { id: 1 }),
        http('http-body', 900, '/shared/hosts', { id: 1, ms: 800 }),
        http('http-start', 1000, '/shared/hosts', { id: 2 }),
        http('http-end', 2400, '/shared/hosts', { id: 2, ms: 1400 }),
        // Reported after the SDK aborted the request, so it arrives late.
        http('http-body', 3100, '/shared/hosts', { id: 2, ms: 1500 }),
        http('http-start', 2500, LOOKUP, { id: 3 }),
        http('http-body', 3000, LOOKUP, { id: 3, ms: 500 }),
      ],
      WINDOW,
    )
    expect(play.timeline.steps.workerHosts).toEqual({ startMs: 30_100, endMs: 32_500 })
    expect(play.timeline.steps.workerLookup).toEqual({ startMs: 32_500, endMs: 33_000 })
    expect(read(play, 'workerHostsMs')).toBe(2400)
    expect(read(play, 'workerLookupMs')).toBe(500)
  })

  test('a worker call that did not happen, or never answered, takes no time', () => {
    const play = summarizePlay(
      [start, click, http('http-start', 100, '/shared/hosts', { id: 1 })],
      WINDOW,
    )
    expect(play.timeline.steps.workerHosts).toBeUndefined()
    expect(read(play, 'workerHostsMs')).toBe(0)
    expect(read(play, 'workerLookupMs')).toBe(0)
  })

  test('a worker call a warm-up made before Play takes no time after it', () => {
    const play = summarizePlay(
      [
        start,
        http('http-start', -5000, '/shared/hosts', { id: 1 }),
        http('http-body', -4000, '/shared/hosts', { id: 1, ms: 1000 }),
        click,
      ],
      WINDOW,
    )
    expect(play.timeline.steps.workerHosts).toEqual({ startMs: 25_000, endMs: 26_000 })
    expect(read(play, 'workerHostsMs')).toBe(0)
  })

  test('the first host connection ends at the first handshake after the first dial', () => {
    const play = summarizePlay(
      [
        start,
        click,
        event('worker', 'host-connect', 3000, { host: 'a:1' }),
        event('worker', 'host-connect', 3100, { host: 'b:1' }),
        event('worker', 'host-ready', 3400, { host: 'b:1' }),
        event('worker', 'host-ready', 3600, { host: 'a:1' }),
      ],
      WINDOW,
    )
    expect(play.timeline.steps.firstHost).toEqual({ startMs: 33_000, endMs: 33_400 })
    expect(read(play, 'firstHostMs')).toBe(3400)
  })

  test('a host a warm-up connected before Play is connected at once', () => {
    const play = summarizePlay(
      [
        start,
        event('worker', 'host-connect', -4000, { host: 'a:1' }),
        event('worker', 'host-ready', -3500, { host: 'a:1' }),
        click,
      ],
      WINDOW,
    )
    expect(read(play, 'firstHostMs')).toBe(0)
  })

  test('first byte, picture and moving are moments', () => {
    const { timeline } = summarizePlay(
      [
        start,
        click,
        event('worker', 'request-first-byte', 1600),
        event('media', 'canplay', 3700),
        event('media', 'playing', 3800),
      ],
      WINDOW,
    )
    expect(timeline.steps.firstByte).toEqual({ startMs: 31_600, endMs: 31_600 })
    expect(timeline.steps.picture).toEqual({ startMs: 33_700, endMs: 33_700 })
    expect(timeline.steps.moving).toEqual({ startMs: 33_800, endMs: 33_800 })
  })

  test('steps that did not happen are absent, not zero', () => {
    const { timeline } = summarizePlay(
      [
        start,
        event('page', 'page-connect', -25_000, { ms: 4000 }),
        // A failed stream URL is not a step taken.
        event('page', 'stream-url-ready', -24_000, { ms: 100, error: 'Error: no' }),
        event('page', 'warm-start', -23_000),
        click,
        event('worker', 'host-connect', 3000, { host: 'a:1' }),
      ],
      WINDOW,
    )
    expect(Object.keys(timeline.steps)).toEqual(['connect'])
  })
})

const play = (steps: Timeline['steps'], playMs = 20_000): PlayMetrics => ({
  timeline: { playMs, steps },
  mbPerSecond: 0.9,
  froze: false,
  closedWhileConnecting: 0,
  refused: 0,
  priceRequestsPerHost: 1,
  indexerMb: 0.2,
  warmed: false,
})
const at = (startMs: number, endMs = startMs): Step => ({ startMs, endMs })

describe('medians', () => {
  test('takes the middle play', () => {
    const result = medians([
      play({ moving: at(24_000) }),
      play({ moving: at(29_000) }),
      play({ moving: at(25_000) }),
    ])
    expect(result.movingMs).toBe(5000)
  })

  test('a step most plays never reached has no median', () => {
    const result = medians([play({}), play({}), play({ moving: at(25_000) })])
    expect(result.movingMs).toBeNull()
  })
})

describe('stepMedians', () => {
  test('takes the median start and the median duration of each step', () => {
    const result = stepMedians([
      play({ connect: at(1000, 5000) }),
      play({ connect: at(3000, 4000) }),
      play({ connect: at(2000, 9000) }),
    ])
    expect(result.before.connect).toEqual({ startMs: 2000, endMs: 6000 })
  })

  test('steps after Play are timed from Play, whatever the wait before it', () => {
    const result = stepMedians([
      play({ picture: at(23_000) }, 20_000),
      play({ picture: at(39_000) }, 35_000),
      play({ picture: at(30_000) }, 25_000),
    ])
    expect(result.after.picture).toEqual({ startMs: 4000, endMs: 4000 })
    expect(result.before.picture).toBeUndefined()
  })

  test('a worker call made by a warm-up is a step before Play', () => {
    const result = stepMedians([
      play({ workerHosts: at(8000, 9000) }),
      play({ workerHosts: at(8500, 9500) }),
    ])
    expect(result.before.workerHosts).toEqual({ startMs: 8000, endMs: 9000 })
    expect(result.after.workerHosts).toBeUndefined()
  })

  test('a step most plays skipped is absent', () => {
    const result = stepMedians([play({ workerLookup: at(21_000, 22_000) }), play({}), play({})])
    expect(result.after.workerLookup).toBeUndefined()
    expect(result.before.workerLookup).toBeUndefined()
  })

  test('a step some plays skipped counts them as its slowest', () => {
    const result = stepMedians([
      play({ moving: at(22_000) }),
      play({ moving: at(25_000) }),
      play({}),
    ])
    expect(result.after.moving).toEqual({ startMs: 5000, endMs: 5000 })
  })
})

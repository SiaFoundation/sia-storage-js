/*
 * The benchmark page: the smallest app that plays a shared video through the
 * SDK's streaming worker, with every wait recorded.
 *
 * It opens the share named in the address fragment, looks one file up, makes
 * its stream URL and waits. A click on Play hands the URL to a plain
 * `<video>`, which is what a site using the SDK does. The runner reads
 * `bench.events` afterwards.
 *
 * With `list=videos` in place of `file`, it only lists the share's videos
 * into `bench.videos` and stops, so the runner can pick one per round.
 *
 * The fragment carries `seed` and `file` (an object ID), and optionally:
 * - `indexer`, in place of https://sia.storage.
 * - `warm` to open connections to the file's first hosts before the click,
 *   with the SDK's `warm()`. A build without it is not warmed.
 * A fragment never reaches a server, so the seed stays in the browser.
 */
import {
  enableStreaming,
  initSia,
  openStreams,
  SharedSdk,
} from '/dist/index.js'

const params = new URLSearchParams(location.hash.slice(1))
const seed = params.get('seed')
const fileId = params.get('file')
const indexerUrl = params.get('indexer') ?? 'https://sia.storage'

const video = document.getElementById('video')
const button = document.getElementById('play')
const state = document.getElementById('state')

// Milliseconds since the epoch, so page and worker clocks line up.
const now = () => performance.timeOrigin + performance.now()
// Navigation start, not this line's time, so the timeline also covers
// fetching this module and the SDK it imports.
const events = [{ at: performance.timeOrigin, from: 'page', name: 'page-start' }]
const mark = (name, detail = {}) =>
  events.push({ at: now(), from: 'page', name, ...detail })

/** Marks `name` when `run` settles, with how long it took. */
async function timed(name, run) {
  const started = now()
  try {
    const result = await run()
    mark(name, { ms: now() - started })
    return result
  } catch (error) {
    mark(name, { ms: now() - started, error: String(error).slice(0, 200) })
    throw error
  }
}

// The hooks' reports, from this page and from the service worker.
new BroadcastChannel('sia-bench').addEventListener('message', (event) => {
  events.push(event.data)
})

for (const name of ['canplay', 'playing', 'waiting']) {
  video.addEventListener(name, () => events.push({ at: now(), from: 'media', name }))
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.addEventListener('load', resolve)
    script.addEventListener('error', () => reject(new Error(`${src} failed`)))
    document.head.append(script)
  })
}

/**
 * A file's name and type from its metadata, which is JSON written by the app
 * that uploaded it. The create-sia-app template and the Sia Storage app both
 * write `name` and `type`, and the Sia Storage app marks thumbnails with
 * `kind: 'thumb'`. Sialo writes `{ type: 'sialo-object-meta', filename }`,
 * where `type` names the metadata format, not the file's.
 */
function readMetadata(bytes) {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes))
    const text = (key) =>
      typeof value?.[key] === 'string' && value[key] !== '' ? value[key] : undefined
    if (value?.type === 'sialo-object-meta') return { name: text('filename') }
    return { name: text('name'), type: text('type'), kind: text('kind') }
  } catch {
    return {}
  }
}

// Sialo writes no type, so a file without one is typed by its name.
const VIDEO_EXTENSIONS = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
}

function videoType({ name, type }) {
  if (type) return type.startsWith('video/') ? type : undefined
  return VIDEO_EXTENSIONS[name?.split('.').pop()?.toLowerCase()]
}

const PAGE_SIZE = 500

/**
 * Every video in the share, by its metadata's type or its name. Uses the
 * listing without storage layouts where the build has one, since a share of
 * many files makes the full listing slow. A build ahead of the production
 * indexer can have that listing and fail to read its answer, so the full
 * listing is the fallback for that too.
 */
async function listVideos(sdk) {
  if (typeof sdk.objectSummaries === 'function') {
    try {
      return await listVideosBy(sdk, true)
    } catch {
      // Falls through to the full listing.
    }
  }
  return listVideosBy(sdk, false)
}

async function listVideosBy(sdk, summaries) {
  const videos = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = summaries
      ? await sdk.objectSummaries(offset, PAGE_SIZE)
      : await sdk.objects(offset, PAGE_SIZE)
    for (const entry of page) {
      const metadata = readMetadata(summaries ? entry.metadata : entry.metadata())
      if (metadata.kind !== 'thumb' && videoType(metadata)) {
        videos.push({ id: summaries ? entry.id : entry.id(), name: metadata.name })
      }
    }
    if (page.length < PAGE_SIZE) return videos
  }
}

/** Opens the share and makes the file's stream URL, as an app showing a player does. */
async function open() {
  if (!seed || !fileId) throw new Error('The address needs #seed= and file=')
  // The hooks must be in place before the SDK makes its first call.
  await loadScript('/bench/page/hooks.js')
  const streaming = enableStreaming({ workerUrl: '/bench/page/worker.js' })
  await timed('page-wasm', initSia)
  const sdk = await timed('page-connect', () => SharedSdk.connect(indexerUrl, seed))
  const object = await timed('page-object', () => sdk.object(fileId))
  // Without the worker the SDK would read the whole file into memory.
  if (!(await streaming)) {
    throw new Error('This browser cannot stream through the service worker')
  }
  const streams = openStreams(sdk, { indexerUrl, seed })
  const type = videoType(readMetadata(object.metadata())) ?? 'video/mp4'
  return timed('stream-url-ready', () => streams.url(object, { name: 'bench', type }))
}

/**
 * Opens connections to the hosts holding the file's start with the SDK's
 * `warm()`. Reading the first byte instead would warm a build that has no
 * `warm()`, and a comparison against the build that adds it would show no
 * difference.
 */
async function warm(file) {
  if (typeof file.warm !== 'function') return
  mark('warm-start')
  await file.warm()
  mark('warm-done')
}

function fail(error) {
  state.textContent = `failed: ${error.message}`
}

window.bench = { events }

if (params.get('list') === 'videos') {
  ;(async () => {
    await initSia()
    const sdk = await SharedSdk.connect(indexerUrl, seed)
    window.bench.videos = await listVideos(sdk)
    state.textContent = 'listed'
  })().catch(fail)
} else {
  const ready = open().then(async (file) => {
    if (params.has('warm')) await warm(file)
    return file
  })
  ready
    .then(() => {
      state.textContent = 'ready'
      button.disabled = false
    })
    .catch(fail)

  button.addEventListener('click', async () => {
    button.disabled = true
    const file = await ready
    mark('play-clicked')
    video.src = file.url
    state.textContent = 'playing'
  })
}

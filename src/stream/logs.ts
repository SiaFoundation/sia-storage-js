/**
 * The streaming worker's log, sent to the pages that asked for it with
 * `enableStreaming({ logLevel })`.
 *
 * A service worker's console is not the page's console, so an SDK panic in
 * the worker, which stops every stream it serves, otherwise shows nowhere a
 * visitor or developer looks. The relay forwards three things: the SDK's own
 * log lines, the panic message the SDK's WebAssembly prints, and errors and
 * promise rejections that nothing in the worker caught. Each page gets the
 * lines at its level or above, in batches.
 */
import {
  isLogLevel,
  LOG_LEVELS,
  type LogLine,
  type StreamLogLevel,
  type WorkerMessage,
} from './protocol'

// How long lines collect before they are sent, so a busy stream's debug log
// costs a few messages a second rather than one per line.
const LOG_INTERVAL = 250
// Room for a panic message and the stack trace the panic hook appends to it.
const MAX_LINE = 4000
// How often sending lines also checks for closed pages, so the SDK stops
// logging at a page's level once that page has gone and no other asks.
const CLOSED_CHECK_INTERVAL = 10_000

type LogClient = { id: string; postMessage(message: unknown): void }

export type LogScope = {
  clients: { get(id: string): Promise<LogClient | undefined> }
  addEventListener(
    type: 'error',
    listener: (event: { error?: unknown; message?: string }) => void,
  ): void
  addEventListener(
    type: 'unhandledrejection',
    listener: (event: { reason?: unknown }) => void,
  ): void
}

export type LogRelay = {
  /** Sends `client` the lines at `level` and above. A non-level is ignored. */
  subscribe(client: LogClient, level: unknown): void
  /** One line from the SDK's `setLogger` callback. */
  sdk(line: string): void
}

/**
 * Cuts the query string and fragment from every URL in `text`. The SDK signs
 * each request to the indexer in its query string (`sv`, `sc` and the
 * signature `ss`), and its fetch errors print the full URL, and a share URL
 * carries the file's encryption key in its fragment. Host keys and host
 * addresses stay, since they are public and say which host failed.
 */
export function redactLogLine(text: string) {
  return text
    .replace(
      // Everything from `?` or `#` to the next space goes, parentheses
      // included, except closing brackets and quotes at its end, such as the
      // `)` of reqwest's "error sending request for url (...)".
      /\b((?:https?|wss?|sia):\/\/[^\s?#"'<>]*)[?#]\S*?(?=["'>)\]]*(?:\s|$))/gi,
      '$1?[redacted]',
    )
    .slice(0, MAX_LINE)
}

/**
 * `onLevel` gets the most verbose level any open page asked for, or `off`
 * once none is left, which is what the SDK's logger should be set to.
 */
export function createLogRelay(
  scope: LogScope,
  onLevel: (level: StreamLogLevel | 'off') => void,
): LogRelay {
  // Each subscribed page's level, as an index into LOG_LEVELS, by client id.
  const pages = new Map<string, { client: LogClient; rank: number }>()
  let level: StreamLogLevel | 'off' = 'off'
  let queue: LogLine[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let watchingPanics = false
  let checkedClosedAt = Date.now()

  function updateLevel() {
    const ranks = [...pages.values()].map(({ rank }) => rank)
    const next = ranks.length ? LOG_LEVELS[Math.max(...ranks)]! : 'off'
    if (next === level) return
    level = next
    onLevel(next)
  }

  // A reloaded or closed page never says it has gone, so the pages are checked
  // whenever another one subscribes.
  async function dropClosedPages() {
    checkedClosedAt = Date.now()
    await Promise.all(
      [...pages.keys()].map(async (id) => {
        if (!(await scope.clients.get(id).catch(() => undefined))) {
          pages.delete(id)
        }
      }),
    )
    updateLevel()
  }

  function flush() {
    clearTimeout(timer)
    timer = undefined
    if (Date.now() - checkedClosedAt >= CLOSED_CHECK_INTERVAL) {
      void dropClosedPages()
    }
    const lines = queue
    queue = []
    for (const { client, rank } of pages.values()) {
      const wanted = lines.filter(
        (line) => LOG_LEVELS.indexOf(line.level) <= rank,
      )
      if (wanted.length === 0) continue
      try {
        client.postMessage({
          type: 'sia-log',
          lines: wanted,
        } satisfies WorkerMessage)
      } catch {
        // The page may already be gone.
      }
    }
  }

  function add(lineLevel: StreamLogLevel, message: string) {
    if (pages.size === 0) return
    queue.push({ level: lineLevel, message: redactLogLine(message) })
    // A stream's own failure reaches its page at once, so an error does too,
    // and prints next to the failure it caused rather than after it.
    if (lineLevel === 'error') flush()
    else timer ??= setTimeout(flush, LOG_INTERVAL)
  }

  // The SDK's panic hook reports a panic only by passing its message to
  // console.error in the worker. The error the panic then raises names only
  // the WebAssembly trap, not the panic.
  function watchPanics() {
    if (watchingPanics) return
    watchingPanics = true
    const error = console.error
    console.error = (...args: unknown[]) => {
      const [first] = args
      if (typeof first === 'string' && first.startsWith('panicked at ')) {
        add('error', first)
      }
      error.apply(console, args)
    }
  }

  scope.addEventListener('error', (event) =>
    add(
      'error',
      event.error instanceof Error
        ? `Uncaught ${describe(event.error)}`
        : (event.message ?? `Uncaught ${String(event.error)}`),
    ),
  )
  scope.addEventListener('unhandledrejection', (event) =>
    add('error', `Unhandled rejection: ${describe(event.reason)}`),
  )

  return {
    subscribe(client, requested) {
      if (!isLogLevel(requested)) return
      const known = pages.has(client.id)
      pages.set(client.id, { client, rank: LOG_LEVELS.indexOf(requested) })
      watchPanics()
      updateLevel()
      if (!known) void dropClosedPages()
    },
    sdk(line) {
      // setLogger formats each line as "[LEVEL] message".
      const match = /^\[(ERROR|WARN|INFO|DEBUG|TRACE)\] ([\s\S]*)$/.exec(line)
      const lineLevel = match?.[1]?.toLowerCase()
      add(isLogLevel(lineLevel) ? lineLevel : 'info', match?.[2] ?? line)
    },
  }
}

function describe(error: unknown) {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error)
}

/*
 * A stopwatch on everything the SDK waits for. The benchmark page loads this
 * file before it starts the SDK, and the benchmark's service worker loads it
 * before the SDK's own worker. It wraps the globals the SDK reaches the
 * network through, so the SDK itself runs unchanged.
 *
 * Each event goes out on a BroadcastChannel that the page collects into
 * `bench.events`. Nothing leaves the browser.
 *
 * What is timed:
 * - `http-*`: one HTTP call, such as the SDK connecting to the indexer,
 *   looking up an object or listing hosts. `http-end` is its headers and
 *   `http-body` its last byte.
 * - `host-*`: one WebTransport session to a storage host, from its dial to
 *   its handshake finishing or failing.
 * - `rpc-request`: one call to a host, by name, such as `Settings` for its
 *   prices or `ReadSector`.
 * - `request-*`, in the worker only: one range request from a media element,
 *   from the fetch event to its last byte.
 *
 * Query strings are dropped from every URL, because the indexer's carry a
 * signature made with the sharing key.
 */
;(() => {
  const inWorker = typeof importScripts === 'function'
  const from = inWorker ? 'worker' : 'page'
  const channel = new BroadcastChannel('sia-bench')
  const now = () => performance.timeOrigin + performance.now()
  let sequence = 0

  function emit(name, detail) {
    channel.postMessage({ at: now(), from, name, ...detail })
  }
  self.siaBenchEmit = emit

  function describeError(error) {
    return String(error?.message ?? error).slice(0, 200)
  }

  // The SDK's HTTP client aborts a request once it has read the body, and the
  // abort errors this copy too, often before it has read its own last chunk.
  // So bytes are counted as they arrive and the time is the last chunk's.
  async function timeBody(copy, call, started) {
    let bytes = 0
    let last = now()
    try {
      const reader = copy.body?.getReader()
      for (;;) {
        const chunk = await reader?.read()
        if (!chunk || chunk.done) break
        bytes += chunk.value.byteLength
        last = now()
      }
    } catch {
      // Aborted by the SDK after it read what it needed.
    }
    emit('http-body', { ...call, bytes, ms: last - started })
  }

  const realFetch = self.fetch
  self.fetch = function (input, init) {
    const started = now()
    const url = new URL(
      typeof input === 'string' ? input : (input.url ?? String(input)),
      self.location.href,
    )
    const call = { id: ++sequence, url: url.origin + url.pathname }
    emit('http-start', call)
    return realFetch.call(self, input, init).then(
      (response) => {
        emit('http-end', { ...call, ms: now() - started })
        // `http-end` is the headers. A listing with every object's layout can
        // spend most of its time on the body after that, so a copy of the body
        // is read alongside the SDK's to time its last byte. Wrapping the body
        // instead would hand the SDK a Response without the original's url.
        void timeBody(response.clone(), call, started)
        return response
      },
      (error) => {
        emit('http-end', { ...call, ms: now() - started })
        throw error
      },
    )
  }

  // A call to a host opens with a 16 byte name, padded with zeros, such as
  // `ReadSector`. The first write on a stream carries it.
  function nameRequest(writable, report) {
    const getWriter = writable.getWriter.bind(writable)
    writable.getWriter = (...args) => {
      const writer = getWriter(...args)
      const write = writer.write.bind(writer)
      let named = false
      writer.write = (chunk) => {
        if (!named && chunk?.byteLength >= 16) {
          named = true
          const bytes = new Uint8Array(
            chunk.buffer ?? chunk,
            chunk.byteOffset ?? 0,
            16,
          )
          report(String.fromCharCode(...bytes).replace(/[^ -~]/g, ''))
        }
        return write(chunk)
      }
      return writer
    }
  }

  if (typeof self.WebTransport === 'function') {
    const RealWebTransport = self.WebTransport
    self.WebTransport = class extends RealWebTransport {
      #host

      constructor(url, options) {
        super(url, options)
        const host = new URL(url).host
        this.#host = host
        emit('host-connect', { host })
        this.ready.then(
          () => emit('host-ready', { host }),
          (error) => emit('host-failed', { host, error: describeError(error) }),
        )
      }

      async createBidirectionalStream(options) {
        const stream = await super.createBidirectionalStream(options)
        nameRequest(stream.writable, (call) =>
          emit('rpc-request', { host: this.#host, call }),
        )
        return stream
      }
    }
  }

  if (!inWorker) return

  // The same bytes through a stream that counts them. It pulls one chunk per
  // pull, as the SDK's own body does, so the browser's backpressure still
  // reaches the hosts.
  function countBody(response, report) {
    if (!response.body) return response
    const reader = response.body.getReader()
    let bytes = 0
    let reported = 0
    let cancelled = false
    const body = new ReadableStream(
      {
        async pull(controller) {
          try {
            const { done, value } = await reader.read()
            // The read can settle after the browser cancelled the body.
            if (cancelled) return
            if (done) {
              report('request-end', { bytes })
              controller.close()
              return
            }
            if (bytes === 0) report('request-first-byte')
            bytes += value.byteLength
            const at = now()
            if (at - reported >= 500) {
              reported = at
              report('request-progress', { bytes })
            }
            controller.enqueue(value)
          } catch (error) {
            if (cancelled) return
            report('request-end', { bytes })
            controller.error(error)
          }
        },
        cancel(reason) {
          cancelled = true
          report('request-end', { bytes })
          return reader.cancel(reason)
        },
      },
      { highWaterMark: 0 },
    )
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  const addEventListener = self.addEventListener.bind(self)
  self.addEventListener = (type, listener, options) => {
    if (type !== 'fetch') return addEventListener(type, listener, options)
    return addEventListener(
      type,
      (event) => {
        const respondWith = event.respondWith.bind(event)
        event.respondWith = (response) => {
          const request = ++sequence
          const report = (name, detail) => emit(name, { request, ...detail })
          report('request-start')
          respondWith(
            Promise.resolve(response).then((answer) => countBody(answer, report)),
          )
        }
        listener(event)
      },
      options,
    )
  }
})()

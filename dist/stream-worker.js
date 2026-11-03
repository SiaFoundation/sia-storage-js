import {
  LOG_LEVELS,
  isLogLevel,
  isSourceReply,
  parseStreamPath,
  requestReply,
  streamErrorMessage
} from "./chunk-KE73LO5C.js";

// src/stream-worker.ts
import wasmInit, {
  AppKey,
  Builder,
  PinnedObject,
  setLogger,
  SharedSdk
} from "../wasm/sia_storage_wasm.js";

// src/stream/logs.ts
var LOG_INTERVAL = 250;
var MAX_LINE = 4e3;
var CLOSED_CHECK_INTERVAL = 1e4;
function redactLogLine(text) {
  return text.replace(
    // Everything from `?` or `#` to the next space goes, parentheses
    // included, except closing brackets and quotes at its end, such as the
    // `)` of reqwest's "error sending request for url (...)".
    /\b((?:https?|wss?|sia):\/\/[^\s?#"'<>]*)[?#]\S*?(?=["'>)\]]*(?:\s|$))/gi,
    "$1?[redacted]"
  ).slice(0, MAX_LINE);
}
function createLogRelay(scope, onLevel) {
  const pages = /* @__PURE__ */ new Map();
  let level = "off";
  let queue = [];
  let timer;
  let watchingPanics = false;
  let checkedClosedAt = Date.now();
  function updateLevel() {
    const ranks = [...pages.values()].map(({ rank }) => rank);
    const next = ranks.length ? LOG_LEVELS[Math.max(...ranks)] : "off";
    if (next === level) return;
    level = next;
    onLevel(next);
  }
  async function dropClosedPages() {
    checkedClosedAt = Date.now();
    await Promise.all(
      [...pages.keys()].map(async (id) => {
        if (!await scope.clients.get(id).catch(() => void 0)) {
          pages.delete(id);
        }
      })
    );
    updateLevel();
  }
  function flush() {
    clearTimeout(timer);
    timer = void 0;
    if (Date.now() - checkedClosedAt >= CLOSED_CHECK_INTERVAL) {
      void dropClosedPages();
    }
    const lines = queue;
    queue = [];
    for (const { client, rank } of pages.values()) {
      const wanted = lines.filter(
        (line) => LOG_LEVELS.indexOf(line.level) <= rank
      );
      if (wanted.length === 0) continue;
      try {
        client.postMessage({
          type: "sia-log",
          lines: wanted
        });
      } catch {
      }
    }
  }
  function add(lineLevel, message) {
    if (pages.size === 0) return;
    queue.push({ level: lineLevel, message: redactLogLine(message) });
    if (lineLevel === "error") flush();
    else timer ??= setTimeout(flush, LOG_INTERVAL);
  }
  function watchPanics() {
    if (watchingPanics) return;
    watchingPanics = true;
    const error = console.error;
    console.error = (...args) => {
      const [first] = args;
      if (typeof first === "string" && first.startsWith("panicked at ")) {
        add("error", first);
      }
      error.apply(console, args);
    };
  }
  scope.addEventListener(
    "error",
    (event) => add(
      "error",
      event.error instanceof Error ? `Uncaught ${describe(event.error)}` : event.message ?? `Uncaught ${String(event.error)}`
    )
  );
  scope.addEventListener(
    "unhandledrejection",
    (event) => add("error", `Unhandled rejection: ${describe(event.reason)}`)
  );
  return {
    subscribe(client, requested) {
      if (!isLogLevel(requested)) return;
      const known = pages.has(client.id);
      pages.set(client.id, { client, rank: LOG_LEVELS.indexOf(requested) });
      watchPanics();
      updateLevel();
      if (!known) void dropClosedPages();
    },
    sdk(line) {
      const match = /^\[(ERROR|WARN|INFO|DEBUG|TRACE)\] ([\s\S]*)$/.exec(line);
      const lineLevel = match?.[1]?.toLowerCase();
      add(isLogLevel(lineLevel) ? lineLevel : "info", match?.[2] ?? line);
    }
  };
}
function describe(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

// src/stream/response.ts
var PROTECTIVE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "Referrer-Policy": "no-referrer"
};
function parseRange(range, size) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError("Invalid file size");
  }
  if (range === null) return { status: 200, offset: 0, length: size };
  const invalid = { status: 416, offset: 0, length: 0 };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match || !match[1] && !match[2] || size === 0) return invalid;
  const start = match[1];
  const end = match[2];
  const total = BigInt(size);
  let first;
  let last;
  if (!start) {
    const suffix = BigInt(end);
    if (suffix === 0n) return invalid;
    first = suffix >= total ? 0n : total - suffix;
    last = total - 1n;
  } else {
    first = BigInt(start);
    last = end ? BigInt(end) : total - 1n;
    if (first >= total || last < first) return invalid;
    if (last >= total) last = total - 1n;
  }
  return {
    status: 206,
    offset: Number(first),
    length: Number(last - first + 1n)
  };
}
function contentDisposition(name, download) {
  const wellFormed = new TextDecoder().decode(new TextEncoder().encode(name));
  const filename = wellFormed.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim() || "download";
  const fallback = filename.replace(/[^\u0020-\u007e]|[";]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${download ? "attachment" : "inline"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
function responseHeaders(metadata, range, download) {
  const mime = (metadata.mime.split(";", 1)[0] ?? "").trim();
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Length": String(range.length),
    "Content-Type": /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(mime) ? mime : "application/octet-stream",
    "Content-Disposition": contentDisposition(metadata.name, download),
    ...PROTECTIVE_HEADERS
  });
  if (range.status === 206) {
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`
    );
  } else if (range.status === 416) {
    headers.set("Content-Range", `bytes */${metadata.size}`);
  }
  return headers;
}
function errorResponse(status) {
  const headers = new Headers(PROTECTIVE_HEADERS);
  if (status === 405) headers.set("Allow", "GET, HEAD");
  return new Response(null, { status, headers });
}

// src/stream/worker.ts
var SOURCE_TIMEOUT = 5e3;
var IDLE_TIMEOUT = 5 * 6e4;
var REPORT_INTERVAL = 100;
function serveStreams(scope, connect, supportsDownloads, onLogLevel = () => {
}) {
  const logs = createLogRelay(scope, onLogLevel);
  const sources = /* @__PURE__ */ new Map();
  const sessions = /* @__PURE__ */ new Map();
  const released = /* @__PURE__ */ new Set();
  const active = /* @__PURE__ */ new Map();
  const key = (clientId, id) => JSON.stringify([clientId, id]);
  function tellStreaming(client, streaming) {
    try {
      client.postMessage({
        type: "sia-streaming",
        active: streaming
      });
    } catch {
    }
  }
  function hold(client, lifetime) {
    const count = (active.get(client.id) ?? 0) + 1;
    active.set(client.id, count);
    if (count === 1) tellStreaming(client, true);
    void lifetime.then(() => {
      const left = active.get(client.id) - 1;
      if (left > 0) {
        active.set(client.id, left);
        return;
      }
      active.delete(client.id);
      tellStreaming(client, false);
    });
  }
  function idle(session) {
    clearTimeout(session.timer);
    if (!session.closed && session.jobs.size === 0) {
      session.timer = setTimeout(
        () => void disposeSession(session),
        IDLE_TIMEOUT
      );
    }
  }
  function sessionFor(clientId, details) {
    const sessionKey = key(clientId, details.session);
    let session = sessions.get(sessionKey);
    if (!session) {
      session = {
        key: sessionKey,
        connection: details.connection,
        sources: /* @__PURE__ */ new Set(),
        objects: /* @__PURE__ */ new Map(),
        jobs: /* @__PURE__ */ new Set(),
        closed: false
      };
      sessions.set(sessionKey, session);
    }
    return session;
  }
  async function disposeSession(session) {
    if (session.closed) return;
    session.closed = true;
    sessions.delete(session.key);
    clearTimeout(session.timer);
    for (const source of session.sources) dropSource(source);
    await Promise.allSettled(session.jobs);
    await Promise.allSettled(
      [...session.objects.values()].map(
        async (object) => (await object).free()
      )
    );
    try {
      ;
      (await session.sdk)?.free();
    } catch {
    }
  }
  function sdkFor(session) {
    if (session.sdk) return session.sdk;
    const { connection } = session;
    const connecting = Promise.resolve().then(() => connect(connection));
    session.sdk = connecting;
    connecting.catch(() => {
      if (session.sdk === connecting) delete session.sdk;
    });
    return connecting;
  }
  function objectFor(session, sdk, ref) {
    const { objectId } = ref;
    const cached = session.objects.get(objectId);
    if (cached) return cached;
    const lookup = Promise.resolve().then(() => sdk.object(ref));
    session.objects.set(objectId, lookup);
    lookup.catch(() => {
      if (session.objects.get(objectId) === lookup) {
        session.objects.delete(objectId);
      }
    });
    return lookup;
  }
  function getSource(client, token) {
    const sourceKey = key(client.id, token);
    const cached = sources.get(sourceKey);
    if (cached) return cached;
    const setup = new AbortController();
    const request = { type: "sia-source", token };
    const ready = requestReply(client, request, {
      timeout: SOURCE_TIMEOUT,
      signal: setup.signal
    }).then((reply) => {
      if (!isSourceReply(reply)) {
        throw new Error("Shared file source unavailable.");
      }
      if (source.closed || released.has(key(client.id, reply.session))) {
        throw new DOMException("Released", "AbortError");
      }
      logs.subscribe(client, reply.logLevel);
      const session = sessionFor(client.id, reply);
      source.session = session;
      session.sources.add(source);
      if (reply.events?.length) {
        source.reporter = createReporter(client, token, reply.events);
      }
      idle(session);
      const { objectId, sealed, name, mime, size } = reply;
      return { objectId, sealed, name, mime, size };
    });
    const source = {
      key: sourceKey,
      client,
      closed: false,
      requests: /* @__PURE__ */ new Set(),
      ready,
      setup,
      reading: 0
    };
    sources.set(sourceKey, source);
    return source;
  }
  function dropSource(source) {
    if (source.closed) return;
    source.closed = true;
    sources.delete(source.key);
    source.reporter?.stop();
    source.setup.abort(new DOMException("Released", "AbortError"));
    for (const cancel of source.requests) cancel();
    source.session?.sources.delete(source);
  }
  function startJob(request, token) {
    let complete = () => {
    };
    const lifetime = new Promise((resolve) => {
      complete = resolve;
    });
    const job = {
      closed: false,
      lifetime,
      finish(cancel = false) {
        if (job.closed) return;
        job.closed = true;
        request.signal.removeEventListener("abort", job.abort);
        const { reader } = job;
        const cancellation = cancel && reader ? reader.cancel().catch(() => {
        }) : void 0;
        void Promise.resolve(cancellation).finally(() => {
          reader?.releaseLock();
          const { source } = job;
          source?.requests.delete(job.abort);
          if (source && job.reading && --source.reading === 0) {
            source.reporter?.status("idle");
          }
          job.session?.jobs.delete(lifetime);
          if (job.session) idle(job.session);
          complete();
        });
      },
      abort() {
        if (job.closed) return;
        job.controller?.error(new DOMException("Aborted", "AbortError"));
        job.finish(true);
      },
      fail(error) {
        if (job.closed) return;
        const message = streamErrorMessage(error);
        const aborted = error instanceof Error && error.name === "AbortError";
        const { source, range } = job;
        if (!aborted && !job.quiet && source && !source.closed) {
          try {
            source.client.postMessage({
              type: "sia-stream-error",
              token,
              message,
              ...range && { offset: range.offset, length: range.length }
            });
          } catch {
          }
        }
        job.controller?.error(new Error(message));
        job.finish(true);
      }
    };
    return job;
  }
  async function serve(request, clientId, token, { download, warm }) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(405);
    }
    if (!supportsDownloads) return errorResponse(503);
    const job = startJob(request, token);
    job.quiet = warm;
    try {
      const client = await scope.clients.get(clientId);
      if (!client || request.signal.aborted) return errorResponse(404);
      hold(client, job.lifetime);
      const source = getSource(client, token);
      job.source = source;
      source.requests.add(job.abort);
      request.signal.addEventListener("abort", job.abort, { once: true });
      const metadata = await source.ready;
      if (job.closed) return errorResponse(502);
      const session = source.session;
      job.session = session;
      session.jobs.add(job.lifetime);
      clearTimeout(session.timer);
      const range = parseRange(
        request.method === "HEAD" ? null : request.headers.get("range"),
        metadata.size
      );
      job.range = range;
      const headers = responseHeaders(metadata, range, download);
      if (request.method === "HEAD" || range.status === 416) {
        job.finish();
        return new Response(null, { status: range.status, headers });
      }
      const reporter = warm ? void 0 : source.reporter;
      job.reading = !warm;
      if (!warm && ++source.reading === 1) reporter?.status("connecting");
      if (range.length === 0) {
        job.finish();
        return new Response(null, { status: range.status, headers });
      }
      const sdk = await sdkFor(session);
      if (job.closed) return errorResponse(502);
      const object = await objectFor(session, sdk, metadata);
      if (job.closed) return errorResponse(502);
      const chunks = sdk.download(object, {
        offset: range.offset,
        length: range.length,
        ...reporter?.wants.shards && {
          onShardDownloaded: (progress) => reporter.shard(progress)
        }
      }).getReader();
      job.reader = chunks;
      return new Response(rangeBody(job, chunks, range.length), {
        status: range.status,
        headers
      });
    } catch (error) {
      job.fail(error);
      if (job.source && !job.source.session) dropSource(job.source);
      return errorResponse(502);
    }
  }
  scope.addEventListener(
    "install",
    (event) => event.waitUntil(scope.skipWaiting())
  );
  scope.addEventListener(
    "activate",
    (event) => event.waitUntil(scope.clients.claim())
  );
  scope.addEventListener("message", (event) => {
    const source = event.source;
    const clientId = typeof source?.id === "string" ? source.id : void 0;
    if (!clientId) return;
    const data = event.data;
    if (data?.type === "sia-client") {
      logs.subscribe(source, data.logLevel);
      const reply = { clientId, supported: supportsDownloads };
      event.ports[0]?.postMessage(reply);
      event.ports[0]?.close();
    } else if (data?.type === "sia-release" && typeof data.token === "string") {
      const source2 = sources.get(key(clientId, data.token));
      if (source2) dropSource(source2);
    } else if (data?.type === "sia-release-share" && typeof data.session === "string") {
      const sessionKey = key(clientId, data.session);
      released.add(sessionKey);
      const session = sessions.get(sessionKey);
      if (session) event.waitUntil(disposeSession(session));
    } else if (data?.type === "sia-keep-alive" && !active.has(clientId)) {
      tellStreaming(source, false);
    }
  });
  scope.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (url.origin !== scope.location.origin) return;
    const stream = parseStreamPath(url.pathname);
    if (!stream) return;
    const download = url.searchParams.get("download") === "1";
    const warm = url.searchParams.get("warm") === "1";
    event.respondWith(
      serve(event.request, stream.clientId, stream.token, { download, warm })
    );
  });
  return { sdkLog: logs.sdk };
}
function rangeBody(job, chunks, length) {
  let remaining = length;
  return new ReadableStream(
    {
      start(controller) {
        job.controller = controller;
      },
      async pull(controller) {
        try {
          const { done, value } = await chunks.read();
          if (job.closed) return;
          if (done) {
            if (remaining !== 0) {
              throw new Error(
                "Shared file stream ended before all bytes arrived."
              );
            }
            controller.close();
            job.finish();
            return;
          }
          remaining -= value.byteLength;
          if (remaining < 0) {
            throw new Error("Shared file stream exceeded the requested length.");
          }
          controller.enqueue(value);
          const reporter = job.quiet ? void 0 : job.source?.reporter;
          reporter?.status("downloading");
          reporter?.bytes(value.byteLength);
          if (remaining === 0) {
            controller.close();
            job.finish(true);
          }
        } catch (error) {
          job.fail(error);
        }
      },
      cancel() {
        job.finish(true);
        return job.lifetime;
      }
    },
    { highWaterMark: 0 }
  );
}
function createReporter(client, token, events) {
  const wants = {
    status: events.includes("status"),
    progress: events.includes("progress"),
    shards: events.includes("shards")
  };
  let stopped = false;
  let current;
  let bytes = 0;
  let shards = [];
  let timer;
  function post(message) {
    try {
      client.postMessage(message);
    } catch {
    }
  }
  function flush() {
    clearTimeout(timer);
    timer = void 0;
    if (stopped || bytes === 0 && shards.length === 0) return;
    post({ type: "sia-stream-progress", token, bytes, shards });
    bytes = 0;
    shards = [];
  }
  function schedule() {
    timer ??= setTimeout(flush, REPORT_INTERVAL);
  }
  function status(next) {
    if (stopped || next === current) return;
    flush();
    current = next;
    if (wants.status) post({ type: "sia-stream-status", token, status: next });
  }
  return {
    wants,
    status,
    bytes(count) {
      if (stopped || !wants.progress) return;
      bytes += count;
      schedule();
    },
    shard({ hostKey, shardSize, shardIndex, slabIndex, elapsedMs }) {
      if (stopped) return;
      shards.push({ hostKey, shardSize, shardIndex, slabIndex, elapsedMs });
      schedule();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = void 0;
      shards = [];
    }
  };
}

// src/stream-worker.ts
function installStreams(scope, options = {}) {
  let ready;
  let running = false;
  let logLevel;
  const applyLogLevel = () => {
    if (running && logLevel) setLogger(sdkLog, logLevel);
  };
  const { sdkLog } = serveStreams(
    scope,
    async (connection) => {
      ready ??= wasmInit(
        options.wasm === void 0 ? void 0 : { module_or_path: options.wasm }
      );
      await ready;
      if (!running) {
        running = true;
        applyLogLevel();
      }
      return connection.kind === "shared" ? connectShared(connection) : connectApp(connection);
    },
    // Downloads from hosts need WebTransport, which some browsers leave out
    // of service workers. The page then reads objects itself.
    typeof WebTransport === "function",
    (level) => {
      logLevel = level;
      applyLogLevel();
    }
  );
}
async function connectShared({
  indexerUrl,
  seed,
  sealKey
}) {
  const key = sealKey === void 0 ? void 0 : new AppKey(fromHex(sealKey));
  let sdk;
  try {
    sdk = await SharedSdk.connect(indexerUrl, seed);
  } catch (error) {
    key?.free();
    throw error;
  }
  return {
    // The page sealed the object it already had with the share's random key.
    // Opening that saves a round trip to the indexer before every stream's
    // first byte.
    object: async ({ objectId, sealed }) => key && sealed ? PinnedObject.open(key, sealed) : sdk.object(objectId),
    download: (object, options) => sdk.download(object, options),
    free: () => {
      sdk.free();
      key?.free();
    }
  };
}
async function connectApp({
  indexerUrl,
  appKey,
  appMeta
}) {
  const key = new AppKey(fromHex(appKey));
  const builder = new Builder(indexerUrl, appMeta);
  try {
    const sdk = await builder.connected(key);
    if (!sdk) throw new Error("The app key is not registered with the indexer.");
    return {
      // The page sent the object sealed with this key, so no lookup is needed.
      object: async ({ sealed }) => PinnedObject.open(key, sealed),
      download: (object, options) => sdk.download(object, options),
      free: () => {
        sdk.free();
        key.free();
      }
    };
  } catch (error) {
    key.free();
    throw error;
  } finally {
    builder.free();
  }
}
function fromHex(hex) {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
}
export {
  installStreams
};
//# sourceMappingURL=stream-worker.js.map
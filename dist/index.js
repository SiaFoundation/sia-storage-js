import {
  LOG_LEVELS,
  isAppMetadata,
  isLogLevel,
  reportStreamError,
  requestReply,
  streamErrorMessage,
  streamPath
} from "./chunk-KE73LO5C.js";

// src/index.ts
import wasmInit from "../wasm/sia_storage_wasm.js";

// src/relay.ts
var RELAY_CHECK_URL = "https://check-relay.sia.storage";
var TIMEOUT = 5e3;
var answer;
function detectPrivateRelay() {
  answer ??= typeof navigator === "undefined" ? Promise.resolve(false) : checkPrivateRelay(navigator.userAgent, fetch);
  return answer;
}
async function checkPrivateRelay(userAgent, request) {
  const safari = /Version\/\S+.*Safari\//.test(userAgent) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|OPiOS|Ddg\/|Android/.test(userAgent);
  if (!safari) return false;
  try {
    const response = await request(RELAY_CHECK_URL, {
      signal: AbortSignal.timeout(TIMEOUT)
    });
    const body = await response.json();
    return body.relay === true;
  } catch {
    return false;
  }
}

// src/wasm.ts
import { AppKey } from "../wasm/sia_storage_wasm.js";

// src/stream/fallback.ts
function chunks(stream) {
  return stream.getReader();
}
function notify(callback, value) {
  if (!callback) return;
  try {
    callback(value);
  } catch (error) {
    reportError(error);
  }
}
function download(sdk, object, events) {
  const { onShard } = events;
  return sdk.download(
    object,
    onShard ? { onShardDownloaded: (shard) => notify(onShard, shard) } : {}
  );
}
function track({ onProgress, onStatus }) {
  let received = 0;
  let started = false;
  notify(onStatus, "connecting");
  return {
    chunk(length) {
      if (!started) notify(onStatus, "downloading");
      started = true;
      received += length;
      notify(onProgress, received);
    },
    end() {
      notify(onStatus, "idle");
    }
  };
}
async function readBlob(sdk, object, type, events, signal) {
  const progress = track(events);
  let reader;
  const onAbort = () => void reader?.cancel();
  signal.addEventListener("abort", onAbort);
  const parts = [];
  try {
    reader = chunks(download(sdk, object, events));
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      progress.chunk(value.length);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    progress.end();
  }
  signal.throwIfAborted();
  return new Blob(parts, type ? { type } : {});
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
async function saveToDisk(sdk, object, name, type, events) {
  const picker = window.showSaveFilePicker;
  if (!picker) {
    const blob = await readBlob(
      sdk,
      object,
      type,
      events,
      new AbortController().signal
    );
    saveBlob(blob, name);
    return true;
  }
  let handle;
  try {
    handle = await picker.call(window, { suggestedName: name });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return false;
    throw e;
  }
  const file = await handle.createWritable();
  const progress = track(events);
  const counter = new TransformStream({
    transform(chunk, controller) {
      progress.chunk(chunk.length);
      controller.enqueue(chunk);
    }
  });
  try {
    await download(sdk, object, events).pipeThrough(counter).pipeTo(file);
  } finally {
    progress.end();
  }
  return true;
}

// src/stream/page.ts
var DEFAULT_WORKER_URL = "/sia-storage-sw.js";
var SETUP_TIMEOUT = 5e3;
var KEEP_ALIVE_INTERVAL = 1e4;
var entries = /* @__PURE__ */ new Map();
var opened = /* @__PURE__ */ new Set();
var worker;
var initialization;
var initOptions = {};
var failedController;
var keepAlive;
function enableStreaming(options = {}) {
  if (!initialization) {
    initOptions = options;
  } else if (failedController === void 0) {
    return initialization;
  } else {
    const controller = navigator.serviceWorker.controller;
    if (!controller || controller === failedController) return initialization;
  }
  failedController = void 0;
  initialization = initialize(initOptions).catch(() => {
    failedController = navigator.serviceWorker.controller;
    return false;
  });
  return initialization;
}
async function initialize({
  workerUrl = DEFAULT_WORKER_URL,
  scope,
  type,
  logLevel
}) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) {
    return false;
  }
  const { serviceWorker } = navigator;
  serviceWorker.addEventListener("message", onWorkerMessage);
  const deadline = AbortSignal.timeout(SETUP_TIMEOUT);
  const existing = await within(serviceWorker.getRegistration(), deadline);
  if (existing?.active && !serviceWorker.controller) return false;
  const registration = await within(
    serviceWorker.register(workerUrl, { ...scope && { scope }, ...type && { type } }).then(() => serviceWorker.ready),
    deadline
  );
  if (!serviceWorker.controller) {
    await within(
      new Promise(
        (resolve) => serviceWorker.addEventListener("controllerchange", resolve, {
          once: true
        })
      ),
      deadline
    );
  }
  const controller = serviceWorker.controller;
  if (!controller) return false;
  const request = {
    type: "sia-client",
    ...logLevel && { logLevel }
  };
  const reply = await requestReply(controller, request, {
    signal: deadline
  });
  if (!reply.supported) return false;
  worker = { clientId: reply.clientId, scope: registration.scope };
  return true;
}
function within(promise, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true
    });
    promise.then(resolve, reject);
  });
}
function openStreams(sdk, credentials) {
  const handle = openedFor(sdk, credentials);
  opened.add(handle);
  void enableStreaming();
  return {
    async url(object, options) {
      await enableStreaming();
      options.signal?.throwIfAborted();
      const stream = streamUrl(handle, object, options);
      if (stream) return stream;
      const blob = await readBlob(
        sdk,
        object,
        options.type,
        options,
        options.signal ?? new AbortController().signal
      );
      const url = URL.createObjectURL(blob);
      return {
        url,
        blob,
        warm: async () => {
        },
        release: () => URL.revokeObjectURL(url)
      };
    },
    async download(object, options) {
      const stream = streamUrl(handle, object, options);
      if (stream) {
        const frame = document.createElement("iframe");
        frame.hidden = true;
        frame.src = `${stream.url}?download=1`;
        document.body.append(frame);
        return "streaming";
      }
      const saved = await saveToDisk(
        sdk,
        object,
        options.name,
        options.type,
        options
      );
      return saved ? "saved" : "cancelled";
    },
    close() {
      releaseStreams(handle);
    }
  };
}
function openedFor(sdk, credentials) {
  const { indexerUrl, seed, appMeta } = credentials ?? {};
  const session = crypto.randomUUID();
  if (typeof sdk.appKey === "function") {
    if (typeof indexerUrl !== "string" || !isAppMetadata(appMeta)) {
      throw new TypeError("openStreams(Sdk) needs { indexerUrl, appMeta }.");
    }
    const appKey = sdk.appKey();
    const connection = {
      kind: "app",
      indexerUrl,
      appKey: toHex(appKey.export()),
      appMeta
    };
    return { session, connection, sealKey: appKey };
  }
  if (typeof indexerUrl !== "string" || typeof seed !== "string") {
    throw new TypeError("openStreams(SharedSdk) needs { indexerUrl, seed }.");
  }
  const sealing = randomSealKey();
  return {
    session,
    connection: {
      kind: "shared",
      indexerUrl,
      seed,
      ...sealing && { sealKey: sealing.hex }
    },
    ...sealing && { sealKey: sealing.key }
  };
}
function randomSealKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  try {
    return { key: new AppKey(bytes), hex: toHex(bytes) };
  } catch {
    return void 0;
  }
}
function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function streamUrl(handle, object, { name, type, onError, onProgress, onShard, onStatus }) {
  if (!worker || !navigator.serviceWorker.controller || !opened.has(handle)) {
    return void 0;
  }
  const token = crypto.randomUUID();
  entries.set(token, {
    handle,
    objectId: object.id(),
    sealed: handle.sealKey && object.seal(handle.sealKey),
    size: object.size(),
    name,
    mime: type || "application/octet-stream",
    onError,
    events: { onProgress, onShard, onStatus },
    received: 0
  });
  const url = streamPath(worker.scope, worker.clientId, token);
  return {
    url,
    async warm() {
      try {
        const response = await fetch(`${url}?warm=1`, {
          headers: { Range: "bytes=0-0" }
        });
        await response.arrayBuffer();
      } catch {
      }
    },
    release() {
      entries.delete(token);
      const message = { type: "sia-release", token };
      navigator.serviceWorker.controller?.postMessage(message);
    }
  };
}
function releaseStreams(handle) {
  for (const [token, entry] of entries) {
    if (entry.handle === handle) entries.delete(token);
  }
  if (!opened.delete(handle)) return;
  handle.sealKey?.free();
  const message = {
    type: "sia-release-share",
    session: handle.session
  };
  navigator.serviceWorker.controller?.postMessage(message);
}
function keepWorkerAlive(streaming) {
  clearInterval(keepAlive);
  keepAlive = void 0;
  const controller = navigator.serviceWorker.controller;
  if (!streaming || !controller) return;
  const message = { type: "sia-keep-alive" };
  keepAlive = setInterval(() => {
    if (navigator.serviceWorker.controller === controller) {
      controller.postMessage(message);
    } else {
      keepWorkerAlive(false);
    }
  }, KEEP_ALIVE_INTERVAL);
}
function onWorkerMessage(event) {
  if (event.source !== navigator.serviceWorker.controller) return;
  const data = event.data;
  if (data?.type === "sia-streaming") {
    keepWorkerAlive(data.active === true);
  } else if (data?.type === "sia-stream-error") {
    const entry = entries.get(data.token);
    if (!entry) return;
    const { offset, length } = data;
    const range = offset !== void 0 && length !== void 0 ? { offset, length } : void 0;
    if (entry.onError) entry.onError(streamErrorMessage(data.message));
    else reportStreamError(data.message, entry.name, range);
  } else if (data?.type === "sia-stream-status") {
    notify(entries.get(data.token)?.events.onStatus, data.status);
  } else if (data?.type === "sia-stream-progress") {
    const entry = entries.get(data.token);
    if (!entry || !Array.isArray(data.shards)) return;
    const { onProgress, onShard } = entry.events;
    for (const shard of data.shards) notify(onShard, shard);
    if (Number.isSafeInteger(data.bytes) && data.bytes > 0) {
      entry.received += data.bytes;
      notify(onProgress, entry.received);
    }
  } else if (data?.type === "sia-log") {
    if (Array.isArray(data.lines)) data.lines.forEach(printLogLine);
  } else if (data?.type === "sia-source") {
    const port = event.ports[0];
    if (!port) return;
    const entry = entries.get(data.token);
    const events = [];
    if (entry?.events.onStatus) events.push("status");
    if (entry?.events.onProgress) events.push("progress");
    if (entry?.events.onShard) events.push("shards");
    const reply = entry ? {
      type: "source",
      session: entry.handle.session,
      connection: entry.handle.connection,
      objectId: entry.objectId,
      ...entry.sealed && { sealed: entry.sealed },
      size: entry.size,
      mime: entry.mime,
      name: entry.name,
      ...events.length > 0 && { events },
      ...initOptions.logLevel && { logLevel: initOptions.logLevel }
    } : { type: "error" };
    port.postMessage(reply);
    port.close();
  }
}
function printLogLine(line) {
  const wanted = initOptions.logLevel;
  if (!wanted || !isLogLevel(line?.level) || typeof line.message !== "string" || LOG_LEVELS.indexOf(line.level) > LOG_LEVELS.indexOf(wanted)) {
    return;
  }
  const method = line.level === "trace" ? "debug" : line.level;
  console[method](`[Sia stream worker] ${line.message}`);
}

// src/index.ts
import {
  AppKey as AppKey2,
  Builder,
  KeyRecord,
  ObjectEvent,
  ObjectEventSummary,
  ObjectSummary,
  PackedUpload,
  PinnedObject,
  PreAuthorizedKey,
  Sdk,
  SharedSdk,
  SharingKey,
  encodedSize,
  generateRecoveryPhrase,
  setLogger,
  validateRecoveryPhrase
} from "../wasm/sia_storage_wasm.js";
var initPromise = null;
async function initSia() {
  if (!initPromise) initPromise = wasmInit();
  await initPromise;
}
export {
  AppKey2 as AppKey,
  Builder,
  KeyRecord,
  ObjectEvent,
  ObjectEventSummary,
  ObjectSummary,
  PackedUpload,
  PinnedObject,
  PreAuthorizedKey,
  Sdk,
  SharedSdk,
  SharingKey,
  detectPrivateRelay,
  enableStreaming,
  encodedSize,
  generateRecoveryPhrase,
  initSia,
  openStreams,
  setLogger,
  validateRecoveryPhrase
};
//# sourceMappingURL=index.js.map
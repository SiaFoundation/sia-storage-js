// src/stream/errors.ts
function streamErrorMessage(error) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown streaming failure";
  return message.replace(/\b(?:https?|wss?|sia):\/\/[^\s"'<>]+/gi, "[URL redacted]").replace(/(?:bearer\s+)[^\s,;]+/gi, "Bearer [redacted]").replace(
    /((?:seed|share|token|key|authorization)\s*[=:]\s*)[^\s,;]+/gi,
    "$1[redacted]"
  ).replace(/[a-f0-9]{64,}/gi, "[redacted]").replace(/[\r\n\t]/g, " ").slice(0, 1e3);
}
function reportStreamError(error, name, range) {
  const message = streamErrorMessage(error);
  const bytes = range ? ` bytes ${range.offset}-${range.offset + range.length - 1}` : "";
  console.error(`[Sia stream] ${streamErrorMessage(name)}${bytes}: ${message}`);
  return message;
}

// src/stream/protocol.ts
var LOG_LEVELS = [
  "error",
  "warn",
  "info",
  "debug",
  "trace"
];
var isLogLevel = (value) => LOG_LEVELS.includes(value);
var STREAM_EVENTS = ["status", "progress", "shards"];
var STREAM_PATH = /\/__sia_stream__\/([^/]+)\/([^/]+)\/[^/]+$/;
function streamPath(scope, clientId, token) {
  return `${scope}__sia_stream__/${clientId}/${token}/file`;
}
function parseStreamPath(pathname) {
  const match = STREAM_PATH.exec(pathname);
  return match ? { clientId: match[1], token: match[2] } : void 0;
}
var strings = (data, fields) => fields.every((field) => typeof data?.[field] === "string");
function isAppMetadata(value) {
  return strings(value, ["appId", "name", "description", "serviceUrl"]);
}
var isKeyHex = (value) => typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
function isConnection(value) {
  const data = value;
  if (data?.kind === "shared") {
    return strings(data, ["indexerUrl", "seed"]) && (data.sealKey === void 0 || isKeyHex(data.sealKey));
  }
  return data?.kind === "app" && strings(data, ["indexerUrl", "appKey"]) && isAppMetadata(data.appMeta);
}
function isSourceReply(reply) {
  const data = reply;
  return data?.type === "source" && strings(data, ["session", "objectId", "name", "mime"]) && isConnection(data.connection) && (data.connection.kind === "shared" || typeof data.sealed === "object" && data.sealed !== null) && Number.isSafeInteger(data.size) && data.size >= 0 && (data.events === void 0 || Array.isArray(data.events) && data.events.every((event) => STREAM_EVENTS.includes(event)));
}
function requestReply(target, message, { timeout, signal }) {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    const timer = timeout === void 0 ? void 0 : setTimeout(
      () => settle(() => reject(new Error("No reply in time."))),
      timeout
    );
    const abort = () => settle(() => reject(signal?.reason));
    function settle(outcome) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      port1.close();
      port2.close();
      outcome();
    }
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    port1.onmessage = ({ data }) => settle(() => resolve(data));
    port1.onmessageerror = () => settle(() => reject(new Error("Unreadable reply.")));
    try {
      target.postMessage(message, [port2]);
    } catch (error) {
      settle(() => reject(error));
    }
  });
}

export {
  streamErrorMessage,
  reportStreamError,
  LOG_LEVELS,
  isLogLevel,
  streamPath,
  parseStreamPath,
  isAppMetadata,
  isSourceReply,
  requestReply
};
//# sourceMappingURL=chunk-KE73LO5C.js.map
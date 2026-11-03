"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.node.ts
var index_node_exports = {};
__export(index_node_exports, {
  AppKey: () => AppKey,
  Builder: () => Builder,
  KeyRecord: () => KeyRecord,
  ObjectEvent: () => ObjectEvent,
  ObjectEventSummary: () => ObjectEventSummary,
  PackedUpload: () => PackedUpload,
  PinnedObject: () => PinnedObject,
  PreAuthorizedKey: () => PreAuthorizedKey,
  Sdk: () => Sdk,
  SharedSdk: () => SharedSdk,
  SharingKey: () => SharingKey,
  UploadCancelled: () => UploadCancelled,
  detectPrivateRelay: () => detectPrivateRelay,
  enableStreaming: () => enableStreaming,
  encodedSize: () => encodedSize,
  finalizePacked: () => finalizePacked,
  generateRecoveryPhrase: () => generateRecoveryPhrase,
  initSia: () => initSia,
  openStreams: () => openStreams,
  setLogger: () => setLogger,
  validateRecoveryPhrase: () => validateRecoveryPhrase
});
module.exports = __toCommonJS(index_node_exports);

// src/node/platforms.ts
var NATIVE_PACKAGES = {
  "darwin-arm64": "@siafoundation/sia-storage-darwin-arm64",
  "darwin-x64": "@siafoundation/sia-storage-darwin-x64",
  "linux-x64": "@siafoundation/sia-storage-linux-x64-gnu",
  "linux-arm64": "@siafoundation/sia-storage-linux-arm64-gnu",
  "win32-x64": "@siafoundation/sia-storage-win32-x64-msvc"
};

// src/node/load.ts
var addon = null;
function loadNativeAddon() {
  if (addon) return addon;
  const target = `${process.platform}-${process.arch}`;
  let cause;
  try {
    if (target === "darwin-arm64") {
      addon = require("@siafoundation/sia-storage-darwin-arm64");
    } else if (target === "darwin-x64") {
      addon = require("@siafoundation/sia-storage-darwin-x64");
    } else if (target === "linux-x64") {
      addon = require("@siafoundation/sia-storage-linux-x64-gnu");
    } else if (target === "linux-arm64") {
      addon = require("@siafoundation/sia-storage-linux-arm64-gnu");
    } else if (target === "win32-x64") {
      addon = require("@siafoundation/sia-storage-win32-x64-msvc");
    }
  } catch (error) {
    cause = error;
  }
  if (!addon) throw addonLoadError(target, cause);
  return addon;
}
function addonLoadError(target, cause) {
  const packageName = NATIVE_PACKAGES[target];
  if (!packageName) {
    return new Error(
      `@siafoundation/sia-storage: no native addon is published for ${target}. Use the browser/WASM build.`
    );
  }
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    `@siafoundation/sia-storage: could not load the native addon for ${target} from ${packageName}: ${reason}`,
    { cause }
  );
}

// src/node/napi.ts
var addon2 = loadNativeAddon();
var {
  AppKey,
  Builder,
  Sdk,
  PinnedObject,
  PackedUpload,
  ObjectEvent,
  ObjectEventSummary,
  SharingKey,
  KeyRecord,
  SharedSdk,
  PreAuthorizedKey,
  generateRecoveryPhrase,
  validateRecoveryPhrase,
  setLogger,
  encodedSize
} = addon2;
async function initSia() {
  loadNativeAddon();
}

// src/packed.ts
var UploadCancelled = class extends Error {
  constructor(message = "the upload was cancelled") {
    super(message);
    this.name = "UploadCancelled";
  }
};
var isCancelMessage = (message) => /upload closed|upload cancelled/i.test(message);
async function finalizePacked(packed, options = {}) {
  const signal = options.signal;
  if (signal?.aborted) {
    packed.cancel();
    throw new UploadCancelled();
  }
  const onAbort = () => packed.cancel();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await packed.finalize();
  } catch (error) {
    if (signal?.aborted || error instanceof Error && isCancelMessage(error.message)) {
      throw new UploadCancelled();
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

// src/index.node.ts
async function detectPrivateRelay() {
  return false;
}
async function enableStreaming() {
  return false;
}
function openStreams() {
  const unavailable = () => Promise.reject(
    new Error("openStreams is for browser pages. In Node, use sdk.download().")
  );
  return { url: unavailable, download: unavailable, close() {
  } };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AppKey,
  Builder,
  KeyRecord,
  ObjectEvent,
  ObjectEventSummary,
  PackedUpload,
  PinnedObject,
  PreAuthorizedKey,
  Sdk,
  SharedSdk,
  SharingKey,
  UploadCancelled,
  detectPrivateRelay,
  enableStreaming,
  encodedSize,
  finalizePacked,
  generateRecoveryPhrase,
  initSia,
  openStreams,
  setLogger,
  validateRecoveryPhrase
});
//# sourceMappingURL=index.node.cjs.map
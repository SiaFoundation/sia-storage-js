// WASM environment stub — provides `env.now` required by the WASM binary
// (used by Rust's std::time / chrono for timestamps in the browser).
export function now(): number {
  return Date.now()
}

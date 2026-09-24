// The SDK's WebAssembly bytes, provided by the worker build in tsup.config.ts.
declare module 'virtual:sia-storage-wasm' {
  const bytes: Uint8Array<ArrayBuffer>
  export default bytes
}

// The prebuilt worker's source, provided by the build in tsup.config.ts.
declare module 'virtual:sia-storage-sw' {
  const source: string
  export default source
}

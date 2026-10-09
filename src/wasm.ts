// The build keeps imports of the WebAssembly glue as written and resolves
// them from dist/, so they must come from a file directly in src/. Code in
// subfolders imports the glue through here.
export { AppKey } from '../wasm/sia_storage_wasm.js'

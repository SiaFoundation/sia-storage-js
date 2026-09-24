import { siaStorage } from '@siafoundation/sia-storage/vite'
import { defineConfig } from 'vite'

// The plugin serves the streaming worker and excludes the SDK from Vite's
// dependency pre-bundling, the only config a Vite app needs.
export default defineConfig({ plugins: [siaStorage()] })

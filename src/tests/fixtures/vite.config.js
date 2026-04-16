import { defineConfig } from 'vite'
export default defineConfig({ optimizeDeps: { exclude: ['sia-storage'] } })

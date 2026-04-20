import { defineConfig } from 'vite'
export default defineConfig({
  optimizeDeps: { exclude: ['@siafoundation/sia-storage'] },
})

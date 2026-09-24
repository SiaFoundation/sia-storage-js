// Copies the prebuilt streaming worker into a site's static folder, for
// setups without the Vite plugin or the Next.js route.
//
//   sia-storage-worker [dir]   (dir defaults to public)
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const WORKER_FILE = 'sia-storage-sw.js'
const dir = process.argv[2] ?? 'public'

mkdirSync(dir, { recursive: true })
copyFileSync(
  new URL(`./${WORKER_FILE}`, import.meta.url),
  join(dir, WORKER_FILE),
)
console.log(`Copied ${WORKER_FILE} into ${dir}/`)

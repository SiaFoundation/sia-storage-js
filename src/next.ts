/**
 * Serves the streaming worker from a Next.js App Router route, so the site
 * needs no copy of it in `public/`. Add `app/sia-storage-sw.js/route.ts`:
 *
 *   export { GET } from '@siafoundation/sia-storage/next'
 *   export const dynamic = 'force-static'
 *
 * The worker's source is built into this module, since Next bundles route
 * handlers and would not ship a file read from the package at runtime.
 */
import source from 'virtual:sia-storage-sw'

export function GET(): Response {
  return new Response(source, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
  })
}

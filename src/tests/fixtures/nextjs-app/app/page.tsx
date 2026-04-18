'use client'
import dynamic from 'next/dynamic'

// Skip SSR/prerender for the SDK component — sia-storage's Node entry
// throws if loaded outside the browser without a NAPI binary present, and
// Next's static export prerenders even 'use client' modules unless the
// import is gated behind dynamic({ ssr: false }). The 'use client' on this
// page is required by App Router so the dynamic import call is allowed.
const Smoke = dynamic(() => import('./smoke'), { ssr: false })

export default function Page() {
  return <Smoke />
}

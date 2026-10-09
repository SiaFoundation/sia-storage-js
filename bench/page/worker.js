/*
 * The benchmark's service worker: the timing hooks, then the SDK's prebuilt
 * streaming worker unchanged, so the timings are of the worker sites ship.
 *
 * A browser stops an idle service worker after about 30 seconds and starts it
 * again for the next request, which loses the SDK it had connected. Each start
 * is reported as `worker-boot`, so a restart shows up between two requests.
 */
importScripts('/bench/page/hooks.js')
importScripts('/dist/sia-storage-sw.js')
self.siaBenchEmit('worker-boot')

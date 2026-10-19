---
default: patch
---

# Keep streamed downloads running in Firefox

Firefox stopped the streaming worker about 30 seconds into a download and saved the bytes it had as a finished file, with no error. A 4 GB file came out as about 120 MB. Firefox stops a service worker 30 seconds after the last event it received, even while it is still serving a response, and a download sends the worker nothing after its first request. The worker now tells the page when it starts and stops serving its requests, and the page sends it a message every 10 seconds in between. A video stream that reads for more than 30 seconds without a new request is kept running the same way. Chrome keeps the worker running while it serves a response, so it was not affected.

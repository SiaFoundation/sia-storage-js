---
default: minor
---

#### Report status and progress for streamed files

Streamed files now report what they're doing. `url()` and `download()` from `openStreams` take `onStatus`, `onProgress` and `onShard`, so a page can show whether a stream is connecting, receiving or done, how many bytes have arrived and which hosts sent them. `onStatus` goes `connecting` until the first bytes, then `downloading`, then `idle` when no read is in flight, and around again on a seek. `onProgress` reports the total bytes the URL has received, and now works while streaming as well as when the page reads the file itself. `onShard` reports each piece the SDK reads from a host. The worker sends only the reports a URL asked for, batches bytes and shards at most every 100 ms and just before each status change, and stops when the URL is released.

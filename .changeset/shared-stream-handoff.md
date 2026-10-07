---
default: patch
---

# Start shared streams without looking the file up again

A stream from a `SharedSdk` no longer makes the service worker ask the indexer for a file the page already has. The page seals the file's record with a random key that only it and its worker know, and the worker opens it. That lookup takes about 0.2 seconds before a video's first byte against the production indexer, and took up to 7 seconds while the indexer was under load. A page and worker from different versions still work together, since a worker that receives no key looks the file up as before.

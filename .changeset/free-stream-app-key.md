---
default: patch
---

# Free the app key copy when streams close

`openStreams` on an `Sdk` takes a copy of its app key to seal objects for the worker. `close()` now frees that copy, which was kept until the page went away.

---
default: minor
---

# Open a stream's host connections before Play with `warm()`

`StreamedFile.warm()` opens connections to the hosts holding the start of the file before a play, by reading one byte without reporting any status or progress. A stream otherwise connects to its hosts only when the video asks for its first bytes, which takes a few seconds. Call it when a play is likely, such as when the pointer reaches a Play button. It resolves when the byte arrives, or at once for a file the page read itself, and never rejects.

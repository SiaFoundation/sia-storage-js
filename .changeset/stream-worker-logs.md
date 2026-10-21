---
default: minor
---

# Print the streaming worker's log in the page with `logLevel`

`enableStreaming({ logLevel })` prints the streaming service worker's log in the page's console, prefixed `[Sia stream worker]`. A service worker's console is separate from the page's, so a panic in the SDK inside the worker froze a video with nothing in the page's console to say why. The page receives the SDK's log at the level it asked for and above, and at `error` also SDK panics and errors the worker did not catch. The worker sets the SDK's logger only once a page asks, to the most verbose level any open page asked for, and sends lines in batches every 250 ms, with errors at once. It cuts the query string and fragment from every URL in a line, since the SDK signs its indexer requests in the query string. Off by default. A page and worker from different versions still work together: a page without `logLevel` gets no lines, and a worker from before it ignores the option.

---
default: major
---

# `Builder.connectPreAuthorized` takes a `PreAuthorizedKey`

`Builder.connectPreAuthorized(key, phrase)` now takes a `PreAuthorizedKey` instead of the
key's 32-byte seed. Callers holding a seed can pass `PreAuthorizedKey.import(seed)`.

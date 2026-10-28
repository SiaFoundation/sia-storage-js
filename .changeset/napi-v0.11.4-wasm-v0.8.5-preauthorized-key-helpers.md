---
default: minor
---

# Added `PreAuthorizedKey` helpers for random key generation, seed import/export, and signing indexer creation requests.

Exports `PreAuthorizedKey` from both the browser and Node entry points, along with the
`PreAuthorizedKeyRequest` and `SignedPreAuthorizedKeyRequest` types on the browser entry
point. The key generates itself with `new PreAuthorizedKey()` or imports a 32-byte seed
with `PreAuthorizedKey.import(seed)`, exports that seed again, signs and verifies
messages, and signs a request that creates the key in the indexer.

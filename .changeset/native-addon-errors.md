---
default: patch
---

#### Explain why the Node addon failed to load

When the native addon cannot load in Node, the error names the platform package it tried, such as `@siafoundation/sia-storage-linux-x64-gnu`, and includes the underlying reason, which is also attached as the error's `cause`. It previously suggested a package name that does not exist and dropped the reason, so a missing package and a binary that failed to load looked the same. A platform with no published addon gets its own message pointing to the browser build.

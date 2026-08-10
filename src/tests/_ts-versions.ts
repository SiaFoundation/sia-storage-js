// Pinned so a TypeScript release cannot silently change what CI covers.
// TS_BUILD also matches the repo's devDependency: the build cannot move to 7,
// whose package exports only `version` and `versionMajorMinor`, leaving no
// compiler API for tsup's .d.ts step to call.
export const TS_BUILD = '5.9.3'
export const TS_NATIVE = '7.0.2'

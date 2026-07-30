---
'payload-reserve': patch
---

- **Fixed** the published package could not be imported by plain Node ESM at all. `import('payload-reserve')` threw `ERR_IMPORT_ATTRIBUTE_MISSING: Module ".../dist/translations/ar.json" needs an import attribute of "type: json"`, so anything loading the built package outside a bundler — a plain Node script, a native-ESM test runner, a non-bundled server entry point — failed on import before reaching any plugin code.

  `src/translations/index.ts` imports its 12 locale files as `import ar from './ar.json' with { type: 'json' }`, which TypeScript requires under `module: NodeNext` and Node >= 22 enforces at runtime. **SWC strips that attribute by default**, so the emitted `dist/translations/index.js` carried bare `import ar from './ar.json';`. `.swcrc` now sets `jsc.experimental.keepImportAssertions`, and all 12 attributes survive compilation.

  **Present in 2.4.0 and 3.0.0** (verified against both published tarballs), so this is a long-standing packaging defect rather than a regression from the 3.0.0 concurrency work.

  Most consumers were never affected and need do nothing: a Payload app loads its config through a bundler (Next.js/Turbopack/webpack), and bundlers resolve JSON imports with no attribute required. That is also why no test caught it — the integration suite imports the plugin from `src/`, where the attribute is present by definition, so the build config was never exercised. A regression test (`dev/buildArtifacts.spec.ts`) now compiles the real file with the real `.swcrc` through the same `swc` binary `pnpm build:swc` uses and asserts every JSON import keeps its attribute; it fails if the flag is removed.

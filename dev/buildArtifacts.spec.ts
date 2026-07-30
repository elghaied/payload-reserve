/**
 * Does the BUILT package still declare its JSON import attributes?
 *
 * `src/translations/index.ts` imports 12 locale files as
 * `import ar from './ar.json' with { type: 'json' }`. TypeScript requires that
 * attribute under `module: NodeNext`, and Node >= 22 enforces it at runtime — an
 * ESM JSON import without it throws `ERR_IMPORT_ATTRIBUTE_MISSING`.
 *
 * SWC strips the attribute by default. It only survives because `.swcrc` sets
 * `jsc.experimental.keepImportAssertions`. Without that flag the SOURCE stays
 * valid and every other test still passes, but the PUBLISHED package cannot be
 * imported by plain Node ESM at all — `import('payload-reserve')` dies on
 * `dist/translations/ar.json`. That shipped broken in 2.4.0 and 3.0.0.
 *
 * Nothing else in the suite can catch this, which is why it exists:
 *   - every other test imports the plugin from `src/`, where the attribute is
 *     present by definition — they exercise the source, never the build config
 *   - the dev app and real consumers load Payload through a bundler
 *     (Next/Turbopack/webpack), and bundlers resolve JSON with no attribute
 *     required, so the break is invisible there too
 *
 * So this asserts the compiler OUTPUT, not the source. Asserting the source
 * would restate the thing that was never broken. It shells out to the same
 * `swc` binary and the same `--config-file .swcrc` that `pnpm build:swc` uses,
 * rather than reading `dist/`, so it needs no prior `pnpm build` and cannot
 * silently pass on a stale or absent artifact. (`@swc/core` is only a
 * transitive dependency here — `@swc/cli` is what the repo declares — so
 * driving the CLI also avoids importing a package this project does not own.)
 */
import { execFile } from 'child_process'
import { readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import { describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dirname, '..')
const translationsEntry = path.join(repoRoot, 'src/translations/index.ts')
const swcBin = path.join(repoRoot, 'node_modules/.bin/swc')

/** Compile one file exactly the way `pnpm build:swc` would, and return its output. */
async function compileWithRepoConfig(filePath: string): Promise<string> {
  const { stdout } = await execFileAsync(
    swcBin,
    [filePath, '--config-file', path.join(repoRoot, '.swcrc')],
    { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024 },
  )
  return stdout
}

describe('build output: JSON import attributes', () => {
  test('every JSON import in the source keeps its attribute after SWC', async () => {
    const source = await readFile(translationsEntry, 'utf8')
    const sourceImports = source.match(/\.json'\s+with\s*\{\s*type:\s*'json'\s*\}/g) ?? []

    // Guard the guard: if the source ever stops using import attributes, this
    // test is measuring nothing and should fail loudly rather than pass vacuously.
    expect(sourceImports.length).toBeGreaterThan(0)

    const code = await compileWithRepoConfig(translationsEntry)

    // SWC emits the attribute across newlines: `with {\n    type: 'json'\n}`.
    const emittedImports = code.match(/\.json'\s+with\s*\{\s*type:\s*['"]json['"]\s*(?:,\s*)?\}/g) ?? []

    expect(emittedImports.length).toBe(sourceImports.length)
  })

  test('no bare JSON import survives compilation', async () => {
    const code = await compileWithRepoConfig(translationsEntry)

    // A `.json` specifier whose statement carries no `with` clause is exactly the
    // shape Node rejects with ERR_IMPORT_ATTRIBUTE_MISSING.
    const bare = code
      .split('\n')
      .filter((line) => /^import\s.*\.json['"];?\s*$/.test(line.trim()))

    expect(bare).toEqual([])
  })
})

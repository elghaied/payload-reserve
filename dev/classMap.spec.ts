import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// classMap() is a Proxy, so a typo'd or stale class name fails silently in the
// browser. Check every `<map>.<class>` a component uses exists in a stylesheet
// under its block prefix.
const componentsDir = path.resolve(import.meta.dirname, '../src/components')
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  )
const files = walk(componentsDir)
const css = files
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

describe('classMap references', () => {
  it('every class a component references exists in the stylesheets', () => {
    const missing: string[] = []
    let checked = 0
    for (const file of files.filter((f) => f.endsWith('.tsx'))) {
      const src = readFileSync(file, 'utf8')
      for (const [, name, block] of src.matchAll(/const (\w+) = classMap\('([\w-]+)'\)/g)) {
        for (const [, cls] of src.matchAll(new RegExp(`\\b${name}\\.(\\w+)`, 'g'))) {
          checked++
          if (!new RegExp(`\\.${block}__${cls}(?![\\w-])`).test(css)) {
            missing.push(`${path.basename(path.dirname(file))}: ${block}__${cls}`)
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
    expect([...new Set(missing)]).toEqual([])
  })
})

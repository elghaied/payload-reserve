/**
 * The calendar's outer padding is a host-tunable CSS custom property so an
 * embedding admin can line the calendar up with its own page gutter, and every
 * font size scales off one `--reserve-calendar-font-size` token.
 *
 * This reads the SOURCE stylesheets. The build copies CSS to `dist/` verbatim
 * (`pnpm copyfiles`, no transform), so source and shipped file are the same
 * bytes — asserting the source is asserting the artifact, without needing a
 * prior `pnpm build`.
 */
import { readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dirname, '..')
const cssPath = path.resolve(repoRoot, 'src/components/CalendarView/CalendarView.module.css')
const eventPillCssPath = path.resolve(
  repoRoot,
  'src/components/primitives/EventPill/EventPill.module.css',
)

describe('CalendarView.module.css host-fit hooks', () => {
  it('exposes the outer padding as --reserve-calendar-padding with the 20px default', async () => {
    const css = await readFile(cssPath, 'utf8')
    expect(css).toContain('var(--reserve-calendar-padding, 20px)')
  })

  it('exposes the phone padding as --reserve-calendar-padding-mobile with the 12px default', async () => {
    const css = await readFile(cssPath, 'utf8')
    expect(css).toContain('var(--reserve-calendar-padding-mobile, 12px)')
  })

  it('scales every font-size off --reserve-calendar-font-size (no bare rem/px sizes left)', async () => {
    for (const file of [cssPath, eventPillCssPath]) {
      const css = await readFile(file, 'utf8')
      const sizes = [...css.matchAll(/font-size:\s*([^;\s][^;]*);/g)].map((m) => m[1].trim())
      const stray = sizes.filter(
        (v) =>
          !v.startsWith('calc(var(--reserve-calendar-font-size, 1rem)') &&
          v !== '28px' &&
          v !== 'inherit',
      )
      expect(stray, `${path.relative(repoRoot, file)}: ${stray.join(', ')}`).toEqual([])
    }
  })

  it('keeps event pills at the readability floor (ratio >= 0.75)', async () => {
    const css = await readFile(eventPillCssPath, 'utf8')
    const ratios = [...css.matchAll(/--reserve-calendar-font-size, 1rem\) \* ([0-9.]+)\)/g)].map(
      (m) => Number(m[1]),
    )
    expect(ratios.length).toBeGreaterThan(0)
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(0.75)
  })
})

describe('CalendarView.module.css day columns never grow past the viewport', () => {
  /**
   * `repeat(7, 1fr)` is `repeat(7, minmax(auto, 1fr))`: a nowrap event pill
   * widens its column to the pill's full text and pushes Friday–Sunday off the
   * page. Every seven-column grid must cap the track minimum at 0 so the pills
   * ellipsize inside the cell instead.
   */
  it('caps every 7-column grid track at minmax(0, 1fr)', async () => {
    const css = await readFile(cssPath, 'utf8')
    const sevenCols = [...css.matchAll(/grid-template-columns:\s*([^;]*repeat\(7,[^;]*);/g)].map((m) => m[1])
    expect(sevenCols.length).toBeGreaterThanOrEqual(3)
    for (const value of sevenCols) expect(value).toContain('repeat(7, minmax(0, 1fr))')
  })

  it('lets week and month cells shrink below their pill text (min-width: 0)', async () => {
    const css = await readFile(cssPath, 'utf8')
    for (const cls of ['.weekCell', '.dayCell']) {
      const block = css.match(new RegExp(`\\${cls} \\{([^}]*)\\}`))?.[1] ?? ''
      expect(block, cls).toContain('min-width: 0')
    }
  })
})

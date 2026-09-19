/**
 * The calendar's outer padding is a host-tunable CSS custom property so an
 * embedding admin can line the calendar up with its own page gutter.
 *
 * This reads the SOURCE stylesheet. The build copies CSS to `dist/` verbatim
 * (`pnpm copyfiles`, no transform), so source and shipped file are the same
 * bytes — asserting the source is asserting the artifact, without needing a
 * prior `pnpm build`.
 */
import { readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const cssPath = path.resolve(dirname, '../src/components/CalendarView/CalendarView.module.css')

describe('CalendarView.module.css host-fit hooks', () => {
  it('exposes the outer padding as --reserve-calendar-padding with the 20px default', async () => {
    const css = await readFile(cssPath, 'utf8')
    expect(css).toContain('var(--reserve-calendar-padding, 20px)')
  })

  it('exposes the phone padding as --reserve-calendar-padding-mobile with the 12px default', async () => {
    const css = await readFile(cssPath, 'utf8')
    expect(css).toContain('var(--reserve-calendar-padding-mobile, 12px)')
  })
})

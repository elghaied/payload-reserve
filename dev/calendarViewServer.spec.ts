import type { ListViewServerProps } from 'payload'

import { describe, expect, it, vi } from 'vitest'

/**
 * `CalendarViewServer` imports the real `CalendarView` from `../../exports/client.js`,
 * which transitively pulls in `@payloadcms/ui`'s barrel and, through it,
 * `react-image-crop`'s `.css` — unimportable under Vitest's `node` environment (see
 * `src/utilities/reservationPatch.ts` for the same constraint on the hooks side). Mocking
 * that one module lets this file call the REAL `CalendarViewServer` function directly —
 * no React renderer needed, since a function component is just a function returning a
 * plain React element object — while keeping the assertions about what `CalendarViewServer`
 * itself does (which import it renders, which props it passes) fully real.
 *
 * The third test's key-set assertion is the one that matters most: `CalendarViewServer`'s
 * own comment forbids spreading `ListViewServerProps` into `CalendarView` (that object
 * carries non-serializable values — `i18n.t`, `payload`, `collectionConfig.access` — that
 * would throw "Functions cannot be passed directly to Client Components" in production,
 * never in dev). A reintroduced `{...props}` spread passes every other test in the repo
 * silently; only asserting the exact prop key set here catches it.
 */
vi.mock('../src/exports/client.js', () => ({
  CalendarView: (props: Record<string, unknown>) => ({
    type: 'mock-calendar-view',
    props,
  }),
}))

const { CalendarViewServer } = await import('../src/components/CalendarView/CalendarViewServer.js')

const fakeProps = (custom: Record<string, unknown>, importMap: Record<string, unknown> = {}) =>
  ({
    payload: {
      config: { admin: { custom } },
      importMap,
    },
  }) as unknown as ListViewServerProps

describe('CalendarViewServer', () => {
  it('passes detailDisabled: false and detailSlot: null when reservationDetail is unset', () => {
    const element = CalendarViewServer(fakeProps({})) as unknown as {
      props: Record<string, unknown>
    }

    expect(element.props.detailDisabled).toBe(false)
    expect(element.props.detailSlot).toBeNull()
  })

  it('passes detailDisabled: true and detailSlot: null when reservationDetail is false', () => {
    const element = CalendarViewServer(
      fakeProps({ reservationDetailComponent: false }),
    ) as unknown as { props: Record<string, unknown> }

    expect(element.props.detailDisabled).toBe(true)
    expect(element.props.detailSlot).toBeNull()
  })

  it('resolves a string reservationDetail through the import map, and passes ONLY detailDisabled/detailSlot', () => {
    const DetailComponent = () => null
    const element = CalendarViewServer(
      fakeProps(
        { reservationDetailComponent: '/components/D.tsx#D' },
        { '/components/D.tsx#D': DetailComponent },
      ),
    ) as unknown as { props: Record<string, unknown> }

    expect(element.props.detailDisabled).toBe(false)
    expect(element.props.detailSlot).not.toBeNull()

    // The load-bearing assertion: no other key crosses the server -> client boundary.
    expect(Object.keys(element.props).sort()).toEqual(['detailDisabled', 'detailSlot'])
  })
})

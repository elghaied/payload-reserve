import type { Config } from 'payload'

import { describe, expect, it } from 'vitest'

import { payloadReserve } from '../src/index.js'

const baseConfig = (): Config =>
  ({ collections: [{ slug: 'users', auth: true, fields: [] }] }) as unknown as Config

const build = (components?: Record<string, unknown>) =>
  payloadReserve({ components } as never)(baseConfig())

const findCollection = (config: Config, slug: string) =>
  (config.collections ?? []).find((c) => c.slug === slug)!

const listComponent = (config: Config) =>
  (findCollection(config, 'reservations').admin?.components?.views as
    | Record<string, { Component?: unknown }>
    | undefined)?.list?.Component

const fieldComponent = (config: Config, name: string) => {
  const collection = findCollection(config, 'reservations')
  const field = (collection.fields as Array<Record<string, never>>).find(
    (f) => (f as { name?: string }).name === name,
  ) as { admin?: { components?: { Field?: unknown } } } | undefined
  return field?.admin?.components?.Field
}

describe('components option — calendarView', () => {
  it('uses the plugin component when unset', () => {
    expect(listComponent(build())).toBe('payload-reserve/client#CalendarView')
  })

  it('uses the consumer component when a string', () => {
    expect(listComponent(build({ calendarView: 'my-app#MyCalendar' }))).toBe('my-app#MyCalendar')
  })

  it('registers no list view when false, leaving Payload’s default', () => {
    const config = build({ calendarView: false })
    expect(listComponent(config)).toBeUndefined()
  })

  it('keeps the rest of the admin config when the list view is disabled', () => {
    const admin = findCollection(build({ calendarView: false }), 'reservations').admin!
    expect(admin.useAsTitle).toBe('startTime')
    expect(admin.listSearchableFields).toEqual(['status'])
    expect(admin.group).toBeTruthy()
  })
})

describe('components option — field slots', () => {
  it('uses plugin fields when unset', () => {
    const config = build()
    expect(fieldComponent(config, 'customer')).toBe('payload-reserve/client#CustomerField')
    expect(fieldComponent(config, 'startTime')).toBe(
      'payload-reserve/client#AvailabilityTimeField',
    )
  })

  it('honours string overrides', () => {
    const config = build({
      availabilityTimeField: 'my-app#MyTime',
      customerField: 'my-app#MyCustomer',
    })
    expect(fieldComponent(config, 'customer')).toBe('my-app#MyCustomer')
    expect(fieldComponent(config, 'startTime')).toBe('my-app#MyTime')
  })

  it('falls back to Payload defaults when false', () => {
    const config = build({ availabilityTimeField: false, customerField: false })
    expect(fieldComponent(config, 'customer')).toBeUndefined()
    expect(fieldComponent(config, 'startTime')).toBeUndefined()
  })
})

describe('components option — dashboard widget and availability view', () => {
  it('registers both when unset', () => {
    const config = build()
    expect(config.admin?.dashboard?.widgets?.length).toBe(1)
    expect(
      (config.admin?.components?.views as Record<string, { Component?: unknown }>)[
        'reservation-availability'
      ].Component,
    ).toBe('payload-reserve/client#AvailabilityOverview')
  })

  it('honours string overrides', () => {
    const config = build({
      availabilityOverview: 'my-app#MyGrid',
      dashboardWidget: 'my-app#MyWidget',
    })
    expect(config.admin?.dashboard?.widgets?.[0].Component).toBe('my-app#MyWidget')
    expect(
      (config.admin?.components?.views as Record<string, { Component?: unknown }>)[
        'reservation-availability'
      ].Component,
    ).toBe('my-app#MyGrid')
  })

  it('registers neither when false', () => {
    const config = build({ availabilityOverview: false, dashboardWidget: false })
    expect(config.admin?.dashboard?.widgets ?? []).toHaveLength(0)
    expect(
      (config.admin?.components?.views as Record<string, unknown> | undefined)?.[
        'reservation-availability'
      ],
    ).toBeUndefined()
  })
})

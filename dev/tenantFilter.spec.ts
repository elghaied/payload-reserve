import { describe, expect, it } from 'vitest'

import {
  collectionHasTenantField,
  readCookie,
  tenantQueryParams,
  tenantWhereClause,
} from '../src/utilities/tenantFilter.js'

describe('readCookie', () => {
  it('returns the value for the named cookie', () => {
    expect(readCookie('payload-tenant=abc123; other=1', 'payload-tenant')).toBe('abc123')
  })
  it('URL-decodes the value', () => {
    expect(readCookie('payload-tenant=a%20b', 'payload-tenant')).toBe('a b')
  })
  it('returns null when absent or empty', () => {
    expect(readCookie('other=1', 'payload-tenant')).toBeNull()
    expect(readCookie('', 'payload-tenant')).toBeNull()
    expect(readCookie(null, 'payload-tenant')).toBeNull()
    expect(readCookie(undefined, 'payload-tenant')).toBeNull()
    expect(readCookie('payload-tenant=; x=1', 'payload-tenant')).toBeNull()
  })
  it('handles = inside a cookie value', () => {
    expect(readCookie('token=a=b=c; payload-tenant=xyz', 'token')).toBe('a=b=c')
    expect(readCookie('token=a=b=c; payload-tenant=xyz', 'payload-tenant')).toBe('xyz')
  })
})

describe('collectionHasTenantField', () => {
  it('is true when a top-level field has the name', () => {
    expect(collectionHasTenantField({ fields: [{ name: 'tenant', type: 'relationship' }] }, 'tenant')).toBe(true)
  })
  it('is false when no field matches, or no/invalid collection', () => {
    expect(collectionHasTenantField({ fields: [{ name: 'title', type: 'text' }] }, 'tenant')).toBe(false)
    expect(collectionHasTenantField(null, 'tenant')).toBe(false)
    expect(collectionHasTenantField(undefined, 'tenant')).toBe(false)
    expect(collectionHasTenantField({}, 'tenant')).toBe(false)
  })
  it('does NOT descend into nested group/row fields (top-level only, by design)', () => {
    const collection = { fields: [{ type: 'group', fields: [{ name: 'tenant', type: 'relationship' }] }] }
    expect(collectionHasTenantField(collection, 'tenant')).toBe(false)
  })
})

describe('tenantQueryParams (REST)', () => {
  it('returns a where param when field present AND tenant selected', () => {
    expect(tenantQueryParams({ hasField: true, tenantField: 'tenant', tenantId: 'abc' })).toEqual({
      'where[tenant][equals]': 'abc',
    })
  })
  it('returns {} when no tenant selected (no cookie)', () => {
    expect(tenantQueryParams({ hasField: true, tenantField: 'tenant', tenantId: null })).toEqual({})
  })
  it('returns {} when collection has no tenant field (non-multi-tenant)', () => {
    expect(tenantQueryParams({ hasField: false, tenantField: 'tenant', tenantId: 'abc' })).toEqual({})
  })
  it('honors a custom tenant field name', () => {
    expect(tenantQueryParams({ hasField: true, tenantField: 'org', tenantId: 'x' })).toEqual({
      'where[org][equals]': 'x',
    })
  })
})

describe('tenantWhereClause (Local API)', () => {
  it('returns a Where when field present AND tenant selected', () => {
    expect(tenantWhereClause({ hasField: true, tenantField: 'tenant', tenantId: 'abc' })).toEqual({
      tenant: { equals: 'abc' },
    })
  })
  it('returns null when no tenant selected or no field', () => {
    expect(tenantWhereClause({ hasField: true, tenantField: 'tenant', tenantId: null })).toBeNull()
    expect(tenantWhereClause({ hasField: false, tenantField: 'tenant', tenantId: 'abc' })).toBeNull()
  })
})

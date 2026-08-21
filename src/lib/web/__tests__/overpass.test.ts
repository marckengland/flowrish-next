import { describe, it, expect } from 'vitest'

// `server-only` is aliased to a stub in vitest.config.ts.
import {
  buildOverpassQuery,
  normalizeElement,
  osmUrl,
  type BoundingBox,
} from '@/lib/web/overpass'

// BoundingBox = [south, north, west, east]
const bbox: BoundingBox = [14.5, 14.6, 120.9, 121.0]

describe('buildOverpassQuery', () => {
  it('emits bbox as (south,west,north,east) with the category + name filters and cap', () => {
    const q = buildOverpassQuery(bbox, { category: 'restaurant', limit: 10 })
    expect(q).toContain('(14.5,120.9,14.6,121)')
    expect(q).toContain('["amenity"="restaurant"]')
    expect(q).toContain('["name"]')
    expect(q).toContain('out center 10;')
  })

  it('clamps the limit to 60', () => {
    expect(buildOverpassQuery(bbox, { limit: 999 })).toContain('out center 60;')
  })

  it('falls back to any shop for an unknown category', () => {
    expect(buildOverpassQuery(bbox, { category: 'nope' })).toContain('["shop"]')
  })

  it('builds a case-insensitive name regex and escapes quotes', () => {
    const q = buildOverpassQuery(bbox, { keyword: 'A"B' })
    expect(q).toContain('["name"~"A\\"B",i]')
  })
})

describe('normalizeElement', () => {
  it('normalizes a named shop with address + contact fallbacks', () => {
    const b = normalizeElement({
      type: 'node',
      id: 1,
      lat: 1,
      lon: 2,
      tags: {
        name: 'Acme',
        shop: 'supermarket',
        'addr:housenumber': '10',
        'addr:street': 'Main St',
        'addr:city': 'Makati',
        'contact:phone': '123',
        'contact:website': 'https://a.example',
      },
    })
    expect(b).toMatchObject({
      osmType: 'node',
      osmId: 1,
      name: 'Acme',
      category: 'shop: supermarket',
      address: '10 Main St, Makati',
      phone: '123',
      website: 'https://a.example',
      lat: 1,
      lon: 2,
    })
  })

  it('returns null for an unnamed element', () => {
    expect(normalizeElement({ type: 'node', id: 2, tags: { shop: 'x' } })).toBeNull()
  })

  it('uses center coords + amenity category for ways', () => {
    const b = normalizeElement({
      type: 'way',
      id: 3,
      center: { lat: 5, lon: 6 },
      tags: { name: 'Cafe W', amenity: 'cafe' },
    })
    expect(b?.lat).toBe(5)
    expect(b?.lon).toBe(6)
    expect(b?.category).toBe('amenity: cafe')
  })
})

describe('osmUrl', () => {
  it('builds a permalink', () => {
    expect(osmUrl({ osmType: 'node', osmId: 42 })).toBe(
      'https://www.openstreetmap.org/node/42',
    )
  })
})

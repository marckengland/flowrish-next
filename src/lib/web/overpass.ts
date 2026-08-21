import 'server-only'

/**
 * Keyless business discovery via OpenStreetMap — Nominatim for geocoding a
 * location to a bounding box, then Overpass for named businesses inside it.
 *
 * No API key or paid service. These are shared community endpoints under a
 * fair-use policy, so we cap results, set timeouts, and send a descriptive
 * User-Agent. High volume should move to a self-hosted Overpass/Nominatim.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const USER_AGENT = 'Flowrish/1.0 (lead discovery; +https://flowrish.marckengland.com)'

export interface DiscoveredBusiness {
  osmType: string
  osmId: number
  name: string
  category: string | null
  address: string | null
  phone: string | null
  website: string | null
  lat: number | null
  lon: number | null
}

export interface DiscoverParams {
  /** Free-text location, e.g. "Makati, Philippines". */
  location: string
  /** Category preset (see CATEGORY_FILTERS) — e.g. "restaurant", "shop". */
  category?: string
  /** Optional case-insensitive name filter. */
  keyword?: string
  /** Max results (default 25, hard cap 60). */
  limit?: number
}

/** Bounding box as [south, north, west, east] (Nominatim order). */
export type BoundingBox = [number, number, number, number]

/**
 * Category → Overpass tag filter. Values are raw Overpass QL tag selectors
 * appended to each element. Keep this list conservative and business-y.
 */
const CATEGORY_FILTERS: Record<string, string> = {
  restaurant: '["amenity"="restaurant"]',
  cafe: '["amenity"="cafe"]',
  bar: '["amenity"="bar"]',
  hotel: '["tourism"="hotel"]',
  shop: '["shop"]',
  retail: '["shop"]',
  supermarket: '["shop"="supermarket"]',
  office: '["office"]',
  clinic: '["amenity"="clinic"]',
  pharmacy: '["amenity"="pharmacy"]',
  gym: '["leisure"="fitness_centre"]',
  bank: '["amenity"="bank"]',
  school: '["amenity"="school"]',
  car_dealer: '["shop"="car"]',
}

export const CATEGORY_OPTIONS = Object.keys(CATEGORY_FILTERS)

/** Escapes a value for safe embedding inside an Overpass QL regex/string. */
function escapeOverpass(value: string): string {
  // Overpass strings are double-quoted; escape backslashes and quotes.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Builds an Overpass QL query for named businesses inside a bbox.
 * Exported for unit testing.
 */
export function buildOverpassQuery(
  bbox: BoundingBox,
  { category, keyword, limit = 25 }: Omit<DiscoverParams, 'location'>,
): string {
  const [south, north, west, east] = bbox
  const bboxClause = `(${south},${west},${north},${east})`
  const cap = Math.min(Math.max(limit, 1), 60)

  // Category tag filter (defaults to any shop so we always target businesses).
  const catFilter =
    (category && CATEGORY_FILTERS[category]) ?? CATEGORY_FILTERS.shop

  // Optional name filter — case-insensitive regex on the name tag.
  const nameFilter = keyword
    ? `["name"~"${escapeOverpass(keyword)}",i]`
    : '["name"]'

  // nwr = node/way/relation. `out center` gives a lat/lon for ways/relations.
  return [
    '[out:json][timeout:25];',
    '(',
    `  nwr${nameFilter}${catFilter}${bboxClause};`,
    ');',
    `out center ${cap};`,
  ].join('\n')
}

interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

/** Normalizes a raw Overpass element into a DiscoveredBusiness. Exported for tests. */
export function normalizeElement(el: OverpassElement): DiscoveredBusiness | null {
  const tags = el.tags ?? {}
  const name = tags.name?.trim()
  if (!name) return null

  const address =
    [
      [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
      tags['addr:city'],
      tags['addr:state'],
      tags['addr:postcode'],
    ]
      .filter((p) => p && p.trim())
      .join(', ') || null

  const category =
    tags.shop
      ? `shop: ${tags.shop}`
      : tags.amenity
        ? `amenity: ${tags.amenity}`
        : tags.office
          ? `office: ${tags.office}`
          : tags.tourism
            ? `tourism: ${tags.tourism}`
            : tags.leisure
              ? `leisure: ${tags.leisure}`
              : null

  return {
    osmType: el.type,
    osmId: el.id,
    name,
    category,
    address,
    phone: tags.phone ?? tags['contact:phone'] ?? null,
    website: tags.website ?? tags['contact:website'] ?? null,
    lat: el.lat ?? el.center?.lat ?? null,
    lon: el.lon ?? el.center?.lon ?? null,
  }
}

/** OSM permalink for a discovered element (used as an Insight source). */
export function osmUrl(b: Pick<DiscoveredBusiness, 'osmType' | 'osmId'>): string {
  return `https://www.openstreetmap.org/${b.osmType}/${b.osmId}`
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, ...(init.headers ?? {}) },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Geocodes a free-text location to a bounding box via Nominatim. */
export async function geocode(location: string): Promise<BoundingBox | null> {
  const q = location.trim()
  if (!q) return null
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=json&limit=1`
  const json = await fetchJson(url, { method: 'GET' }, 8000)
  if (!Array.isArray(json) || json.length === 0) return null
  const first = json[0] as { boundingbox?: [string, string, string, string] }
  const bb = first.boundingbox
  if (!bb || bb.length !== 4) return null
  const nums = bb.map((v) => Number.parseFloat(v)) as BoundingBox
  if (nums.some((n) => Number.isNaN(n))) return null
  return nums
}

/**
 * Discovers named businesses for a location + optional category/keyword.
 * Returns [] on any failure (geocode miss, Overpass down, no matches).
 */
export async function discoverBusinesses(
  params: DiscoverParams,
): Promise<DiscoveredBusiness[]> {
  const bbox = await geocode(params.location)
  if (!bbox) return []

  const query = buildOverpassQuery(bbox, params)
  const json = await fetchJson(
    OVERPASS_URL,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    },
    30000,
  )
  const elements = (json as { elements?: OverpassElement[] } | null)?.elements
  if (!Array.isArray(elements)) return []

  const seen = new Set<string>()
  const results: DiscoveredBusiness[] = []
  for (const el of elements) {
    const biz = normalizeElement(el)
    if (!biz) continue
    // De-dupe by lowercased name so the same chain doesn't flood results.
    const key = biz.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    results.push(biz)
  }
  return results
}

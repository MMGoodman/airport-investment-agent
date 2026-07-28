/** Loads the ingested JSON once and answers the scoping questions the tools need. */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const load = async (rel) => JSON.parse(await readFile(path.join(ROOT, rel), 'utf8'))

let cache = null

export async function getStore() {
  if (cache) return cache

  const [airports, annual, weights, regions, knownConstraints] = await Promise.all([
    load('data/airports.json'),
    load('data/airport_annual.json'),
    load('config/weights.json'),
    load('config/regions.json'),
    load('config/known-constraints.json'),
  ])

  const stateToRegion = new Map()
  for (const [region, states] of Object.entries(regions)) {
    for (const s of states) stateToRegion.set(s, region)
  }

  const byIata = new Map(
    airports.map((a) => [a.iata, { ...a, region: stateToRegion.get(a.state) ?? 'Other' }]),
  )

  cache = { airports: [...byIata.values()], byIata, annual, weights, regions, knownConstraints }
  return cache
}

/** Resolve a region name case-insensitively; returns null when it is not one we cover. */
export function resolveRegion(store, name) {
  if (!name) return null
  const key = Object.keys(store.regions).find(
    (r) => r.toLowerCase() === String(name).trim().toLowerCase(),
  )
  return key ?? null
}

export function selectAirports(store, { region, state, iataList } = {}) {
  let list = store.airports

  if (iataList?.length) {
    const want = new Set(iataList.map((c) => c.toUpperCase()))
    list = list.filter((a) => want.has(a.iata))
  }
  if (region) list = list.filter((a) => a.region === region)
  if (state) list = list.filter((a) => a.state === String(state).toUpperCase())

  return list
}

export function annualFor(store, iataList) {
  const want = new Set(iataList.map((a) => (typeof a === 'string' ? a : a.iata)))
  return store.annual.filter((r) => want.has(r.iata))
}

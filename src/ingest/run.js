/**
 * One-shot ingest: BTS T-100 origin-airport monthly summaries + OurAirports metadata
 * -> data/airports.json and data/airport_annual.json.
 *
 * Deliberately writes JSON files instead of standing up MongoDB. For ~90 airports and
 * five years the whole set is a few hundred KB and loads into memory in milliseconds;
 * a database would add operational surface without changing a single answer.
 *
 * Fails loudly. Never substitutes synthetic data.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RAW = path.join(ROOT, 'data', 'raw')
const OUT = path.join(ROOT, 'data')

const DATASET = 'r495-tyji' // AFF - T100 Segment Summary By Origin Airport
const BTS_URL = `https://data.bts.gov/resource/${DATASET}.json`
const AIRPORTS_CSV = 'https://davidmegginson.github.io/ourairports-data/airports.csv'

// 2020 and 2021 are excluded from every trend: COVID makes them a nonsense baseline.
export const BASELINE_YEAR = 2019
export const MOMENTUM_FROM = 2022
export const LATEST_YEAR = 2025
const YEARS = [BASELINE_YEAR, MOMENTUM_FROM, 2023, 2024, LATEST_YEAR]

// Below this the monthly figures get noisy and percentile ranks stop meaning anything.
const MIN_ANNUAL_PASSENGERS = 400_000

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`GET ${url}\n  -> HTTP ${res.status} ${res.statusText}\n  ${await res.text()}`)
  }
  return res.json()
}

/** Socrata caps a page at 50k rows; walk offsets until a short page comes back. */
async function fetchAllRows() {
  const cache = path.join(RAW, `t100-${DATASET}.json`)
  if (existsSync(cache)) {
    console.log(`  cache hit: ${path.relative(ROOT, cache)}`)
    return JSON.parse(await readFile(cache, 'utf8'))
  }

  const where = encodeURIComponent(`year in(${YEARS.map((y) => `'${y}'`).join(',')})`)
  const pageSize = 50_000
  const rows = []

  for (let offset = 0; ; offset += pageSize) {
    const url = `${BTS_URL}?$where=${where}&$limit=${pageSize}&$offset=${offset}&$order=origin_airport_code,reporting_month`
    const page = await fetchJson(url)
    rows.push(...page)
    console.log(`  fetched ${rows.length} rows`)
    if (page.length < pageSize) break
  }

  await writeFile(cache, JSON.stringify(rows), 'utf8')
  return rows
}

/** Minimal RFC-4180 parser — OurAirports quotes fields that contain commas. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }

  const header = rows.shift()
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

async function fetchAirportMetadata() {
  const cache = path.join(RAW, 'ourairports.csv')
  let text
  if (existsSync(cache)) {
    console.log(`  cache hit: ${path.relative(ROOT, cache)}`)
    text = await readFile(cache, 'utf8')
  } else {
    const res = await fetch(AIRPORTS_CSV)
    if (!res.ok) throw new Error(`GET ${AIRPORTS_CSV} -> HTTP ${res.status}`)
    text = await res.text()
    await writeFile(cache, text, 'utf8')
  }

  // BTS reports US territories, but OurAirports files them under their own country codes.
  const US_AND_TERRITORIES = new Set(['US', 'PR', 'VI', 'GU', 'AS', 'MP'])
  const TERRITORY_STATE = { PR: 'PR', VI: 'VI', GU: 'GU', AS: 'AS', MP: 'MP' }

  const byIata = new Map()
  for (const a of parseCsv(text)) {
    if (!US_AND_TERRITORIES.has(a.iso_country) || !a.iata_code) continue
    byIata.set(a.iata_code, {
      iata: a.iata_code,
      name: a.name,
      city: a.municipality,
      state:
        TERRITORY_STATE[a.iso_country] ?? (a.iso_region || '').replace(/^US-/, ''),
      lat: Number(a.latitude_deg),
      lon: Number(a.longitude_deg),
      type: a.type,
    })
  }
  return byIata
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * BTS reports distances as per-flight and per-passenger averages, not sums, so the
 * annual figure has to be re-weighted by departures/passengers rather than summed.
 */
function rollupToAnnual(rows) {
  const byKey = new Map()

  for (const r of rows) {
    const iata = r.origin_airport_code
    const year = Number(r.year)
    if (!iata || !YEARS.includes(year)) continue

    const key = `${iata}|${year}`
    let a = byKey.get(key)
    if (!a) {
      a = {
        iata,
        year,
        months: 0,
        departures: 0,
        passengers: 0,
        seats: 0,
        freightLbs: 0,
        intlDepartures: 0,
        intlPassengers: 0,
        _flightMiles: 0,
        _paxMiles: 0,
        _domFlightMiles: 0,
        _intlFlightMiles: 0,
      }
      byKey.set(key, a)
    }

    const dep = num(r.total_departures)
    const pax = num(r.total_passengers)
    const domDep = num(r.domestic_departures)
    const intlDep = num(r.outbound_international)

    a.months += 1
    a.departures += dep
    a.passengers += pax
    a.seats += num(r.total_seats)
    a.freightLbs += num(r.total_freight_lbs)
    a.intlDepartures += intlDep
    a.intlPassengers += num(r.outbound_international_1)
    a._flightMiles += num(r.total_distance_flight_sm) * dep
    a._paxMiles += num(r.total_distance_passenger) * pax
    a._domFlightMiles += num(r.domestic_distance_flight) * domDep
    a._intlFlightMiles += num(r.outbound_international_3) * intlDep
  }

  return [...byKey.values()].map((a) => {
    const domDepartures = a.departures - a.intlDepartures
    return {
      iata: a.iata,
      year: a.year,
      months: a.months,
      departures: a.departures,
      passengers: a.passengers,
      seats: a.seats,
      freightLbs: a.freightLbs,
      loadFactor: a.seats ? a.passengers / a.seats : 0,
      seatsPerDeparture: a.departures ? a.seats / a.departures : 0,
      avgStageMiles: a.departures ? a._flightMiles / a.departures : 0,
      avgPassengerMiles: a.passengers ? a._paxMiles / a.passengers : 0,
      avgDomesticStageMiles: domDepartures ? a._domFlightMiles / domDepartures : 0,
      avgIntlStageMiles: a.intlDepartures ? a._intlFlightMiles / a.intlDepartures : 0,
      intlDepartureShare: a.departures ? a.intlDepartures / a.departures : 0,
      intlPassengerShare: a.passengers ? a.intlPassengers / a.passengers : 0,
    }
  })
}

async function main() {
  await mkdir(RAW, { recursive: true })

  console.log(`\nBTS T-100 origin summaries (dataset ${DATASET}), years ${YEARS.join(', ')}`)
  const rows = await fetchAllRows()

  console.log('\nOurAirports metadata')
  const meta = await fetchAirportMetadata()

  const annual = rollupToAnnual(rows)

  // Scope: airports that cleared the volume floor in the latest full year.
  const keep = new Set(
    annual
      .filter((a) => a.year === LATEST_YEAR && a.passengers >= MIN_ANNUAL_PASSENGERS)
      .map((a) => a.iata),
  )

  const rejected = { noMetadata: [], belowFloor: 0 }
  const airports = []
  for (const iata of keep) {
    const m = meta.get(iata)
    if (!m) { rejected.noMetadata.push(iata); continue }
    airports.push(m)
  }
  const known = new Set(airports.map((a) => a.iata))
  const kept = annual.filter((a) => known.has(a.iata))
  rejected.belowFloor = new Set(annual.map((a) => a.iata)).size - keep.size

  airports.sort((a, b) => a.iata.localeCompare(b.iata))
  kept.sort((a, b) => a.iata.localeCompare(b.iata) || a.year - b.year)

  await writeFile(path.join(OUT, 'airports.json'), JSON.stringify(airports, null, 2), 'utf8')
  await writeFile(path.join(OUT, 'airport_annual.json'), JSON.stringify(kept, null, 2), 'utf8')

  const incomplete = kept.filter((a) => a.months !== 12)

  console.log(`
  source rows       ${rows.length}
  airports in scope ${airports.length}  (>= ${MIN_ANNUAL_PASSENGERS.toLocaleString()} passengers in ${LATEST_YEAR})
  annual records    ${kept.length}
  years             ${YEARS.join(', ')}
  dropped: below volume floor  ${rejected.belowFloor}
  dropped: no IATA metadata    ${rejected.noMetadata.length}${rejected.noMetadata.length ? ` (${rejected.noMetadata.join(', ')})` : ''}
  partial years (< 12 months)  ${incomplete.length}
`)
}

main().catch((err) => {
  console.error('\nINGEST FAILED\n')
  console.error(err.message)
  process.exit(1)
})

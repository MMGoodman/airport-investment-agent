/**
 * Resolve every covered airport to its nearest NWS observation station, once.
 *
 * WHY A TABLE AND NOT A LOOKUP AT CALL TIME
 *
 * The National Weather Service has no endpoint that takes an IATA code. Getting from an
 * airport to its observations means `/points/{lat},{lon}/stations` and then
 * `/stations/{id}/observations/latest` — two round trips, measured at 1.2 to 3.7 seconds
 * together. In a spoken conversation that is the difference between an answer and a pause,
 * and it would be paid on every single question.
 *
 * The first of those two calls has no reason to happen more than once: an airport does not
 * move. So it happens here, and the live path reads a file.
 *
 * WHY NOT GUESS THE STATION ID
 *
 * The obvious shortcut is that a US station is "K" plus the IATA code, and for most of the
 * lower 48 it is. It is not for Alaska (PANC), Hawaii (PHNL), Puerto Rico (TJSJ) or Guam
 * (PGUM) — and those four are in this dataset. Guessing right on four spot checks is not
 * evidence about a hundred and fifty-eight, and a wrong id fails as "no observations" rather
 * than as an error anyone would trace back to a prefix rule.
 *
 *   node scripts/build-nws-stations.js
 *
 * Rerun it if data/airports.json gains airports. The output is committed: it is derived
 * data, but it derives from a government service over a slow loop, and a fresh clone should
 * not need either.
 */
import { readFileSync, writeFileSync } from 'node:fs'

/**
 * They ask for this, and they mean it.
 *
 * api.weather.gov refuses requests with a generic agent string. Their guidance is a
 * contact — this is a public service and they want to be able to reach whoever is hammering
 * it. `NWS_USER_AGENT` overrides it for a real deployment.
 */
const UA = {
  'User-Agent':
    process.env.NWS_USER_AGENT || 'airport-investment-agent (https://github.com/MMGoodman/airport-investment-agent)',
}

/** Their rate limit is generous and undocumented; this loop is polite rather than fast. */
const GAP_MS = 250

const airports = JSON.parse(readFileSync('data/airports.json', 'utf8'))
const out = {}
const missing = []

for (const [i, a] of airports.entries()) {
  try {
    const res = await fetch(`https://api.weather.gov/points/${a.lat},${a.lon}/stations`, { headers: UA })
    if (!res.ok) throw new Error(`points returned ${res.status}`)
    const id = (await res.json())?.features?.[0]?.properties?.stationIdentifier
    if (!id) throw new Error('no station in range')
    out[a.iata] = id
    process.stdout.write(`\r  ${i + 1}/${airports.length}  ${a.iata} → ${id}          `)
  } catch (err) {
    missing.push(`${a.iata}: ${err.message}`)
  }
  await new Promise((r) => setTimeout(r, GAP_MS))
}

writeFileSync('data/nws-stations.json', `${JSON.stringify(out, null, 0)}\n`)

console.log(`\n\n  ${Object.keys(out).length}/${airports.length} resolved → data/nws-stations.json`)
if (missing.length) {
  /**
   * Named, not counted.
   *
   * An airport with no station is not a failure of this script — it is a fact about that
   * airport, and the weather tool falls back to the coordinate lookup for it at call time.
   * Printing which ones lets somebody check whether the gap is real or a bad afternoon on
   * their side.
   */
  console.log(`\n  ${missing.length} unresolved — the tool will look these up live:`)
  for (const m of missing) console.log(`    ${m}`)
}

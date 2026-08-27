/**
 * Checks everything that does not need the language model: data coverage, the tool
 * contracts, determinism, and weight sensitivity. Costs no API quota, so it can be run
 * as often as you like.
 *
 *   node scripts/verify.js
 */
import { getStore } from '../src/data/store.js'
import { runTool } from '../src/agent/tools.js'
import { scoreAirports } from '../src/scoring/score.js'

let passed = 0
let failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  PASS  ${label}${detail ? `  - ${detail}` : ''}`)
  } else {
    failed++
    console.log(`  FAIL  ${label}${detail ? `  - ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

const store = await getStore()

section('Data coverage')
check('airports loaded', store.airports.length > 100, `${store.airports.length} airports`)
check('annual records loaded', store.annual.length > 500, `${store.annual.length} records`)
for (const iata of ['BOS', 'BDL', 'PVD', 'MHT', 'BTV', 'PWM', 'LAX', 'SNA', 'ANC', 'SFO']) {
  check(`${iata} present`, store.byIata.has(iata), store.byIata.get(iata)?.name ?? 'missing')
}
check(
  'New England resolves to 6 states',
  store.regions['New England'].length === 6,
  store.regions['New England'].join(' '),
)

section('Q1 - rank_airports over New England')
const q1 = await runTool('rank_airports', { region: 'New England' })
check('returns a ranking', q1.data.ranked?.length > 0, `${q1.data.ranked.length} ranked`)
check('names the peer set', Boolean(q1.data.peerSet), q1.data.peerSet)
check('every entry carries drivers', q1.data.ranked.every((r) => r.drivers?.length === 4))
// Caveats used to be repeated verbatim on every entry — ten airports, forty copies of the
// same four sentences. They now sit once at the response level, with only airport-specific
// notes left on the entry. A reader still sees every caveat; the model reads a third less.
check('standing caveats are stated once, at the top', q1.data.caveats?.length > 0, `${q1.data.caveats.length} shared`)
check(
  'no standing caveat is repeated on an entry',
  q1.data.ranked.every((r) => (r.caveats ?? []).every((c) => !q1.data.caveats.includes(c))),
)
check(
  'airport-specific caveats still surface',
  q1.data.ranked.some((r) => (r.caveats ?? []).length > 0),
  q1.data.ranked
    .filter((r) => r.caveats?.length)
    .map((r) => r.iata)
    .join(', ') || 'none in this peer set',
)
check(
  'driver contributions rebuild the score',
  q1.data.ranked.every((r) => {
    const total = r.drivers.reduce((s, d) => s + d.contribution, 0)
    return Math.abs(total - r.score) < 0.5
  }),
)
check(
  'ranks are strictly ordered by score',
  q1.data.ranked.every((r, i, all) => i === 0 || all[i - 1].score >= r.score),
)
check('meta carries source, period, coverage', Boolean(q1.meta.source && q1.meta.period && q1.meta.coverage))
console.log(
  `        top 3: ${q1.data.ranked.slice(0, 3).map((r) => `${r.iata} ${r.score}`).join(', ')}`,
)

section('Q2 - compare_airports LAX vs SNA')
const q2 = await runTool('compare_airports', { iataList: ['LAX', 'SNA'] })
check('returns both airports', q2.data.airports?.length === 2)
check('produces per-metric verdicts', q2.data.verdicts?.length > 0, `${q2.data.verdicts.length} verdicts`)
check(
  'LAX leads on departures',
  q2.data.verdicts.find((v) => v.metric === 'departures')?.leader === 'LAX',
)
check(
  'SNA regulatory cap is surfaced',
  q2.data.airports.find((a) => a.iata === 'SNA')?.constraintNote?.includes('court-ordered'),
)

section('Q3 - get_flight_mix for ANC')
const q3 = await runTool('get_flight_mix', { iata: 'ANC', dimension: 'distance' })
check(
  'returns a long-haul share',
  Number.isFinite(q3.data.estimatedLongHaulDepartureSharePct),
  `${q3.data.estimatedLongHaulDepartureSharePct}%`,
)
check('flags the estimate as inexact', q3.data.exact === false)
check('states the segment-data limitation', q3.data.caveat?.includes('origin-destination'))
check('surfaces the cargo-hub note', q3.data.constraintNote?.includes('cargo'))

section('Q4 - get_airport_profile for SFO')
const q4 = await runTool('get_airport_profile', { iata: 'SFO' })
check('returns a multi-year history', q4.data.history?.length >= 4, `${q4.data.history.length} years`)
check(
  'returns an unmet-demand component',
  Number.isFinite(q4.data.components?.unmetDemand),
  `unmetDemand ${q4.data.components?.unmetDemand}`,
)
check('explanation names the peer set', Boolean(q4.data.explanation?.peerSet), q4.data.explanation?.peerSet)

section('Scoping - out-of-scope requests fail cleanly')
const bad = await runTool('get_airport_profile', { iata: 'LHR' })
check('unknown airport returns a typed error, not a guess', bad.data.error === 'unknown_airport')
const badRegion = await runTool('rank_airports', { region: 'Scandinavia' })
check('unknown region lists what is supported', badRegion.data.error === 'unknown_region')
const badDim = await runTool('get_flight_mix', { iata: 'SFO', dimension: 'carrier' })
check('unavailable dimension explains why', badDim.data.error === 'dimension_unavailable')

section('Metric-name robustness')
const bogus = await runTool('compare_airports', { iataList: ['LAX', 'SNA'], metrics: ['congestion'] })
check(
  'an unknown metric name falls back to the defaults',
  bogus.data.verdicts.length > 0,
  `${bogus.data.verdicts.length} verdicts`,
)
check('the unknown name is reported, not swallowed', bogus.data.unknownMetrics?.includes('congestion'))
check(
  'metricsUsed states what was actually compared',
  bogus.data.metricsUsed?.length > 0,
  bogus.data.metricsUsed?.join(', '),
)
const validMetric = await runTool('compare_airports', { iataList: ['LAX', 'SNA'], metrics: ['loadFactor'] })
check('a valid metric subset is honoured', validMetric.data.metricsUsed?.join() === 'loadFactor')

section('Determinism')
const a = await runTool('rank_airports', { region: 'New England' })
const b = await runTool('rank_airports', { region: 'New England' })
check(
  'identical query returns byte-identical results',
  JSON.stringify(a.data.ranked) === JSON.stringify(b.data.ranked),
)

section('Weights are policy, not code')
const base = await runTool('rank_airports', { region: 'Pacific', topN: 5 })
const growthHeavy = await runTool('rank_airports', {
  region: 'Pacific',
  topN: 5,
  weights: { utilization: 0, growth: 1, unmetDemand: 0, constraint: 0 },
})
check(
  'a weight override changes the ranking',
  JSON.stringify(base.data.ranked.map((r) => r.iata)) !==
    JSON.stringify(growthHeavy.data.ranked.map((r) => r.iata)),
  `${base.data.ranked.map((r) => r.iata).join(',')}  ->  ${growthHeavy.data.ranked.map((r) => r.iata).join(',')}`,
)

section('Insufficient history is excluded, not zeroed')
const national = scoreAirports(store.annual)
check(
  'excluded airports are listed with a reason',
  national.excluded.every((e) => e.iata && e.reason),
  national.excluded.length
    ? national.excluded.map((e) => `${e.iata}: ${e.reason}`).join('; ')
    : 'none excluded in the current dataset',
)
check('no scored airport has a null score', national.scored.every((s) => Number.isFinite(s.score)))

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)

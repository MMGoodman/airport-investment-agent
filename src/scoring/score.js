/**
 * The composite score and its explanation. Pure functions — same inputs, same output,
 * every time. The language model never touches these numbers; it only narrates the
 * explanation object this file returns.
 *
 * The score measures DEMAND OPPORTUNITY, not financial return. Construction cost, AIP
 * grants, PFC revenue, bond capacity, land availability and environmental review are all
 * out of scope; a high score says "traffic pressure is building here", not "this pays back".
 */
import { percentileRank, round } from './normalize.js'
import { rawMetrics } from './metrics.js'
import { BASELINE_YEAR, MOMENTUM_FROM, LATEST_YEAR } from './metrics.js'

export const COMPONENTS = ['utilization', 'growth', 'unmetDemand', 'constraint']

const pct = (v) => (v === null ? null : round(v * 100, 1))

/** Group flat annual rows into one entry per airport. */
export function groupByAirport(annualRows) {
  const byIata = new Map()
  for (const row of annualRows) {
    if (!byIata.has(row.iata)) byIata.set(row.iata, [])
    byIata.get(row.iata).push(row)
  }
  return byIata
}

/**
 * Score every airport against the peer set it is given.
 *
 * The peer set matters: percentile ranks are relative. Scoring six New England airports
 * against each other answers "best of these six"; scoring them inside all 158 answers
 * "how do these six sit nationally". Callers choose, and the answer says which was used.
 */
export function scoreAirports(annualRows, { weights, peerSetLabel } = {}) {
  const w = weights ?? {
    version: 'v1',
    utilization: 0.3,
    growth: 0.3,
    unmetDemand: 0.25,
    constraint: 0.15,
  }

  const grouped = groupByAirport(annualRows)
  const metrics = [...grouped.values()].map(rawMetrics).filter((m) => m && m.iata)

  const scorable = metrics.filter((m) => !m.insufficientHistory)
  const excluded = metrics.filter((m) => m.insufficientHistory)

  // Peer distributions, computed once so every airport is ranked against the same set.
  const dist = {
    departures: scorable.map((m) => m.departures),
    demandGap: scorable.map((m) => m.demandGap).filter(Number.isFinite),
    upgaugeRate: scorable.map((m) => m.upgaugeRate).filter(Number.isFinite),
    departureCagr: scorable.map((m) => m.departureCagr).filter(Number.isFinite),
  }

  const withRaw = scorable.map((m) => {
    // A — Utilization pressure: how hard the existing footprint is worked.
    const utilizationRaw =
      0.6 * m.loadFactor + 0.4 * (percentileRank(m.departures, dist.departures) / 100)

    // B — Growth momentum: busy but flat does not justify capital.
    const growthRaw = 0.7 * (m.paxCagr ?? 0) + 0.3 * ((m.recoveryRatio ?? 1) - 1)

    // C — Unmet demand: passengers outrunning seat supply, and seats already full.
    const unmetRaw =
      0.5 * (percentileRank(m.demandGap, dist.demandGap) / 100) + 0.5 * m.loadFactorPressure

    // D — Capacity constraint: upgauging while departures stay flat.
    const constraintRaw =
      0.5 * (percentileRank(m.upgaugeRate, dist.upgaugeRate) / 100) +
      0.5 * (1 - percentileRank(m.departureCagr, dist.departureCagr) / 100)

    return { m, utilizationRaw, growthRaw, unmetRaw, constraintRaw }
  })

  const rawDist = {
    utilization: withRaw.map((e) => e.utilizationRaw),
    growth: withRaw.map((e) => e.growthRaw),
    unmetDemand: withRaw.map((e) => e.unmetRaw),
    constraint: withRaw.map((e) => e.constraintRaw),
  }

  const scored = withRaw.map((e) => {
    const components = {
      utilization: percentileRank(e.utilizationRaw, rawDist.utilization),
      growth: percentileRank(e.growthRaw, rawDist.growth),
      unmetDemand: percentileRank(e.unmetRaw, rawDist.unmetDemand),
      constraint: percentileRank(e.constraintRaw, rawDist.constraint),
    }

    const score = COMPONENTS.reduce((sum, c) => sum + w[c] * components[c], 0)

    return {
      iata: e.m.iata,
      score: round(score, 1),
      components: Object.fromEntries(
        COMPONENTS.map((c) => [c, round(components[c], 1)]),
      ),
      raw: e.m,
      weightsVersion: w.version ?? 'custom',
    }
  })

  scored.sort((a, b) => b.score - a.score)
  scored.forEach((s, i) => {
    s.rank = i + 1
  })

  return {
    scored,
    excluded: excluded.map((m) => ({
      iata: m.iata,
      reason: m.missingYears?.length
        ? `missing ${m.missingYears.join(', ')}`
        : `only ${m.monthsInLatestYear} months reported in ${LATEST_YEAR}`,
    })),
    peerSet: peerSetLabel ?? `${scored.length} US airports`,
    peerSetSize: scored.length,
    weights: w,
    period: `${BASELINE_YEAR} baseline, ${MOMENTUM_FROM}-${LATEST_YEAR} trend`,
  }
}

/**
 * Turn one scored airport into the structured explanation the agent narrates.
 * The model may only restate what appears here — it must not invent drivers or caveats.
 */
export function explain(entry, context, knownConstraints = {}) {
  const m = entry.raw
  const w = context.weights

  const why = {
    utilization: `Load factor ${pct(m.loadFactor)}% on ${m.departures.toLocaleString()} departures in ${LATEST_YEAR}.`,
    growth: `Passenger CAGR ${pct(m.paxCagr)}% (${MOMENTUM_FROM}-${LATEST_YEAR}); ${
      m.recoveryRatio === null
        ? `no ${BASELINE_YEAR} baseline available`
        : `${pct(m.recoveryRatio - 1)}% versus ${BASELINE_YEAR}`
    }.`,
    unmetDemand: `Passenger CAGR ${pct(m.paxCagr)}% against seat CAGR ${pct(m.seatCagr)}% — a gap of ${pct(m.demandGap)} points — with load factor at ${pct(m.loadFactor)}%.`,
    constraint: `Seats per departure moved ${pct(m.upgaugeRate)}% while departures moved ${pct(m.departureCagr)}%; average ${round(m.seatsPerDeparture, 0)} seats per departure.`,
  }

  const drivers = COMPONENTS.map((c) => ({
    component: c,
    value: entry.components[c],
    weight: w[c],
    contribution: round(w[c] * entry.components[c], 1),
    why: why[c],
  })).sort((a, b) => b.contribution - a.contribution)

  const caveats = [
    'This score measures demand opportunity, not a financial return. Construction cost, grant eligibility, bond capacity, land availability and environmental review are all out of scope.',
    'Source is the BTS T-100 origin-airport summary. International coverage for foreign carriers is partial, so international figures understate true volumes.',
    `Gate and stand counts are not published in this dataset; seats per departure is used as the capacity-constraint proxy.`,
    `${MOMENTUM_FROM} is the trend base rather than a five-year window: 2020 and 2021 traffic was distorted by COVID and would produce meaningless growth rates.`,
  ]

  const constraint = knownConstraints[entry.iata]
  if (constraint) caveats.unshift(`${entry.iata}: ${constraint.note}`)

  if (m.freightLbs > 0 && m.passengers > 0) {
    const lbsPerPax = m.freightLbs / m.passengers
    if (lbsPerPax > 50) {
      caveats.unshift(
        `${entry.iata} carries ${round(lbsPerPax, 0)} lbs of freight per passenger, far above a typical passenger hub. A passenger-only reading understates its role.`,
      )
    }
  }

  return {
    iata: entry.iata,
    score: entry.score,
    rank: entry.rank,
    drivers,
    caveats,
    period: context.period,
    peerSet: context.peerSet,
    weightsVersion: entry.weightsVersion,
  }
}

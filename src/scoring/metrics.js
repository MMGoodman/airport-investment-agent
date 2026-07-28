/**
 * Raw per-airport metrics derived from the annual rollup. Pure functions.
 *
 * Nothing here is normalised — these are the real-world quantities an analyst would
 * quote. Turning them into 0..100 peer ranks happens in score.js.
 */
import { cagr, loadFactorPressure } from './normalize.js'

export const BASELINE_YEAR = 2019
export const MOMENTUM_FROM = 2022
export const LATEST_YEAR = 2025
const MOMENTUM_YEARS = LATEST_YEAR - MOMENTUM_FROM // 3

/** Long-haul distance buckets, statute miles. */
export const DISTANCE_BUCKETS = [
  { name: 'short', max: 700 },
  { name: 'medium', max: 2200 },
  { name: 'long', max: 4000 },
  { name: 'ultra-long', max: Infinity },
]

export function bucketForDistance(miles) {
  return DISTANCE_BUCKETS.find((b) => miles < b.max)?.name ?? 'ultra-long'
}

/**
 * @param {object[]} yearsForAirport annual rollup rows for one airport
 * @returns {object} raw metrics plus the flags that gate which components can be scored
 */
export function rawMetrics(yearsForAirport) {
  const by = new Map(yearsForAirport.map((r) => [r.year, r]))
  const latest = by.get(LATEST_YEAR)
  const momentumBase = by.get(MOMENTUM_FROM)
  const baseline = by.get(BASELINE_YEAR)

  if (!latest) {
    return { iata: yearsForAirport[0]?.iata, insufficientHistory: true, reason: `no ${LATEST_YEAR} data` }
  }

  const paxCagr = momentumBase
    ? cagr(latest.passengers, momentumBase.passengers, MOMENTUM_YEARS)
    : null
  const seatCagr = momentumBase
    ? cagr(latest.seats, momentumBase.seats, MOMENTUM_YEARS)
    : null
  const departureCagr = momentumBase
    ? cagr(latest.departures, momentumBase.departures, MOMENTUM_YEARS)
    : null

  const recoveryRatio =
    baseline && baseline.passengers > 0 ? latest.passengers / baseline.passengers : null

  // Carriers that cannot add flights fly bigger aircraft instead. Rising seats per
  // departure alongside flat departures is the classic slot- or gate-constrained shape.
  const upgaugeRate =
    momentumBase && momentumBase.seatsPerDeparture > 0
      ? latest.seatsPerDeparture / momentumBase.seatsPerDeparture - 1
      : null

  const demandGap = paxCagr !== null && seatCagr !== null ? paxCagr - seatCagr : null

  return {
    iata: latest.iata,
    insufficientHistory: !momentumBase || latest.months !== 12,
    missingYears: [BASELINE_YEAR, MOMENTUM_FROM, LATEST_YEAR].filter((y) => !by.has(y)),
    monthsInLatestYear: latest.months,

    passengers: latest.passengers,
    departures: latest.departures,
    seats: latest.seats,
    loadFactor: latest.loadFactor,
    seatsPerDeparture: latest.seatsPerDeparture,
    freightLbs: latest.freightLbs,
    avgStageMiles: latest.avgStageMiles,
    avgPassengerMiles: latest.avgPassengerMiles,
    avgDomesticStageMiles: latest.avgDomesticStageMiles,
    avgIntlStageMiles: latest.avgIntlStageMiles,
    intlDepartureShare: latest.intlDepartureShare,
    intlPassengerShare: latest.intlPassengerShare,

    paxCagr,
    seatCagr,
    departureCagr,
    recoveryRatio,
    upgaugeRate,
    demandGap,
    loadFactorPressure: loadFactorPressure(latest.loadFactor),
  }
}

/**
 * Long-haul exposure.
 *
 * SCOPE LIMIT: the BTS Socrata endpoint only publishes T-100 pre-aggregated per origin
 * airport, so there is no origin-destination row to bucket by distance. What we can state
 * exactly is the international share and the average stage length of each leg type; the
 * long-haul share below is an estimate built from those, not a count of flights.
 */
export function longHaulProfile(m) {
  const LONG_HAUL_MILES = 2200
  const intlIsLongHaul = m.avgIntlStageMiles >= LONG_HAUL_MILES
  const domesticIsLongHaul = m.avgDomesticStageMiles >= LONG_HAUL_MILES

  const estimatedLongHaulDepartureShare =
    (intlIsLongHaul ? m.intlDepartureShare : 0) +
    (domesticIsLongHaul ? 1 - m.intlDepartureShare : 0)

  return {
    method: 'stage-length estimate',
    threshold: `>= ${LONG_HAUL_MILES} statute miles`,
    avgStageMiles: m.avgStageMiles,
    avgDomesticStageMiles: m.avgDomesticStageMiles,
    avgIntlStageMiles: m.avgIntlStageMiles,
    intlDepartureShare: m.intlDepartureShare,
    intlPassengerShare: m.intlPassengerShare,
    estimatedLongHaulDepartureShare,
    exact: false,
    caveat:
      'BTS publishes T-100 aggregated per origin airport, not per origin-destination segment, ' +
      'so flights cannot be counted into distance buckets. This share is inferred from average ' +
      'stage length by leg type: international legs averaging over the threshold are counted as ' +
      'long-haul, domestic legs likewise. A domestic network that mixes short and very long legs ' +
      'around a sub-threshold average will be understated. An exact figure needs the T-100 segment ' +
      'file from BTS TranStats, which is a bulk download rather than an API.',
  }
}

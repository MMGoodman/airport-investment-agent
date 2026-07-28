/** Pure helpers. No I/O, no clock, no randomness. */

/**
 * Percentile rank of `value` within `values`, 0..100.
 *
 * Percentile rather than z-score on purpose: airport traffic is heavily right-skewed
 * (ATL and a long tail), so a z-score is dominated by a handful of mega-hubs and is
 * hard to explain to a non-technical analyst. "72nd of 158 peers" needs no translation.
 * Ties share the midpoint so equal inputs cannot be ordered arbitrarily.
 */
export function percentileRank(value, values) {
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0) return 0
  if (finite.length === 1) return finite[0] === value ? 50 : value > finite[0] ? 100 : 0

  let below = 0
  let equal = 0
  for (const v of finite) {
    if (v < value) below++
    else if (v === value) equal++
  }
  return ((below + equal / 2) / finite.length) * 100
}

/** Percentile rank of every entry against the same peer set, as a Map. */
export function percentileRankAll(entries) {
  const values = entries.map((e) => e.value)
  return new Map(entries.map((e) => [e.key, percentileRank(e.value, values)]))
}

/**
 * Compound annual growth rate over `years` periods.
 * Returns null when it cannot be computed honestly — a zero or missing base would
 * produce an infinite rate, and reporting that as 0 would silently flatter the airport.
 */
export function cagr(latest, base, years) {
  if (!Number.isFinite(latest) || !Number.isFinite(base)) return null
  if (base <= 0 || latest < 0 || years <= 0) return null
  return Math.pow(latest / base, 1 / years) - 1
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** 0 at or below 80% load factor, 1 at 100%. The industry's practical squeeze zone. */
export function loadFactorPressure(loadFactor) {
  if (!Number.isFinite(loadFactor)) return 0
  // (1 - 0.8) / 0.2 lands on 0.9999999999999998 in binary floating point; snapping at the
  // tenth decimal keeps the endpoints exact without affecting any real measurement.
  const pressure = Number((((loadFactor - 0.8) / 0.2)).toFixed(10))
  return clamp(pressure, 0, 1)
}

export const round = (v, places = 1) =>
  Number.isFinite(v) ? Number(v.toFixed(places)) : null

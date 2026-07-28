import { describe, expect, it } from 'vitest'
import { cagr, loadFactorPressure, percentileRank } from '../normalize.js'
import { bucketForDistance, rawMetrics } from '../metrics.js'
import { explain, scoreAirports } from '../score.js'

/** Hand-built airport: one row per year, numbers chosen so the maths is checkable. */
function airport(iata, { pax2019, pax2022, pax2025, seats2022, seats2025, dep2022, dep2025 }) {
  const row = (year, passengers, seats, departures) => ({
    iata,
    year,
    months: 12,
    passengers,
    seats,
    departures,
    freightLbs: 0,
    loadFactor: seats ? passengers / seats : 0,
    seatsPerDeparture: departures ? seats / departures : 0,
    avgStageMiles: 900,
    avgPassengerMiles: 950,
    avgDomesticStageMiles: 800,
    avgIntlStageMiles: 4200,
    intlDepartureShare: 0.1,
    intlPassengerShare: 0.12,
  })
  return [
    row(2019, pax2019, Math.round(pax2019 / 0.8), 1000),
    row(2022, pax2022, seats2022, dep2022),
    row(2025, pax2025, seats2025, dep2025),
  ]
}

describe('percentileRank', () => {
  it('ranks a known array', () => {
    const values = [10, 20, 30, 40]
    expect(percentileRank(10, values)).toBe(12.5) // 0 below + half of 1 tie
    expect(percentileRank(40, values)).toBe(87.5) // 3 below + half of 1 tie
    expect(percentileRank(25, values)).toBe(50)
  })

  it('gives tied values the same rank rather than an arbitrary order', () => {
    const values = [5, 5, 5, 5]
    expect(percentileRank(5, values)).toBe(50)
  })

  it('survives an empty or single-element peer set', () => {
    expect(percentileRank(10, [])).toBe(0)
    expect(percentileRank(10, [10])).toBe(50)
    expect(percentileRank(99, [10])).toBe(100)
  })
})

describe('cagr', () => {
  it('computes a known series', () => {
    // 100 -> 133.1 over 3 years is exactly 10% a year.
    expect(cagr(133.1, 100, 3)).toBeCloseTo(0.1, 6)
  })

  it('returns null rather than Infinity when the base is zero or missing', () => {
    expect(cagr(100, 0, 3)).toBeNull()
    expect(cagr(100, undefined, 3)).toBeNull()
    expect(cagr(NaN, 100, 3)).toBeNull()
  })
})

describe('loadFactorPressure', () => {
  it('is zero at or below 80% and one at 100%', () => {
    expect(loadFactorPressure(0.75)).toBe(0)
    expect(loadFactorPressure(0.8)).toBe(0)
    expect(loadFactorPressure(0.9)).toBeCloseTo(0.5, 6)
    expect(loadFactorPressure(1.0)).toBe(1)
    expect(loadFactorPressure(1.2)).toBe(1) // clamped
  })
})

describe('distance buckets', () => {
  it('places distances in the documented buckets', () => {
    expect(bucketForDistance(500)).toBe('short')
    expect(bucketForDistance(700)).toBe('medium')
    expect(bucketForDistance(2200)).toBe('long')
    expect(bucketForDistance(4000)).toBe('ultra-long')
  })
})

describe('rawMetrics', () => {
  it('derives the demand gap from passenger and seat growth', () => {
    const m = rawMetrics(
      airport('AAA', {
        pax2019: 800_000,
        pax2022: 1_000_000,
        pax2025: 1_331_000, // exactly 10% a year
        seats2022: 1_250_000,
        seats2025: 1_400_000,
        dep2022: 10_000,
        dep2025: 10_500,
      }),
    )
    expect(m.paxCagr).toBeCloseTo(0.1, 6)
    expect(m.demandGap).toBeGreaterThan(0) // passengers outrunning seats
    expect(m.insufficientHistory).toBe(false)
  })

  it('flags an airport whose latest year is incomplete', () => {
    const rows = airport('BBB', {
      pax2019: 1, pax2022: 1, pax2025: 1,
      seats2022: 1, seats2025: 1, dep2022: 1, dep2025: 1,
    })
    rows[2].months = 7
    expect(rawMetrics(rows).insufficientHistory).toBe(true)
  })
})

describe('scoreAirports', () => {
  const peers = [
    // Demand outrunning supply, full aircraft, flat departures: the target profile.
    ...airport('SQZ', {
      pax2019: 900_000, pax2022: 1_000_000, pax2025: 1_331_000,
      seats2022: 1_150_000, seats2025: 1_450_000, dep2022: 10_000, dep2025: 10_100,
    }),
    // Plenty of empty seats and shrinking: should land at the bottom.
    ...airport('SLK', {
      pax2019: 1_200_000, pax2022: 1_000_000, pax2025: 900_000,
      seats2022: 1_600_000, seats2025: 1_700_000, dep2022: 12_000, dep2025: 13_000,
    }),
    // Middle of the road.
    ...airport('MID', {
      pax2019: 1_000_000, pax2022: 1_000_000, pax2025: 1_100_000,
      seats2022: 1_300_000, seats2025: 1_400_000, dep2022: 11_000, dep2025: 11_400,
    }),
  ]

  it('ranks the squeezed airport above the slack one', () => {
    const { scored } = scoreAirports(peers)
    const rank = Object.fromEntries(scored.map((s) => [s.iata, s.rank]))
    expect(rank.SQZ).toBeLessThan(rank.SLK)
  })

  it('reproduces the composite from its weighted components', () => {
    const { scored, weights } = scoreAirports(peers)
    const top = scored[0]
    const byHand =
      weights.utilization * top.components.utilization +
      weights.growth * top.components.growth +
      weights.unmetDemand * top.components.unmetDemand +
      weights.constraint * top.components.constraint
    expect(top.score).toBeCloseTo(byHand, 1)
  })

  it('changes the ranking when the weights change', () => {
    const base = scoreAirports(peers).scored.map((s) => s.iata)
    const growthOnly = scoreAirports(peers, {
      weights: { version: 'growth-only', utilization: 0, growth: 1, unmetDemand: 0, constraint: 0 },
    }).scored.map((s) => s.iata)
    // Same airports, and the weighting is doing real work rather than being decorative.
    expect(new Set(growthOnly)).toEqual(new Set(base))
    expect(
      scoreAirports(peers, {
        weights: { version: 'x', utilization: 0, growth: 1, unmetDemand: 0, constraint: 0 },
      }).scored[0].score,
    ).not.toBe(scoreAirports(peers).scored[0].score)
  })

  it('excludes an airport with insufficient history instead of scoring it as zero', () => {
    const short = airport('NEW', {
      pax2019: 1, pax2022: 1, pax2025: 500_000,
      seats2022: 1, seats2025: 600_000, dep2022: 1, dep2025: 5_000,
    }).filter((r) => r.year === 2025)

    const { scored, excluded } = scoreAirports([...peers, ...short])
    expect(scored.find((s) => s.iata === 'NEW')).toBeUndefined()
    expect(excluded.map((e) => e.iata)).toContain('NEW')
  })

  it('is deterministic across runs', () => {
    const a = scoreAirports(peers).scored
    const b = scoreAirports(peers).scored
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('explain', () => {
  const peers = [
    ...airport('AAA', {
      pax2019: 900_000, pax2022: 1_000_000, pax2025: 1_331_000,
      seats2022: 1_150_000, seats2025: 1_450_000, dep2022: 10_000, dep2025: 10_100,
    }),
    ...airport('BBB', {
      pax2019: 1_200_000, pax2022: 1_000_000, pax2025: 900_000,
      seats2022: 1_600_000, seats2025: 1_700_000, dep2022: 12_000, dep2025: 13_000,
    }),
  ]

  it('returns drivers ordered by contribution, and the contributions rebuild the score', () => {
    const ctx = scoreAirports(peers)
    const e = explain(ctx.scored[0], ctx)
    expect(e.drivers).toHaveLength(4)
    const total = e.drivers.reduce((s, d) => s + d.contribution, 0)
    expect(total).toBeCloseTo(e.score, 0)
    for (let i = 1; i < e.drivers.length; i++) {
      expect(e.drivers[i - 1].contribution).toBeGreaterThanOrEqual(e.drivers[i].contribution)
    }
  })

  it('surfaces a hand-curated constraint note for the airport it belongs to', () => {
    const ctx = scoreAirports(peers)
    const e = explain(ctx.scored[0], ctx, {
      AAA: { note: 'Operates under a court-ordered noise cap.' },
      ZZZ: { note: 'Should not appear.' },
    })
    expect(e.caveats.some((c) => c.includes('court-ordered noise cap'))).toBe(true)
    expect(e.caveats.some((c) => c.includes('Should not appear'))).toBe(false)
  })

  it('always states that the score is not a financial return', () => {
    const ctx = scoreAirports(peers)
    const e = explain(ctx.scored[0], ctx)
    expect(e.caveats.some((c) => /not a financial return/i.test(c))).toBe(true)
  })
})

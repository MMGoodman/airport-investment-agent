/**
 * The tool surface. Every handler returns { data, meta } and every number in `data`
 * comes out of src/scoring — the model chooses which tool to call and narrates the
 * result, but never computes a figure itself.
 */
import { annualFor, getStore, resolveRegion, selectAirports } from '../data/store.js'
import { explain, scoreAirports } from '../scoring/score.js'
import { longHaulProfile, rawMetrics, BASELINE_YEAR, MOMENTUM_FROM, LATEST_YEAR } from '../scoring/metrics.js'
import { round } from '../scoring/normalize.js'

/** The only metric names compare_airports understands. */
export const COMPARABLE_METRICS = [
  'loadFactor',
  'departures',
  'passengers',
  'seats',
  'seatsPerDeparture',
  'paxCagr',
  'seatCagr',
  'departureCagr',
  'demandGap',
  'recoveryRatio',
  'upgaugeRate',
  'freightLbs',
  'avgStageMiles',
  'intlDepartureShare',
]

const DEFAULT_COMPARE_METRICS = [
  'loadFactor',
  'departures',
  'passengers',
  'seatsPerDeparture',
  'paxCagr',
  'seatCagr',
  'demandGap',
]

const SOURCE = 'BTS T-100 Segment Summary By Origin Airport (data.bts.gov, dataset r495-tyji)'
const PERIOD = `${BASELINE_YEAR} baseline; ${MOMENTUM_FROM}-${LATEST_YEAR} trend`
const COVERAGE =
  'US airports reporting at least 400,000 outbound passengers in ' +
  `${LATEST_YEAR}. International legs flown by foreign carriers are only partially reported to BTS.`

function meta(extra = []) {
  return {
    source: SOURCE,
    period: PERIOD,
    coverage: COVERAGE,
    assumptions: [
      'Score measures demand opportunity, not a financial return.',
      'Gate counts are unavailable; seats per departure is the capacity-constraint proxy.',
      '2020 and 2021 are excluded from trends as COVID-distorted.',
      ...extra,
    ],
  }
}

/** Merge caller-supplied weights over the configured ones and renormalise to sum 1. */
function resolveWeights(base, override) {
  if (!override) return base
  const merged = { ...base, ...override, version: 'custom' }
  const keys = ['utilization', 'growth', 'unmetDemand', 'constraint']
  const total = keys.reduce((s, k) => s + (Number(merged[k]) || 0), 0)
  if (total <= 0) return base
  for (const k of keys) merged[k] = (Number(merged[k]) || 0) / total
  return merged
}

const describe = (store, iata) => {
  const a = store.byIata.get(iata)
  return a ? { iata, name: a.name, city: a.city, state: a.state, region: a.region } : { iata }
}

export const handlers = {
  async list_supported_regions() {
    const store = await getStore()
    const regions = {}
    for (const a of store.airports) {
      ;(regions[a.region] ??= []).push(a.iata)
    }
    for (const k of Object.keys(regions)) regions[k].sort()

    return {
      data: {
        regions: Object.entries(regions)
          .map(([region, airports]) => ({ region, count: airports.length, airports }))
          .sort((a, b) => a.region.localeCompare(b.region)),
        totalAirports: store.airports.length,
      },
      meta: meta(),
    }
  },

  async rank_airports({ region, state, iataList, weights, topN } = {}) {
    const store = await getStore()

    let resolvedRegion = null
    if (region) {
      resolvedRegion = resolveRegion(store, region)
      if (!resolvedRegion) {
        return {
          data: {
            error: 'unknown_region',
            requested: region,
            supported: Object.keys(store.regions),
          },
          meta: meta(),
        }
      }
    }

    const selection = selectAirports(store, { region: resolvedRegion, state, iataList })
    if (selection.length === 0) {
      return { data: { error: 'no_airports_matched', region, state, iataList }, meta: meta() }
    }

    const label = resolvedRegion
      ? `${selection.length} ${resolvedRegion} airports`
      : state
        ? `${selection.length} airports in ${state}`
        : iataList
          ? `${selection.length} named airports`
          : `${selection.length} US airports`

    const ctx = scoreAirports(annualFor(store, selection), {
      weights: resolveWeights(store.weights, weights),
      peerSetLabel: label,
    })

    const ranked = ctx.scored.slice(0, topN ?? 10).map((s) => ({
      ...describe(store, s.iata),
      score: s.score,
      rank: s.rank,
      components: s.components,
      ...explain(s, ctx, store.knownConstraints),
    }))

    // The four standing caveats are identical on every entry, so ten airports used to
    // carry forty copies of the same four sentences — three quarters of the payload, and
    // the reason a spoken answer took so long to start. Hoist what every entry shares and
    // leave each entry only what is true of that airport. No figure changes.
    const shared = ranked.length
      ? ranked[0].caveats.filter((c) => ranked.every((r) => r.caveats.includes(c)))
      : []
    for (const entry of ranked) {
      entry.caveats = entry.caveats.filter((c) => !shared.includes(c))
    }

    return {
      data: {
        peerSet: ctx.peerSet,
        weights: ctx.weights,
        excluded: ctx.excluded,
        caveats: shared,
        ranked,
      },
      meta: meta([
        `Percentile ranks are relative to the peer set actually scored (${ctx.peerSet}), not to all US airports.`,
      ]),
    }
  },

  async compare_airports({ iataList, metrics } = {}) {
    const store = await getStore()
    const codes = (iataList ?? []).map((c) => String(c).toUpperCase())
    const known = codes.filter((c) => store.byIata.has(c))
    const unknown = codes.filter((c) => !store.byIata.has(c))

    if (known.length < 2) {
      return {
        data: { error: 'need_two_known_airports', requested: codes, unknown },
        meta: meta(),
      }
    }

    // Scored against the national field so "more congested" means nationally, not
    // just relative to the other airport in the pair.
    const ctx = scoreAirports(store.annual, { peerSetLabel: 'all 158 scored US airports' })
    const byIata = new Map(ctx.scored.map((s) => [s.iata, s]))

    // An unrecognised metric name used to pass straight through and produce a column of
    // nulls with no verdicts — a silent failure. Validate, fall back, and say what was
    // dropped so the agent can tell the user rather than quietly answering less.
    const requested = Array.isArray(metrics) ? metrics : metrics ? [metrics] : null
    const valid = requested?.filter((m) => COMPARABLE_METRICS.includes(m)) ?? null
    const unknownMetrics = requested?.filter((m) => !COMPARABLE_METRICS.includes(m)) ?? []
    const chosen = valid?.length ? valid : DEFAULT_COMPARE_METRICS

    const rows = known.map((iata) => {
      const entry = byIata.get(iata)
      const m = entry?.raw ?? rawMetrics(annualFor(store, [iata]))
      const values = Object.fromEntries(
        chosen.map((k) => [
          k,
          typeof m[k] === 'number'
            ? round(m[k], ['loadFactor', 'paxCagr', 'seatCagr', 'demandGap'].includes(k) ? 4 : 1)
            : (m[k] ?? null),
        ]),
      )
      return {
        ...describe(store, iata),
        score: entry?.score ?? null,
        nationalRank: entry?.rank ?? null,
        components: entry?.components ?? null,
        metrics: values,
        constraintNote: store.knownConstraints[iata]?.note ?? null,
      }
    })

    // Deterministic verdict per metric — the model does not decide who wins.
    const verdicts = chosen
      .map((k) => {
        const withValue = rows.filter((r) => typeof r.metrics[k] === 'number')
        if (withValue.length < 2) return null
        const sorted = [...withValue].sort((a, b) => b.metrics[k] - a.metrics[k])
        const [top, next] = sorted
        return {
          metric: k,
          leader: top.iata,
          leaderValue: top.metrics[k],
          runnerUp: next.iata,
          runnerUpValue: next.metrics[k],
          tied: top.metrics[k] === next.metrics[k],
        }
      })
      .filter(Boolean)

    return {
      data: {
        peerSet: ctx.peerSet,
        metricsUsed: chosen,
        unknownMetrics,
        airports: rows,
        verdicts,
        unknown,
        explanations: known.map((iata) =>
          byIata.has(iata) ? explain(byIata.get(iata), ctx, store.knownConstraints) : { iata, note: 'not scored' },
        ),
      },
      meta: meta([
        'Congestion here means utilisation pressure measured from load factor and departure volume. It is not a delay statistic; FAA delay feeds are not part of this build.',
      ]),
    }
  },

  async get_airport_profile({ iata } = {}) {
    const store = await getStore()
    const code = String(iata ?? '').toUpperCase()
    if (!store.byIata.has(code)) {
      return {
        data: { error: 'unknown_airport', requested: code, hint: 'Call list_supported_regions to see coverage.' },
        meta: meta(),
      }
    }

    const history = annualFor(store, [code]).sort((a, b) => a.year - b.year)
    const ctx = scoreAirports(store.annual, { peerSetLabel: 'all 158 scored US airports' })
    const entry = ctx.scored.find((s) => s.iata === code)

    return {
      data: {
        ...describe(store, code),
        history: history.map((h) => ({
          year: h.year,
          months: h.months,
          passengers: h.passengers,
          departures: h.departures,
          seats: h.seats,
          loadFactor: round(h.loadFactor, 4),
          seatsPerDeparture: round(h.seatsPerDeparture, 1),
          freightLbs: h.freightLbs,
          avgStageMiles: round(h.avgStageMiles, 0),
        })),
        score: entry?.score ?? null,
        nationalRank: entry?.rank ?? null,
        components: entry?.components ?? null,
        explanation: entry ? explain(entry, ctx, store.knownConstraints) : null,
        constraintNote: store.knownConstraints[code]?.note ?? null,
      },
      meta: meta(),
    }
  },

  async get_flight_mix({ iata, dimension } = {}) {
    const store = await getStore()
    const code = String(iata ?? '').toUpperCase()
    if (!store.byIata.has(code)) {
      return { data: { error: 'unknown_airport', requested: code }, meta: meta() }
    }

    const dim = dimension ?? 'distance'
    if (dim !== 'distance') {
      return {
        data: {
          error: 'dimension_unavailable',
          requested: dim,
          available: ['distance'],
          why: 'The origin-airport summary carries no carrier or destination breakdown. Those need the T-100 segment file, which BTS publishes as a bulk download rather than through this API.',
        },
        meta: meta(),
      }
    }

    const m = rawMetrics(annualFor(store, [code]))
    const profile = longHaulProfile(m)

    return {
      data: {
        ...describe(store, code),
        year: LATEST_YEAR,
        ...profile,
        estimatedLongHaulDepartureSharePct: round(profile.estimatedLongHaulDepartureShare * 100, 1),
        intlDepartureSharePct: round(profile.intlDepartureShare * 100, 1),
        intlPassengerSharePct: round(profile.intlPassengerShare * 100, 1),
        avgStageMiles: round(profile.avgStageMiles, 0),
        avgDomesticStageMiles: round(profile.avgDomesticStageMiles, 0),
        avgIntlStageMiles: round(profile.avgIntlStageMiles, 0),
        constraintNote: store.knownConstraints[code]?.note ?? null,
      },
      meta: meta([profile.caveat]),
    }
  },
}

/** JSON-Schema tool declarations, shared by the model call and the HTTP layer. */
export const toolSchemas = [
  {
    name: 'list_supported_regions',
    description:
      'List the regions this agent covers and which airports fall in each. Call this first when the user names a region and you are unsure whether it is in scope.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'rank_airports',
    description:
      'Rank airports as candidates for terminal expansion using the deterministic scoring engine. Use for "which airports are strong candidates" style questions. Returns scores, ranks, per-driver contributions and caveats.',
    parameters: {
      type: 'object',
      properties: {
        region: { type: 'string', description: 'Region name, e.g. "New England".' },
        state: { type: 'string', description: 'Two-letter US state code.' },
        iataList: {
          type: 'array',
          items: { type: 'string' },
          description: 'Explicit IATA codes to rank against each other.',
        },
        topN: { type: 'integer', description: 'How many to return. Default 10.' },
        weights: {
          type: 'object',
          description:
            'Optional weight override, e.g. {"growth": 0.6} to answer "what if we care more about growth". Renormalised to sum to 1.',
          properties: {
            utilization: { type: 'number' },
            growth: { type: 'number' },
            unmetDemand: { type: 'number' },
            constraint: { type: 'number' },
          },
        },
      },
    },
  },
  {
    name: 'compare_airports',
    description:
      'Compare two or more airports side by side on congestion and demand metrics, with a deterministic winner per metric. Use for "compare X and Y" questions.',
    parameters: {
      type: 'object',
      properties: {
        iataList: {
          type: 'array',
          items: { type: 'string' },
          description: 'Two or more IATA codes, e.g. ["LAX","SNA"].',
        },
        metrics: {
          type: 'array',
          items: { type: 'string', enum: COMPARABLE_METRICS },
          description:
            'Optional subset of metric names. Must come from the listed set — "congestion" and other free-text labels are not metric names. Omit this to get the standard congestion and demand set.',
        },
      },
      required: ['iataList'],
    },
  },
  {
    name: 'get_airport_profile',
    description:
      'Full metric history, component scores, explanation and caveats for one airport. Use for "why" and "unmet demand at X" questions.',
    parameters: {
      type: 'object',
      properties: { iata: { type: 'string', description: 'IATA code, e.g. "SFO".' } },
      required: ['iata'],
    },
  },
  {
    name: 'get_flight_mix',
    description:
      'Distribution of flights out of one airport. Only the distance dimension is available; use it for long-haul share questions.',
    parameters: {
      type: 'object',
      properties: {
        iata: { type: 'string' },
        dimension: { type: 'string', enum: ['distance', 'carrier', 'destination'] },
      },
      required: ['iata'],
    },
  },
]

export async function runTool(name, args) {
  const handler = handlers[name]
  if (!handler) {
    return { data: { error: 'unknown_tool', requested: name, available: Object.keys(handlers) }, meta: meta() }
  }
  return handler(args ?? {})
}

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

/**
 * Weather carries its own provenance, deliberately not meta().
 *
 * Every other tool here answers from a file that shipped with the repo: same input, same
 * output, forever. This one reads a live third-party feed. Letting it borrow the BTS
 * `source` line would put a reading that expires in fifteen minutes and a scored figure
 * from a frozen dataset under one claim of origin, and the tool trace is the only thing a
 * reader has to tell them apart.
 */
const WEATHER_SOURCE = 'Open-Meteo current conditions (api.open-meteo.com), a live third-party feed'

function weatherMeta(extra = []) {
  return {
    source: WEATHER_SOURCE,
    period: 'current observation',
    coverage: 'The 158 airports in this build, located by the coordinates in data/airports.json.',
    assumptions: [
      'Live reading, not a scored figure. It is not deterministic and it is not an input to any ranking.',
      'Model output at the airport coordinates, not an official METAR from the field.',
      ...extra,
    ],
  }
}

/** WMO weather codes, the subset an airport actually cares about. */
const WMO = {
  0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  56: 'light freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'light freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'light rain showers', 81: 'rain showers', 82: 'violent rain showers',
  85: 'light snow showers', 86: 'heavy snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with heavy hail',
}

/** A hung fetch would stall a spoken turn with no way for the caller to tell why. */
const WEATHER_TIMEOUT_MS = 4000

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

  /**
   * Live conditions at one covered airport.
   *
   * The airport list IS the access list. Coordinates come from data/airports.json, so an
   * airport outside the 158 has none here and cannot be looked up — there is no free-text
   * place name to pass through to the upstream service, and no way to turn this tool into
   * a general weather lookup by asking it nicely.
   *
   * Open-Meteo needs no key and no account, which keeps the repo runnable from a clone.
   * A failure returns a typed error naming the stage, never a plausible-looking reading.
   */
  async get_airport_weather({ iata } = {}) {
    const store = await getStore()
    const code = String(iata ?? '').toUpperCase()
    const airport = store.byIata.get(code)

    if (!airport) {
      return {
        data: {
          error: 'unknown_airport',
          requested: code,
          hint: 'Weather is available only for the airports this build covers. Call list_supported_regions to see them.',
        },
        meta: weatherMeta(),
      }
    }

    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${airport.lat}&longitude=${airport.lon}` +
      '&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,' +
      'wind_gusts_10m,visibility,precipitation,cloud_cover,weather_code' +
      '&wind_speed_unit=kn&timezone=auto'

    let current
    try {
      const upstream = await fetch(url, { signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS) })
      if (!upstream.ok) {
        return {
          data: { error: 'weather_feed_failed', requested: code, status: upstream.status, stage: 'upstream' },
          meta: weatherMeta(),
        }
      }
      current = (await upstream.json()).current
    } catch (err) {
      return {
        data: {
          error: 'weather_feed_unreachable',
          requested: code,
          stage: 'network',
          why: err.name === 'TimeoutError' ? `No answer within ${WEATHER_TIMEOUT_MS} ms.` : err.message,
        },
        meta: weatherMeta(),
      }
    }

    if (!current) {
      return { data: { error: 'weather_feed_empty', requested: code }, meta: weatherMeta() }
    }

    // Both scales, computed here rather than left to the model: US airports are read in
    // Fahrenheit and the caller may be thinking in Celsius, and a unit conversion is
    // arithmetic the same rule covers — the model states figures, it does not derive them.
    const f = (c) => (c == null ? null : round(c * 1.8 + 32, 1))

    return {
      data: {
        ...describe(store, code),
        observedAt: current.time ?? null,
        conditions: WMO[current.weather_code] ?? `WMO code ${current.weather_code}`,
        temperatureC: current.temperature_2m,
        temperatureF: f(current.temperature_2m),
        feelsLikeC: current.apparent_temperature,
        feelsLikeF: f(current.apparent_temperature),
        windKnots: current.wind_speed_10m,
        windGustKnots: current.wind_gusts_10m,
        windDirectionDegrees: current.wind_direction_10m,
        visibilityMetres: current.visibility,
        precipitationMm: current.precipitation,
        cloudCoverPct: current.cloud_cover,
      },
      meta: weatherMeta(),
    }
  },

  /**
   * Close the session.
   *
   * A tool and not a prompt instruction, because "stop talking" has to actually tear down
   * a WebRTC peer connection, and only the browser can do that. The handler is an
   * acknowledgement with no side effect; LivePanel watches the tool trace for this name
   * and hangs up once the closing sentence has finished playing.
   *
   * Reachable on the text path too, where it is inert — the model gets the acknowledgement
   * and there is no session to close. That is the correct behaviour, not a gap: a typed
   * chat has nothing to hang up.
   */
  async end_call({ reason } = {}) {
    return {
      data: {
        ended: true,
        reason: String(reason ?? 'unspecified').slice(0, 200),
        note: 'Acknowledged. The client closes the session once the current sentence has finished.',
      },
      meta: {
        source: 'session control — not data',
        period: null,
        coverage: null,
        assumptions: ['No effect on a text conversation; there is no live session to end.'],
      },
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
  {
    name: 'get_airport_weather',
    description:
      'Current weather at one covered airport, read live from a third-party feed. Use for "what is the weather at X" questions. It is an observation, not a scored figure, and it is not an input to any ranking — never use it to argue for or against an expansion.',
    parameters: {
      type: 'object',
      properties: {
        iata: { type: 'string', description: 'IATA code of a covered airport, e.g. "BOS".' },
      },
      required: ['iata'],
    },
  },
  {
    name: 'end_call',
    description:
      'End the live voice session. Call this the MOMENT the caller explicitly asks to hang up or says goodbye — before your own goodbye, because words never close the line and announcing the end without this tool strands the call open. Explicit means בי, להתראות, סיימתי, אפשר לסיים; a bare תודה or אוקיי after an answer is acknowledgement, not goodbye — never end on it. After it returns, say one short closing sentence; the session closes when that sentence ends. Also for abuse, or a third pressed attempt at something you have already refused twice. Never end a call merely because a question was out of scope or because the caller repeated themselves.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'One short phrase recording why the call was ended, for the session log.',
        },
      },
      required: ['reason'],
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

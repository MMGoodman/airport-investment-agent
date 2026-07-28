# Design — Airport Investment Intelligence Agent

## 1. Problem framing

The brief asks where "renovations will be most profitable based on increased flight and
passenger capacity". Profitability is not observable from public aviation data — it needs
construction cost, grant eligibility, PFC and bond capacity, land availability and
environmental review, none of which are in any aviation feed.

So the question was translated into one that public data can actually answer:

> **Where is demand pressing hardest against the capacity that exists today, and rising?**

That is a **demand-opportunity** score, not a return forecast. Everything in this build
is consistent with that framing, and the agent states the distinction in every answer.
An airport scoring 80 has traffic building against its current footprint; whether the
capex pays back is a separate question this system deliberately does not answer.

Four target questions drove the tool surface:

1. Which airports in New England are strong candidates for terminal expansion?
2. Compare LA (LAX) and Santa Ana (SNA) congestion levels.
3. What percentage of flights out of Anchorage (ANC) are long-haul?
4. What is the unmet flight demand at SFO, and why?

Transcripts for all four, plus a follow-up, are in the appendix.

---

## 2. Scoring methodology

### Data

**BTS T-100 Segment Summary By Origin Airport** (`data.bts.gov`, dataset `r495-tyji`),
plus **OurAirports** for state and coordinates. Monthly per origin airport: departures,
passengers, seats, load factor, average stage length, a domestic/international split, and
freight pounds.

**Scope after ingest:** 158 US airports that cleared 400,000 outbound passengers in 2025,
across 2019, 2022, 2023, 2024, 2025. Below that floor the monthly figures get noisy enough
that percentile ranks stop carrying meaning.

**Why those years.** 2020 and 2021 are excluded from every trend. A CAGR anchored in 2020
measures the recovery from a global shutdown, not an airport's demand trajectory, and would
have put whichever airport fell furthest at the top of the ranking. Momentum is therefore
measured 2022→2025 and recovery separately as 2025 ÷ 2019. Those are two genuinely
different signals: an airport can be growing fast and still be below its pre-COVID size.

### The four components

Each is computed as a real-world quantity, then converted to a **0–100 percentile rank
within the peer set being scored**.

**Percentile rank rather than z-score.** Airport traffic is heavily right-skewed — ATL and
a long tail. A z-score is dominated by a handful of mega-hubs, and "1.8 standard deviations
above the mean" needs translating for a non-technical reader. "72nd of 158 peers" does not.
Ties share the midpoint, so equal inputs can never be ordered arbitrarily.

| Component | Weight | Raw signal | Reasoning |
|---|---|---|---|
| **Utilization pressure** | 0.30 | `0.6 × loadFactor + 0.4 × pctRank(departures)` | How hard the existing footprint is worked. Full aircraft *and* high absolute volume means the terminal is under strain. Either alone is not enough — a small airport can run full aircraft without straining anything. |
| **Growth momentum** | 0.30 | `0.7 × paxCAGR(2022→2025) + 0.3 × (recoveryRatio − 1)` | Busy but flat does not justify capital. Growth is what converts congestion into an investment case. |
| **Unmet demand** | 0.25 | `0.5 × pctRank(paxCAGR − seatCAGR) + 0.5 × loadFactorPressure` | The signal we actually want: demand rising while seat supply does not follow, with aircraft already full. `loadFactorPressure` is 0 at 80% load factor and 1 at 100%. |
| **Capacity constraint** | 0.15 | `0.5 × pctRank(upgaugeRate) + 0.5 × (1 − pctRank(departureCAGR))` | When carriers cannot add flights they fly bigger aircraft. Rising seats-per-departure alongside flat departures is the classic slot- or gate-constrained signature. |

```
score = Σ (weightᵢ × componentᵢ)      // components already 0..100
```

**Weights live in `config/weights.json`, never in code**, and are overridable per request —
the agent can answer "what if we cared more about growth?" without a redeploy, and
`GET /api/rankings?growth=0.6` does the same with no model in the path. Weights are an
analyst policy decision, not a fact about the world, and the system treats them that way.

### The explainability contract

Every scoring result returns a structured object alongside the number:

```js
{
  score: 67.2, rank: 1,
  drivers: [{ component: 'unmetDemand', value: 81.3, weight: 0.25,
              contribution: 20.3, why: 'Passenger CAGR 6.5% against seat CAGR 5.1%…' }, …],
  caveats: ['This score measures demand opportunity, not a financial return…', …],
  period: '2019 baseline, 2022-2025 trend',
  peerSet: '8 New England airports'
}
```

Drivers are sorted by contribution and the contributions sum back to the score. The model's
only job is to turn this object into prose — it may not add a driver or a caveat that is not
in it.

### Edge cases handled explicitly

- **ANC** is one of the world's largest cargo hubs. Any airport carrying more than 50 lbs of
  freight per passenger gets an automatic caveat that a passenger-only reading understates it.
  The rule is data-driven, so it also caught MHT, which we had not anticipated.
- **SNA** has a court-ordered noise and access cap. Its congestion is a legal ceiling, not a
  physical one, and extra terminal capacity cannot lift it. This and six other regulatory
  notes (JFK, LGA, EWR, DCA, ORD) live in `config/known-constraints.json` and are surfaced
  verbatim whenever the airport appears.
- **Insufficient history.** An airport missing its trend base, or with fewer than 12 reported
  months in the latest year, is *excluded and listed* — never silently scored as zero.

---

## 3. Architecture

```
React (Vite)                    Express                      Deterministic core
──────────────                  ───────                      ──────────────────
chat + tool trace  ── POST ──>  /api/chat ──> agent loop ──> tools.js ──> scoring/
                                                  │                         ├── metrics.js
                                                  ▼                         ├── normalize.js
                                            Gemini API                      └── score.js
                                        (routing + prose)                        │
                                                                                 ▼
                   ── GET ───>  /api/rankings ─────────────────────────>  data/*.json
                                (no model in this path)                   (from npm run ingest)
```

Three layers, one rule between them: **the model never crosses into the right-hand column.**

- `src/ingest/run.js` — one-shot pull from BTS + OurAirports into `data/*.json`. Idempotent,
  caches raw responses, prints a summary, fails loudly with the HTTP status and body.
- `src/scoring/` — pure functions. No I/O, no clock, no randomness. Unit-tested.
- `src/agent/` — five tools over the scoring engine, plus the tool-calling loop.
- `server/` + `src/` (React) — HTTP surface and UI.

**Endpoints**

| | |
|---|---|
| `POST /api/chat` | `{sessionless messages[]}` → `{reply, toolCalls[], turns, usage}` |
| `GET /api/rankings` | The scoring engine with **no LLM involved**. `?region=New England&topN=5`, weight overrides as query params. |
| `POST /api/tool` | Call any tool directly and inspect its raw structured result. |
| `GET /api/airports`, `GET /health` | Coverage and status. |

`/api/rankings` existing separately is a deliberate demo asset: it proves the ranking is
deterministic with the model switched off entirely.

---

## 4. Where and how AI is used

**The boundary, stated crisply:** the LLM does two things — it picks which tool to call with
which arguments, and it turns the structured result into prose. It computes nothing, ranks
nothing, and retrieves nothing. Every number in every answer can be traced to a tool result.

The system prompt states this as a hard rule, but a prompt is not a guarantee, so the
architecture backs it up: the model has no data access at all. There is no query tool, no
code execution, no retrieval. The only numbers it can see are the ones a scoring function
already computed. And the UI renders the full tool trace beneath every answer, so a reader
can check the claim rather than take it on trust.

### A worked example

**Question:** *"Compare LA (LAX) and Santa Ana (SNA) airport congestion levels."*

1. **Model → tool call.** `compare_airports({ iataList: ['LAX', 'SNA'] })`
2. **Deterministic result.** Both airports scored against all 158 US airports; per-metric
   winners decided by the handler, not the model:
   `LAX: score 60.1, rank 34, utilization 97.8, constraint 85.8, loadFactor 0.816, departures 273,911`
   `SNA: score 50.0, rank 90, utilization 75.6, constraint 43.0, loadFactor 0.797, departures 51,256`
   plus the SNA regulatory note from `known-constraints.json`.
3. **Model → prose.** *"Los Angeles International (LAX) exhibits significantly higher
   congestion and physical capacity pressure than Santa Ana (SNA)… SNA's congestion is a
   legal ceiling, not a physical one — extra terminal capacity cannot lift it."*

The model chose the tool and the framing. Every figure, the ranking, and the caveat came out
of the deterministic layer.

### Why no RAG or vector store

Considered and rejected. The data is a numeric table; "% of long-haul flights" is a filter
and a division, not a similarity search. Vector retrieval is also probabilistic — the same
question phrased differently can return different context and therefore different numbers —
which directly contradicts the deterministic-ranking requirement. A vector store would be
the right call for unstructured sources such as FAA reports or airport master plans, which
are out of scope here.

---

## 5. Key tradeoffs

| Decision | Alternative rejected | Why |
|---|---|---|
| **JSON files on disk** | MongoDB | 158 airports × 5 years is a few hundred KB and loads in milliseconds. A database adds operational surface and a setup step for a reviewer without changing a single answer. If ingest grew to segment-level data across 20 years, this flips. |
| **Percentile rank** | Z-score | Airport traffic is heavily right-skewed; a z-score is dominated by mega-hubs and is harder to explain. Percentile costs some information about *how far* apart two airports are — acceptable for a ranking tool. |
| **Proxy for spilled demand** | Real spill measurement | True spill needs fare and search data (DB1B, GDS) we do not have. `paxCAGR − seatCAGR` combined with load-factor pressure is consistent with a physical constraint but does not prove one. It is labelled a proxy everywhere it appears. |
| **Seats per departure as the constraint proxy** | Actual gate and stand inventory | Gate counts are not in any free feed. Upgauging against flat departures is a real signal, but it also fires on fleet-renewal cycles that have nothing to do with constraint. Documented as a proxy. |
| **2022→2025 momentum window** | A clean 5-year CAGR | A five-year window would anchor on 2020 and rank airports by how hard they crashed. The cost is a shorter and therefore noisier trend; the alternative was actively misleading. |
| **Stateless conversation** | Server-side sessions | The client posts the whole history each turn, so there is no session store to manage or expire. It costs tokens on long conversations and would not survive multi-user scale — fine for a single-analyst demo, and one of the first things to change. |
| **158 airports, 7 metrics** | 40 airports, 20 metrics | The brief prizes clarity over completeness. Breadth of coverage made the region questions answerable; depth would have meant a richer profile per airport but fewer of them. |
| **Google Gemini** | Any other provider | The brief names no provider and this one has a free tier. The LLM is confined to `src/agent/agent.js`; swapping it is one file. |

---

## 6. Assumptions, uncertainty and scoping

### Explicitly out of scope

Financial modelling of any kind — construction cost, AIP grants, PFC revenue, bond capacity,
land availability, environmental review. Cargo-driven investment cases, except where flagged
for ANC. General aviation and non-commercial airports. Real-time flight tracking and delay
statistics. Route-level and carrier-level breakdowns.

### Known limitations of the data

- **T-100 international coverage is partial.** Foreign carriers report less completely than
  US ones, so international figures understate true volumes at gateway airports.
- **No origin–destination detail.** BTS exposes T-100 pre-aggregated per origin airport over
  the API; there is no segment row to bucket by distance. Long-haul share is therefore
  *estimated* from average stage length by leg type, and the tool says so in its own output.
  An airport whose domestic network mixes very short and very long legs around a
  sub-threshold average will be understated. An exact figure needs the T-100 segment file
  from BTS TranStats, which is a bulk download rather than an API.
- **Percentile ranks are relative to the peer set actually scored.** Ranking eight New
  England airports answers "best of these eight". The tool returns the peer set with every
  answer and the agent is instructed to quote it.
- **Outbound only.** The dataset is origin-airport based, so all figures describe departing
  traffic.

### The assumption that matters most

**This score measures demand opportunity, not a financial return.** Two airports with
identical scores can have completely different investment cases once land, cost and funding
enter the picture. Every answer the agent gives carries this caveat, and it is not decorative
— it is the honest boundary of what public aviation data can support.

---

## 7. What I would do next, with another week

1. **Segment-level T-100 from TranStats.** Replaces the estimated long-haul share with a real
   distance-bucket distribution, and unlocks route-level and carrier-level questions. This is
   the single biggest gap.
2. **DB1B fare data for real spill.** Fare and itinerary data would turn the unmet-demand
   proxy into an actual measurement of passengers priced or scheduled off an airport.
3. **FAA TAF forecasts.** Everything here is backward-looking. Official terminal-area
   forecasts would let the score weigh projected growth, which is what a capital decision
   actually turns on.
4. **Gate and stand inventory.** Replaces the seats-per-departure proxy with the real
   constraint denominator, and makes the constraint component defensible rather than
   suggestive.
5. **An evaluation harness for the agent.** Right now correctness is verified by reading four
   transcripts. A fixed question set with assertions on which tool was called and which
   figures appeared would catch a regression in tool selection immediately — the failure mode
   most likely to go unnoticed as the tool surface grows.

---

## Appendix — transcripts

Verbatim, from `POST /api/chat`. Tool calls shown as recorded in the trace.

### Q1 — New England expansion candidates

> **Tools:** `rank_airports({region: 'New England'})`

> Based on the deterministic scoring engine for the **8 New England airports** evaluated
> (covering a 2019 baseline and 2022–2025 trend period), the top candidates for terminal
> expansion are:
>
> 1. **Boston Logan International (BOS)** — Ranked 1st of 8 (Score: 67.2). Driven by high
>    capacity utilization (81.6% load factor across 191,546 departures in 2025) and unmet
>    demand, where passenger growth (6.5% CAGR) outpaced seat growth (5.1% CAGR) by 1.4
>    percentage points.
> 2. **Bangor International (BGR)** — Ranked 2nd of 8 (Score: 61.3). Led by strong passenger
>    growth (7.2% CAGR from 2022–2025; up 39.6% versus 2019) and capacity constraint
>    indicators, with seats per departure expanding 16.1% to an average of 89 seats.
> 3. **Portland International Jetport (PWM)** — Ranked 3rd of 8 (Score: 57.8). Driven by 9.2%
>    passenger CAGR combined with high passenger utilization (82.4% load factor).
>
> *Caveats: scores measure demand opportunity only, not financial return… MHT carries 145 lbs
> of freight per passenger, far above a typical passenger hub… gate and stand counts are not
> published in this dataset, so seats per departure is used as the capacity-constraint proxy.*

### Q2 — LAX vs SNA congestion

> **Tools:** `compare_airports({iataList: ['LAX', 'SNA']})`

> **Los Angeles International (LAX) exhibits significantly higher congestion and physical
> capacity pressure than Santa Ana / John Wayne Airport (SNA).** LAX ranks 34th of all 158
> scored US airports with a score of 60.1, a utilization component of 97.8 and a constraint
> score of 85.8. SNA ranks 90th with an overall score of 50.0, utilization 75.6, constraint 43.0.
>
> LAX reached an 81.6% load factor against SNA's 79.7%; 273,911 departures and 36,766,912
> passengers against SNA's 51,256 and 5,532,646. LAX grew 3.9% a year 2022–2025; SNA
> contracted at −0.4%.
>
> **SNA Regulatory Cap:** John Wayne operates under a court-ordered noise and access agreement
> that caps annual passenger volume and regulated commercial departures, with a night-time
> curfew. Congestion at SNA is a legal ceiling, not a physical one — extra terminal capacity
> cannot lift it.

### Q3 — Long-haul share out of ANC

> **Tools:** `get_flight_mix({iata: 'ANC', dimension: 'distance'})`

> The estimated long-haul departure share out of Ted Stevens Anchorage International (ANC) is
> **16%** (threshold ≥ 2,200 statute miles) for 2025. Average stage length: 1,458 miles
> domestic, 4,322 international, 1,916 overall. International departure share 16%;
> international passenger share 1.3%.
>
> *Methodology constraint: BTS publishes T-100 aggregated per origin airport rather than per
> origin-destination segment, so flights cannot be counted directly into distance buckets…
> An exact figure requires the T-100 segment bulk file from BTS TranStats.*
>
> *Anchorage is one of the world's largest cargo hubs. Passenger-only metrics understate its
> operational role; freight tonnage is the primary structural driver.*

Note the 16% international share against a 1.3% international *passenger* share — the
signature of a freight hub, visible directly in the data.

### Q4 — Unmet demand at SFO

> **Tools:** `get_airport_profile({iata: 'SFO'})`

> San Francisco International (SFO) scores an **unmet demand value of 82** (contributing 20.5
> points toward a total opportunity score of 67, ranking SFO **13th of all 158 scored US
> airports**).
>
> The unmet demand score is driven by a passenger CAGR of 8.9% outpacing seat CAGR of 8.8%
> between 2022 and 2025 — a gap of 0.1 percentage points — alongside an elevated load factor
> of 82.3% across 190,086 departures in 2025.

### Follow-up — pronoun resolution against the prior ranking

> **User:** *"Why is the second one ahead of the third?"*
> **Tools:** `compare_airports({iataList: ['BGR','PWM']})` · `get_airport_profile({iata:'BGR'})`
> · `get_airport_profile({iata:'PWM'})` · `rank_airports({region:'New England'})`

> Bangor (BGR) ranks 2nd of 8 with 61.3, ahead of Portland Jetport (PWM) at 57.8, primarily
> due to higher capacity constraint pressure and stronger long-term growth relative to its
> pre-pandemic baseline.
>
> **Capacity Constraint:** BGR contributes 14.1 points (component 93.8) versus PWM's 9.4
> (62.5). BGR's seats per departure grew 16.1% while departures grew only 1.7%…
> **Growth:** BGR contributes 24.4 points versus PWM's 20.6. Although PWM has a higher recent
> passenger CAGR (9.2% vs 7.2%), BGR traffic is up 39.6% over its 2019 baseline against PWM's
> 18.2%.
> **Utilization:** PWM leads BGR here (16.9 points vs 5.6) on volume and load factor, but this
> is offset by BGR's advantages in the other three drivers.

The agent resolved "the second one" and "the third" against the previous ranking, then went
back to the tools for the specific airports rather than reasoning from memory of its own
earlier answer.

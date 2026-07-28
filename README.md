# Airport Investment Intelligence Agent

An analyst assistant that identifies US airports where terminal expansion has the strongest
demand case, backed by a deterministic scoring engine over public BTS aviation data.

**The language model never computes a number.** It chooses which tool to call and turns the
structured result into prose; every figure comes from a pure scoring function. The UI shows
the full tool trace under each answer so you can check that rather than take it on trust.

📄 **[docs/DESIGN.md](docs/DESIGN.md)** — scoring methodology, tradeoffs, and where AI is used.

---

## Run it

Node 20.19+ (or 22.12+), and a free Gemini API key.

```bash
npm install

# Get a free key at https://aistudio.google.com/apikey, then put it in .env:
#   GEMINI_API_KEY=...
cp .env.example .env

npm run dev:all   # API on :3001, UI on :5173
```

Open http://localhost:5173.

The ingested data is committed under `data/`, so there is nothing to download before the first
run. To rebuild it from source instead — 158 airports, ~30s against the BTS API:

```bash
npm run ingest
```

```bash
npm test          # scoring engine unit tests
npm run verify    # end-to-end checks on data, tools and determinism — no API quota used
```

## Try it without the model

The scoring engine is reachable directly, with no LLM in the path — same query, same numbers,
every time:

```bash
curl 'http://localhost:3001/api/rankings?region=New%20England&topN=3'

# Weights are analyst policy, not code. Override them per request:
curl 'http://localhost:3001/api/rankings?region=New%20England&growth=0.6'
```

## Questions it answers

- Which airports in New England are strong candidates for terminal expansion?
- Compare LAX and SNA congestion levels.
- What percentage of flights out of ANC are long-haul?
- What is the unmet flight demand at SFO, and why?
- Follow-ups: *"why is the second one ahead of the third?"*, *"what if we cared more about growth?"*

## How it fits together

```
src/ingest/   BTS T-100 + OurAirports  ->  data/*.json     (npm run ingest)
src/scoring/  pure functions: metrics, percentile ranks, composite + explanation
src/agent/    five tools over the scoring engine, plus the tool-calling loop
server/       /api/chat, /api/rankings, /api/tool, /api/airports, /health
src/*.jsx     chat UI with the tool trace panel
config/       weights.json · regions.json · known-constraints.json
```

## Scope

158 US airports with over 400,000 outbound passengers in 2025; years 2019 and 2022–2025.
The score measures **demand opportunity, not financial return** — construction cost, grants,
bond capacity, land and environmental review are all out of scope. Full list of assumptions
and limitations in [docs/DESIGN.md](docs/DESIGN.md) §6.

## Data sources

- **[BTS T-100 Segment Summary By Origin Airport](https://data.bts.gov/resource/r495-tyji)** —
  monthly departures, passengers, seats, load factor, stage length, freight.
- **[OurAirports](https://davidmegginson.github.io/ourairports-data/)** — state, city, coordinates.

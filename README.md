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
npm run eval      # 15 cases against every model path — needs API keys
```

`verify` proves the numbers are deterministic. `eval` proves the layer above them: which
tool each model reached for, on which arguments, and — the check that matters — that every
figure in the prose came out of a tool rather than out of the model. It drives the realtime
path over a WebSocket with text output, so voice agents are tested without a microphone.

```bash
npm run eval -- --group=scope          # only the questions the data cannot answer
npm run eval -- --case=lax-vs-sna      # one case, with the reply printed
npm run eval -- --path=gemini          # one path
```

## Try it without the model

The scoring engine is reachable directly, with no LLM in the path — same query, same numbers,
every time:

```bash
curl 'http://localhost:3001/api/rankings?region=New%20England&topN=3'

# Weights are analyst policy, not code. Override them per request:
curl 'http://localhost:3001/api/rankings?region=New%20England&growth=0.6'
```

## Talk to it

The switcher in the header picks which brain answers and over which pipe. All three share
the same prompt module, the same five tools and the same scoring engine — only the transport
changes.

Each option names its models in full, because the shape of the name is the point — one name
is one model, two with an arrow are two in series:

| | |
|---|---|
| `gemini-3.1-flash-lite · text` | Type. Two model round trips, tool call in between. The default. |
| `gpt-realtime · voice` | Native speech-to-speech over WebRTC. Interrupt it mid-sentence. |
| `soniox → gemini-3.1-flash-lite → soniox · voice` | A cascade we assemble: their recogniser, our agent, their synthesiser. The only path where each stage is timed separately. |
| `gemini-3.1-flash-lite → eleven_flash_v2_5 · voice` | A managed cascade. Structurally the slower of the two, and audibly so. |

Both live paths need keys in `.env`; a provider without one still appears in the switcher,
marked `no key`, rather than vanishing:

```bash
OPENAI_API_KEY=...           # platform.openai.com/api-keys
ELEVENLABS_API_KEY=...       # elevenlabs.io -> Settings -> API Keys
ELEVENLABS_AGENT_ID=...      # printed by the sync command below
```

Everything else has a working default; `.env.example` lists the knobs worth turning,
including the transcription model and how long the agent waits before deciding you have
finished a sentence.

ElevenLabs agents are normally configured in a dashboard. This one is not — its prompt and
tools are pushed from this repo, so the voice agent cannot drift from the text agent:

```bash
npm run sync:agent    # creates or updates the agent, prints its id for .env
```

Browser dictation and read-aloud (Web Speech API, no key, no cost) stay available under
every provider as the fallback.

**`EN` / `HE`** next to the switcher sets the reply language on all three paths. On the live
ones it switches the transcriber and the voice too, not just the wording.

**Session trace.** Under a live call, a timestamped log of what is actually happening —
microphone, speech detected, which tool fired, how many bytes it returned, and
`answer latency`: the gap between the end of your sentence and the first word of the reply.
Tick `raw events` for the provider's own event stream, and `copy` to lift the whole session
as text.

That panel is not decoration. Four real bugs were found by reading a pasted log and none of
them were visible in the source: a session selected as English answering in Arabic, an agent
claiming it could not understand a language when only its transcriber was misconfigured, a
turn detector splitting one question into four fragments, and a latency metric reporting
26 ms for a wait that took 2.6 seconds. See [docs/DESIGN.md](docs/DESIGN.md) §3.

## Questions it answers

- Which airports in New England are strong candidates for terminal expansion?
- Compare LAX and SNA congestion levels.
- What percentage of flights out of ANC are long-haul?
- What is the unmet flight demand at SFO, and why?
- Follow-ups: *"why is the second one ahead of the third?"*, *"what if we cared more about growth?"*

## Voice

Ask by voice with the mic button, and toggle **voice on** in the header to have answers read
back. Both use the browser's Web Speech API — no audio leaves your machine and nothing extra
is billed. Needs Chrome or Edge; other browsers show the controls disabled with a reason.

## How it fits together

```
src/ingest/   BTS T-100 + OurAirports  ->  data/*.json     (npm run ingest)
src/scoring/  pure functions: metrics, percentile ranks, composite + explanation
src/agent/    five tools over the scoring engine, plus the tool-calling loop
server/       /api/chat, /api/rankings, /api/tool, /api/airports, /health
src/*.jsx     chat UI with the tool trace panel; src/voice.js adds speech in and out
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

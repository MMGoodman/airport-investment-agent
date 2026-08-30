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

`rank_airports` hoists the caveats every entry shares to the top of its response and leaves
each entry only what is true of that airport. Ten ranked airports used to carry forty copies
of the same four sentences; a reader still sees every caveat, and the payload the model has
to read before it can answer drops by about a third. Nothing about a figure changes.

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
- `server/` + `src/` (React) — HTTP surface and UI, including browser-native voice
  (`src/voice.js`) layered over the same `/api/chat` call.

**Endpoints**

| | |
|---|---|
| `POST /api/chat` | `{sessionless messages[]}` → `{reply, toolCalls[], turns, usage}` |
| `GET /api/rankings` | The scoring engine with **no LLM involved**. `?region=New England&topN=5`, weight overrides as query params. |
| `POST /api/tool` | Call any tool directly and inspect its raw structured result. |
| `GET /api/airports`, `GET /health` | Coverage and status. |

`/api/rankings` existing separately is a deliberate demo asset: it proves the ranking is
deterministic with the model switched off entirely.

### Live voice: two more transports, the same engine

Voice was a stated bonus. The first pass did it the cheap way — browser dictation in,
speech synthesis out, the text agent untouched. That still ships as the fallback. On top of
it there are now two real-time speech-to-speech paths, selectable from the switcher in the
header.

The rule that governs them is the one that governs everything else: **a new transport may
not bring its own numbers.** Both live providers are handed the same `SYSTEM_PROMPT` and the
same five `toolSchemas` the text path imports, and when either asks for a tool the browser
calls `POST /api/tool` — the endpoint that already existed. Not one line of `src/scoring/`
or `src/agent/tools.js` changed to add either of them.

```
                  ┌─ gemini · text ──── POST /api/chat ─── agent loop ─┐
switcher ─────────┼─ openai · live ──── WebRTC ─── OpenAI session ─────┼── POST /api/tool ── scoring/
                  └─ elevenlabs · live ─ WebSocket ─ EL agent runtime ──┘        (unchanged)
```

The switcher spells each option out in full, and the arrows are the argument:

```
gemini-3.1-flash-lite · text
gpt-realtime · voice
gemini-3.1-flash-lite → eleven_flash_v2_5 · voice
```

One name means one model. Two names with an arrow between them mean two models in series,
and that is visible before you have listened to either.

| | `gemini · text` | `openai · live` | `elevenlabs · live` |
|---|---|---|---|
| Transport | HTTP request/response | WebRTC peer connection | WebSocket via SDK |
| Turn-taking | you press Enter | semantic VAD, barge-in | platform VAD, barge-in |
| Who routes to a tool | our loop in `agent.js` | the model inside OpenAI's session | the ElevenLabs agent runtime |
| Who runs the tool | our server | this browser | this browser |
| Where the prompt lives | `src/agent/prompt.js` | same file, sent per session | same file, pushed by `npm run sync:agent` |
| Secret handling | key stays server-side | ephemeral key, minutes to live | signed WebSocket URL |
| Transcription | n/a | `gpt-4o-transcribe` | `scribe_realtime` |
| Billing unit | tokens | audio minutes | audio minutes |

**Why the latency differs, mechanically.** The text path is two full model round trips —
route, then narrate — with a tool call between them, and nothing is shown until the second
completes. The live paths stream audio continuously and the model starts speaking before
its sentence is finished, so a tool call happens *inside* a turn rather than between two of
them. That is a difference in shape, not in tuning; no amount of optimisation makes the
request/response path feel conversational.

**The ElevenLabs configuration problem, and the fix.** An ElevenLabs agent normally lives in
their dashboard — prompt, tools, model, all of it outside version control, which would mean
the voice agent could silently drift from the text agent. `scripts/sync-elevenlabs-agent.js`
pushes the repo's own `SYSTEM_PROMPT` and `toolSchemas` into the agent over their API, so the
definition still lives in git and one command re-syncs it. It registers the tools as **client**
tools rather than server tools deliberately: server tools would have ElevenLabs' cloud call
back into us, which needs a public URL and a tunnel in development. Client tools execute in
the browser and reach the same local endpoint.

### Making a spoken answer fast enough to feel live

The first working version was slow to start talking, and the trace panel said why: a single
`rank_airports` call returned **13.5 KB**, roughly 3,400 tokens, which the model had to read
in full before it could open its mouth. Two changes, neither of which touches a number:

1. **Deduplicated caveats** (above) — 13.5 KB to 9.3 KB.
2. **`VOICE_ADDENDUM`**, appended to `SYSTEM_PROMPT` on the live paths only. It changes
   delivery, not analysis: two or three sentences, `topN` 3 rather than 10, numbers spoken
   the way a person says them, one caveat chosen rather than a list recited. With `topN` 3
   the same call returns **4.3 KB** — a 68% cut against where it started.

The analytical contract is identical across all three paths; only the register differs, and
it differs because reading ten ranked airports aloud is not an answer, it is a filibuster.

### Watching it happen

`ToolTrace`, under each answer, shows what a finished turn was built from. The live panel
adds `LiveTrace`: a timestamped log of the session as it runs — microphone opened, speech
detected, which tool fired with which arguments, **how many bytes it returned and how long
it took**, then the reply. A `raw events` toggle drops to the provider's own event stream.

Payload size sits in the log on purpose. Latency in a voice agent is usually a token-count
problem wearing a network-problem costume, and the fix above was found by reading this panel
rather than by guessing.

### Why ElevenLabs is the slower of the two, structurally

Tuning did not close the gap, because the gap is architectural. **OpenAI Realtime is one
native speech-to-speech model.** **ElevenLabs, by default, is a cascade:** transcribe, then
run an LLM, then synthesise — three stages in series, and nothing can start speaking until
the stage before it has produced output. Every stage's time-to-first-token adds.

What was tuned, and what it bought:

| Setting | Was | Now | Why |
|---|---|---|---|
| Agent LLM | `gemini-2.5-flash` | `gemini-3.1-flash-lite` | Same tier as the text path, so an A/B across providers compares transports rather than models. |
| `expressive_mode` | on | off | Prosody costs time to first audio, and on a cascade that lands after the LLM has already finished. |
| `optimize_streaming_latency` | 3 | 4 | Their maximum. |
| `turn_eagerness` | normal | eager | Commit to a turn when the speaker has plainly stopped instead of waiting out the silence window. |
| Voice model (English) | `eleven_v3_conversational` | `eleven_flash_v2_5` | The low-latency model. |

**The Hebrew constraint is real and unfixable from here.** Of the nine voice models on the
platform — flash v2/v2.5, turbo v2/v2.5, multilingual v2, v3, v3 conversational, v4, v4
turbo — **only `eleven_v3_conversational` has Hebrew in its language list**, and it is the
slowest of them. Worse, ElevenLabs validates a preset language against the *base* model, so
keeping Hebrew forces the slow model as the agent's default. English escapes it by
overriding the model at connect time; Hebrew has nothing to override to. Hebrew on this
provider is slower than English by construction, and no amount of configuration changes it.

The OpenAI path has no equivalent problem: one model, both languages, no synthesis stage to
pick a model for.

**If the cascade is the problem, collapse it.** `ELEVENLABS_REALTIME_MODEL` set to
`eleven_realtime_v1_mini` or `_max` switches the agent to their native speech-to-speech
model — the same shape the OpenAI path uses. It is left unset by default because the cascade
is the more interesting comparison: it is what makes the architectural difference audible
rather than theoretical.

### Four bugs the trace panel found

None of these were visible from the code. All four came out of reading a pasted session log.

**The model chose its own language.** `languageInstruction('en')` returned an empty string,
on the reasoning that English is the default and needs no steering. A session selected as
English opened in Arabic, drifted to Hebrew and stayed there for the rest of the call. With
nothing said about language, the realtime model takes its cue from the speaker's accent.
Both languages are now stated explicitly.

**The cascade told a user it could not understand their language.** Asked in Hebrew during
an English session, the ElevenLabs agent replied that it lacked the capability to process
Hebrew. That is false — the transcriber was set to English, which is a configuration choice,
not a limit of the model. The prompt now forbids that answer and points at the EN/HE control.

**Turn detection cut sentences in half.** OpenAI's server VAD ends a turn after 200 ms of
silence by default. One question — *"I want to compare BOS and Portland"* — arrived as four
fragments, each one cancelling the answer to the fragment before it. Switched to semantic
VAD at `low` eagerness, which judges whether a thought is finished rather than timing a gap.
`whisper-1` was also mangling spelled-out airport codes, so transcription moved to
`gpt-4o-transcribe`.

**The latency metric was measuring nothing.** It read `26 ms` on the cascade while the log's
own timestamps showed 2.6 seconds. It was timing the gap between a mode-change event and a
transcript event, which on that provider fire together. It now runs from the end of speech
(or the transcript, where the provider does not report speech end) to the first word of the
answer, and says in the label which of the two it used.

The general lesson is the one the panel was built for: **a voice agent fails in ways its
source code looks fine for.** Every one of these is a configuration default or an
unstated assumption, and none would have been found by reading the repository.

### Where the time actually goes

"One provider is slower than the other" is not actionable. The trace now breaks a turn
into the stages a cascade is made of, and the shape of what each provider can report is
itself the answer:

```
gpt-realtime                        soniox → our agent → soniox
  ⏱ answer      340 ms                ⏱ recognise    260 ms
  (one model — no stages to split)    ⏱ think        910 ms
                                      ⏱ synthesise   180 ms
                                      ⏱ answer     1,350 ms
```

A native model has one number because it has one stage. A cascade has three, and one of
them is always the culprit — usually `think`, which is the LLM plus however many tools it
called, and which the payload sizes in the same log then explain.

**The Soniox path exists to make that legible.** It is the only one of the three we
assemble ourselves — their recogniser, our existing agent over `POST /api/chat`, and a
synthesiser chosen separately — so every boundary is a timestamp we own rather than one a
platform chooses to expose.

The synthesiser is separate on purpose, and the reason is instructive. Soniox does offer
TTS — `tts-rt-v2`, Hebrew, six voices — on a different host to the rest of its API, but the
account's balance is exhausted and every request returns 402. OpenAI holds the stage
instead, and `CASCADE_TTS_PROVIDER=soniox` swaps it back the moment the account is funded,
with nothing else changing. That single line is the difference between a pipeline you
assembled and one you bought: ElevenLabs accepts only its own four transcribers, and OpenAI
Realtime has no seams to swap at all. ElevenLabs can report roughly when it started speaking and nothing before that;
OpenAI has nothing to decompose. Soniox was chosen for the recogniser because it switches
language mid-sentence without being told which language to expect, which is the exact
pattern a bilingual user produces and the one that broke every other configuration here.

### Recognition, not just synthesis

With the reply side fixed, the remaining weakness was the input. A general transcriber has
no reason to expect three-letter airport codes: spoken "BOS and PDX" came back as
`D-O-S-L-A-T-E`. Two changes:

**Vocabulary bias.** Both providers take a hint — OpenAI a `transcription.prompt`,
ElevenLabs `asr.keywords`. `src/agent/vocabulary.js` builds it from `data/`: the airports
named in the four target questions, pinned so they cannot fall out, then the largest by
passengers, plus the metric names this domain uses and everyday speech does not. Derived
rather than hand-listed, so an airport entering the dataset enters the vocabulary with it.
SNA is the case that made pinning necessary — it is 41st by passengers and would have been
cut, and mis-hearing an airport named in a demo question is the worst failure available.

**The transcriber no longer takes the language selector.** It used to be pinned to the
selected language, which is wrong: that control governs the *reply*. A user asking in Hebrew
and wanting the answer in English — a combination they asked for out loud — had their
question mangled by a transcriber told to expect English. Auto-detection handles a session
that mixes the two, and the selector now does one job instead of two.

ElevenLabs cannot make the same split: its language preset drives transcriber, voice and
reply together. Another place the managed platform trades control for convenience.

### Hebrew

Every path takes a language. On the text path it appends an instruction to the system
prompt. On the live paths it also switches the transcriber — Whisper is told which language
to expect, and the ElevenLabs agent carries a Hebrew `language_preset` that swaps its ASR,
its voice and its opening line. A prompt instruction alone cannot do that: a transcriber left
on English will phonetically mangle Hebrew speech into English words, and the model then
answers the mangled version. Airport codes and metric names stay in English in both
languages, because that is how an analyst says them.

**What this costs.** Two providers, two SDK surfaces and two failure modes to reason about,
for a bonus. It is justified here only because the deterministic core is genuinely untouched
by all three — which is the claim the whole submission rests on, and three independent
transports agreeing on the same numbers is the strongest available evidence for it.

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

### Voice — and where it deliberately stops

Voice is handled entirely by the browser's Web Speech API (`src/voice.js`): `SpeechRecognition`
for dictation, `speechSynthesis` for reading answers back. No audio leaves the machine, no
transcription service is billed, and no dependency was added. Chrome and Edge implement both
halves; Firefox implements neither, so each control reports support and disables itself with an
explanation rather than presenting a button that quietly does nothing.

Two decisions inside it are worth naming:

- **Dictation fills the box; it does not auto-send.** Hands-free would demo better, but a
  misheard question spends a request against a free-tier quota the user cannot get back, and
  the transcript is right there to correct. Review-then-send is the safer default.
- **Long answers are spoken as queued short utterances.** Chrome silently truncates a single
  utterance after roughly fifteen seconds, which lands mid-sentence on a real answer.
  `intoChunks` splits on sentence boundaries to keep the synthesiser alive to the end.

Voice is an input and output skin on the same `/api/chat` path — it changes nothing about
routing, scoring, or the tool trace. The spoken answer is the same string as the rendered one.

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
| **Browser Web Speech API for voice** | Whisper or a cloud speech service | Zero cost, zero dependencies, no audio leaving the machine, and no server work — against a hard Chrome/Edge-only constraint and no control over recognition quality. For an English-language analyst tool on a desktop browser that trade is clearly worth it; a production build with non-native speakers or noisy environments would need real ASR. |

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

  This has a sharper consequence than it first looks. Scores from two calls with *different*
  peer sets are on different axes and cannot be compared — "84.9, 1st of 18" does not beat
  "71.8, 1st of 42". Asked which regions held the best candidates, an earlier version called
  `rank_airports` once per region and ranked the results against each other, which is not a
  valid comparison. The tool had returned the warning; the prompt had not said what to do
  with it. The prompt now requires a single call with the region omitted — scoring all 158
  airports on one axis — for any cross-region question, and forbids assembling one out of
  several per-region calls. **The tool trace is what surfaced this**: nine calls where there
  should have been one is visible at a glance, while the prose read perfectly plausibly.
- **Outbound only.** The dataset is origin-airport based, so all figures describe departing
  traffic.
- **Place names resolve to IATA codes through the model, not a lookup table.** The tools take
  codes; turning *"LA and Santa Ana"* into `['LAX', 'SNA']` is the model's world knowledge.
  That is a routing decision rather than a value — a wrong code is visible in the trace
  immediately, and no figure is invented either way. It is still the one place where an
  answer depends on something outside the deterministic layer, and *"LA"* is genuinely
  ambiguous: LAX, BUR, LGB and ONT all serve greater Los Angeles. A `resolve_airport` tool
  over the OurAirports name and municipality columns would close it, and would let the agent
  ask which one was meant instead of choosing silently.

### The assumption that matters most

**This score measures demand opportunity, not a financial return.** Two airports with
identical scores can have completely different investment cases once land, cost and funding
enter the picture. Every answer the agent gives carries this caveat, and it is not decorative
— it is the honest boundary of what public aviation data can support.

---

## 6b. Evaluating the agent layer

`npm run verify` proves the scoring engine is deterministic. Nothing proved the layer above
it. Correctness there was checked by a human reading four transcripts and recognising the
numbers — tolerable with one model in the loop, not with three, each choosing its own tools.

The failure that matters is also the quietest: the model calls a real tool, gets real
numbers, and answers a question nobody asked. No error, no stack trace, a fluent reply.

`npm run eval` runs 15 cases against every model path and asserts what a correct answer must
*do*, not what it must say:

| Group | Cases | What it protects |
|---|---|---|
| `target` | 4 | The four questions in the brief: right tool, right arguments, right caveat |
| `follow-up` | 2 | Pronouns resolved against the prior ranking; a weight change re-runs the engine instead of being reasoned about |
| `scope` | 5 | Construction cost, foreign airports, delay statistics, unknown regions, "highest ROI" — each an invitation to invent |
| `edge` | 4 | Cargo hubs, a city with two airports, state queries, three-way comparisons |
| `hebrew` | 4 | The same questions asked in Hebrew: same tool, same figures, answer in the right language, and the SNA cap surviving translation |

The Hebrew group is not testing the numbers — the scoring engine cannot tell what language
a question arrived in. It tests that switching language does not quietly change which tool
runs or lose the caveat that matters, which is the sort of thing nobody notices until a
demo.

### The provenance check

The headline assertion. Every figure in the prose must be traceable to a tool result:
numbers are pulled out of the reply and matched against everything the tools returned,
allowing for how a person actually says a number — a load factor stored as `0.816` spoken
as "81.6 percent", `273,911` as "over 273,000", `36,766,912` as "36.8 million". Anything
left over is a figure no tool produced.

Given a reply containing *"payback in 7 years at $430 million, ROI 14.5%"* against a real
tool result, it returns `[430, 14.5]` and passes the 7 — a rank, not a claim.

This is the one check that tests the sentence the whole submission rests on, and it was the
only one previously performed by eye.

### Two things the harness found immediately

**Its own provenance model was incomplete.** The peer-set size lives in the string
`"all 158 scored US airports"`, the long-haul threshold in `">= 2200 statute miles"`, and
the growth rates only ever appear inside a driver's `why` sentence. Scanning numeric fields
alone flagged all of them as fabricated. They are the tool's own words, which the prompt
tells the model to reuse, so they are provenanced by definition.

**A spoken preamble is not an answer.** Before a slow tool the voice model fills the
silence — *"let me pull that up"* — and that filler is a complete response, with text and
no function call, indistinguishable by shape from a real reply. The harness took it as the
answer and reported a Hebrew case as having dropped the SNA regulatory cap, which the model
had simply not reached yet. It now settles only after the model has been quiet for a beat.
A harness that stops listening too early invents failures as readily as a model invents
facts.

**The same assertion was right for text and wrong for speech.** Requiring the literal string
`SNA` failed the voice path on four cases — because it says "Santa Ana", which is what the
spoken-delivery rules ask of it and what an analyst would actually say. Airport names now
resolve through aliases built from `data/`. Neither of these is visible from one path alone.

### Driving voice agents without a microphone

Both live paths accept text on the same session they accept audio on, with the same prompt
and the same tools, so the harness drives the realtime model over a WebSocket with output
forced to text — no browser, no audio, no synthesis cost, and it runs in CI. That measures
tool selection and phrasing, which is what regresses when a prompt is reworded. It does not
measure speech recognition, and does not claim to.

ElevenLabs is not covered. Their simulation endpoint exists but cannot execute client tools,
which is where every number in an answer comes from — so it would test the wording of an
agent that had no data. Listed as a gap rather than faked.

### Current state

```
path                            cases     checks     provenance
gemini-3.1-flash-lite · text    15/15     62/62      15/15
gpt-realtime · realtime         15/15     62/62      15/15
```

The run also prints where the paths chose different tools. That is not a failure — two tools
can both answer a question — but it is the first place to look when one path starts behaving
differently from the other.

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
5. ~~**An evaluation harness for the agent.**~~ Built — see §6b. `npm run eval`. What is
   still missing there: ElevenLabs coverage, which needs their simulation endpoint to be able
   to execute client tools, and an audio-in fixture set so speech recognition is measured
   rather than assumed.

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
> **Tools:** `list_supported_regions()` · `rank_airports({region:'New England', topN:3})`

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
back to the tools rather than reasoning from memory of its own earlier answer — and it went
back through the *same* peer set, so the follow-up cannot contradict the ranking it explains.
An earlier version reached for `compare_airports` here, which scores nationally, and produced
an answer that corrected the ranking it was supposed to be explaining. See the peer-set rule
in §6.

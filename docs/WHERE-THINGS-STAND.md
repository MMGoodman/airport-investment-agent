# Where things stand

One day's work went onto one branch, mixing three unrelated kinds of change:
bug fixes, a UI redesign, and an architecture experiment. That was a mistake —
a problem in any one of them made the whole thing feel broken. This file exists
so the way out is a choice between branches rather than an untangling.

## The branches

| Branch | What it is | State |
|---|---|---|
| `main` | Before today | Untouched |
| `voice/core` | Fixes and tools only | lint · 32 tests · 44 verify · build ✅ |
| `voice/core+panel` | The above, plus the pipeline board and split layout | lint · 32 tests · build ✅ |
| `live-voice-agents` | Everything, including the server-relay transport | lint · 32 tests · 44 verify · build ✅ |
| `safety/today-full` | Frozen copy of the full branch, and the `today-full` tag | Never move it |

Each branch builds and passes on its own. Nothing is lost by choosing the
smallest one — the rest stay on their branches until they are wanted.

## `voice/core` — six commits, each fixing something observed in a real session

- **Weather and end_call tools.** `get_airport_weather` reads Open-Meteo at the
  coordinates already in `data/airports.json`, which makes the airport list the
  access list. `end_call` closes the session, because saying goodbye cannot.
- **Hebrew register.** A fixed glossary, numbers rounded aloud and numeric in
  writing, natural Hebrew airport names, never a transliterated IATA code
  ("בגר" was neither the code nor the city), and a forced state or code when a
  city name covers two fields — Portland quietly meaning Oregon is the failure a
  listener cannot hear.
- **Refusal, weather scope, hangup policy.** One session refused the same
  out-of-scope topic five times and then refused a bare domain word as if it
  were the sixth ask.
- **Tool batching and barge-in.** A response's tool calls settle together; a
  barge-in no longer asks the model to answer the stale turn. Covered by tests
  that were run against the old behaviour first and failed on exactly those two
  claims.
- **Server-side tool audit.** Where the browser carries the model's tool
  results, the server records each call with a digest and the panel reconciles
  against it — the text path never needed this because its loop is closed.
- **Double-voice fix.** Live answers were being read aloud a second time by the
  browser, in an en-US voice, over Hebrew.

## What is still open

1. **Phantom transcripts.** On near-silence the transcriber can emit the
   vocabulary hint itself as a transcript — seen once, in full, in list order.
   The vocabulary switch on the panel turns the bias off; a filter that drops a
   transcript overlapping the hint has not been built.
2. **VAD fragmentation.** Hesitant speech gets split into fragments, and each
   fragment cancels the answer to the one before. Semantic VAD at low eagerness
   is the best setting found so far; it is not a fix.
3. **The audit log is in memory.** A server restart empties it, and calls from
   before the restart then read as fabricated. `TOOL_LOG_FILE` writes a JSONL
   trail but nothing loads it back on boot.
4. **`think (to first word)` is not what it says** on the WebRTC path. The model
   starts generating before the transcription event arrives, so the gap measures
   event skew, not thinking. Sub-100 ms values are noise.
5. **Node version.** npm runs the scripts under 20.13.1 while Vite asks for
   20.19+. It works; it is a trap for the next upgrade.
6. **A relay session costs 4-5× the latency** of the direct one — 1,611 ms
   against ~340 ms, measured. That is the price of the extra hop, and the reason
   the direct path is the default.

## Working agreement

Editing files under a running dev server killed a live call, broke a browser
tab's module graph, and left confusing console errors — three times in one day.
While a call is being tested, the files stay untouched; `npm run build && npm
run preview` gives a bundle that no edit can move.

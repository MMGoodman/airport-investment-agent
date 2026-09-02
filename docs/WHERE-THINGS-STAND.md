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
| `live-voice-agents` | Everything: the relay, the hybrid sideband, the pipeline board | lint · 54 tests · verify 44 · build ✅ |
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

## Fixed since this file was written

- **Phantom transcripts.** The guard existed inside the WebRTC transport and was
  absent from the relay, so a relayed caller was shown all 122 hint terms in list
  order as a turn they had spoken. One implementation now, in `src/agent/phantom.js`,
  used by both transports. Only the transcript is dropped and it is reported, not
  swallowed — the model never had it, because the transcriber listens alongside
  rather than in front.
- **A noisy room cancelling every answer.** `interrupt_response` defaults to true
  and had never been set. Three of four responses in one trace died within 600 ms of
  being created, one of them 300 ms after the tool result it was carrying. No
  threshold reaches this — `semantic_vad` has none — so it is now its own switch,
  reaching the model config, the local playback gate, and the post-tool
  `response.create`.
- **Guessed IATA codes.** Asked for the weather in New England and Arizona, the model
  looked up JFK and ATL and read the JFK figure out, with `"region": "Mid-Atlantic"`
  sitting in the payload it had just received. The prompt banned inventing numbers and
  said nothing about codes; it now bans recalling them and requires reading the
  returned city and region back against the question.
- **The trace not saying what the call ran under.** The settings arrive when the
  socket opens; the browser attached its listener after `getUserMedia`. Both lines
  were delivered to nobody, so a changed setting and an ignored one looked identical.
  Messages are queued from socket creation, and the board now names the running
  pipeline, green when it matches the switches and amber when they have drifted.
- **The audit log surviving a restart.** `TOOL_LOG_FILE` is reloaded on boot, so
  pre-restart calls no longer read as fabricated.
- **`think (to first word)`.** Response-scoped boundaries, and the label says which
  boundary it used, so the two transports are never silently compared on different
  ones.

## The hybrid — one session, two connections

The largest thing built since this file was written, and the reason the tool surface has a
`placement` field.

A Realtime session accepts TWO connections: the browser's WebRTC peer connection, and a
WebSocket from this server addressed by `?call_id=rtc_…`. OpenAI calls the second one a
sideband control channel. Both see the session and either can answer a tool call. So the
audio stays on the direct path at full speed while a tool the browser must not invoke is
executed here instead.

    browser  ──WebRTC (audio + the tools it owns)──▶  OpenAI
    server   ──WebSocket ?call_id=rtc_…────────────▶  OpenAI      server/sideband.js

Three modes in the provider switcher, identical except for who answers a tool:

| Entry | Audio | Who answers | get_airport_weather |
|---|---|---|---|
| `gpt-realtime · voice` | direct | browser, for what it owns | withheld, model says so |
| `gpt-realtime · voice · hybrid` | direct | browser + this server | runs here |
| `gpt-realtime · voice · via your server` | relayed | this server | runs here |

Enforced in three places, because any one alone is theatre: the session is minted with six
tools; `POST /api/tool` returns 403 for a server-placed tool to every caller; and the
browser's event handler skips a function call for a tool it does not own, since both sides
answering would put two outputs under one `call_id`.

### Two things verified against the live API, not assumed

Both cost a debugging cycle and neither is guessable from the docs.

1. **The sideband authenticates with the EPHEMERAL key, not the account key.** The account
   key mints the session and is what relay.js uses, so it is the obvious thing to reach for
   — and OpenAI refuses it with `HTTP 404`, which reads as a call id that does not exist
   and is in fact an authentication failure wearing the wrong status code.
2. **The browser DOES receive the result of a server-run tool.** When this server injects
   its `function_call_output`, OpenAI echoes the item to every connection —
   `conversation.item.added` carries `item.output` in full. Placement controls who
   EXECUTES: who holds the credentials, who makes the outbound call, and who can invoke the
   tool with arguments of their own. It does not control who can see.

Measured on a live call: sideband attached in 559 ms, `get_airport_weather` ran in 302 ms,
answer latency 974 ms and 796 ms — the same as without it, because the audio path never
changed.

## What is still open

1. **`POST /api/tool` has no authentication at all.** It refuses the server-placed tool to
   everyone, but it still runs the six read-only ones for anyone who can reach the port,
   and the session id it writes into the audit log is generated in the browser
   (`crypto.randomUUID()`) so it is not evidence of anything. The fix is a short-lived token
   minted alongside the ephemeral key, required by the endpoint, and used as the real
   session id for the log. It changes the session-start flow, which is why it has not been
   done unasked. **This is the largest remaining gap and the one a reader will ask about
   first.**
2. **VAD fragmentation.** Hesitant speech is still split into fragments — one sentence
   became "על איזה" then "פועלי" then the rest. Turning interruption off stops each fragment
   killing the previous answer, which was the damaging half; the fragmenting itself is
   unchanged, and the cost is that the caller cannot interrupt either. Hold-to-talk is the
   practical workaround and is on the panel.
3. **Node version.** npm runs the scripts under 20.13.1 while Vite asks for 20.19+. It
   works; it is a trap for the next upgrade.
4. **A relay session costs 4-5× the latency** of the direct one — 1,611 ms against ~340 ms,
   measured. That is the price of the extra hop, and the reason the direct path is the
   default. The hybrid exists so that price does not have to be paid for one tool.
5. **`conversation.item.truncate` is not sent on relay barge-in.** The model's context holds
   the whole sentence it generated rather than the part that was heard. Only the browser
   knows the played position, so this cannot be fixed from the server side.
6. **`npm run eval` has not been run since the prompt roughly doubled.** It was 8,468
   characters this morning and is over 15,000 now, with rules added for withheld tools,
   region labels, score-versus-peer-set phrasing, fragments, place names and tool-call loops.
   Each was written from a real failure; none has been checked for regressions against the
   others.

## Working agreement

Editing files under a running dev server killed a live call, broke a browser
tab's module graph, and left confusing console errors — three times in one day.
While a call is being tested, the files stay untouched; `npm run build && npm
run preview` gives a bundle that no edit can move.

The build is not a safety net for the browser. Vite replaces `node:*` with a stub
that throws on first access, so a server-only import reached from client code
compiles clean, passes every test, and blanks the page on load. That happened here.
`src/live/__tests__/browser-safe.test.js` walks the real client graph and fails on
any `node:` import — it is the only thing in the pipeline that can catch it.

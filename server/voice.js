/**
 * Live-voice transport endpoints.
 *
 * Two providers, one rule that does not change: neither of them gets to compute a
 * number. Both are handed the SAME `SYSTEM_PROMPT` and the SAME five `toolSchemas`
 * the text path uses, and when either asks for a tool the browser calls POST /api/tool
 * — the deterministic engine that was already there. Only the transport differs.
 *
 * Secrets never reach the browser. OpenAI gets a short-lived ephemeral key minted here;
 * ElevenLabs gets a signed WebSocket URL minted here.
 */
import { SYSTEM_PROMPT, VOICE_ADDENDUM, languageInstruction } from '../src/agent/prompt.js'
import { toolSchemasFor } from '../src/agent/tools.js'
import { attachSideband, detachSideband } from './sideband.js'
import { transcriptionPrompt } from '../src/agent/vocabulary.js'

const OPENAI_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime'
// Ten voices exist: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar.
// marin and cedar are the current pair and the only ones worth starting from. A voice
// carries an accent, so the one that reads English best is not automatically the one that
// reads Hebrew best — hence a separate setting rather than one voice for both.
const OPENAI_VOICE = process.env.OPENAI_REALTIME_VOICE || 'marin'
const OPENAI_VOICE_HE = process.env.OPENAI_REALTIME_VOICE_HE || OPENAI_VOICE
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe'
/**
 * Turn detection: when the caller has finished speaking, and when they have interrupted.
 *
 * Two mechanisms with genuinely different failure modes, so both are exposed rather than
 * one being chosen here on the caller's behalf.
 *
 *   semantic  a model judges whether the THOUGHT is finished. Rides through a breath
 *             mid-sentence, but offers no volume threshold, so background noise can still
 *             register as an interruption and truncate an answer.
 *   server    a silence timer with a loudness threshold. Crude about meaning — the 200 ms
 *             default split one question into four fragments — but it is the only way to
 *             say "ignore anything quieter than this".
 *
 * Reach for `server` with a high threshold when a room is noisy; keep `semantic` when it
 * is quiet and sentences are long.
 */
const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * The env values are the deployment's defaults, not the session's settings.
 *
 * They used to be both: read once at startup and baked into every call, so comparing two
 * turn-detection settings meant editing .env and restarting between them — by which point
 * the room, the speaker and the question had all moved. A caller now overrides them per
 * session and the trace records what it ran under, which is what makes two runs comparable.
 */
const VAD_DEFAULTS = {
  type: process.env.OPENAI_VAD_TYPE === 'server' ? 'server' : 'semantic',
  eagerness: process.env.OPENAI_VAD_EAGERNESS || 'low',
  threshold: clamp(num(process.env.OPENAI_VAD_THRESHOLD, 0.5), 0, 1),
  silenceMs: clamp(num(process.env.OPENAI_VAD_SILENCE_MS, 700), 100, 5000),
  prefixMs: clamp(num(process.env.OPENAI_VAD_PREFIX_MS, 300), 0, 2000),
}

const EAGERNESS = ['low', 'medium', 'high', 'auto']

/**
 * Build one session's turn detection from the request, falling back to the deployment.
 *
 * Every number is clamped: these arrive on a query string, and a silence window of NaN or
 * of ten minutes is a call that never answers. Returns the summary alongside the config so
 * the trace can state the setting rather than the reader having to infer it.
 */
function turnDetectionFor(q = {}) {
  const asked = q.vad === 'server' || q.vad === 'semantic' ? q.vad : VAD_DEFAULTS.type

  /**
   * Whether detected speech cancels the answer already being spoken.
   *
   * On by default, and it has to be: an agent that talks over you is unusable. But it is a
   * separate decision from WHERE the turn boundary is, and no threshold reaches it —
   * semantic_vad has none, so on that setting a nearby conversation cancels every answer
   * with nothing to tune. One trace from a noisy room: three of four responses cancelled
   * within 600 ms of being created, including the one carrying the tool result the caller
   * had asked for. The answer was generated, paid for, and never spoken.
   *
   * Off, the agent finishes its sentence and the caller waits. That is the trade, and it is
   * theirs to make — which is why it is a switch and not a constant.
   */
  const interrupt = q.interrupt !== 'off'
  const interruptSummary = interrupt ? '' : ' · no interrupt'

  if (asked === 'semantic') {
    // A model judges whether the THOUGHT is finished. Rides through a breath mid-sentence,
    // but offers no volume threshold, so room noise can still truncate an answer.
    const eagerness = EAGERNESS.includes(q.eagerness) ? q.eagerness : VAD_DEFAULTS.eagerness
    return {
      config: { type: 'semantic_vad', eagerness, interrupt_response: interrupt },
      summary: `semantic_vad · eagerness ${eagerness}${interruptSummary}`,
    }
  }

  // A silence timer with a loudness threshold. Crude about meaning — the 200 ms default
  // split one question into four fragments — but the only way to say "ignore anything
  // quieter than this".
  const threshold = clamp(num(q.threshold, VAD_DEFAULTS.threshold), 0, 1)
  const silence = clamp(num(q.silenceMs, VAD_DEFAULTS.silenceMs), 100, 5000)
  const prefix = clamp(num(q.prefixMs, VAD_DEFAULTS.prefixMs), 0, 2000)
  return {
    config: {
      type: 'server_vad',
      threshold,
      silence_duration_ms: silence,
      // Audio kept from before speech was detected, so the first syllable survives.
      prefix_padding_ms: prefix,
      interrupt_response: interrupt,
    },
    summary: `server_vad · threshold ${threshold} · silence ${silence}ms${interruptSummary}`,
  }
}
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest'
const SONIOX_STT = process.env.SONIOX_STT_MODEL || 'stt-rt-v5'
const SONIOX_FUNDED = process.env.SONIOX_FUNDED === 'true'
const DEFAULT_LANG = process.env.DEFAULT_LANG === 'en' ? 'en' : 'he'
const CASCADE_TTS =
  process.env.CASCADE_TTS_PROVIDER === 'soniox'
    ? process.env.SONIOX_TTS_MODEL || 'tts-rt-v2'
    : process.env.CASCADE_TTS_MODEL || 'gpt-4o-mini-tts'
const EL_LLM = process.env.ELEVENLABS_LLM || 'gemini-3.1-flash-lite'
// English sessions swap to the fast model at connect time; that is what the label shows.
/**
 * The voice model this deployment actually runs, per language.
 *
 * The label used to prefer the fast model unconditionally, so a Hebrew session — which
 * never gets the English-only swap, and runs the agent's base model — was reported in the
 * trace as eleven_flash_v2_5 while eleven_v3_conversational was doing the talking. A trace
 * that names the wrong model is worse than one that names none: it is what a comparison
 * gets filed under.
 */
const EL_BASE_TTS = process.env.ELEVENLABS_TTS_MODEL || 'eleven_v3_conversational'
const EL_FAST_TTS = process.env.ELEVENLABS_FAST_TTS || null
const EL_TTS = DEFAULT_LANG === 'en' && EL_FAST_TTS ? EL_FAST_TTS : EL_BASE_TTS

/** Our JSON-Schema tool declarations in the Realtime session format. */
const asRealtimeTool = (t) => ({
  type: 'function',
  name: t.name,
  description: t.description,
  parameters:
    t.parameters && Object.keys(t.parameters.properties ?? {}).length > 0
      ? t.parameters
      : { type: 'object', properties: {} },
})

/**
 * Told to the model when a transport cannot offer a tool, so the gap is named rather than
 * improvised around. A model handed six tools where its instructions imply seven answers
 * the seventh from memory — which is exactly how a caller who asked for the weather got a
 * score summary instead.
 */
function withheldNote(names) {
  if (names.length === 0) return ''
  const one = names.length === 1
  return [
    '',
    '',
    'NOT AVAILABLE ON THIS CONNECTION',
    `${names.join(', ')} ${one ? 'is' : 'are'} not offered on this line. The caller's audio`,
    `goes straight from their browser to you, so ${one ? 'that tool runs' : 'those tools run'} only where the server`,
    'holds the connection.',
    'Say so in one sentence and name the switch: the "via your server" option beside the',
    'model selector puts the call on the relayed line, where it works. Do not answer from',
    'memory, do not substitute figures from a different tool, and do not apologise at',
    'length — it is a setting, not a limit of yours.',
  ].join('\n')
}

/**
 * One realtime session config, built from a request's query.
 *
 * Exported because two transports need the identical session: the WebRTC path mints it
 * into an ephemeral key, and the server relay opens it over a WebSocket. Building it in
 * both places is how the two paths would drift apart — and the whole point of running
 * them side by side is that the ONLY difference is where the connection lives.
 */
export async function buildRealtimeSession(query = {}, transport = 'browser') {
  const lang = query.lang === 'he' ? 'he' : 'en'
  // Which tools this connection may offer. A 'server' tool is withheld from the browser
  // path rather than hidden there: on WebRTC the function call lands on the browser's data
  // channel, so a tool it cannot see is a tool that transport cannot carry.
  const { tools, withheld } = toolSchemasFor(transport)
  const vad = turnDetectionFor(query)
  const useVocabulary = query.vocabulary !== 'off'

  const hint = useVocabulary ? await transcriptionPrompt(lang) : ''

  return {
    lang,
    vadSummary: vad.summary,
    // Read back off the config rather than re-derived from the query, so the browser and
    // the model can never be told two different things about the same session.
    interrupts: vad.config.interrupt_response !== false,
    useVocabulary,
    // What this connection can and cannot reach, so the panel can show it rather than the
    // caller discovering it when an answer goes missing.
    toolNames: tools.map((t) => t.name),
    withheldTools: withheld,
    // The hint's own terms, so the browser can recognise it being read back at it.
    hintTerms: hint.split(',').map((t) => t.trim()).filter((t) => t.length > 2),
    model: OPENAI_MODEL,
    session: {
      type: 'realtime',
      model: OPENAI_MODEL,
      instructions:
        SYSTEM_PROMPT + VOICE_ADDENDUM + languageInstruction(lang, true) + withheldNote(withheld),
      tools: tools.map(asRealtimeTool),
      tool_choice: 'auto',
      audio: {
        input: {
          transcription: {
            model: TRANSCRIBE_MODEL,
            /**
             * Say which language is being spoken. Never used to be set at all — the
             * language was pinned only as a side effect of the vocabulary hint, whose
             * terms happen to be Hebrew. Turned the hint off, as the pipeline board now
             * lets a caller do, and nothing was left to say what to expect: one session
             * transcribed Hebrew speech into Greek, then Thai. The hint is a domain prior
             * and this is a language pin; they were never the same setting.
             */
            language: lang,
            ...(useVocabulary ? { prompt: hint } : {}),
          },
          turn_detection: vad.config,
        },
        output: { voice: lang === 'he' ? OPENAI_VOICE_HE : OPENAI_VOICE },
      },
    },
  }
}

export function mountVoiceRoutes(app) {
  /** Which live providers this deployment can actually offer. Drives the UI switcher. */
  app.get('/api/voice/providers', (req, res) => {
    res.json({
      // Which language the UI opens on. Hebrew is the default here because that is what
      // this deployment is being exercised in; the control still switches it per session.
      defaultLang: DEFAULT_LANG,
      providers: [
        {
          id: 'gemini',
          label: `${GEMINI_MODEL} · text`,
          mode: 'text',
          available: Boolean(process.env.GEMINI_API_KEY),
          model: GEMINI_MODEL,
          pipeline: GEMINI_MODEL,
          transport: 'HTTP · POST /api/chat',
        },
        {
          id: 'openai',
          // One model does everything: no transcriber, no synthesiser, no arrow.
          label: `${OPENAI_MODEL} · voice`,
          mode: 'live',
          available: Boolean(process.env.OPENAI_API_KEY),
          model: OPENAI_MODEL,
          pipeline: `${OPENAI_MODEL} (native speech-to-speech)`,
          transport: 'WebRTC · speech-to-speech',
        },
        {
          id: 'openai-relay',
          // The same model and the same session config — the ONLY change is where the
          // connection lives. This is the architecture experiment: audio relayed through
          // our server, tools run in-process, the browser reduced to a microphone and a
          // speaker. Same session, one variable, so the latency difference IS the answer.
          label: `${OPENAI_MODEL} · voice · via your server`,
          mode: 'live',
          available: Boolean(process.env.OPENAI_API_KEY),
          model: OPENAI_MODEL,
          pipeline: `${OPENAI_MODEL} — relayed: audio through your server, tools in-process`,
          transport: 'WebSocket · browser → your server → OpenAI',
        },
        {
          id: 'soniox',
          // Ours, not theirs. Every stage is a component we chose and can time.
          label: `${SONIOX_STT} → ${GEMINI_MODEL} → ${CASCADE_TTS} · voice`,
          mode: 'live',
          // A key alone is not readiness. Streaming audio bills per hour, so an unfunded
          // account mints temporary keys happily and then returns 402 the moment real
          // audio arrives. Listing it as available would put that failure mid-conversation
          // instead of in the switcher, where it can be read before a call starts.
          available: Boolean(
            process.env.SONIOX_API_KEY && process.env.OPENAI_API_KEY && SONIOX_FUNDED,
          ),
          note: SONIOX_FUNDED ? null : 'needs a funded Soniox account — set SONIOX_FUNDED=true once topped up',
          model: `${SONIOX_STT} + ${CASCADE_TTS}`,
          pipeline: `${SONIOX_STT} → ${GEMINI_MODEL} → ${CASCADE_TTS} (assembled — three vendors)`,
          transport: 'WebSocket STT · our agent · REST TTS',
        },
        {
          id: 'elevenlabs',
          // The arrow is the point: this provider is two models in series, and that is
          // why it answers later than the one above it.
          label: `${EL_LLM} → ${EL_TTS} · voice`,
          mode: 'live',
          available: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID),
          model: `${EL_LLM} → ${EL_TTS}`,
          pipeline:
            `scribe_realtime → ${EL_LLM} → ${EL_TTS} (cascade)` +
            (EL_FAST_TTS && EL_FAST_TTS !== EL_TTS ? ` · English swaps to ${EL_FAST_TTS}` : ''),
          transport: 'WebSocket · agent platform',
        },
      ],
    })
  })

  /**
   * Mint an ephemeral OpenAI Realtime key. The real key stays on this server; the
   * browser gets a token that expires in minutes and is bound to this session config —
   * including our prompt and the tool list this transport is allowed, so the browser can
   * neither widen it nor reach past it.
   */
  /**
   * Take over a live WebRTC session's server-placed tools.
   *
   * The browser reads the call id out of the Location header on its SDP exchange — OpenAI
   * lists it in Access-Control-Expose-Headers, so a page can read it cross-origin — and
   * hands it here. This server then opens its own WebSocket to the same session and
   * declares the withheld tools on it.
   *
   * The result: audio stays on the direct peer connection at full speed, and a tool the
   * browser must not invoke is invoked here instead, against this process's credentials.
   * The browser is not trusted with the call id in any meaningful sense — it identifies a
   * session OpenAI already knows about, and this route only ever adds our own tools to it.
   */
  app.post('/api/realtime/sideband', async (req, res) => {
    const { callId, session } = req.body ?? {}
    if (!/^rtc_[A-Za-z0-9_-]+$/.test(callId ?? '')) {
      return res.status(400).json({ error: 'a call id like rtc_… is required' })
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'no OpenAI key on this server' })
    }
    try {
      const out = await attachSideband({
        callId,
        session: session || null,
        apiKey: process.env.OPENAI_API_KEY,
      })
      res.json(out)
    } catch (err) {
      res.status(502).json({ error: err.message })
    }
  })

  /** Let go of a session the caller has hung up on, rather than waiting for the timeout. */
  app.post('/api/realtime/sideband/detach', (req, res) => {
    const { callId } = req.body ?? {}
    res.json({ detached: detachSideband(callId) })
  })

  app.get('/api/realtime/session', async (req, res) => {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'OPENAI_API_KEY is not set in .env.' })
    }

    try {
      // Everything session-shaped lives in buildRealtimeSession, shared verbatim with the
      // server-relay transport. See the comment there for why sharing it is the point.
      const built = await buildRealtimeSession(req.query)

      const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ session: built.session }),
      })

      const body = await upstream.json()
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: body?.error?.message ?? 'OpenAI rejected the session' })
      }

      // Only the ephemeral value crosses to the browser — never the account key.
      res.json({
        clientSecret: body.value,
        expiresAt: body.expires_at,
        model: built.model,
        lang: built.lang,
        vad: built.vadSummary,
        vocabulary: built.useVocabulary,
        interrupts: built.interrupts,
        toolNames: built.toolNames,
        withheldTools: built.withheldTools,
        hintTerms: built.hintTerms,
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  /**
   * Mint a short-lived Soniox key for the browser to open its transcription socket with.
   *
   * This is the one path we assemble ourselves: Soniox recognises, our existing agent
   * thinks, Soniox speaks. Three stages we own, which means three stages we can time
   * separately — the managed providers only ever report a single number.
   */
  app.get('/api/voice/soniox-key', async (req, res) => {
    if (!process.env.SONIOX_API_KEY) {
      return res.status(503).json({ error: 'SONIOX_API_KEY is not set in .env.' })
    }

    try {
      const upstream = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.SONIOX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          usage_type: 'transcribe_websocket',
          expires_in_seconds: 120,
          client_reference_id: 'airport-investment-agent',
        }),
      })

      const body = await upstream.json()
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: body?.message ?? 'Soniox rejected the key request' })
      }

      res.json({
        apiKey: body.api_key ?? body.key,
        expiresAt: body.expires_at ?? null,
        sttModel: process.env.SONIOX_STT_MODEL || 'stt-rt-v5',
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  /**
   * The synthesis stage of the assembled cascade — a stage, not a vendor.
   *
   * Whoever recognises does not have to be whoever speaks, and here they are not. Soniox
   * has TTS (`tts-rt-v2`, Hebrew, voice "Daniel") but the organization balance is
   * exhausted, so every request comes back 402. OpenAI speaks both languages and is
   * already paid for, so it holds the stage until Soniox is funded, at which point
   * CASCADE_TTS_PROVIDER=soniox swaps it back with no other change.
   *
   * Being able to do that is the entire argument for assembling a pipeline instead of
   * buying one. ElevenLabs will only accept its own four transcribers; OpenAI Realtime has
   * no seams at all. Here every stage is replaceable on its own merits.
   */
  const SYNTHESISERS = {
    openai: async (text, lang) => {
      const r = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.CASCADE_TTS_MODEL || 'gpt-4o-mini-tts',
          voice: lang === 'he' ? OPENAI_VOICE_HE : OPENAI_VOICE,
          input: text,
          response_format: 'mp3',
        }),
      })
      return r
    },
    // Note the host: synthesis lives on tts-rt.soniox.com, not the api. subdomain.
    soniox: async (text, lang) => {
      const r = await fetch('https://tts-rt.soniox.com/tts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.SONIOX_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.SONIOX_TTS_MODEL || 'tts-rt-v2',
          voice: process.env.SONIOX_TTS_VOICE || 'Daniel',
          language: lang === 'he' ? 'he' : 'en',
          text,
          audio_format: 'mp3',
        }),
      })
      return r
    },
  }

  app.post('/api/voice/speak', async (req, res) => {
    const { text, lang } = req.body ?? {}
    const provider = process.env.CASCADE_TTS_PROVIDER || 'openai'
    const synthesise = SYNTHESISERS[provider]

    if (!synthesise) return res.status(500).json({ error: `Unknown CASCADE_TTS_PROVIDER "${provider}"` })
    if (!text?.trim()) return res.status(400).json({ error: 'Body must be { text }' })

    try {
      const upstream = await synthesise(text, lang)

      if (!upstream.ok) {
        const detail = await upstream.text()
        // Say which stage failed and who owns it. "TTS failed" sends someone reading the
        // wrong logs; "soniox: balance exhausted" is a thing you can act on.
        return res.status(upstream.status).json({
          error: `${provider}: ${detail.slice(0, 240)}`,
          stage: 'synthesise',
          provider,
        })
      }

      res.setHeader('Content-Type', 'audio/mpeg')
      res.send(Buffer.from(await upstream.arrayBuffer()))
    } catch (err) {
      res.status(500).json({ error: `${provider}: ${err.message}`, stage: 'synthesise', provider })
    }
  })

  /**
   * Mint a signed ElevenLabs WebSocket URL so the API key never reaches the browser.
   * The prompt travels with it: the client passes it back as a session override, which is
   * how the voice path stays pinned to the repo's prompt rather than the dashboard's copy.
   */
  app.get('/api/voice/signed-url', async (req, res) => {
    const { ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID } = process.env
    if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
      return res.status(503).json({ error: 'ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID is not set in .env.' })
    }

    try {
      const upstream = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${ELEVENLABS_AGENT_ID}`,
        { headers: { 'xi-api-key': ELEVENLABS_API_KEY } },
      )
      const body = await upstream.json()
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: body?.detail?.message ?? 'ElevenLabs rejected the request' })
      }
      const lang = req.query.lang === 'he' ? 'he' : 'en'

      // Only eleven_v3_conversational speaks Hebrew, and it is the slowest model they
      // offer, so the agent is pinned to it to keep Hebrew working at all. English does
      // not need it: swap in the fast model for the session and skip the penalty.
      const ttsModelId = lang === 'en' ? process.env.ELEVENLABS_FAST_TTS || null : null

      res.json({
        signedUrl: body.signed_url,
        agentId: ELEVENLABS_AGENT_ID,
        lang,
        ttsModelId,
        prompt: SYSTEM_PROMPT + VOICE_ADDENDUM + languageInstruction(lang, true),
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}

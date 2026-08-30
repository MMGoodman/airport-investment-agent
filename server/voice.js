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
import { toolSchemas } from '../src/agent/tools.js'
import { transcriptionPrompt } from '../src/agent/vocabulary.js'

const OPENAI_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime'
// Ten voices exist: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar.
// marin and cedar are the current pair and the only ones worth starting from. A voice
// carries an accent, so the one that reads English best is not automatically the one that
// reads Hebrew best — hence a separate setting rather than one voice for both.
const OPENAI_VOICE = process.env.OPENAI_REALTIME_VOICE || 'marin'
const OPENAI_VOICE_HE = process.env.OPENAI_REALTIME_VOICE_HE || OPENAI_VOICE
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe'
const OPENAI_VAD_EAGERNESS = process.env.OPENAI_VAD_EAGERNESS || 'low'
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest'
const SONIOX_STT = process.env.SONIOX_STT_MODEL || 'stt-rt-v5'
const SONIOX_FUNDED = process.env.SONIOX_FUNDED === 'true'
const CASCADE_TTS =
  process.env.CASCADE_TTS_PROVIDER === 'soniox'
    ? process.env.SONIOX_TTS_MODEL || 'tts-rt-v2'
    : process.env.CASCADE_TTS_MODEL || 'gpt-4o-mini-tts'
const EL_LLM = process.env.ELEVENLABS_LLM || 'gemini-3.1-flash-lite'
// English sessions swap to the fast model at connect time; that is what the label shows.
const EL_TTS =
  process.env.ELEVENLABS_FAST_TTS || process.env.ELEVENLABS_TTS_MODEL || 'eleven_v3_conversational'

/** Our JSON-Schema tool declarations in the Realtime session format. */
const realtimeTools = toolSchemas.map((t) => ({
  type: 'function',
  name: t.name,
  description: t.description,
  parameters:
    t.parameters && Object.keys(t.parameters.properties ?? {}).length > 0
      ? t.parameters
      : { type: 'object', properties: {} },
}))

export function mountVoiceRoutes(app) {
  /** Which live providers this deployment can actually offer. Drives the UI switcher. */
  app.get('/api/voice/providers', (req, res) => {
    res.json({
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
          pipeline: `scribe_realtime → ${EL_LLM} → ${EL_TTS} (cascade)`,
          transport: 'WebSocket · agent platform',
        },
      ],
    })
  })

  /**
   * Mint an ephemeral OpenAI Realtime key. The real key stays on this server; the
   * browser gets a token that expires in minutes and is bound to this session config —
   * including our prompt and our five tools, so the browser cannot widen either.
   */
  app.get('/api/realtime/session', async (req, res) => {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'OPENAI_API_KEY is not set in .env.' })
    }

    // Steering the transcriber at the same language as the reply stops it from
    // "correcting" Hebrew speech into phonetic English, which then derails the answer.
    const lang = req.query.lang === 'he' ? 'he' : 'en'

    try {
      const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session: {
            type: 'realtime',
            model: OPENAI_MODEL,
            instructions: SYSTEM_PROMPT + VOICE_ADDENDUM + languageInstruction(lang),
            tools: realtimeTools,
            tool_choice: 'auto',
            audio: {
              input: {
                // gpt-4o-transcribe rather than whisper-1: whisper turned a spelled-out
                // airport code into nonsense and dropped words around pauses.
                //
                // No `language`: the selector governs the REPLY language, not what the
                // speaker uses. Pinning it to English mangled Hebrew questions from a user
                // who wanted English answers — a combination they asked for out loud.
                // Auto-detection handles a session that mixes the two.
                //
                // `prompt` biases recognition toward this domain's vocabulary, built from
                // data/ rather than hand-listed. See src/agent/vocabulary.js.
                transcription: { model: TRANSCRIBE_MODEL, prompt: await transcriptionPrompt() },
                // Semantic turn detection, not a silence timer. The 200 ms server-VAD
                // default ended the turn on an ordinary mid-sentence breath: one question
                // arrived as four fragments, each cancelling the answer to the one before.
                // Semantic VAD judges whether the thought is finished; 'low' waits longer.
                turn_detection: { type: 'semantic_vad', eagerness: OPENAI_VAD_EAGERNESS },
              },
              output: { voice: lang === 'he' ? OPENAI_VOICE_HE : OPENAI_VOICE },
            },
          },
        }),
      })

      const body = await upstream.json()
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: body?.error?.message ?? 'OpenAI rejected the session' })
      }

      // Only the ephemeral value crosses to the browser — never the account key.
      res.json({ clientSecret: body.value, expiresAt: body.expires_at, model: OPENAI_MODEL, lang })
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
        prompt: SYSTEM_PROMPT + VOICE_ADDENDUM + languageInstruction(lang),
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}

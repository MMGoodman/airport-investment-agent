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

const OPENAI_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime'
const OPENAI_VOICE = process.env.OPENAI_REALTIME_VOICE || 'marin'
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe'
const OPENAI_VAD_EAGERNESS = process.env.OPENAI_VAD_EAGERNESS || 'low'
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest'
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
                transcription: { model: TRANSCRIBE_MODEL, language: lang },
                // Semantic turn detection, not a silence timer. The 200 ms server-VAD
                // default ended the turn on an ordinary mid-sentence breath: one question
                // arrived as four fragments, each cancelling the answer to the one before.
                // Semantic VAD judges whether the thought is finished; 'low' waits longer.
                turn_detection: { type: 'semantic_vad', eagerness: OPENAI_VAD_EAGERNESS },
              },
              output: { voice: OPENAI_VOICE },
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

/**
 * Push the repo's agent definition into ElevenLabs.
 *
 * The point: the voice agent's prompt and tool surface live in git, not in a SaaS
 * dashboard. `SYSTEM_PROMPT` and `toolSchemas` are the same modules the text path
 * imports, so the two paths cannot drift.
 *
 *   npm run sync:agent          create or update, then print the agent id
 *
 * Writes nothing to .env — it prints the id and you paste it once.
 */
import 'dotenv/config'
import { SYSTEM_PROMPT, VOICE_ADDENDUM, languageInstruction } from '../src/agent/prompt.js'
import { toolSchemas } from '../src/agent/tools.js'
import { asrKeywords } from '../src/agent/vocabulary.js'

const API = 'https://api.elevenlabs.io/v1/convai'
const KEY = process.env.ELEVENLABS_API_KEY
const AGENT_NAME = 'airport-investment-agent'

if (!KEY) {
  console.error('ELEVENLABS_API_KEY is not set in .env.')
  process.exit(1)
}

/**
 * JSON Schema -> the shape ElevenLabs wants for a client tool.
 * Every parameter must carry a non-empty description, nested ones included, or the
 * API rejects the whole agent with a 422. Our schemas leave some blank, so fall back.
 */
function toElevenLabsParam(schema, name = 'value') {
  const out = {
    type: schema.type ?? 'string',
    description: schema.description?.trim() || `The ${name}.`,
  }
  if (schema.enum) out.enum = schema.enum
  if (schema.type === 'array' && schema.items) {
    out.items = toElevenLabsParam(schema.items, `${name} entry`)
  }
  if (schema.type === 'object' && schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toElevenLabsParam(v, k)]),
    )
    out.required = schema.required ?? []
  }
  return out
}

const tools = toolSchemas.map((t) => ({
  type: 'client',
  name: t.name,
  description: t.description,
  expects_response: true,
  response_timeout_secs: 30,
  parameters: {
    type: 'object',
    required: t.parameters?.required ?? [],
    properties: Object.fromEntries(
      Object.entries(t.parameters?.properties ?? {}).map(([k, v]) => [k, toElevenLabsParam(v, k)]),
    ),
  },
}))

const SPOKEN_PROMPT = SYSTEM_PROMPT + VOICE_ADDENDUM

const conversation_config = {
  agent: {
    language: 'en',
    first_message:
      'Airport investment agent, live. Ask me which airports are strong expansion candidates, ' +
      'or compare two of them.',
    prompt: {
      prompt: SPOKEN_PROMPT + languageInstruction('en'),
      // Same model tier as the text path on purpose: when you A/B the three providers,
      // the difference you hear should be the transport, not a smarter model.
      llm: process.env.ELEVENLABS_LLM || 'gemini-3.1-flash-lite',
      temperature: 0.3,
      // Unlimited by default, and it shows: one spoken answer ran to two paragraphs and
      // took fifteen seconds to generate, because on a cascade nothing is spoken until
      // generation finishes. The prompt asks for two or three sentences and is not always
      // obeyed, so this is the backstop. Set high enough that a disciplined answer is
      // never cut mid-sentence — the ceiling is for the pathological case, not the normal
      // one.
      max_tokens: Number(process.env.ELEVENLABS_MAX_TOKENS) || 400,
      tools,
    },
  },
  // Hebrew as a first-class preset rather than a prompt trick: the platform switches the
  // transcriber and the voice too, which a prompt instruction alone cannot do.
  language_presets: {
    he: {
      overrides: {
        agent: {
          language: 'he',
          first_message:
            'סוכן השקעות בשדות תעופה, בשידור חי. אפשר לשאול אילו שדות מועמדים חזקים להרחבה, או להשוות בין שניים.',
          prompt: { prompt: SPOKEN_PROMPT + languageInstruction('he') },
        },
      },
    },
  },
  // Latency settings, not taste settings.
  //
  // The default pipeline is a cascade: transcribe, then think, then synthesise, three
  // stages in series. Nothing can start speaking until the LLM has produced a word, so
  // every stage's first-token time adds up. eleven_v3_conversational sounds better and
  // starts later; on a cascade that delay lands on top of everything else.
  // eleven_v3_conversational is the only ElevenLabs voice model whose language list
  // includes Hebrew, and the preset languages are validated against the BASE model — so
  // supporting Hebrew at all forces it here. It is also the slowest of them. English
  // sessions override it at runtime (see server/voice.js); Hebrew cannot, and pays for it.
  tts: {
    // Their `verified_languages` metadata lists no Hebrew for any voice, and the voice
    // library returns nothing for a Hebrew search — but listening to one settles it and
    // listening said they are fine. The field marks what ElevenLabs has tested, not what
    // a voice can do, and treating absence as incapacity was the wrong read.
    voice_id: process.env.ELEVENLABS_VOICE_ID || 'pqHfZKP75CvOlQylNhV4',
    model_id: process.env.ELEVENLABS_TTS_MODEL || 'eleven_v3_conversational',
    optimize_streaming_latency: 4,
    // Expressive synthesis buys prosody at the cost of time to first audio. On a cascade
    // that delay lands after the LLM has already finished thinking.
    expressive_mode: false,
  },
  turn: {
    // Commit to a turn as soon as the speaker has plainly finished rather than waiting
    // out the full silence window.
    turn_eagerness: 'eager',
  },
  // The same vocabulary bias the OpenAI path gets as a transcription prompt. Without it a
  // transcriber has no reason to expect three-letter airport codes and guesses at them.
  // Their four transcribers, all in-house: scribe_realtime, scribe_v2_turbo, scribe_v2,
  // elevenlabs. All four take Hebrew. An external one — Soniox, say — is not an option
  // here; the list is closed, which is the cost of a managed platform.
  asr: {
    provider: process.env.ELEVENLABS_ASR_PROVIDER || 'scribe_realtime',
    keywords: await asrKeywords(),
  },
  // Set ELEVENLABS_REALTIME_MODEL to collapse the cascade into one native
  // speech-to-speech model — the same shape the OpenAI path uses. Left unset it stays a
  // cascade, which is the more interesting comparison and the reason the switcher exists.
  ...(process.env.ELEVENLABS_REALTIME_MODEL
    ? { realtime_model: process.env.ELEVENLABS_REALTIME_MODEL }
    : {}),
}

// Without this the platform refuses any client-side override, and the browser could not
// switch the session to Hebrew or pin it to this repo's prompt.
const platform_settings = {
  overrides: {
    conversation_config_override: {
      agent: {
        language: true,
        first_message: true,
        prompt: { prompt: true },
      },
      // Lets an English session swap in the fast voice model at connect time, which the
      // agent config itself cannot express without dropping Hebrew support entirely.
      tts: { model_id: true },
    },
  },
}

const headers = { 'xi-api-key': KEY, 'Content-Type': 'application/json' }

async function findExisting() {
  const res = await fetch(`${API}/agents?page_size=100`, { headers })
  if (!res.ok) return null
  const { agents = [] } = await res.json()
  return agents.find((a) => a.name === AGENT_NAME) ?? null
}

const existing = await findExisting()

// Never touch an agent we did not create — the configured id may belong to another project.
const res = existing
  ? await fetch(`${API}/agents/${existing.agent_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: AGENT_NAME, conversation_config, platform_settings }),
    })
  : await fetch(`${API}/agents/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: AGENT_NAME, conversation_config, platform_settings }),
    })

const body = await res.json()
if (!res.ok) {
  console.error(`\n  ${res.status} from ElevenLabs:\n`, JSON.stringify(body, null, 2).slice(0, 2000))
  process.exit(1)
}

const id = body.agent_id ?? existing?.agent_id
console.log(`\n  ${existing ? 'updated' : 'created'} "${AGENT_NAME}"`)
console.log(`  ${tools.length} client tools: ${tools.map((t) => t.name).join(', ')}`)
console.log(`  prompt: ${SPOKEN_PROMPT.length} chars — the text path's prompt plus spoken-delivery rules`)
console.log('  languages: en, he (the preset switches transcriber and voice, not just wording)')
console.log(`  ELEVENLABS_AGENT_ID=${id}\n`)

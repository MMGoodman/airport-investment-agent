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
import {
  SYSTEM_PROMPT,
  VOICE_ADDENDUM,
  languageInstruction,
  withheldNote,
  ELEVENLABS_REMEDY,
} from '../src/agent/prompt.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toolSchemasFor } from '../src/agent/tools.js'
import { asrKeywords } from '../src/agent/vocabulary.js'

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

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

/**
 * Client tools — so the BROWSER runs every one of these.
 *
 * That makes this the same transport as the direct WebRTC line as far as placement is
 * concerned, and it has to be built the same way. It was not: this mapped every schema,
 * which would have handed ElevenLabs get_airport_weather and search_knowledge as client
 * tools. The page would call POST /api/tool, get the 403 that placement exists to return,
 * and the agent would report a tool failure to the caller — a placement leak that only
 * shows up on the next sync, in a SaaS dashboard, minutes from the code that caused it.
 *
 * ElevenLabs has no equivalent of the sideband, so a server-placed tool cannot be offered
 * here at all. The withheld list is printed at the end rather than left silent.
 */
const { tools: offered, withheld } = toolSchemasFor('browser')

/**
 * The gap, named in the prompt rather than left for the model to improvise around.
 *
 * A trace that made this necessary: asked for the weather in San Juan, the agent called
 * get_airport_profile — the wrong tool — and then said weather was outside its remit. It is
 * not outside its remit; it is outside THIS LINE. Telling a caller the subject is beyond
 * you, when another transport answers it in one call, is the worst of the available wrong
 * answers, because they stop asking.
 */
const WITHHELD = withheldNote(withheld, ELEVENLABS_REMEDY)

const tools = offered.map((t) => ({
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
      prompt: SPOKEN_PROMPT + languageInstruction('en', true) + WITHHELD,
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
          prompt: { prompt: SPOKEN_PROMPT + languageInstruction('he', true) + WITHHELD },
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
    /**
     * Pinned, because it was not, and every call opened in a different mood.
     *
     * The greeting is one fixed sentence, but it is synthesised fresh each session, and
     * with stability left at the platform default the same words came back cheerful,
     * clipped or weary depending on the run. For an analyst assistant that reads as an
     * unstable narrator; the caller cannot tell a mood from a signal.
     *
     * Higher is steadier and flatter. 0.7 was chosen to stop the swings without going
     * monotone — worth A/B-ing on your own ear, since the v3 models are documented to
     * quantise this differently from v2 and this build cannot measure that from here.
     */
    stability: num(process.env.ELEVENLABS_STABILITY, 0.7),
    similarity_boost: num(process.env.ELEVENLABS_SIMILARITY, 0.8),
    // Expressive synthesis buys prosody at the cost of time to first audio. On a cascade
    // that delay lands after the LLM has already finished thinking.
    expressive_mode: false,
  },
  turn: {
    // Was 'eager', chosen to shave latency off a provider that is slow anyway. It cost far
    // more than it saved: room noise and half-sentences aimed at someone else kept cutting
    // the agent off, and one session lost thirty-four seconds to an answer being
    // interrupted and then repeated in full. Two wasted turns dwarf the few hundred
    // milliseconds eagerness buys.
    turn_eagerness: process.env.ELEVENLABS_TURN_EAGERNESS || 'normal',

    /**
     * How long a caller may think before the agent speaks again, in seconds.
     *
     * ElevenLabs defaults this to 7 and it is far too short for this agent. A trace: the
     * agent finished a ranking of three airports, its audio ran about thirteen seconds, and
     * seven seconds after it stopped the platform re-engaged — twice in one call, each time
     * costing a full generation to ask "shall I elaborate?" while the caller was still
     * reading the answer they had asked for.
     *
     * Worse with retranscribe_on_turn_timeout on, which is the setting above: the silence
     * gets transcribed, comes back as "..." and enters the conversation as something the
     * caller said. Two of those in this trace, 1.9s and 2.4s of generation spent on nothing.
     *
     * Twenty seconds suits a question whose answer is three airports and four figures. A
     * chattier deployment can lower it.
     */
    turn_timeout: num(process.env.ELEVENLABS_TURN_TIMEOUT, 20),

    /**
     * Do not start answering before the turn is known to be over.
     *
     * The live agent had this ON, which is not the documented default — so it was set in
     * the dashboard, outside git, and nothing here recorded it. It "starts generating LLM
     * responses during silence before full turn confidence is reached", which is the
     * eagerness trade again in a different costume, and it loses to the same argument: a
     * hesitant caller — "אמ... אני רוצה... להשוות בין שניים: בוסטון ו... איך הוא נקרא?" —
     * is a run of silences that are not turn ends. Generating into one of them answers half
     * a sentence, and half an answer has to be thrown away and asked again.
     */
    speculative_turn: process.env.ELEVENLABS_SPECULATIVE === 'on',

    /**
     * When the detector hears nothing, transcribe the audio anyway before giving up.
     *
     * "If VAD detects no speech, attempts to re-transcribe accumulated audio at turn
     * timeout." Without it, speech the detector missed is simply gone, which is what
     * "it did not hear me at all" looks like from the caller's chair: they spoke, the
     * agent waited, and nothing they said ever became a turn.
     *
     * It costs money — ElevenLabs stops applying the silence discount to a turn this
     * fires on. Worth it for a caller who has to repeat themselves; set
     * ELEVENLABS_RETRANSCRIBE=off if a deployment would rather pay less than hear more.
     */
    retranscribe_on_turn_timeout: process.env.ELEVENLABS_RETRANSCRIBE !== 'off',
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

const BACKUPS = join(dirname(fileURLToPath(import.meta.url)), '..', '.backups')
const headers = { 'xi-api-key': KEY, 'Content-Type': 'application/json' }

async function findExisting() {
  const res = await fetch(`${API}/agents?page_size=100`, { headers })
  if (!res.ok) return null
  const { agents = [] } = await res.json()
  return agents.find((a) => a.name === AGENT_NAME) ?? null
}

const existing = await findExisting()

/**
 * Keep what is about to be overwritten.
 *
 * A PATCH here replaces the whole conversation_config, including anything set by hand in
 * the ElevenLabs dashboard. speculative_turn had arrived exactly that way — on, against the
 * documented default, with nothing in this repo recording it — and it was found by reading
 * the live agent rather than by anything here knowing. The next such setting should be
 * recoverable instead of merely gone.
 *
 * A snapshot is not a rollback, and it is not offered as one: it is the previous config on
 * disk, in a directory git ignores, so a person can see what changed and put it back.
 */
async function snapshot(agentId) {
  const res = await fetch(`${API}/agents/${agentId}`, { headers })
  if (!res.ok) {
    console.warn(`  could not snapshot the live agent (${res.status}) — continuing without one`)
    return null
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const path = join(BACKUPS, `elevenlabs-agent-${stamp}.json`)
  await mkdir(BACKUPS, { recursive: true })
  await writeFile(path, JSON.stringify(await res.json(), null, 2))
  return path
}

const saved = existing ? await snapshot(existing.agent_id) : null

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
if (withheld.length) {
  console.log(
    `  withheld (server-placed, and this platform has no sideband): ${withheld.join(', ')}`,
  )
}
// What was SENT, not what SPOKEN_PROMPT happens to be: the language instruction and the
// withheld note are appended after it, and reporting the shorter number made a prompt that
// had grown by 1,479 characters look unchanged.
console.log(
  `  prompt: ${conversation_config.agent.prompt.prompt.length} chars — the text path's prompt, spoken-delivery rules${WITHHELD ? ', and the withheld-tools note' : ''}`,
)
if (saved) console.log(`  previous config saved to ${relative(process.cwd(), saved)}`)
console.log('  languages: en, he (the preset switches transcriber and voice, not just wording)')
console.log(`  ELEVENLABS_AGENT_ID=${id}\n`)

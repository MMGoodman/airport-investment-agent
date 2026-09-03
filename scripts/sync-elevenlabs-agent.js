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
import { skillsFor } from '../src/agent/skills.js'
import { webhookToolsFor, webhookHybridStatus } from '../server/webhookTools.js'
import { asrKeywords } from '../src/agent/vocabulary.js'

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

const API = 'https://api.elevenlabs.io/v1/convai'
const KEY = process.env.ELEVENLABS_API_KEY
const AGENT_NAME = 'airport-investment-agent'
/** The same agent with the placed tools on a webhook. Its own row in the switcher. */
const HYBRID_AGENT_NAME = 'airport-investment-agent-hybrid'

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
 * The hybrid half, when this deployment can be reached from outside.
 *
 * Empty on a laptop with no tunnel, which is the normal case and not a failure — the two
 * placed tools then stay withheld exactly as before, and WITHHELD below says so to the model.
 * Configure PUBLIC_BASE_URL and ELEVENLABS_WEBHOOK_SECRET and they move to ElevenLabs'
 * server-to-server path instead, giving that platform the same tool surface the OpenAI
 * hybrid has, by a completely different mechanism.
 */
const hybrid = webhookHybridStatus()
const webhookTools = webhookToolsFor()

/**
 * The gap, named in the prompt rather than left for the model to improvise around.
 *
 * A trace that made this necessary: asked for the weather in San Juan, the agent called
 * get_airport_profile — the wrong tool — and then said weather was outside its remit. It is
 * not outside its remit; it is outside THIS LINE. Telling a caller the subject is beyond
 * you, when another transport answers it in one call, is the worst of the available wrong
 * answers, because they stop asking.
 */
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

/** The same bias list for both agents, so resolve it once rather than per build. */
const ASR_KEYWORDS = await asrKeywords()

const SPOKEN_PROMPT = SYSTEM_PROMPT + VOICE_ADDENDUM

/**
 * One agent's configuration, as a function of the tools it can reach.
 *
 * Called twice. Everything it produces — prompt, voice, turn settings, ASR, language
 * presets — is identical between the two agents; the ONLY difference is `webhookTools`,
 * and the withheld note that follows from it. That is the same discipline the OpenAI pair
 * follows, and it is what makes the two rows in the switcher a comparison rather than two
 * unrelated agents that happen to share a name.
 */
/**
 * Skills, flattened into the prompt, because this platform cannot be sent any later.
 *
 * On the OpenAI paths a skill arrives as a session.update the first time one of its tools is
 * called — the base prompt stays small and the conditional rules turn up when they become
 * relevant. ElevenLabs has no session.update and no equivalent, so for a long time the
 * result was simply that NO skill ever reached these agents, silently.
 *
 * It showed. A caller said "אה, תודה רבה" and the agent hung up on them, because the rule
 * that a bare thank-you is acknowledgement rather than goodbye lives in the call-control
 * skill — 1,071 characters that had never been sent. The ranking rules and the weather
 * rules had never been sent either.
 *
 * So the choice here is all of them always or none of them ever, and none was the wrong
 * one. Only the skills whose tools this agent actually carries: the plain agent has no
 * weather tool, and rules about reading back a weather result are noise to it.
 */
function skillsBlock(toolNames) {
  const relevant = skillsFor(toolNames)
  if (relevant.length === 0) return ''
  return [
    '',
    '',
    'RULES THAT APPLY WHEN THEY APPLY',
    'What follows is grouped by subject. Each block governs only its own subject; read the',
    'one that matches what you are about to do and ignore the rest.',
    '',
    ...relevant.map((skill) => skill.instructions),
  ].join('\n')
}

const buildConfig = (webhookTools) => {
  const stillWithheld = withheld.filter((name) => !webhookTools.some((t) => t.name === name))
  const WITHHELD = withheldNote(stillWithheld, ELEVENLABS_REMEDY)
  const allTools = [...tools, ...webhookTools]
  const SKILLS_TEXT = skillsBlock(allTools.map((t) => t.name))
  return {
  agent: {
    language: 'en',
    first_message:
      'Airport investment agent, live. Ask me which airports are strong expansion candidates, ' +
      'or compare two of them.',
    prompt: {
      prompt: SPOKEN_PROMPT + SKILLS_TEXT + languageInstruction('en', true) + WITHHELD,
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
      tools: allTools,
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
          prompt: { prompt: SPOKEN_PROMPT + SKILLS_TEXT + languageInstruction('he', true) + WITHHELD },
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
  /**
   * Which transcriber, and why it is the knob that matters most on this path.
   *
   * Three in-house options remain — scribe_realtime, scribe_v2_turbo, scribe_v2. A fourth,
   * 'elevenlabs', is gone: the API answers "Original ASR has been removed". An external one
   * is not an option at all; the list is closed, which is the cost of a managed platform.
   *
   * On a cascade the transcript IS the model's input, so a bad one is a bad question. A live
   * Hebrew session produced "אממ, דף קמארה מתי, אממ, מסיגריה?" from a caller who had said
   * nothing of the sort, and the agent answered the nonsense it was handed. The native
   * speech-to-speech path does not have this failure — asked the same kind of question it
   * transcribed "בניג" and still called rank_airports with state: ME, because it hears the
   * audio and the transcript is only something to display.
   *
   * scribe_realtime is the fastest and the least accurate. Worth A/B-ing against
   * scribe_v2_turbo on a real voice before deciding; accuracy and latency trade here and no
   * default is right for every caller.
   */
  asr: {
    provider: process.env.ELEVENLABS_ASR_PROVIDER || 'scribe_realtime',
    keywords: ASR_KEYWORDS,
  },
  // Set ELEVENLABS_REALTIME_MODEL to collapse the cascade into one native
  // speech-to-speech model — the same shape the OpenAI path uses. Left unset it stays a
  // cascade, which is the more interesting comparison and the reason the switcher exists.
  ...(process.env.ELEVENLABS_REALTIME_MODEL
    ? { realtime_model: process.env.ELEVENLABS_REALTIME_MODEL }
    : {}),
  }
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

/**
 * Two agents, differing in one property.
 *
 * The plain one runs six client tools. The hybrid one runs the same six plus the two placed
 * tools as webhooks, which ElevenLabs' cloud calls on this server. Everything else — prompt,
 * voice, turn settings, ASR, language presets — comes from the same function and the same
 * inputs, because a comparison between two things that differ in three ways measures nothing.
 *
 * The hybrid agent is only created when the webhook half is configured. An agent declaring
 * webhook tools at a URL nobody can reach is worse than no agent at all: it would appear in
 * the switcher, take a call, and fail at the first tool.
 */
async function findByName(name) {
  const res = await fetch(`${API}/agents?page_size=100`, { headers })
  if (!res.ok) return null
  const { agents = [] } = await res.json()
  return agents.find((a) => a.name === name) ?? null
}

/**
 * Keep what is about to be overwritten.
 *
 * A PATCH replaces the whole conversation_config, including anything set by hand in the
 * ElevenLabs dashboard. speculative_turn had arrived exactly that way — on, against the
 * documented default, with nothing in this repo recording it — and it was found by reading
 * the live agent rather than by anything here knowing. The next such setting should be
 * recoverable rather than merely gone.
 *
 * A snapshot is not a rollback and is not offered as one: it is the previous config on disk,
 * in a directory git ignores, so a person can see what changed and put it back.
 */
async function snapshot(agentId, label) {
  const res = await fetch(`${API}/agents/${agentId}`, { headers })
  if (!res.ok) {
    console.warn(`  could not snapshot ${label} (${res.status}) — continuing without one`)
    return null
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const path = join(BACKUPS, `${label}-${stamp}.json`)
  await mkdir(BACKUPS, { recursive: true })
  await writeFile(path, JSON.stringify(await res.json(), null, 2))
  return path
}

async function syncAgent({ name, webhookTools: hooks, envVar }) {
  const config = buildConfig(hooks)
  const existing = await findByName(name)
  const saved = existing ? await snapshot(existing.agent_id, name) : null

  // Never touch an agent we did not create — a configured id may belong to another project.
  const res = existing
    ? await fetch(`${API}/agents/${existing.agent_id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name, conversation_config: config, platform_settings }),
      })
    : await fetch(`${API}/agents/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, conversation_config: config, platform_settings }),
      })

  const body = await res.json()
  if (!res.ok) {
    console.error(`\n  ${res.status} from ElevenLabs for ${name}:\n`, JSON.stringify(body, null, 2).slice(0, 1500))
    process.exit(1)
  }

  const id = body.agent_id ?? existing?.agent_id
  const placed = hooks.map((t) => t.name)
  const missing = withheld.filter((n) => !placed.includes(n))
  const total = tools.length + withheld.length

  console.log(`\n  ${existing ? 'updated' : 'created'} "${name}"`)
  console.log(`  ${tools.length} client · ${hooks.length} webhook · ${tools.length + hooks.length}/${total} of the agent`)
  if (placed.length) console.log(`  their cloud calls this server for: ${placed.join(', ')}`)
  if (missing.length) console.log(`  withheld: ${missing.join(', ')}`)
  const skills = skillsFor([...tools, ...hooks].map((t) => t.name))
  console.log(`  prompt: ${config.agent.prompt.prompt.length} chars · ${skills.length} skills inlined: ${skills.map((s) => s.id).join(', ')}`)
  if (saved) console.log(`  previous config saved to ${relative(process.cwd(), saved)}`)
  console.log(`  ${envVar}=${id}`)
  return id
}

console.log(`\n  hybrid: ${hybrid.enabled ? 'ON' : 'off'} — ${hybrid.reason}`)

await syncAgent({ name: AGENT_NAME, webhookTools: [], envVar: 'ELEVENLABS_AGENT_ID' })

if (hybrid.enabled) {
  await syncAgent({ name: HYBRID_AGENT_NAME, webhookTools, envVar: 'ELEVENLABS_HYBRID_AGENT_ID' })
} else {
  console.log(`\n  "${HYBRID_AGENT_NAME}" not synced — it would declare webhook tools at a URL nobody can reach.`)
  console.log('  Set PUBLIC_BASE_URL and ELEVENLABS_WEBHOOK_SECRET, then run this again.')
}

console.log('\n  languages: en, he (the preset switches transcriber and voice, not just wording)\n')

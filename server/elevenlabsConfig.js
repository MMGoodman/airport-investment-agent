/**
 * The ElevenLabs agent's own settings, editable from the screen.
 *
 * WHY THIS PATH NEEDED IT MOST
 *
 * It is the one where the most is CHOSEN. The OpenAI paths are one model doing everything —
 * there is no voice to pick and no LLM to swap, so the pipeline board covers them. This
 * path is a cascade of three separately-chosen stages, and every one of them was a string
 * in .env: the voice, the LLM, the text-to-speech model, the transcriber, and the whole
 * turn-taking configuration. Fifteen settings on the most configurable path, reachable only
 * by editing a file and re-running a script.
 *
 * HOW APPLYING WORKS, AND WHY IT SPAWNS THE SCRIPT
 *
 * scripts/sync-elevenlabs-agent.js already builds the entire agent — two of them, with the
 * prompt, the tools, the placement, the vocabulary and a backup of what it replaced. Half
 * of that has a comment explaining a trace that made it necessary. Re-implementing any of
 * it here to save a child process would be two things that must not drift, and the one that
 * drifts is always the copy.
 *
 * So the overrides are held here, passed as environment to the script the CLI runs, and
 * what comes back is that script's own output. `npm run sync:agent` and this button do
 * exactly the same thing because they are the same thing.
 */
import { spawn } from 'node:child_process'

const API = 'https://api.elevenlabs.io/v1'

/** A value no field will ever accept, which is the point — see allowedValues. */
const PROBE = '__probe_for_allowed_values__'

/**
 * In memory, like every other override in this workbench.
 *
 * The agent itself is NOT in memory — applying writes to ElevenLabs and stays written. What
 * is lost on restart is only the record of which values this session typed, and .env stays
 * the source of truth for what a fresh boot sends.
 */
const overrides = {}

/**
 * Which settings this pane owns, and what each one actually decides.
 *
 * `options` are offered; the field still accepts anything, because the list of models a
 * provider supports changes faster than a constant in a file, and a picker that cannot
 * express next month's model is worse than a text box.
 */
export const FIELDS = [
  {
    key: 'ELEVENLABS_LLM',
    label: 'מודל השפה',
    hint: 'מי חושב. הכי משפיע על איכות התשובה ועל הלטנסי',
    // Discovered, not listed here. See allowedValues below for why that matters.
    probe: { conversation_config: { agent: { prompt: { llm: PROBE } } } },
  },
  {
    key: 'ELEVENLABS_VOICE_ID',
    label: 'קול',
    hint: 'נטען חי מהחשבון שלך',
    from: 'voices',
  },
  {
    key: 'ELEVENLABS_TTS_MODEL',
    label: 'מודל הקראה',
    hint: 'איך הטקסט נשמע',
    probe: { conversation_config: { tts: { model_id: PROBE } } },
  },
  {
    key: 'ELEVENLABS_ASR_PROVIDER',
    label: 'מתמלל',
    // The page calls this the knob that matters most on a cascade, because the transcript
    // IS the model's input here — what breaks in it breaks for good.
    hint: 'הכי משפיע בעברית — התמלול הוא הקלט של המודל, לא תצוגה',
    probe: { conversation_config: { asr: { provider: PROBE } } },
    /**
     * Validation accepts this one and the platform then refuses it.
     *
     * Their API answers "Original ASR has been removed" when a conversation actually uses
     * it, but it is still in the list of accepted values — so discovery, which is otherwise
     * the honest source, offers a setting that cannot work. Named here rather than filtered
     * out: a value that disappears without explanation is the same puzzle in a quieter form.
     */
    avoid: { elevenlabs: 'הוסר אצלם — נכשל בזמן שיחה' },
  },
  {
    key: 'ELEVENLABS_REALTIME_MODEL',
    label: 'מודל נייטיב במקום קסקייד',
    // Free text, not a picker. It was `options: ['']` — a select whose only choice was
    // blank, so the one field meant to collapse the cascade could not be filled in at all.
    hint: 'ריק = קסקייד של שלושה שלבים. מלא = מודל אחד מהאודיו',
  },
  {
    key: 'ELEVENLABS_TURN_EAGERNESS',
    label: 'להוט לתפוס תור',
    hint: 'eager חוטף לך את המילה',
    probe: { conversation_config: { turn: { turn_eagerness: PROBE } } },
  },
  { key: 'ELEVENLABS_TURN_TIMEOUT', label: 'שניות עד שהוא מדבר שוב', hint: 'ברירת המחדל שלהם 7 וקצרה מדי כאן', kind: 'number' },
  { key: 'ELEVENLABS_STABILITY', label: 'יציבות הקול', hint: '0–1', kind: 'number' },
  { key: 'ELEVENLABS_SIMILARITY', label: 'דמיון לקול המקור', hint: '0–1', kind: 'number' },
  { key: 'ELEVENLABS_MAX_TOKENS', label: 'תקרת אורך תשובה', hint: 'טוקנים', kind: 'number' },
  { key: 'ELEVENLABS_SPECULATIVE', label: 'להתחיל לענות לפני סוף התור', hint: "on מקצר לטנסי ועונה לחצי משפט", options: ['off', 'on'] },
  { key: 'ELEVENLABS_RETRANSCRIBE', label: 'לתמלל שוב כשלא נשמע כלום', hint: 'off חוסך כסף ומאבד דיבור', options: ['on', 'off'] },
  { key: 'ELEVENLABS_MERGE_IGNORE', label: 'רשימת מילים שלא קוטעות', hint: 'off מכבה גם את שלהם', options: ['on', 'off'] },
  { key: 'ELEVENLABS_IGNORE_TERMS', label: 'מילים שלא ייחשבו כקטיעה', hint: 'מופרד בפסיקים. ריק = ברירת המחדל שבסקריפט' },
]

const KEYS = new Set(FIELDS.map((f) => f.key))

/**
 * What values a field will accept, asked of the platform rather than guessed.
 *
 * THE LISTS WERE HARDCODED AND ONE OF THEM WAS WRONG
 *
 * `gemini-3.1-flash` looked like a model and is not one. Applying it failed validation, the
 * sync exited 1, and the agent was left as it was — which is the good outcome, but the
 * picker had offered a value that could never work, and would have gone on offering it.
 *
 * There is no endpoint that lists these: /v1/models needs a permission this key does not
 * carry, and convai has no equivalent. But the validation error IS the list — it names
 * every accepted value — so the way to ask is to send one that cannot be right and read the
 * refusal. 103 language models came back, and 9 voices models, and 3 transcribers.
 *
 * The probe changes nothing: validation rejects the whole request before any field is
 * written. Cached for the life of the process, because the answer moves on their release
 * schedule and not on ours.
 */
const discovered = new Map()

function parseAllowed(message = '') {
  const m = String(message).match(/Input should be ([^"]+)/)
  if (!m) return null
  return (
    m[1]
      // The tail reads "…, 'x' or 'y'", so commas alone leave the last two joined.
      .split(/,|\s+or\s+/)
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
  )
}

async function allowedValues(key, agentId, probe) {
  if (!agentId || !probe) return null
  const cacheKey = JSON.stringify(probe)
  if (discovered.has(cacheKey)) return discovered.get(cacheKey)
  try {
    const res = await fetch(`${API}/convai/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(probe),
    })
    const body = await res.text()
    const list = parseAllowed(body)
    discovered.set(cacheKey, list)
    return list
  } catch {
    return null
  }
}

/**
 * Which voice models can actually speak Hebrew.
 *
 * THE FAILURE THIS EXISTS FOR
 *
 * A preset language is validated against the TTS BASE MODEL, not against the agent. So
 * choosing a faster voice model silently invalidates the `he` preset, and the sync fails
 * with "Preset languages must be one of en, zh, es… but got he" — an error about a language
 * you did not touch, caused by a model you did.
 *
 * The proper answer is /v1/models, which lists each model's languages. This key is missing
 * the `models_read` permission, so that returns 401 — and rather than guess, the pane says
 * so and warns from what the sync script has recorded. Grant the permission and this starts
 * answering from their data instead.
 */
async function hebrewCapableModels(key) {
  if (discovered.has('tts-languages')) return discovered.get('tts-languages')
  let result = null
  try {
    const res = await fetch(`${API}/models`, { headers: { 'xi-api-key': key } })
    if (res.ok) {
      const models = await res.json()
      result = {
        source: 'api',
        supports: Object.fromEntries(
          (models ?? []).map((m) => [
            m.model_id,
            (m.languages ?? []).some((l) => (l.language_id ?? '').toLowerCase() === 'he'),
          ]),
        ),
      }
    }
  } catch {
    result = null
  }
  discovered.set('tts-languages', result)
  return result
}

async function voices(key) {
  try {
    const res = await fetch(`${API}/voices?page_size=100`, { headers: { 'xi-api-key': key } })
    if (!res.ok) return []
    const body = await res.json()
    return (body.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name }))
  } catch {
    // A pane that cannot reach their API should still open on the values you typed.
    return []
  }
}

/** What the agent is actually configured with right now, read back from them. */
async function liveAgent(key, id) {
  if (!id) return null
  try {
    const res = await fetch(`${API}/convai/agents/${id}`, { headers: { 'xi-api-key': key } })
    if (!res.ok) return null
    const a = await res.json()
    const c = a.conversation_config ?? {}
    return {
      name: a.name,
      llm: c.agent?.prompt?.llm,
      voiceId: c.tts?.voice_id,
      ttsModel: c.tts?.model_id,
      transcriber: c.asr?.provider,
      turnEagerness: c.turn?.turn_eagerness,
      turnTimeout: c.turn?.turn_timeout,
      ignoreTerms: (c.turn?.interruption_ignore_terms ?? []).length,
      mergeIgnore: c.turn?.merge_with_default_ignore_terms,
    }
  } catch {
    return null
  }
}

export function mountElevenLabsConfigRoutes(app) {
  app.get('/api/elevenlabs/config', async (_req, res) => {
    const key = process.env.ELEVENLABS_API_KEY
    if (!key) return res.status(400).json({ error: 'ELEVENLABS_API_KEY is not set' })

    // The effective value: what this session typed, else what .env holds, else the default
    // the sync script would fall back to.
    const values = Object.fromEntries(
      FIELDS.map((f) => [f.key, overrides[f.key] ?? process.env[f.key] ?? '']),
    )

    // Asked once per process and then cached, so opening the pane is not four round trips
    // every time.
    const agentId = process.env.ELEVENLABS_HYBRID_AGENT_ID || process.env.ELEVENLABS_AGENT_ID
    const hebrew = await hebrewCapableModels(key)

    const fields = await Promise.all(
      FIELDS.map(async (f) => {
        const { probe, ...rest } = f
        const options = probe ? await allowedValues(key, agentId, probe) : null
        const out = options ? { ...rest, options, discovered: true } : rest

        if (f.key !== 'ELEVENLABS_TTS_MODEL') return out

        /**
         * Mark the voice models that cannot carry the Hebrew preset.
         *
         * From their data when the key allows it. Otherwise from what the sync script
         * recorded — stated as a warning on every other option rather than pretending to
         * know, because being wrong in the permissive direction is what produced the failure.
         */
        const avoid = {}
        for (const id of out.options ?? []) {
          if (hebrew?.source === 'api') {
            if (hebrew.supports[id] === false) avoid[id] = 'לא תומך בעברית — יפיל את הפריסט'
          } else if (id !== 'eleven_v3_conversational') {
            avoid[id] = 'ייתכן שלא תומך בעברית'
          }
        }
        return {
          ...out,
          avoid,
          note:
            hebrew?.source === 'api'
              ? 'תמיכת השפות נקראת מ-/v1/models'
              : 'הרשאת models_read חסרה למפתח, אז תמיכת השפות לא נבדקה — רק eleven_v3_conversational ידוע כתומך בעברית',
        }
      }),
    )

    res.json({
      fields,
      values,
      overridden: Object.keys(overrides),
      voices: await voices(key),
      live: {
        direct: await liveAgent(key, process.env.ELEVENLABS_AGENT_ID),
        hybrid: await liveAgent(key, process.env.ELEVENLABS_HYBRID_AGENT_ID),
      },
      note: 'החלה מריצה את אותו סקריפט ש-npm run sync:agent מריץ, ושומרת גיבוי של הקונפיג הקודם.',
    })
  })

  app.post('/api/elevenlabs/config', (req, res) => {
    for (const [k, v] of Object.entries(req.body ?? {})) {
      if (!KEYS.has(k)) continue
      // An emptied field means "stop overriding", not "send an empty string" — otherwise
      // clearing a box would push a blank voice id to their platform.
      if (v === '' || v == null) delete overrides[k]
      else overrides[k] = String(v)
    }
    res.json({ overrides })
  })

  app.post('/api/elevenlabs/apply', (req, res) => {
    for (const [k, v] of Object.entries(req.body ?? {})) {
      if (!KEYS.has(k)) continue
      if (v === '' || v == null) delete overrides[k]
      else overrides[k] = String(v)
    }

    const child = spawn(process.execPath, ['scripts/sync-elevenlabs-agent.js'], {
      env: { ...process.env, ...overrides },
      cwd: process.cwd(),
    })

    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('close', (code) => {
      // The script's own output, verbatim. It names both agents, the tool split and where
      // the backup went — inventing a friendlier summary would hide the half that matters.
      res.json({ ok: code === 0, code, output: out.trim(), overrides })
    })
    child.on('error', (err) => res.status(500).json({ error: err.message }))
  })
}

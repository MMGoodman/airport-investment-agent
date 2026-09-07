/**
 * The OpenAI paths' own settings — the ones that are not turn detection.
 *
 * WHY THERE ARE FEWER OF THEM THAN ELEVENLABS HAS, AND WHY THAT IS NOT A GAP
 *
 * Most of what the ElevenLabs pane offers has no counterpart here, because there is nothing
 * to offer it FOR. That path is a cascade: a transcriber, then a language model, then a
 * voice model, three products chosen separately and wired in series. This one is a single
 * model that takes audio and returns audio. There is no LLM to swap, no text-to-speech
 * stage to pick, and no separate voice engine — asking which LLM gpt-realtime uses is
 * asking which engine a car's engine uses.
 *
 * WHAT IS GENUINELY HERE, AND WAS NOT REACHABLE
 *
 * Three things, all of them real choices and all of them env-only until now: which realtime
 * model, which voice, and which transcription model.
 *
 * THE TRANSCRIPTION MODEL IS THE INTERESTING ONE
 *
 * On the cascade, the transcript IS the model's input — what breaks in it breaks the answer.
 * Here it is not. The model hears the audio; the transcript is produced ALONGSIDE, for the
 * screen. So changing it changes what you READ and not what the agent understands.
 *
 * That distinction is not academic. One session transcribed "לוס אנג'לס" and the model
 * answered about Nashville, having heard something else entirely from the same audio — a
 * trace that looks like the model ignoring a correct transcript, and is nothing of the kind.
 * The pane says so where the field is, because that is where somebody would otherwise draw
 * the wrong conclusion.
 */

const OPENAI = 'https://api.openai.com/v1'

/** Asked once per process. Model lists move on their release schedule, not on ours. */
const cache = new Map()

/**
 * Which realtime and transcription models this key can see.
 *
 * A real list endpoint, unlike ElevenLabs — no probing needed for these two.
 */
async function models(key) {
  if (cache.has('models')) return cache.get('models')
  let out = { realtime: [], transcribe: [] }
  try {
    const res = await fetch(`${OPENAI}/models`, { headers: { Authorization: `Bearer ${key}` } })
    if (res.ok) {
      const ids = ((await res.json()).data ?? []).map((m) => m.id)
      out = {
        realtime: ids.filter((i) => /realtime/.test(i) && !/whisper/.test(i)).sort(),
        // whisper-1 is still offered and still works; the gpt-4o ones are newer and better
        // at Hebrew, which is the only reason this list is worth seeing.
        transcribe: ids.filter((i) => /transcribe|whisper/.test(i)).sort(),
      }
    }
  } catch {
    /* an unreachable list is not a reason to fail the pane */
  }
  cache.set('models', out)
  return out
}

/**
 * The voices, from the refusal.
 *
 * There is no endpoint that lists them, but minting a session with one that cannot exist
 * names every one that can. The mint is rejected, so no session is created and nothing is
 * spent.
 */
async function voices(key) {
  if (cache.has('voices')) return cache.get('voices')
  let list = []
  try {
    const res = await fetch(`${OPENAI}/realtime/client_secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
          audio: { output: { voice: '__probe_for_supported_voices__' } },
        },
      }),
    })
    const body = await res.json()
    const m = String(body?.error?.message ?? '').match(/Supported values are:(.+)/)
    if (m) {
      list = m[1]
        .split(/,|\band\b/)
        .map((v) => v.trim().replace(/^'|'|\.$/g, '').replace(/'/g, ''))
        .filter(Boolean)
    }
  } catch {
    /* same */
  }
  cache.set('voices', list)
  return list
}

export function mountOpenAIConfigRoutes(app) {
  app.get('/api/openai/config', async (_req, res) => {
    const key = process.env.OPENAI_API_KEY
    if (!key) return res.status(400).json({ error: 'OPENAI_API_KEY is not set' })

    const [m, v] = await Promise.all([models(key), voices(key)])
    res.json({
      models: m,
      voices: v,
      /**
       * The values a session is minted with right now.
       *
       * Read from the same env the builder reads, not from a copy — there is no override
       * store here on purpose. These reach a session as query parameters, exactly like the
       * turn-detection settings beside them, so a change takes effect on the next call and
       * nothing is left holding state that the next mint would ignore.
       */
      current: {
        model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
        voice: process.env.OPENAI_REALTIME_VOICE || 'marin',
        voiceHe: process.env.OPENAI_REALTIME_VOICE_HE || '',
        transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe',
      },
      note: 'משתנה בשיחה הבאה, לא בזו שרצה — ההגדרות נשלחות עם הבקשה שמנפיקה את הסשן.',
    })
  })
}

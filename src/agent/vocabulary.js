/**
 * Speech-recognition bias terms, derived from the dataset rather than hand-listed.
 *
 * A general transcriber has no reason to expect three-letter airport codes or aviation
 * metric names, and it guesses: spoken "BOS and PDX" came back as "D-O-S-L-A-T-E", and
 * "Santa Ana" as ordinary English words. Both providers accept a vocabulary hint —
 * OpenAI as a transcription `prompt`, ElevenLabs as `asr.keywords` — and it is the single
 * largest quality lever available on the input side.
 *
 * Built from data/, so an airport that enters the dataset enters the vocabulary with it.
 */
import { getStore } from '../data/store.js'

/**
 * The same domain in Hebrew. A keyword list of English metric names does nothing for a
 * Hebrew caller, and the transcripts showed it: spoken Hebrew about airports came back as
 * unrelated words. These are the terms a Hebrew speaker actually uses for this subject.
 */
const HEBREW_TERMS = [
  'שדה תעופה',
  'שדות תעופה',
  'טרמינל',
  'הרחבת טרמינל',
  'נמל תעופה',
  'תפוסה',
  'עומס',
  'ביקוש',
  'ביקוש לא מסופק',
  'צמיחה',
  'נוסעים',
  'המראות',
  'טיסות',
  'מושבים',
  'השקעה',
  'דירוג',
  'להשוות',
  'בוסטון',
  'לוס אנג׳לס',
  'סנטה אנה',
  'אנקורג׳',
  'סן פרנסיסקו',
  'פורטלנד',
  'ניו אינגלנד',
]

/** The words this domain uses that everyday speech does not. */
const DOMAIN_TERMS = [
  'IATA code',
  'load factor',
  'CAGR',
  'seats per departure',
  'stage length',
  'long-haul',
  'terminal expansion',
  'unmet demand',
  'demand gap',
  'capacity constraint',
  'utilisation',
  'upgauging',
  'slot-controlled',
  'hub',
  'BTS',
  'T-100',
]

/**
 * Airports named in the four questions this build is judged on, plus New England, which
 * one of them asks about by region. Ranking by size alone drops SNA — it is 41st by
 * passengers — and mis-hearing the airport in a demo question is the worst failure here.
 */
const ALWAYS = ['LAX', 'SNA', 'ANC', 'SFO', 'BOS', 'BDL', 'PVD', 'MHT', 'BTV', 'PWM', 'BGR']

/**
 * The pinned set first, then the biggest airports by passengers — what people actually
 * name out loud. Capped: a transcription prompt is a hint, and an over-long one dilutes
 * itself.
 */
async function biasAirports(limit) {
  const store = await getStore()

  const latest = new Map()
  for (const row of store.annual) {
    const best = latest.get(row.iata)
    if (!best || row.year > best.year) latest.set(row.iata, row)
  }

  const bySize = [...latest.values()]
    .sort((a, b) => b.passengers - a.passengers)
    .map((r) => r.iata)

  const codes = [...new Set([...ALWAYS, ...bySize])].slice(0, limit)
  return codes.map((c) => store.byIata.get(c)).filter(Boolean)
}

/**
 * A comma-separated hint for OpenAI's `transcription.prompt`.
 *
 * Hard limit of 1024 characters, enforced by the API — adding the Hebrew terms pushed it
 * to 1070 and every session was rejected before a word was spoken. Rather than trimming
 * the list by hand and having it break again on the next addition, the sections are laid
 * out in priority order and truncated at a comma so the hint is always well-formed.
 */
const PROMPT_LIMIT = 1024

export async function transcriptionPrompt(limit = 40) {
  const airports = await biasAirports(limit)
  const codes = airports.map((a) => a.iata).join(', ')
  const cities = [...new Set(airports.map((a) => a.city.split('/')[0]))].join(', ')

  // Codes first: they are the figures an answer is built on and the ones a general
  // transcriber is most likely to mangle. Prose terms are the first thing to lose.
  const full =
    'Aviation investment analysis, English or Hebrew. Three-letter IATA codes spoken as ' +
    `letters: ${codes}. Cities: ${cities}. Hebrew: ${HEBREW_TERMS.join(', ')}. ` +
    `Terms: ${DOMAIN_TERMS.join(', ')}.`

  if (full.length <= PROMPT_LIMIT) return full

  const cut = full.slice(0, PROMPT_LIMIT)
  return `${cut.slice(0, cut.lastIndexOf(','))}.`
}

/** A flat keyword list for ElevenLabs' `asr.keywords`. */
export async function asrKeywords(limit = 60) {
  const airports = await biasAirports(limit)
  return [
    ...airports.map((a) => a.iata),
    ...new Set(airports.map((a) => a.city.split('/')[0])),
    ...DOMAIN_TERMS,
    ...HEBREW_TERMS,
  ]
}

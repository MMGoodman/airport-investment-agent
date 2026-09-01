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
 * What each airport is called out loud in Hebrew.
 *
 * One table, three consumers, and they have to agree or the loop breaks in a way that
 * looks like a transcription fault:
 *   - the ASR keyword list below, so the transcriber expects the word
 *   - the agent, which is told to use these names rather than invent one
 *   - eval, whose airport aliases were built from the English dataset only, so a correct
 *     Hebrew answer failed a check that was looking for "Boston Logan"
 *
 * The failure that produced this table: the agent spelled the IATA code BGR into Hebrew
 * letters as "בגר" — neither the code nor the city, and unreadable as either.
 */
export const HEBREW_AIRPORT_NAMES = {
  BOS: 'בוסטון לוגן',
  BGR: 'בנגור',
  PWM: 'פורטלנד',
  BDL: 'הרטפורד',
  PVD: 'פרובידנס',
  MHT: 'מנצ׳סטר',
  BTV: 'ברלינגטון',
  HVN: 'ניו הייבן',
  LAX: 'לוס אנג׳לס',
  SNA: 'סנטה אנה',
  ANC: 'אנקורג׳',
  SFO: 'סן פרנסיסקו',
  PDX: 'פורטלנד',
  JFK: 'ג׳ון קנדי',
  LGA: 'לה גוארדיה',
}

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
  'מקדם תפוסה',
  'ניצולת',
  'עומס',
  'ביקוש',
  'ביקוש לא מסופק',
  'פער ביקוש',
  'מגבלת קיבולת',
  'צמיחה',
  'נוסעים',
  'המראות',
  'טיסות',
  'מושבים',
  'מושבים להמראה',
  'קבוצת ההשוואה',
  'הסתייגויות',
  'השקעה',
  'דירוג',
  'להשוות',
  // The words the agent itself says. A caller repeats the term they just heard, so the
  // glossary in prompt.js and this list have to name the same things: a metric the agent
  // introduces in Hebrew that the transcriber was never told to expect comes back mangled
  // on the next turn, and the mangling reads as the caller's fault rather than ours.
  'מזג אוויר',
  'טמפרטורה',
  'רוח',
  'משבי רוח',
  'ראות',
  'ערפל',
  'בהיר',
  'מעונן',
  'גשם',
  'ניו אינגלנד',
  'בוסטון',
  // The rest of the place names come from the table above rather than being listed twice.
  // BGR was in the pinned code list and not in this one, so the agent named Bangor out loud
  // and could not hear it said back — one session recorded it as "מנהיג בם".
  ...new Set(Object.values(HEBREW_AIRPORT_NAMES)),
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

export async function transcriptionPrompt(lang = 'he', limit = 40) {
  const airports = await biasAirports(limit)
  const codes = airports.map((a) => a.iata).join(', ')
  const cities = [...new Set(airports.map((a) => a.city.split('/')[0]))].join(', ')

  /**
   * The session's own language goes ahead of the other one.
   *
   * Both lists together no longer fit under the cap, so one of them is always truncated —
   * and with a fixed order it was always the same one. Adding the Hebrew weather and
   * New England terms pushed the hint to 1014 characters and silently took "load factor",
   * "CAGR" and "T-100" out of every session, English ones included. Which list can afford
   * to be cut is a property of the call, not of this file.
   */
  const bySession = lang === 'he' ? [HEBREW_TERMS, DOMAIN_TERMS] : [DOMAIN_TERMS, HEBREW_TERMS]

  // A bare vocabulary list, deliberately not sentences.
  //
  // The first version read like prose — "Aviation investment analysis. Three-letter IATA
  // codes spoken as letters: ... Terms: load factor, CAGR ..." — and a transcriber given
  // unclear audio continued it. One session recorded a fluent Hebrew paragraph about LAX
  // congestion and CAGR that the caller never said, assembled entirely out of the words in
  // this hint. A biasing prompt is a prior, and a prior stated as fluent text invites more
  // fluent text.
  //
  // Comma-separated terms with no verbs and no framing keep the bias without giving the
  // model a sentence to finish. Codes first: they are what an answer is built on and what
  // a general transcriber most often mangles.
  const full = [codes, cities, ...bySession.map((terms) => terms.join(', '))].join(', ')

  if (full.length <= PROMPT_LIMIT) return full

  const cut = full.slice(0, PROMPT_LIMIT)
  return `${cut.slice(0, cut.lastIndexOf(','))}.`
}

/**
 * A flat keyword list for ElevenLabs' `asr.keywords`.
 *
 * Hebrew ahead of the English terms, unlike the sentence above. This list is pushed once
 * at sync time and is not per-language — the platform takes one `asr` block for the agent,
 * whatever preset a session runs under — so its order has to favour the language this
 * deployment actually opens in, and DEFAULT_LANG here is Hebrew. If the list is ever capped
 * on their side, the terms that survive should be the ones being spoken.
 */
export async function asrKeywords(limit = 60) {
  const airports = await biasAirports(limit)
  return [
    ...airports.map((a) => a.iata),
    ...new Set(airports.map((a) => a.city.split('/')[0])),
    ...HEBREW_TERMS,
    ...DOMAIN_TERMS,
  ]
}

/**
 * How many of the hint's own terms a transcript repeats.
 *
 * The vocabulary hint is a prior, and on a stretch of near-silence a transcriber given a
 * prior and nothing to describe can emit the prior itself. One session recorded every IATA
 * code and every Hebrew term in list order as a caller's utterance — the hint, read back.
 *
 * Nobody says ten domain terms in one breath, so the count separates the phantom from real
 * speech cleanly: a genuine question about Boston's load factor hits two or three.
 */
export async function hintTermsEchoed(transcript, lang = 'he') {
  if (!transcript || transcript.length < 60) return 0
  const hint = await transcriptionPrompt(lang)
  const terms = hint
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 2)
  const text = transcript.toLowerCase()
  return new Set(terms.filter((t) => text.includes(t.toLowerCase()))).size
}

/** Above this, the transcript is the hint talking, not the caller. */
export const PHANTOM_TERM_THRESHOLD = 10

/**
 * The same test, against a term list already in hand.
 *
 * hintTermsEchoed above re-reads the hint every call, which is fine for a script and wrong
 * on a live transcript event. Both live transports are handed the hint's terms when their
 * session is built, so they can ask this directly.
 *
 * It lives here because it existed twice — once inside the WebRTC transport's closure and
 * not at all on the relay, which is how a caller on the relay was shown forty domain terms
 * in list order as something they had said. One copy, both paths.
 */
export function isHintEcho(text, terms = []) {
  if (!text || terms.length === 0 || text.length < 60) return false
  const lower = text.toLowerCase()
  let hits = 0
  for (const term of terms) {
    if (lower.includes(term.toLowerCase()) && ++hits >= PHANTOM_TERM_THRESHOLD) return true
  }
  return false
}

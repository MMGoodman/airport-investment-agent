/**
 * The phantom transcript.
 *
 * The transcriber is given the domain vocabulary as a prior. Handed a prior and a stretch
 * of near-silence to describe, it can emit the prior itself — and it did: a relayed session
 * showed all forty terms in list order, ending in "לוס אנג׳לס", attributed to a caller who
 * had said one word. It was shown as their turn and appended to the conversation.
 *
 * The guard existed inside the WebRTC transport's closure and nowhere else, so the relay had
 * none. These tests pin the shared version against the real transcript that got through, and
 * against the term-heavy questions it must not swallow — a guard that eats real questions is
 * worse than the phantom it was added for.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { transcriptionPrompt } from '../vocabulary.js'
import { isHintEcho, PHANTOM_TERM_THRESHOLD } from '../phantom.js'

let terms = []
beforeAll(async () => {
  terms = (await transcriptionPrompt('he'))
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 2)
})

// Verbatim from the trace that exposed the gap.
const PHANTOM =
  'שדה תעופה, שדות תעופה, טרמינל, הרחבת טרמינל, נמל תעופה, תפוסה, מקדם תפוסה, ניצולת, ' +
  'עומס, ביקוש, ביקוש לא מסופק, פער ביקוש, מגבלת קיבולת, צמיחה, נוסעים, המראות, טיסות, ' +
  'מושבים, מושבים להמראה, קבוצת ההשוואה, הסתייגויות, השקעה, דירוג, להשוות, מזג אוויר, ' +
  'טמפרטורה, רוח, משבי רוח, ראות, ערפל, בהיר, מעונן, גשם, ניו אינגלנד, בוסטון, בוסטון לוגן, ' +
  'בנגור, פורטלנד, הרטפורד, פרובידנס, מנצ׳סטר, ברלינגטון, ניו הייבן, לוס אנג׳לס.'

describe('phantom transcripts', () => {
  it('catches the hint read back', () => {
    expect(isHintEcho(PHANTOM, terms)).toBe(true)
  })

  it('lets a real question through, however many terms it uses', () => {
    // Deliberately term-heavy, and longer than the length floor, so only the count decides.
    const asked =
      'מה מקדם התפוסה והניצולת והעומס בבוסטון לוגן לעומת פרובידנס, ומה פער הביקוש שם?'
    expect(asked.length).toBeGreaterThan(60)
    expect(isHintEcho(asked, terms)).toBe(false)
  })

  it('lets a short answer through untouched', () => {
    expect(isHintEcho('מנצ׳סטר.', terms)).toBe(false)
  })

  it('catches a SHORT echo, which the count rule alone let through', () => {
    // Verbatim from a later trace. Six terms — under the threshold of ten — and it entered
    // the conversation as something the caller had said.
    const short = 'מנצ׳סטר, ניו הייבן, לוס אנג׳לס, שדה תעופה, שדות תעופה, טרמינל.'
    expect(isHintEcho(short, terms)).toBe(true)
  })

  it('keeps a two-term answer, which is an ordinary comparison', () => {
    // The density rule has to stop somewhere above this, or "compare these two" is dropped.
    expect(isHintEcho('בוסטון ופורטלנד', terms)).toBe(false)
  })

  it('keeps a question that is mostly terms but has a question in it', () => {
    expect(isHintEcho('תשווה לי בין שדה התעופה של בוסטון לשדה התעופה של פורטלנד.', terms)).toBe(false)
  })

  it('does nothing when the vocabulary bias is off', () => {
    // With no hint sent there is no prior to read back, and nothing to drop.
    expect(isHintEcho(PHANTOM, [])).toBe(false)
  })

  it('needs the count, not one match short of it', () => {
    /**
     * Padded with WORDS, not punctuation.
     *
     * It used to pad with sixty dots, which the density rule strips as separators — leaving
     * nine terms and nothing else, which that rule then correctly called an echo. The old
     * padding made the case indistinguishable from the thing being caught. Real filler
     * dilutes the density, so the count is once again the only rule under test.
     */
    const pad = ` ${'אולי בבקשה '.repeat(12)}`
    const under = terms.slice(0, PHANTOM_TERM_THRESHOLD - 1).join(' ') + pad
    const over = terms.slice(0, PHANTOM_TERM_THRESHOLD).join(' ') + pad
    expect(under.length).toBeGreaterThan(60)
    expect(isHintEcho(under, terms)).toBe(false)
    expect(isHintEcho(over, terms)).toBe(true)
  })
})

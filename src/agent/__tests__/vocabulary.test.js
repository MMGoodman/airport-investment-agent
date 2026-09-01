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

  it('does nothing when the vocabulary bias is off', () => {
    // With no hint sent there is no prior to read back, and nothing to drop.
    expect(isHintEcho(PHANTOM, [])).toBe(false)
  })

  it('needs the count, not one match short of it', () => {
    // Padded past the length floor with characters no term can match, so the count is the
    // only thing under test. One term either side of the threshold, nothing else changed.
    const pad = ` ${'.'.repeat(60)}`
    const under = terms.slice(0, PHANTOM_TERM_THRESHOLD - 1).join(' ') + pad
    const over = terms.slice(0, PHANTOM_TERM_THRESHOLD).join(' ') + pad
    expect(under.length).toBeGreaterThan(60)
    expect(isHintEcho(under, terms)).toBe(false)
    expect(isHintEcho(over, terms)).toBe(true)
  })
})

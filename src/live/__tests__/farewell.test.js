/**
 * The gate that decides whether end_call actually hangs up.
 *
 * Every "should not end" case here is a real transcript from a live session or from
 * probe-hangup. The first one ended a call in front of someone.
 */
import { describe, it, expect } from 'vitest'
import { isFarewell } from '../farewell.js'

describe('isFarewell', () => {
  it('does not end a call on thanks, however final it sounds', () => {
    // Measured at 16/24 across eight samples of each: the prompt rule is present and losing.
    // This is the case that cut a call off mid-demo.
    expect(isFarewell('אוקיי, תודה רבה.')).toBe(false)
    expect(isFarewell('אה, תודה רבה.')).toBe(false)
    expect(isFarewell('אוקיי, מגניב. אממ, טוב, תודה רבה לך.')).toBe(false)
    expect(isFarewell('תודה רבה.')).toBe(false)
  })

  it('does not end a call on an acknowledgement or a fragment', () => {
    expect(isFarewell('אוקיי.')).toBe(false)
    expect(isFarewell('שדה תעופה.')).toBe(false)
    expect(isFarewell('')).toBe(false)
    expect(isFarewell(null)).toBe(false)
  })

  it('ends a call on an explicit goodbye', () => {
    expect(isFarewell('ביי, להתראות.')).toBe(true)
    expect(isFarewell('סיימתי, תודה. אפשר לנתק.')).toBe(true)
    expect(isFarewell('להתראות')).toBe(true)
  })

  it('reads an English goodbye too, for a call switched mid-session', () => {
    expect(isFarewell('Okay, bye!')).toBe(true)
    expect(isFarewell("That's all, thanks")).toBe(true)
    expect(isFarewell('thanks a lot')).toBe(false)
  })

  it('is not fooled by punctuation the transcriber may or may not add', () => {
    expect(isFarewell('ביי')).toBe(true)
    expect(isFarewell('ביי.')).toBe(true)
    expect(isFarewell('ביי!')).toBe(true)
  })
})

/**
 * The prompt's promise and the gate's list, held against each other.
 *
 * These are two lists in two files that must agree, and only one of them can act. The
 * end_call description says "Explicit means בי, להתראות, סיימתי, אפשר לסיים" and the
 * call-control skill repeats it; farewell.js decides whether the line actually closes. It
 * held four of those five.
 *
 * Measured in a live call: the caller asked to end it, the model called end_call correctly,
 * the gate declined because `אפשר לסיים` was not in its list, and the agent said "ניתוק
 * כעת" over a line that stayed open. Twice in ninety seconds.
 *
 * A drift with no symptom except a caller who cannot hang up is exactly the kind this test
 * exists to make loud.
 */
describe('the gate accepts what the prompt promises', () => {
  it('ends the call on every phrase end_call and call-control call explicit', async () => {
    const { toolSchemas } = await import('../../agent/tools.js')
    const { skillsSummary } = await import('../../agent/skills.js')
    const promised = ['ביי', 'להתראות', 'סיימתי', 'אפשר לסיים', 'תנתק']

    const description = toolSchemas.find((t) => t.name === 'end_call').description
    const skill = skillsSummary().find((s) => s.id === 'call-control').instructions
    // If a phrase leaves the prompt, this test should be updated with it — not silently pass.
    for (const phrase of promised) {
      expect(description.includes(phrase) || skill.includes(phrase), `prompt still promises ${phrase}`).toBe(true)
      expect(isFarewell(phrase), `gate accepts ${phrase}`).toBe(true)
    }
  })

  it('ends on the plain ways a Hebrew speaker asks', () => {
    for (const phrase of ['סיים את השיחה', 'תסיים את השיחה', 'אפשר לנתק']) {
      expect(isFarewell(phrase), phrase).toBe(true)
    }
  })

  /**
   * The other direction, and the more expensive one.
   *
   * A bare `סיים` was in this list for one commit because it rescued a garbled transcript.
   * It also matched "אני רוצה לסיים את הבדיקה" — somebody finishing a task and staying on
   * the line. Ending a call nobody ended is worse than failing to end one they did.
   */
  it('stays on the line for finishing a task, or for thanks', () => {
    for (const phrase of [
      'תודה',
      'תודה רבה',
      'אוקיי',
      'אני רוצה לסיים את הבדיקה של הדירוג',
      'בוא נסיים עם בוסטון ונעבור ל-JFK',
    ]) {
      expect(isFarewell(phrase), phrase).toBe(false)
    }
  })
})

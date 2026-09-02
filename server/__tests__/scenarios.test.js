/**
 * Capturing an eval case from a real turn.
 *
 * The extraction is the whole value here: what it suggests is what a person will keep, and
 * a wrong suggestion kept without noticing becomes a test that enshrines a bug. These pin
 * the cases where it would have got it wrong.
 */
import { describe, it, expect } from 'vitest'
import { draftFromTurn, exportCases } from '../scenarios.js'

const turn = {
  ask: 'Compare LAX and SNA congestion levels.',
  reply:
    'LAX carried 36,766,912 passengers on 273,911 departures in 2025, load factor 81.6%. SNA sits at 79.7% on 5,532 departures. Ranked 34 of 158.',
  toolCalls: [{ tool: 'compare_airports', args: { iataList: ['LAX', 'SNA'] } }],
  lang: 'en',
}

describe('draftFromTurn', () => {
  it('takes the tools and their arguments from what actually ran', () => {
    const draft = draftFromTurn(turn)
    expect(draft.expectTools).toEqual(['compare_airports'])
    expect(draft.expectArgs).toEqual({ iataList: ['LAX', 'SNA'] })
  })

  it('keeps a grouped number whole', () => {
    // 36,766,912 used to match as "36,766" and then "912" — two assertions on halves of a
    // number the answer never split, either of which would pass on the wrong reply.
    const draft = draftFromTurn(turn)
    expect(draft.mustMentionOneOf).toContain('36,766,912')
    expect(draft.mustMentionOneOf).not.toContain('912')
  })

  it('leaves out the one- and two-digit numbers', () => {
    // "34 of 158" — 34 is a rank here and a list marker in the next answer. A wrong
    // assertion costs more than a missing one.
    const draft = draftFromTurn(turn)
    expect(draft.mustMentionOneOf).not.toContain('34')
    expect(draft.mustMentionOneOf).toContain('158')
  })

  it('keeps percentages whatever their length', () => {
    const draft = draftFromTurn(turn)
    expect(draft.mustMentionOneOf).toContain('81.6%')
    expect(draft.mustMentionOneOf).toContain('79.7%')
  })

  it('names the case after the question, not a counter', () => {
    expect(draftFromTurn(turn).id).toBe('compare-lax-and-sna')
  })

  it('falls back to a counter when the question leaves no latin', () => {
    const draft = draftFromTurn({ ...turn, ask: 'מה מזג האוויר בבוסטון?', lang: 'he' })
    expect(draft.id).toMatch(/^he-capture-\d+$/)
    expect(draft.ask).toBe('מה מזג האוויר בבוסטון?')
    expect(draft.mustReplyInHebrew).toBe(true)
  })

  it('files a turn with no tool call under scope', () => {
    // No tool ran means the agent declined, and declining is what the scope group tests.
    const draft = draftFromTurn({ ...turn, toolCalls: [] })
    expect(draft.group).toBe('scope')
    expect(draft.expectTools).toBeUndefined()
  })

  it('refuses a turn with no question', () => {
    expect(() => draftFromTurn({ reply: 'anything' })).toThrow(/question/)
  })

  it('exports source without the review-only field', () => {
    const source = exportCases([draftFromTurn(turn)])
    expect(source).not.toContain('_capturedReply')
    expect(source).toContain('compare_airports')
    // The header is the warning, and it travels with the code rather than staying in the UI.
    expect(source).toMatch(/what the agent DID/)
  })
})

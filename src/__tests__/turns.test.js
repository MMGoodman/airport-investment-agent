/**
 * What the tagger sees when it reads the conversation on screen.
 *
 * The shape matters more than it looks: a turn is a question AND its answer, and the pairing
 * is done by position rather than by an id. Anything that breaks the pairing tags the wrong
 * words — which is the same class of mistake as attaching a tool call to the wrong answer,
 * and that one took a live trace to notice.
 */
import { describe, it, expect } from 'vitest'
import { turnsFrom } from '../turns.js'

describe('turnsFrom', () => {
  it('pairs each answer with the question above it', () => {
    const turns = turnsFrom([
      { role: 'user', content: 'איזה שדות מועמדים חזקים?' },
      { role: 'assistant', content: 'JFK מוביל.', toolCalls: [{ tool: 'rank_airports' }], ms: 9300 },
      { role: 'user', content: 'ומה מזג האוויר שם?' },
      { role: 'assistant', content: 'יורד גשם קל.', toolCalls: [], ms: 3635 },
    ])

    expect(turns).toHaveLength(2)
    expect(turns[0].ask).toBe('איזה שדות מועמדים חזקים?')
    expect(turns[0].reply).toBe('JFK מוביל.')
    expect(turns[0].toolCalls).toHaveLength(1)
    expect(turns[0].ms).toBe(9300)
    expect(turns[1].ask).toBe('ומה מזג האוויר שם?')
  })

  it('skips the greeting, which nobody asked for', () => {
    // Every live session opens with the agent speaking first. Grading that against a question
    // that does not exist would tag the opening line on every call, in every session.
    const turns = turnsFrom([
      { role: 'assistant', content: 'סוכן השקעות בשדות תעופה, בשידור חי.' },
      { role: 'user', content: 'שלום' },
      { role: 'assistant', content: 'במה אפשר לעזור?' },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0].ask).toBe('שלום')
  })

  it('skips an answer the agent volunteered after its own', () => {
    // ElevenLabs re-engages after a silence, which puts two assistant messages in a row. The
    // second was not a reply to anything.
    const turns = turnsFrom([
      { role: 'user', content: 'תודה' },
      { role: 'assistant', content: 'בבקשה.' },
      { role: 'assistant', content: 'האם תרצה שאפרט על שדה תעופה נוסף?' },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0].reply).toBe('בבקשה.')
  })

  it('defaults an answer with no recorded calls to an empty list, not undefined', () => {
    // Every predicate reads toolCalls. One undefined turn would throw mid-run and take the
    // whole conversation's tags with it.
    const [turn] = turnsFrom([
      { role: 'user', content: 'כמה שדות תעופה יש?' },
      { role: 'assistant', content: 'שישה עשר.' },
    ])
    expect(turn.toolCalls).toEqual([])
  })

  it('returns nothing for an empty conversation', () => {
    expect(turnsFrom([])).toEqual([])
    expect(turnsFrom()).toEqual([])
  })
})

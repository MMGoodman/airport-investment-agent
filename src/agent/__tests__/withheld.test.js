/**
 * What the model is told about a tool this transport cannot offer.
 *
 * The failure being pinned came from a live call. Asked for the weather in San Juan on the
 * ElevenLabs line — where get_airport_weather is withheld because that platform runs every
 * tool in the browser and has no sideband — the agent called get_airport_profile instead,
 * then said weather was outside its remit. Both halves are wrong: the tool it called cannot
 * answer the question, and weather is not outside its remit at all. One switch away, on the
 * relayed line, it answers in a single call.
 *
 * A caller told "that is not what I do" stops asking. That is the expensive kind of wrong,
 * and it happened because this note existed for the OpenAI paths and nothing sent it here.
 */
import { describe, it, expect } from 'vitest'
import { withheldNote, OPENAI_REMEDY, ELEVENLABS_REMEDY } from '../prompt.js'

describe('withheldNote', () => {
  it('says nothing when nothing is withheld', () => {
    // Every transport calls this; most sessions withhold nothing and must not carry a
    // paragraph about tools that were never missing.
    expect(withheldNote([])).toBe('')
  })

  it('names the tools rather than describing them vaguely', () => {
    const note = withheldNote(['get_airport_weather', 'search_knowledge'])
    expect(note).toContain('get_airport_weather')
    expect(note).toContain('search_knowledge')
  })

  it('agrees with itself about how many tools there are', () => {
    // "get_airport_weather are not offered" reads as a mistake and undermines the sentence
    // it appears in, which is the one sentence here the caller actually hears repeated.
    expect(withheldNote(['get_airport_weather'])).toContain('get_airport_weather is not offered')
    expect(withheldNote(['a', 'b'])).toContain('a, b are not offered')
  })

  it('offers the way out that exists on this transport', () => {
    // OpenAI can relay the same session; ElevenLabs cannot, and telling a caller to flip a
    // switch that will not help them is worse than telling them nothing.
    const openai = withheldNote(['get_airport_weather'], OPENAI_REMEDY)
    expect(openai).toContain('via your server')

    const eleven = withheldNote(['get_airport_weather'], ELEVENLABS_REMEDY)
    expect(eleven).toContain('There is no setting on this platform')
  })

  it('forbids the answer that actually got given: "outside my remit"', () => {
    for (const remedy of [OPENAI_REMEDY, ELEVENLABS_REMEDY]) {
      const note = withheldNote(['get_airport_weather'], remedy)
      expect(note, 'the note must rule out calling the subject out of scope').toMatch(
        /do not say the\s+subject is outside what you do/,
      )
    }
  })

  it('forbids substituting a different tool, which is what it reached for', () => {
    expect(withheldNote(['get_airport_weather'])).toContain('do not substitute figures from a different tool')
  })
})

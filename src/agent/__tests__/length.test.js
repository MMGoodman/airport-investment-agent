/**
 * The two paths disagree about how long an answer should be, and only one of them may say so.
 *
 * "Two or three short paragraphs" ended SYSTEM_PROMPT, so a voice session was handed that and
 * then, a few hundred characters later, the voice addendum's "two or three sentences". A
 * contradiction is not a stricter rule — it is permission to pick the easier one, and a weak
 * model picks the longer. On a cascade nothing is spoken until generation finishes: one
 * three-airport answer cost 15.7s to generate and 15.1s to synthesise.
 */
import { describe, it, expect } from 'vitest'
import { SYSTEM_PROMPT, VOICE_ADDENDUM, TEXT_LENGTH, languageInstruction } from '../prompt.js'

describe('how long an answer should be', () => {
  it('is not stated in the prompt both paths share', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/paragraphs/i)
  })

  it('asks a voice caller for sentences, and never for paragraphs', () => {
    const spoken = SYSTEM_PROMPT + VOICE_ADDENDUM + languageInstruction('he', true)
    expect(spoken).toMatch(/Two or three sentences/)
    // The specific regression: the spoken prompt must not carry the text-length rule at all.
    expect(spoken, 'a spoken prompt asking for paragraphs contradicts itself').not.toMatch(
      /short paragraphs/,
    )
  })

  it('still asks a reader for paragraphs, where they are right', () => {
    // Reading takes a fraction of the time hearing does. Dropping the rule from the base was
    // about where it travels, not about wanting shorter text answers.
    expect(SYSTEM_PROMPT + TEXT_LENGTH).toMatch(/Two or three short paragraphs/)
  })
})

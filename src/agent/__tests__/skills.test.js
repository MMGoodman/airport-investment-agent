/**
 * Base plus extensions, and the arithmetic that makes it worth doing.
 *
 * The instructions went from 8,468 characters to 18,237 in a day, and by the end three rules
 * added that same day were all present in the live prompt and all violated in one call. The
 * point of splitting is that a turn carries only what applies to it — so these check that the
 * base actually shrank, that nothing was lost, and that a rule lives in exactly one place.
 */
import { describe, it, expect } from 'vitest'
import { SKILLS, ALL_SKILLS, skillForTool, skillsFor, skillsSummary } from '../skills.js'
import { SYSTEM_PROMPT, VOICE_ADDENDUM, languageInstruction } from '../prompt.js'
import { toolSchemas } from '../tools.js'

const base = SYSTEM_PROMPT + VOICE_ADDENDUM + languageInstruction('he', true)

describe('the split', () => {
  it('leaves a base smaller than the block it replaced', () => {
    // 18,237 was the single block on the day this was written.
    expect(base.length).toBeLessThan(18237 * 0.85)
  })

  it('does not leave a moved rule in both places', () => {
    // A rule in the base AND in a skill is worse than one in neither: it is loaded twice
    // and edited in one.
    for (const marker of [
      'A RANK CARRIES NO SIGN',
      'PEER SETS ARE NOT INTERCHANGEABLE',
      'WEATHER IS A LOOKUP',
      'ENDING THE CALL',
    ]) {
      expect(base, `"${marker}" is still in the base`).not.toContain(marker)
      expect(SKILLS.some((s) => s.instructions.includes(marker))).toBe(true)
    }
  })

  it('tells the model that rules will arrive rather than leaving a hole', () => {
    // Without this the base reads as if the missing rules were never written, and a model
    // asked about a rank has nothing to reach for and no reason to expect anything.
    expect(base).toContain('A SKILL WILL ARRIVE WHEN IT IS NEEDED')
  })
})

describe('loading', () => {
  it('links every skill tool to a tool that exists', () => {
    const known = new Set(toolSchemas.map((t) => t.name))
    for (const skill of SKILLS) {
      for (const tool of skill.tools) {
        expect(known, `${skill.id} names a tool that does not exist: ${tool}`).toContain(tool)
      }
    }
  })

  it('gives a tool at most one skill', () => {
    // Two skills on one tool means one call loads two sets of rules and neither knows.
    const seen = new Set()
    for (const skill of SKILLS) {
      for (const tool of skill.tools) {
        expect(seen, `${tool} is claimed twice`).not.toContain(tool)
        seen.add(tool)
      }
    }
  })

  it('resolves a tool to its skill in both directions', () => {
    expect(skillForTool('rank_airports').id).toBe('ranking')
    expect(skillForTool('get_airport_weather').id).toBe('weather')
    expect(skillForTool('get_airport_profile')).toBeNull()
  })

  it('loads only what the called tools make relevant', () => {
    expect(skillsFor(['rank_airports']).map((s) => s.id)).toEqual(['ranking'])
    expect(skillsFor([]).length).toBe(0)
    expect(skillsFor(['rank_airports', 'get_airport_weather']).map((s) => s.id)).toEqual([
      'ranking',
      'weather',
    ])
  })

  it('reports the base as always and the rest as not', () => {
    const summary = skillsSummary()
    expect(summary.find((s) => s.id === 'base').always).toBe(true)
    expect(summary.filter((s) => !s.always)).toHaveLength(SKILLS.length)
    expect(ALL_SKILLS).toHaveLength(SKILLS.length + 1)
  })
})

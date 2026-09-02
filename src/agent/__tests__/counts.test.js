/**
 * The numbers a card states about the agent must be the agent's numbers.
 *
 * Both had drifted. The home page said "7 כלים" and the description said "reached through
 * seven tools" while the agent carried eight — search_knowledge had been added that morning
 * and neither literal moved with it. Prose is the worse of the two: nobody re-reads a
 * sentence to check whether a number in it is still true.
 */
import { describe, it, expect } from 'vitest'
import { AGENTS } from '../../../server/agents.js'
import { toolSchemas } from '../tools.js'
import { cases } from '../../../eval/cases.js'

describe('agent card summary', () => {
  const agent = AGENTS.find((a) => a.id === 'airport-investment')

  it('counts the tools the agent actually has', () => {
    expect(agent.summary.tools).toBe(toolSchemas.length)
  })

  it('counts the eval cases the file actually holds', () => {
    expect(agent.summary.evalCases).toBe(cases.length)
  })

  it('states no tool count in prose, where it cannot be kept true', () => {
    // The count belongs to summary.tools, which is derived. A number spelled out in a
    // sentence is a claim nothing checks — which is how "seven tools" survived the eighth.
    expect(agent.description).not.toMatch(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+tools?\b/i)
  })
})

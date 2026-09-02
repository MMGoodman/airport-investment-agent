/**
 * The workbench can take a tool away. It can never put one back.
 *
 * Everything else here is a convenience — edit a wording, try it against a live call, keep
 * it or revert. This one is a boundary. Placement decides which tools the browser may ever
 * invoke, and the whole argument for putting that in the tool list rather than the
 * instructions is that instructions can be argued with. A panel that could move a tool
 * across it would put the boundary back into the conversation, where anything that reaches
 * the model can reach it too.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { applyOverrides, workbenchState, toolIsEnabled } from '../workbench.js'
import { toolSchemasFor } from '../../src/agent/tools.js'

beforeEach(() => {
  applyOverrides({ systemPrompt: null, voiceAddendum: null, disabledTools: [] })
})

describe('workbench overrides', () => {
  it('reports every tool with its placement, and does not offer to change it', () => {
    const { tools } = workbenchState()
    expect(tools).toHaveLength(7)
    const weather = tools.find((t) => t.name === 'get_airport_weather')
    expect(weather.placement).toBe('server')
    // The panel renders placement; nothing in the patch shape can set it.
    const before = weather.placement
    applyOverrides({ tools: [{ name: 'get_airport_weather', placement: 'anywhere' }] })
    expect(workbenchState().tools.find((t) => t.name === 'get_airport_weather').placement)
      .toBe(before)
  })

  it('cannot enable a tool the browser transport withholds', () => {
    // Disabling then re-enabling must not smuggle a server-placed tool onto the direct line.
    applyOverrides({ disabledTools: [] })
    const browser = toolSchemasFor('browser').tools.map((t) => t.name)
    expect(browser).not.toContain('get_airport_weather')
  })

  it('disables a tool and puts it back', () => {
    expect(toolIsEnabled('get_flight_mix')).toBe(true)
    applyOverrides({ disabledTools: ['get_flight_mix'] })
    expect(toolIsEnabled('get_flight_mix')).toBe(false)
    applyOverrides({ disabledTools: [] })
    expect(toolIsEnabled('get_flight_mix')).toBe(true)
  })

  it('ignores a tool name it does not know', () => {
    applyOverrides({ disabledTools: ['no_such_tool'] })
    expect(workbenchState().tools.every((t) => t.enabled)).toBe(true)
  })

  it('tells an empty override apart from no override', () => {
    // Someone can legitimately want to try an empty addendum, and "" must not read as
    // "go back to the file" — that is the difference between an experiment and a revert.
    applyOverrides({ voiceAddendum: '' })
    const empty = workbenchState().prompt
    expect(empty.voiceAddendum).toBe('')
    expect(empty.voiceAddendumIsOverridden).toBe(true)

    applyOverrides({ voiceAddendum: null })
    const reverted = workbenchState().prompt
    expect(reverted.voiceAddendumIsOverridden).toBe(false)
    expect(reverted.voiceAddendum).toBe(reverted.fileVoiceAddendum)
  })

  it('keeps the file alongside the override so a revert is always possible', () => {
    applyOverrides({ systemPrompt: 'a much shorter prompt' })
    const s = workbenchState().prompt
    expect(s.system).toBe('a much shorter prompt')
    expect(s.fileSystem.length).toBeGreaterThan(1000)
    expect(s.systemIsOverridden).toBe(true)
  })

  it('says what changed rather than leaving the caller to diff it', () => {
    const { changed } = applyOverrides({ systemPrompt: 'x', disabledTools: ['end_call'] })
    expect(changed.join(' ')).toMatch(/system prompt/)
    expect(changed.join(' ')).toMatch(/end_call/)
  })
})

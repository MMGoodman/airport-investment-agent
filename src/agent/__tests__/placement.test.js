/**
 * Which tools each connection may offer, and which the browser may never reach.
 *
 * The distinction is protocol-shaped, not a preference. On WebRTC the model's function call
 * arrives on the browser's data channel and the server never sees it, so a tool the browser
 * cannot see is a tool that transport cannot carry. Marking one 'server' therefore removes
 * it from the direct line rather than hiding it there — and these pin both halves, because
 * a withheld tool that is still one POST away is not withheld at all.
 */
import { describe, it, expect } from 'vitest'
import { toolSchemas, toolSchemasFor, placementOf } from '../tools.js'

const names = (list) => list.map((t) => t.name)

describe('tool placement', () => {
  it('gives the relay every tool', () => {
    const { tools, withheld } = toolSchemasFor('relay')
    expect(names(tools)).toEqual(names(toolSchemas))
    expect(withheld).toEqual([])
  })

  it('withholds the server-placed tools from the browser, and names them', () => {
    const { tools, withheld } = toolSchemasFor('browser')
    expect(withheld).toContain('get_airport_weather')
    expect(names(tools)).not.toContain('get_airport_weather')
    // Named, not silently dropped: a model handed a shorter list than its instructions
    // imply answers the missing one from memory.
    expect(withheld.length).toBe(toolSchemas.length - tools.length)
  })

  it('leaves the read-only engine tools reachable from both', () => {
    const browser = names(toolSchemasFor('browser').tools)
    for (const t of ['list_supported_regions', 'rank_airports', 'compare_airports']) {
      expect(browser).toContain(t)
    }
  })

  it('defaults an unmarked tool to anywhere', () => {
    expect(placementOf('rank_airports')).toBe('anywhere')
    expect(placementOf('no_such_tool')).toBe('anywhere')
  })

  it('marks only what leaves the building', () => {
    // Every other tool is a pure read over a local dataset. get_airport_weather is the one
    // outbound call, and a browser-reachable endpoint for it is an open proxy through this
    // server's address.
    const server = toolSchemas.filter((t) => t.placement === 'server').map((t) => t.name)
    expect(server).toEqual(['get_airport_weather'])
  })
})

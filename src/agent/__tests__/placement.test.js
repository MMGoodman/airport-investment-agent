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

describe('rank_airports order', () => {
  it('returns the weakest airports, worst first, with absolute ranks', async () => {
    // There was no way to ask for this. A model asked for the three lowest-ranked US
    // airports called rank_airports twenty-four times walking every region twice, then
    // named two airports that are not in the dataset and a third at rank 103 as last.
    // A tool surface that cannot express the question gets improvised around.
    const { runTool } = await import('../tools.js')
    const bottom = (await runTool('rank_airports', { topN: 3, order: 'bottom' })).data.ranked
    const all = (await runTool('rank_airports', { topN: 500 })).data.ranked

    expect(bottom).toHaveLength(3)
    // Worst first, and the ranks are positions in the whole set — not 1, 2, 3.
    expect(bottom[0].rank).toBe(all.length)
    expect(bottom.map((a) => a.iata)).toEqual(
      all.slice(-3).reverse().map((a) => a.iata),
    )
    expect(bottom[0].score).toBeLessThan(bottom[2].score)
  })

  it('still returns the strongest by default', async () => {
    const { runTool } = await import('../tools.js')
    const top = (await runTool('rank_airports', { topN: 3 })).data.ranked
    expect(top[0].rank).toBe(1)
    expect(top[0].score).toBeGreaterThan(top[2].score)
  })
})

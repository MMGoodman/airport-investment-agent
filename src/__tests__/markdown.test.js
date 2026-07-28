import { describe, expect, it } from 'vitest'
import { toBlocks, toPlainText } from '../markdown.js'

// The fixture is a real answer shape: a lead paragraph, a bold label, and a caveat list.
const ANSWER = `Boston Logan (BOS) is the strongest candidate.

**Key Caveats:**
*   These scores measure demand opportunity only.
*   Gate counts are unavailable, so \`seatsPerDeparture\` is a proxy.`

describe('toBlocks', () => {
  it('separates prose from list items', () => {
    const blocks = toBlocks(ANSWER)
    expect(blocks.map((b) => b.type)).toEqual(['text', 'text', 'list'])
    expect(blocks[2].items).toHaveLength(2)
  })

  it('keeps consecutive bullets in one list', () => {
    expect(toBlocks('- one\n- two\n- three')).toEqual([
      { type: 'list', items: ['one', 'two', 'three'] },
    ])
  })

  it('accepts both bullet markers and extra spacing', () => {
    expect(toBlocks('*   star\n-  dash')).toEqual([{ type: 'list', items: ['star', 'dash'] }])
  })

  it('drops blank separators rather than rendering empty blocks', () => {
    expect(toBlocks('a\n\n\n\nb')).toEqual([
      { type: 'text', lines: ['a'] },
      { type: 'text', lines: ['b'] },
    ])
  })

  it('survives empty and missing input', () => {
    expect(toBlocks('')).toEqual([])
    expect(toBlocks(null)).toEqual([])
    expect(toBlocks(undefined)).toEqual([])
  })
})

describe('toPlainText', () => {
  it('strips the markers speech should not read out', () => {
    expect(toPlainText('**Key Caveats:** see `weights.json`')).toBe('Key Caveats: see weights.json')
  })

  it('removes bullet markers but keeps the item text', () => {
    expect(toPlainText('*   These scores measure demand opportunity.')).toBe(
      'These scores measure demand opportunity.',
    )
  })

  it('leaves ordinary prose untouched', () => {
    const plain = 'LAX carried 61,000,000 passengers in 2025.'
    expect(toPlainText(plain)).toBe(plain)
  })
})

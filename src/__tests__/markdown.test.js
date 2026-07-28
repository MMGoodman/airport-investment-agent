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
      { type: 'list', ordered: false, items: ['one', 'two', 'three'] },
    ])
  })

  it('accepts both bullet markers and extra spacing', () => {
    expect(toBlocks('*   star\n-  dash')).toEqual([
      { type: 'list', ordered: false, items: ['star', 'dash'] },
    ])
  })

  it('reads numbered lists and keeps them separate from bullets', () => {
    expect(toBlocks('1.  first\n2.  second\n- bullet')).toEqual([
      { type: 'list', ordered: true, items: ['first', 'second'] },
      { type: 'list', ordered: false, items: ['bullet'] },
    ])
  })

  it('reads headings at any level', () => {
    expect(toBlocks('### Top Candidates')).toEqual([
      { type: 'heading', level: 3, text: 'Top Candidates' },
    ])
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

  it('removes bullet, number and heading markers but keeps the text', () => {
    expect(toPlainText('*   These scores measure demand opportunity.')).toBe(
      'These scores measure demand opportunity.',
    )
    expect(toPlainText('1.  Boston Logan')).toBe('Boston Logan')
    expect(toPlainText('### Top Candidates')).toBe('Top Candidates')
  })

  it('leaves ordinary prose untouched', () => {
    const plain = 'LAX carried 61,000,000 passengers in 2025.'
    expect(toPlainText(plain)).toBe(plain)
  })
})

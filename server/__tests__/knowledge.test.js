/**
 * Chunking, which is the part that decides whether retrieval is worth anything.
 *
 * Embedding and cosine similarity are arithmetic and will do what they do. Chunking is a
 * judgement, and getting it wrong fails quietly: a passage cut mid-sentence still retrieves,
 * still scores, and reads as nonsense — or worse, reads as a claim the document never made.
 */
import { describe, it, expect } from 'vitest'
import { chunk, ACCEPTED } from '../knowledge.js'

/** A blank line, written this way so the literal survives every editor and shell. */
const BR = '\n\n'

describe('chunk', () => {
  it('keeps a heading with the text under it when a split happens', () => {
    // A retrieved passage has to arrive with the thing it is about. A heading alone in one
    // chunk and its body in the next means the body comes back with no subject.
    const out = chunk(
      '# Weights policy' + BR + 'Utilisation carries 0.30. '.repeat(60) +
        BR + '## Overrides' + BR + 'A caller may pass weights per request. '.repeat(60),
    )
    expect(out.length).toBeGreaterThan(1)
    expect(out[0]).toMatch(/^# Weights policy/)
    expect(out[0]).toContain('Utilisation carries')
    const overrides = out.find((c) => c.startsWith('## Overrides'))
    expect(overrides, 'the second heading did not start its own chunk').toBeDefined()
    expect(overrides).toContain('per request')
  })

  it('keeps two short sections together rather than splitting for the sake of it', () => {
    // Sections that fit inside one chunk stay in one. Splitting on every heading would give
    // a chunk per line in a document written as short headings, and a chunk that small
    // matches on almost nothing.
    const out = chunk('# A' + BR + 'Short body.' + BR + '# B' + BR + 'Also short.')
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('# A')
    expect(out[0]).toContain('# B')
  })

  it('does not leave a one-line scrap on its own', () => {
    // A chunk of one line matches almost nothing and takes a retrieval slot from something
    // that would have answered.
    const out = chunk(`${'Body text here. '.repeat(40)}\n\nTrailing note.`)
    expect(out[out.length - 1]).toContain('Body text here')
    expect(out.some((c) => c.trim() === 'Trailing note.')).toBe(false)
  })

  it('returns one chunk for a short document rather than splitting for its own sake', () => {
    expect(chunk('Two sentences. That is the whole file.')).toHaveLength(1)
  })

  it('drops nothing', () => {
    const text = `# A\n\n${'x'.repeat(900)}\n\n# B\n\n${'y'.repeat(900)}`
    const joined = chunk(text).join('\n\n')
    expect(joined).toContain('x'.repeat(900))
    expect(joined).toContain('y'.repeat(900))
  })

  it('accepts only the formats whose text can be read without a parser', () => {
    // PDF is deliberately absent: it needs a dependency, and adding one is a decision
    // rather than something that happens on the way past.
    expect(ACCEPTED).toEqual(['.md', '.txt', '.csv'])
  })
})

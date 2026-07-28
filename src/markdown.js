/**
 * A parser for the light Markdown the model actually emits — bold labels, bullet lists, the
 * occasional code span. Nothing more. Kept separate from the component so it stays a pure
 * function over strings, and so it can be tested without rendering anything.
 */

export const BULLET = /^\s*[-*]\s+/
export const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g

/** Group lines into runs of list items and runs of prose, dropping the blank separators. */
export function toBlocks(text) {
  const blocks = []

  for (const line of String(text ?? '').split('\n')) {
    const last = blocks[blocks.length - 1]

    if (BULLET.test(line)) {
      const item = line.replace(BULLET, '')
      if (last?.type === 'list') last.items.push(item)
      else blocks.push({ type: 'list', items: [item] })
      continue
    }

    // A blank line closes whatever block was open; the gap itself is not rendered.
    if (!line.trim()) {
      if (last && last.type !== 'gap') blocks.push({ type: 'gap' })
      continue
    }

    if (last?.type === 'text') last.lines.push(line)
    else blocks.push({ type: 'text', lines: [line] })
  }

  return blocks.filter((b) => b.type !== 'gap')
}

/** The same text with the markers stripped, for anything that is not rendering — e.g. speech. */
export function toPlainText(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) =>
      line
        .replace(BULLET, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1'),
    )
    .join('\n')
}

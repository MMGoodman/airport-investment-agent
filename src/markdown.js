/**
 * A parser for the light Markdown the model actually emits — headings, bullet and numbered
 * lists, bold labels, the occasional code span. Nothing more. Kept separate from the component
 * so it stays a pure function over strings, and so it can be tested without rendering anything.
 */

export const HEADING = /^(#{1,4})\s+(.+)$/
export const BULLET = /^\s*[-*]\s+/
export const ORDERED = /^\s*\d+[.)]\s+/
export const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g

/** Group lines into headings, runs of list items and runs of prose, dropping blank separators. */
export function toBlocks(text) {
  const blocks = []

  for (const line of String(text ?? '').split('\n')) {
    const last = blocks[blocks.length - 1]

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      continue
    }

    const ordered = ORDERED.test(line)
    if (ordered || BULLET.test(line)) {
      const item = line.replace(ordered ? ORDERED : BULLET, '')
      // A change of marker starts a new list rather than mixing the two.
      if (last?.type === 'list' && last.ordered === ordered) last.items.push(item)
      else blocks.push({ type: 'list', ordered, items: [item] })
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
        .replace(HEADING, '$2')
        .replace(BULLET, '')
        .replace(ORDERED, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1'),
    )
    .join('\n')
}

/**
 * Renders an answer. The model replies in light Markdown, and shown as raw text those markers
 * appear as literal asterisks in the middle of the prose.
 *
 * This builds React elements rather than HTML, so there is no dangerouslySetInnerHTML and no
 * escaping to get wrong. Anything the parser does not recognise stays visible as ordinary text.
 */
import { INLINE, toBlocks } from './markdown.js'

function inline(text) {
  return text
    .split(INLINE)
    .filter(Boolean)
    .map((part, i) => {
      if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>
      }
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
        return <code key={i}>{part.slice(1, -1)}</code>
      }
      return part
    })
}

function Block({ block }) {
  if (block.type === 'heading') {
    // One visual weight for every level — an answer is not a document outline.
    return <h4>{inline(block.text)}</h4>
  }
  if (block.type === 'list') {
    const items = block.items.map((item, i) => <li key={i}>{inline(item)}</li>)
    return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
  }
  return <p>{inline(block.lines.join('\n'))}</p>
}

export default function Markdown({ text }) {
  return (
    <div className="md">
      {toBlocks(text).map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  )
}

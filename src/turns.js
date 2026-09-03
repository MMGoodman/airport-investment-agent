/**
 * The conversation as anything that grades it reads: a question, the answer to it, and the
 * calls behind that answer.
 *
 * Built from the rendered messages rather than from a separate log, so what gets tagged is
 * exactly what is on screen. If the two ever disagree, the screen is the one a person is
 * looking at.
 *
 * Its own module rather than a second export from the pane: a component file that also
 * exports a function loses fast refresh, and this is worth testing on its own anyway.
 */

/**
 * @param messages the rendered conversation, oldest first
 * @returns one entry per answered question, in order
 */
export function turnsFrom(messages = []) {
  const turns = []
  messages.forEach((message, i) => {
    if (message.role !== 'assistant') return
    const asked = messages[i - 1]
    // An assistant message with no question above it is the greeting, or a re-engagement the
    // agent started on its own. Nobody asked for it, so there is nothing to grade against.
    if (asked?.role !== 'user') return
    turns.push({
      ask: asked.content,
      reply: message.content,
      toolCalls: message.toolCalls ?? [],
      ms: message.ms,
    })
  })
  return turns
}

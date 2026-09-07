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

    /**
     * A second assistant message in a row CONTINUES the answer above it.
     *
     * This used to be dropped, on the reasoning that nobody asked for it. Then a live
     * session showed what that costs: the model said "let me rank the top three for you",
     * called rank_airports, and delivered the ranking as a second message. The record kept
     * the sentence before the tool call and threw away the answer AND the call — so the
     * stored conversation showed an agent announcing work it never appeared to do, and the
     * dashboard timed a turn that had not answered anything yet.
     *
     * Merging is also right for the case this rule was written for: an agent that
     * re-engages after a silence did say those words in that exchange, and a record that
     * omits them does not match the conversation a person is reading it against.
     */
    if (asked?.role === 'assistant' && turns.length > 0) {
      const open = turns[turns.length - 1]
      open.reply = [open.reply, message.content].filter(Boolean).join('\n\n')
      open.toolCalls = [...open.toolCalls, ...(message.toolCalls ?? [])]
      // The first part's timing is the one that matters: when the caller first heard
      // anything back. A later part cannot make that number smaller or larger.
      open.ms ??= message.ms
      return
    }

    // An assistant message with no question above it at all is the greeting — every live
    // session opens with one, and grading it against a question that does not exist would
    // tag the opening line of every call.
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

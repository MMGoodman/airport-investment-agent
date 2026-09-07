/**
 * What a tool may be called, in one place because two places disagreed.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * The rule started life inside the server's `normaliseTool`, which is the right place to
 * enforce it and the wrong place to be the only one that knows it. The create form let you
 * type `get policy status!`, offered that string to the skill step as a trigger to tick,
 * and then stored the tool as `get_policy_status_`. The skill pointed at a tool that did
 * not exist — and a skill whose trigger never fires does not error, it simply never loads.
 * The rules you wrote are absent from the conversation and nothing says so.
 *
 * The form and the store now scrub with the same function, so the name you see while typing
 * IS the name that gets stored, and a trigger cannot be built from a string the tool never
 * had.
 *
 * WHY THIS SHAPE
 *
 * Every provider here wants an identifier: OpenAI, Gemini and ElevenLabs all reject a tool
 * name with a space in it. Trailing separators are trimmed rather than kept as underscores
 * because `get_policy_status_` is what a punctuation mark leaves behind, and it is a name
 * nobody chose.
 */
export function toolNameFrom(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    // Collapsed above; trimmed here. A name is not improved by the ghost of its punctuation.
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

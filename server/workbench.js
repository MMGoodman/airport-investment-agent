/**
 * The agent's surface, readable and editable from the console.
 *
 * Everything that shapes how the agent behaves — the instructions, which tools it is
 * offered, where each one runs — has until now lived only in source files. Changing a rule
 * meant editing prompt.js, restarting the API server by hand, and reloading. A day of that
 * is a day of guessing at which sentence in a 15,000-character prompt caused a wrong
 * answer, because the loop between changing one and hearing the result was minutes long.
 *
 * This shortens the loop to a session. An override lives in memory, applies to the next
 * call, and disappears on restart.
 *
 * WHY IT IS DELIBERATELY NOT PERSISTED
 *
 * prompt.js stays the source of truth. Every rule in it was written from a real failure
 * and carries the trace that produced it in a comment; a panel that could quietly rewrite
 * that file would lose the reasoning and keep the text. So this is a scratchpad: try a
 * wording against a live call, and when it works, put it in the file with the reason.
 * "Revert" is always one click away because the original is never overwritten.
 *
 * WHAT IT WILL NOT LET YOU DO
 *
 * Placement is not editable here. Which tools may run in the browser is a security
 * boundary decided before a conversation starts — the whole argument for putting it in the
 * tool list rather than the instructions is that instructions can be argued with. A panel
 * that could move a tool across it would put the boundary back into the conversation.
 */
import { SYSTEM_PROMPT, VOICE_ADDENDUM, languageInstruction } from '../src/agent/prompt.js'
import { toolSchemas, placementOf } from '../src/agent/tools.js'

/**
 * In-memory only, and gone on restart.
 *
 * `null` means "use the file", which is not the same as an empty string — someone can
 * legitimately want to try an empty addendum, and the two have to be distinguishable.
 */
const overrides = {
  systemPrompt: null,
  voiceAddendum: null,
  /** Tool names switched off for experiments. Never used to switch one ON that placement withheld. */
  disabledTools: new Set(),
}

/** What the model will actually be given, override or file. */
export const effectivePrompt = () => overrides.systemPrompt ?? SYSTEM_PROMPT
export const effectiveVoiceAddendum = () => overrides.voiceAddendum ?? VOICE_ADDENDUM

/**
 * Whether a tool is offered at all this session.
 *
 * Separate from placement, and strictly narrower: this can only take a tool away. A tool
 * that placement keeps off the browser stays off it whatever is set here.
 */
export const toolIsEnabled = (name) => !overrides.disabledTools.has(name)

/** Everything the console needs to show the agent's surface, with the file alongside. */
export function workbenchState() {
  return {
    prompt: {
      system: effectivePrompt(),
      voiceAddendum: effectiveVoiceAddendum(),
      // So the panel can show what changed and offer to put it back.
      systemIsOverridden: overrides.systemPrompt !== null,
      voiceAddendumIsOverridden: overrides.voiceAddendum !== null,
      fileSystem: SYSTEM_PROMPT,
      fileVoiceAddendum: VOICE_ADDENDUM,
      // Two languages produce two different instruction blocks from the same prompt.
      languageBlock: { he: languageInstruction('he', true), en: languageInstruction('en', true) },
    },
    tools: toolSchemas.map((t) => ({
      name: t.name,
      description: t.description,
      placement: placementOf(t.name),
      enabled: toolIsEnabled(t.name),
      parameters: t.parameters ?? { type: 'object', properties: {} },
      required: t.parameters?.required ?? [],
    })),
    note: 'Overrides live in memory and are lost on restart. src/agent/prompt.js stays the source of truth.',
  }
}

/**
 * Apply an edit. Returns what changed so the caller can say so rather than guess.
 *
 * A field that is absent is left alone; a field explicitly set to null goes back to the
 * file. That distinction is what makes "revert this one section" possible without also
 * reverting the other.
 */
export function applyOverrides(patch = {}) {
  const changed = []

  for (const [key, field] of [
    ['systemPrompt', 'system prompt'],
    ['voiceAddendum', 'voice addendum'],
  ]) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value === null) {
      if (overrides[key] !== null) changed.push(`${field} back to the file`)
      overrides[key] = null
    } else if (typeof value === 'string') {
      if (overrides[key] !== value) changed.push(`${field} (${value.length} chars)`)
      overrides[key] = value
    }
  }

  if (Array.isArray(patch.disabledTools)) {
    const known = new Set(toolSchemas.map((t) => t.name))
    const next = new Set(patch.disabledTools.filter((n) => known.has(n)))
    const before = [...overrides.disabledTools].sort().join(',')
    if (before !== [...next].sort().join(',')) {
      changed.push(next.size ? `disabled: ${[...next].join(', ')}` : 'all tools enabled')
    }
    overrides.disabledTools = next
  }

  return { changed, state: workbenchState() }
}

export function mountWorkbenchRoutes(app) {
  app.get('/api/workbench', (_req, res) => res.json(workbenchState()))

  app.post('/api/workbench', (req, res) => {
    try {
      res.json(applyOverrides(req.body ?? {}))
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })
}

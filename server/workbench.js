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
import { getStore } from '../src/data/store.js'
import { transcriptionPrompt, PHANTOM_TERM_THRESHOLD } from '../src/agent/vocabulary.js'
import { cases } from '../eval/cases.js'
import { skillsSummary, skillForTool, eagerSkills } from '../src/agent/skills.js'
import { configFor, updateAgent, toolAsSchema } from './agentStore.js'

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

/**
 * Everything the runtime needs to serve one conversation, for one agent.
 *
 * IT LIVES HERE AND NOT IN agentStore FOR A REASON
 *
 * The built-in agent resolves through the overrides above — the Instructions pane edits it,
 * the tool switches take tools away from it. So resolution needs both the record and the
 * overrides, and putting it in the store meant the store importing this file while this file
 * imported the store. That cycle worked, until it would not: two modules that need each
 * other at import time fail in a way that looks like a value being undefined for no reason.
 *
 * The overrides are the thing that has to be layered on, so resolution belongs beside them.
 *
 * ONE FUNCTION, TWO KINDS OF AGENT — callers never branch on which they were handed. The
 * moment one has to ask "is this the real one", they all do, and one of them forgets.
 *
 * WHY SKILLS CARRY THEIR FLAGS
 *
 * `eager` is not decoration. A skill that decides WHETHER to call its tool cannot be
 * delivered by calling it — call-control is what stops the agent hanging up on "thank you",
 * and four premature hangups were the cost of learning that.
 */
export function runtimeFor(agentId) {
  const cfg = configFor(agentId)

  if (cfg.builtIn) {
    return {
      id: cfg.id,
      builtIn: true,
      systemPrompt: effectivePrompt(),
      voiceAddendum: effectiveVoiceAddendum(),
      allows: (name) => toolIsEnabled(name),
      skills: skillsSummary(),
      eager: eagerSkills(),
      model: null,
      voice: null,
      transport: cfg.transport,
    }
  }

  const chosen = new Set(cfg.toolNames)
  const skills = (cfg.skills ?? []).map((sk) => ({
    id: sk.id,
    name: sk.name ?? sk.id,
    tools: sk.tools ?? [],
    instructions: sk.instructions ?? '',
    always: Boolean(sk.always),
    eager: Boolean(sk.eager),
    chars: (sk.instructions ?? '').length,
  }))

  return {
    id: cfg.id,
    builtIn: false,
    systemPrompt: cfg.systemPrompt,
    voiceAddendum: cfg.voiceAddendum,
    // A created agent narrows the CATALOGUE. It cannot widen it — placement still decides
    // where an implemented tool may run, and this only takes away.
    allows: (name) => chosen.has(name),
    /**
     * Tools this agent declared, which are a different kind of thing.
     *
     * They are not in `toolSchemas` and never will be until somebody writes the code, so
     * they cannot go through `allows` — that answers "may this agent use one of the
     * deployment's tools", and the answer for a name with no implementation is not "no",
     * it is "that is not the question". Kept separate so the difference survives to the
     * screen instead of being flattened into a disabled checkbox.
     */
    declaredTools: cfg.customTools ?? [],
    skills,
    eager: skills.filter((sk) => sk.eager),
    model: cfg.model,
    voice: cfg.voice,
    transport: cfg.transport,
  }
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

/**
 * What the agent can actually see, as opposed to what it is told.
 *
 * A prompt panel on its own answers "what did I tell it"; this answers "what does it have
 * to work with", which is the other half of why an answer came out the way it did. Several
 * of today's wrong answers were a model reaching past the edge of this — a bottom-three
 * question the tool could not express, an airport that is not in the set, a region name
 * read as a place on the map.
 */
async function knowledge() {
  const store = await getStore()
  const years = [...new Set(store.annual.map((r) => r.year))].sort()
  /**
   * Airports per region, counted from the airports — and the states each region covers.
   *
   * store.regions maps a region to its STATES, not to its airports. Counting its entries
   * and calling them airports put "Midwest 12" on a region that holds 27, which is exactly
   * the kind of number a console is trusted for.
   *
   * The states are worth showing on their own: they are why "Arizona" is not a region here
   * and a caller asking for one gets Mountain, which is a thing the agent has got wrong
   * out loud.
   */
  const counts = store.airports.reduce((acc, a) => {
    acc[a.region] = (acc[a.region] ?? 0) + 1
    return acc
  }, {})
  const byRegion = Object.entries(store.regions)
    .map(([region, states]) => ({ region, airports: counts[region] ?? 0, states: states ?? [] }))
    .sort((a, b) => b.airports - a.airports)

  // _note is the instruction to the curator, not a constraint on an airport.
  const constraints = Object.entries(store.knownConstraints)
    .filter(([iata]) => iata !== '_note')
    .map(([iata, c]) => ({ iata, type: c.type, note: c.note }))

  return {
    airports: store.airports.length,
    regions: byRegion,
    annualRows: store.annual.length,
    years,
    // 2020 and 2021 are absent on purpose and the agent is required to say so.
    yearsNote: 'COVID years are excluded from the trend, so a CAGR here spans 2022-2025.',
    weights: store.weights,
    weightsNote:
      'Analyst policy, not a model fact. rank_airports accepts a per-call override; there is no session default yet, and adding one touches the audited scoring path, so it has not been done casually.',
    constraints,
    constraintsNote:
      'Hand-curated. The agent must surface these verbatim when the airport appears and must not invent new ones.',
  }
}

/**
 * The transcription bias list, which is knowledge the agent is given about how to HEAR.
 *
 * It belongs in a management console because it has caused real failures on its own: given
 * a prior and a stretch of near-silence to describe, the transcriber emits the prior. One
 * session showed all 122 terms in list order as something the caller had said; another
 * showed just the last one, "לוס אנג׳לס", after eleven seconds of speech about Boston.
 */
async function vocabulary() {
  const [he, en] = await Promise.all([transcriptionPrompt('he'), transcriptionPrompt('en')])
  const terms = (hint) => hint.split(',').map((t) => t.trim()).filter((t) => t.length > 2)
  return {
    he: { chars: he.length, terms: terms(he) },
    en: { chars: en.length, terms: terms(en) },
    phantomThreshold: PHANTOM_TERM_THRESHOLD,
    phantomNote:
      'A transcript repeating this many of the terms in the hint, and at least 60 characters long, is dropped as the hint being read back rather than shown as speech.',
  }
}

/** The regression net, so the console can say what is covered without running it. */
/**
 * The cases themselves, not a list of their names.
 *
 * This used to reduce every case to `c.id` and send that. Which put nineteen chips on a
 * screen, each naming a claim the reader had no way to see: `lax-vs-sna` tells you a case
 * exists and nothing about what it asserts, what it asks, or why. The information was one
 * property away the whole time.
 *
 * The count in the note was a literal `19` beside a computed `total`, so the two would have
 * disagreed the first time anyone added a case.
 */
function evals() {
  const groups = {}
  for (const c of cases) (groups[c.group] ??= []).push(c.id)
  return {
    total: cases.length,
    cases,
    groups: Object.entries(groups).map(([group, ids]) => ({ group, ids })),
    note: `npm run eval — ${cases.length} cases across both model paths. Costs API quota, so it is not run from here.`,
  }
}

/** Everything the console needs to show the agent's surface, with the file alongside. */
export async function workbenchState(agentId) {
  const agent = runtimeFor(agentId)
  return {
    /**
     * Which agent this describes, and whether editing it sticks.
     *
     * The built-in's edits are in-memory experiments and vanish on restart, by design. A
     * created agent's prompt and tools ARE its definition, so the same controls write to
     * disk. The screen has to be able to say which, or someone loses work they thought was
     * saved — or keeps a change they thought was temporary.
     */
    agent: { id: agent.id, builtIn: agent.builtIn, persists: !agent.builtIn },
    prompt: {
      system: agent.systemPrompt,
      voiceAddendum: agent.voiceAddendum,
      // So the panel can show what changed and offer to put it back.
      systemIsOverridden: overrides.systemPrompt !== null,
      voiceAddendumIsOverridden: overrides.voiceAddendum !== null,
      fileSystem: SYSTEM_PROMPT,
      fileVoiceAddendum: VOICE_ADDENDUM,
      // Two languages produce two different instruction blocks from the same prompt.
      languageBlock: { he: languageInstruction('he', true), en: languageInstruction('en', true) },
    },
    // Every skill with its instructions and the tools that trigger it, so the console can
    // show the link from either side — open a skill and see its tools, open a tool and see
    // which skill it brings with it.
    skills: agent.skills,
    tools: [
      ...toolSchemas.map((t) => ({
        name: t.name,
        description: t.description,
        placement: placementOf(t.name),
        skill: skillForTool(t.name)?.id ?? null,
        skillName: skillForTool(t.name)?.name ?? null,
        // For a created agent this is "did you give it this tool", not "is it switched off
        // for an experiment" — the same column answering a different question per agent.
        enabled: agent.allows(t.name),
        parameters: t.parameters ?? { type: 'object', properties: {} },
        required: t.parameters?.required ?? [],
        declared: false,
      })),
      /**
       * Tools this agent declared but nobody has implemented.
       *
       * They belong in this list or they disappear the moment the create flow closes,
       * which would make declaring one feel like it did nothing. They are marked, because
       * showing them identically to the eight that actually run would be the more
       * expensive lie: `enabled: true` on a name with no code behind it.
       */
      ...(agent.declaredTools ?? []).map((t) => {
        const schema = toolAsSchema(t)
        return {
          name: schema.name,
          description: schema.description,
          placement: schema.placement,
          skill: null,
          skillName: null,
          enabled: false,
          parameters: schema.parameters,
          required: schema.parameters.required,
          declared: true,
          handler: t.handler ?? '',
        }
      }),
    ],
    knowledge: await knowledge(),
    vocabulary: await vocabulary(),
    evals: evals(),
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

  return { changed }
}

/**
 * The same edits, written to a created agent's record instead of the session overrides.
 *
 * `disableTool` and `enableTool` mean something different here and the difference is the
 * point: on the built-in they take a tool away for an experiment, on a created agent they
 * change which tools it HAS. Same control, same words on screen, and the pane says which by
 * showing whether the change persists.
 */
function applyToAgent(agent, patch) {
  const changed = []
  const next = {}

  if (typeof patch.systemPrompt === 'string') {
    next.systemPrompt = patch.systemPrompt
    changed.push('systemPrompt')
  }
  if (typeof patch.voiceAddendum === 'string') {
    next.voiceAddendum = patch.voiceAddendum
    changed.push('voiceAddendum')
  }

  /**
   * The same `disabledTools` array the pane already sends, read the other way round.
   *
   * It invented its own `enableTool`/`disableTool` keys first, which the pane does not send
   * and never did — so every tool toggle on a created agent silently did nothing. The pane
   * posts the full set of switched-off tools; for a created agent, the ones NOT in it are
   * the tools it has.
   */
  if (Array.isArray(patch.disabledTools)) {
    const off = new Set(patch.disabledTools)
    const kept = toolSchemas.map((t) => t.name).filter((n) => !off.has(n))
    const before = toolSchemas
      .map((t) => t.name)
      .filter((n) => agent.allows(n))
      .sort()
      .join(',')
    if (before !== [...kept].sort().join(',')) {
      next.toolNames = kept
      changed.push(kept.length ? `tools: ${kept.join(', ')}` : 'no tools')
    }
  }

  if (Array.isArray(patch.skills)) {
    next.skills = patch.skills
    changed.push('skills')
  }

  if (changed.length) updateAgent(agent.id, next)
  return { changed }
}

export function mountWorkbenchRoutes(app) {
  app.get('/api/workbench', async (req, res) => {
    try {
      res.json(await workbenchState(req.query?.agent))
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/workbench', async (req, res) => {
    try {
      const agentId = req.body?.agent
      const agent = runtimeFor(agentId)
      // A created agent's settings are saved; the built-in's are session overrides.
      const { changed } = agent.builtIn
        ? applyOverrides(req.body ?? {})
        : applyToAgent(agent, req.body ?? {})
      res.json({ changed, state: await workbenchState(agentId) })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })
}

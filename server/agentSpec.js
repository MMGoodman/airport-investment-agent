/**
 * An agent, written out as a brief somebody can act on.
 *
 * WHY THIS EXISTS
 *
 * The create flow lets you DECLARE a tool — name, purpose, arguments, where it runs — and
 * stops there, because a declaration is a contract and the code that answers it is code.
 * That boundary is honest, and it left a gap: the person who writes that code needs the
 * declaration, the agent's rules, this repo's conventions and a list of what was left
 * unanswered, and until now the only way to hand those over was to describe them from
 * memory.
 *
 * So this renders all of it as Markdown. Paste it into Claude — or a colleague — and the
 * reply is against what the agent actually is rather than against a summary of it.
 *
 * WHAT MAKES IT A BRIEF RATHER THAN A DUMP
 *
 * The gaps section. Everything above it is transcription; that part is computed — which
 * tools have no description, which parameters have none, which skills point at a tool that
 * does not exist, which declarations carry no sketch. Those are the questions an engineer
 * would send back, asked before they have to send them.
 *
 * WHY MARKDOWN AND NOT JSON
 *
 * The reader is a language model or a person. JSON would be smaller and would need a
 * paragraph of explanation to be usable; prose with fenced schemas needs none, and the
 * schema blocks are still exact.
 */
import { getAgent } from './agentStore.js'
import { runtimeFor } from './workbench.js'
import { toolSchemas } from '../src/agent/tools.js'
import { TRANSPORTS } from './agentStore.js'

/** A fenced block, with the language named so a reader's editor colours it. */
const fence = (lang, body) => `\`\`\`${lang}\n${body}\n\`\`\``

/**
 * The conventions a new tool has to satisfy in THIS repo.
 *
 * Stated as facts about files that exist rather than as advice. A brief that says "follow
 * the existing patterns" is asking the reader to go and find them; naming the array, the
 * object and the return shape is the difference between a request and a specification.
 */
const CONVENTIONS = `## How a tool is implemented here

Two edits in \`src/agent/tools.js\`, and nothing else:

1. **The schema** — append to the exported \`toolSchemas\` array. This is what the model is
   sent: \`name\`, \`description\`, \`parameters\` (JSON Schema), and optionally
   \`placement: 'server'\`.
2. **The handler** — add a key to the exported \`handlers\` object, named exactly as the
   schema. It receives the parsed arguments object.

Every handler returns \`{ data, meta }\`:

- \`data\` is what the model sees. **Every number in it must be something the tool computed
  or fetched** — the agent is instructed to state no figure it did not get from a tool, so a
  handler that guesses breaks the one guarantee the system makes.
- \`meta\` carries provenance: where the data came from, over what period, and any
  assumption a reader would need in order to judge it. Use the existing \`meta()\` helper
  when the answer comes from the bundled dataset; write the equivalent when it does not.

Failures are returned, not thrown: \`{ data: { error: '…', … }, meta: … }\`. A thrown error
reaches the caller as a dead turn; a returned one lets the agent say what went wrong.

**Placement.** A tool marked \`placement: 'server'\` is refused to the browser and is
enforced in three separate places — do not add a fourth. Mark it server-placed if it needs a
key, a database, or anything that must not reach the page.

**Secrets** never appear in a schema or a handler literal. Read them from \`process.env\`
and keep the name in \`.env.example\`.`

/** One declared tool, as the thing somebody has to build. */
function toolSection(tool) {
  const params = tool.parameters ?? []
  const schema = {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        params.map((p) => [p.name, { type: p.type, description: p.description || `The ${p.name}.` }]),
      ),
      required: params.filter((p) => p.required).map((p) => p.name),
    },
    ...(tool.placement === 'server' ? { placement: 'server' } : {}),
  }

  const lines = [
    `### \`${tool.name}\``,
    '',
    tool.description || '_No description written. See the gaps below — this is the field the model actually reads._',
    '',
    `Runs **${tool.placement === 'server' ? 'on the server' : 'in the browser'}**.`,
    '',
    'Schema to append to `toolSchemas`:',
    '',
    fence('js', JSON.stringify(schema, null, 2)),
  ]

  if (tool.handler?.trim()) {
    lines.push(
      '',
      'What its author sketched — intent, not code to keep:',
      '',
      fence('js', tool.handler.trim()),
    )
  }

  return lines.join('\n')
}

/**
 * Does the description draw a line anywhere, or only describe the happy path?
 *
 * WHY THIS IS NOT A GREP FOR NEGATION WORDS
 *
 * It was, and it lied. `/אל |לא /` marked "קרא לו כשהלקוח שואל אם הוא מכוסה" as bounded,
 * because **שוא·ל א·ם contains "אל "** — the tail of one word plus the head of the next.
 * Hebrew has no word boundary that `\b` recognises, so a naive substring finds negations
 * inside unrelated words and the check quietly passes everything.
 *
 * The same mistake as reading "403 scored airports" as an auth failure, in a new alphabet.
 * Lookarounds for a letter on either side are what `\b` should have been.
 */
const LIMIT_WORDS = ['not', 'never', 'only', 'unless', 'לא', 'אל', 'אין', 'רק', 'אלא', 'למעט']
const statesALimit = (text) =>
  LIMIT_WORDS.some((word) => new RegExp(`(?<!\\p{L})${word}(?!\\p{L})`, 'iu').test(text))

/**
 * What the declaration does not answer.
 *
 * Computed rather than listed, so it cannot go stale, and phrased as the question rather
 * than as a scolding — the point is to get the answer, not to grade the form.
 */
function gaps(agent, declared) {
  const out = []

  if (!agent.systemPrompt?.trim()) out.push('The agent has no system prompt. What is it for, and what may it not invent?')

  for (const tool of declared) {
    if (!tool.description?.trim())
      out.push(`\`${tool.name}\` has no description. **This is the only field the model sees** — it decides whether the tool is ever called, and with what.`)
    else if (!statesALimit(tool.description))
      out.push(`\`${tool.name}\`'s description says when to call it but not when **not** to. That omission is the usual cause of a tool being called for the wrong question.`)

    for (const p of tool.parameters ?? []) {
      if (!p.description?.trim())
        out.push(`\`${tool.name}.${p.name}\` has no description. ElevenLabs rejects an agent whose parameter lacks one, and the model has to guess what to put there.`)
    }
    if (!tool.parameters?.length)
      out.push(`\`${tool.name}\` takes no arguments. Correct for a "list everything" tool — worth confirming it is not an oversight.`)
    if (!tool.handler?.trim())
      out.push(`\`${tool.name}\` has no implementation sketch. **What should it call?** URL and method, where the credential comes from, an example of what comes back, and what to do on 404, timeout and rate limit.`)
  }

  // A skill whose trigger names nothing real never loads, and never says so.
  const names = new Set([...declared.map((t) => t.name), ...toolSchemas.map((t) => t.name)])
  for (const skill of agent.skills ?? []) {
    for (const trigger of skill.tools ?? []) {
      if (!names.has(trigger))
        out.push(`Skill \`${skill.id}\` loads on \`${trigger}\`, which is not a tool this agent has. Its rules would never reach a conversation.`)
    }
    if (!skill.instructions?.trim()) out.push(`Skill \`${skill.id}\` has no instructions.`)
  }

  return out
}

export function specFor(agentId) {
  const record = getAgent(agentId)
  if (!record) return null
  const agent = runtimeFor(agentId)

  const declared = agent.declaredTools ?? []
  const borrowed = toolSchemas.filter((t) => agent.allows(t.name))
  const transport = TRANSPORTS.find((t) => t.id === record.defaultTransport)

  const out = [
    `# ${record.name}`,
    '',
    record.tagline || record.description || '',
    '',
    '> Exported from the agent workbench. It describes one agent completely: its rules, the',
    '> tools it has, the tools it has only declared, and the questions its declaration leaves',
    '> open. **The task is to implement the declared tools.**',
    '',
    '## The agent',
    '',
    `- **Pipeline** — ${transport?.label ?? record.defaultTransport}${transport?.note ? ` (${transport.note})` : ''}`,
    `- **Languages** — ${(record.languages ?? []).join(', ') || 'he, en'}`,
    `- **Tools it can run today** — ${borrowed.length ? borrowed.map((t) => `\`${t.name}\``).join(', ') : 'none'}`,
    `- **Tools declared but not implemented** — ${declared.length ? declared.map((t) => `\`${t.name}\``).join(', ') : 'none'}`,
    '',
    '## Its instructions',
    '',
    'The rules a new tool has to be consistent with — a tool whose result the prompt forbids',
    'the agent to state is a tool nobody can use.',
    '',
    fence('text', agent.systemPrompt?.trim() || '(none written)'),
  ]

  if (agent.voiceAddendum?.trim()) {
    out.push('', 'Added on the voice paths:', '', fence('text', agent.voiceAddendum.trim()))
  }

  if ((agent.skills ?? []).length) {
    out.push('', '## Skills', '')
    out.push(
      'Instructions loaded on demand — the first time one of the listed tools is called, that',
      "skill's rules are sent to the model. A skill marked *always* is sent up front instead.",
      '',
    )
    for (const skill of agent.skills) {
      const when = skill.eager ? '_always_' : (skill.tools ?? []).map((t) => `\`${t}\``).join(', ') || '_never — no trigger set_'
      out.push(`### \`${skill.id}\``, '', `Loads on: ${when}`, '', fence('text', skill.instructions?.trim() || '(none)'), '')
    }
  }

  if (declared.length) {
    out.push('', '## Tools to implement', '')
    out.push(declared.map(toolSection).join('\n\n'))
    out.push('', CONVENTIONS)
  }

  const open = gaps(record, declared)
  if (open.length) {
    out.push('', '## Answer these first', '')
    out.push('Computed from the declaration — each one is something the code cannot be written without, or something that will fail quietly if it is guessed.', '')
    out.push(open.map((q) => `- ${q}`).join('\n'))
  }

  return out.join('\n') + '\n'
}

export function mountAgentSpecRoutes(app) {
  app.get('/api/agent-store/:id/spec', (req, res) => {
    const spec = specFor(req.params.id)
    if (!spec) return res.status(404).json({ error: `אין סוכן בשם ${req.params.id}` })
    // Markdown rather than JSON: the caller pastes this, it does not parse it.
    res.type('text/markdown; charset=utf-8').send(spec)
  })
}

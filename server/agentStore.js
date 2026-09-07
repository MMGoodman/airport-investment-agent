/**
 * Agents as data, so a second one is a record rather than a rewrite.
 *
 * WHAT agents.js SAID AND WHY THIS EXISTS
 *
 * That file describes the built-in agent and warns, in its own header, that adding a row
 * would give you "a second card pointing at the same brain" — because the prompt, the tools
 * and the skills are module singletons that voice.js imports directly. This is the layer
 * that makes the warning stop being true: an agent's configuration lives here, is saved to
 * disk, and the runtime resolves against it per request.
 *
 * WHERE THE LINE IS, HONESTLY
 *
 * A created agent gets its own identity, pipeline, model, voice, prompt, skills and choice
 * of tools. It does NOT get new tool implementations — a tool is code that reaches a data
 * source, and the ones here reach the BTS scoring engine. So today this builds a different
 * agent over the same capabilities: a different persona, a different pipeline, a different
 * set of the existing tools, its own rules.
 *
 * Declaring a tool that calls an arbitrary HTTP endpoint is the piece that would make this a
 * general agent builder, and it is a separate build. Saying so here is cheaper than letting
 * someone discover it by looking for a button that is not there.
 *
 * WHY DISK
 *
 * Everything else in this workbench is deliberately in memory — overrides are experiments
 * and an experiment that outlives its sitting becomes a setting nobody chose. An agent is
 * the opposite: it is the thing you made, and losing it on restart would make the feature
 * pointless.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { AGENTS as BUILT_IN } from './agents.js'
import { SYSTEM_PROMPT, VOICE_ADDENDUM } from '../src/agent/prompt.js'
import { toolSchemas } from '../src/agent/tools.js'
import { toolNameFrom } from '../src/agent/toolName.js'

const DIR = 'data'
const FILE = join(DIR, 'agents.json')
/** Dot-prefixed so it sorts out of the way of the data somebody actually browses. */
const BACKUP_DIR = join(DIR, '.agents-backups')

/**
 * Prompts to start from, none of which are about airports.
 *
 * WHY THIS LIST REPLACED "COPY THE EXISTING AGENT"
 *
 * The create flow used to offer exactly one starting point: the airport analyst's own
 * 8,700-character prompt. For the second airport agent that is the fastest possible start.
 * For anything else it is a wall of rules about BTS T-100 data, peer sets and demand scores
 * that has to be read and deleted before the first useful word can be typed — and the
 * likelier outcome is that it is not read, and a travel-insurance agent quietly inherits
 * instructions about never presenting a score as a return on investment.
 *
 * So these are short on purpose. A template's job is to show the SHAPE of a prompt that
 * works here — who you are, what you may say, what you must not invent, and what to do when
 * you cannot answer — and then get out of the way.
 */
export const PROMPT_TEMPLATES = [
  {
    id: 'blank',
    name: 'ריק',
    note: 'מתחילים מכלום',
    systemPrompt: '',
    voiceAddendum: '',
  },
  {
    id: 'skeleton',
    name: 'שלד',
    note: 'ארבעת החלקים שכל פרומפט כאן צריך',
    systemPrompt: `אתה [מי הסוכן]. אתה עוזר ל[מי המשתמש] ב[מה המשימה].

מה אתה עושה
- [היכולת הראשונה]
- [היכולת השנייה]

מה אתה לא ממציא
- כל מספר או עובדה מגיעים מכלי. אם אין כלי שמחזיר את זה, אמור שאין לך את הנתון.
- אל תשלים פרטים חסרים מהזיכרון.

כשאתה לא יכול לענות
אמור בפירוש מה חסר ומה כן אפשר לעשות. אל תיתן תשובה מעורפלת במקום סירוב ברור.`,
    voiceAddendum: '',
  },
  {
    id: 'support',
    name: 'סוכן שירות',
    note: 'עונה, מברר, מסלים',
    systemPrompt: `אתה נציג שירות של [הארגון]. אתה עונה על שאלות של לקוחות ופותר בעיות פשוטות.

איך אתה עובד
- קודם תברר מה בדיוק קרה. שאלה אחת בכל פעם.
- כשיש לך מספיק, השתמש בכלי כדי לבדוק את המצב בפועל.
- אל תבטיח תוצאה שאתה לא יכול לאמת.

מתי להסלים
כשהבקשה דורשת החלטה שאין לך כלי לבצע, אמור זאת ואמור למי זה עובר.`,
    voiceAddendum: '',
  },
  {
    id: 'docs',
    name: 'עונה מתוך מסמכים',
    note: 'מצטט, לא זוכר',
    systemPrompt: `אתה עונה על שאלות אך ורק מתוך המסמכים שהועלו.

הכלל היחיד שאסור לשבור
כל תשובה מגיעה מקטע שמצאת. אם החיפוש לא החזיר קטע רלוונטי, אמור שהמסמכים לא מכסים את זה — אל תענה מהידע הכללי שלך, גם אם אתה בטוח בתשובה.

ציטוט
בכל תשובה ציין מאיזה מסמך ומאיזה מקום בו היא הגיעה.`,
    voiceAddendum: '',
  },
]

/** The transports an agent may be built on, with what each one actually is. */
export const TRANSPORTS = [
  { id: 'gemini', label: 'gemini · text', voice: false, note: 'טקסט בלבד. הזול והמהיר' },
  { id: 'openai', label: 'gpt-realtime · voice', voice: 'openai', note: 'מודל אחד מהאודיו. הכי מהיר בקול' },
  { id: 'openai-hybrid', label: 'gpt-realtime · hybrid', voice: 'openai', note: 'אותו דבר, והשרת עונה על כלים מושמים' },
  { id: 'openai-relay', label: 'gpt-realtime · via your server', voice: 'openai', note: 'הכל דרך השרת. פי 2 בלטנסי' },
  { id: 'elevenlabs', label: 'elevenlabs · cascade', voice: 'elevenlabs', note: 'תמלול → LLM → קול. כל שלב נבחר' },
  { id: 'elevenlabs-hybrid', label: 'elevenlabs · hybrid', voice: 'elevenlabs', note: 'אותו דבר, עם כלים בשרת' },
]

function load() {
  try {
    if (!existsSync(FILE)) return []
    const parsed = JSON.parse(readFileSync(FILE, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let created = load()

/**
 * Every write keeps the version it replaced.
 *
 * WHY THIS EXISTS, WRITTEN THE DAY IT WAS NEEDED
 *
 * An agent disappeared from this file and could not be brought back. One line in the store,
 * holding a prompt somebody wrote, the tools they declared and the skills they authored —
 * gone, with nothing to restore from and no record of what removed it. The delete dialog
 * three files away says "אין ביטול ואין סל מיחזור", and it was telling the truth.
 *
 * The fix is not a smarter delete. Deletes are supposed to delete. The gap was that a
 * single overwrite of one JSON file was the whole of the durability story: any bug, any
 * stray request, any load() that returned an empty array because the file was momentarily
 * unreadable, and the next save writes the emptiness over the data.
 *
 * So the previous contents are copied aside first, named by the moment they stopped being
 * current. Cheap — a few kilobytes per write — and it converts "gone" into "look in
 * data/.agents-backups". The backup is deliberately NOT wired to a restore button: this is
 * a safety net for the case nobody predicted, and the cases you can predict deserve real
 * handling rather than a rummage through timestamps.
 *
 * Failures here are swallowed. A backup that cannot be written must never stop the write it
 * was protecting — losing the edit to protect the history is the wrong way round.
 */
function backup() {
  try {
    if (!existsSync(FILE)) return
    const previous = readFileSync(FILE, 'utf8')
    // Nothing to keep, and no point keeping a hundred copies of "[]".
    if (previous.trim() === '' || previous.trim() === '[]') return
    mkdirSync(BACKUP_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    writeFileSync(join(BACKUP_DIR, `agents-${stamp}.json`), previous)
  } catch {
    // See above: protecting the history must not cost the write.
  }
}

function save() {
  mkdirSync(DIR, { recursive: true })
  backup()
  writeFileSync(FILE, JSON.stringify(created, null, 2))
}

const slug = (name) =>
  String(name || 'agent')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9֐-׿]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'agent'

/**
 * Every agent, built-in first.
 *
 * The built-in one is not in the file and never will be: it is defined by code that reads
 * the airport dataset, and a copy of its description on disk would be a second truth about
 * it. It is marked so the UI can offer to open it but not to delete it.
 */
export function allAgents() {
  return [
    ...BUILT_IN.map((a) => ({ ...a, builtIn: true })),
    ...created.map((a) => ({ ...a, builtIn: false, welcome: welcomeFor(a) })),
  ]
}

/**
 * The empty-conversation screen for an agent someone made.
 *
 * Derived on read rather than stored, so renaming an agent or rewriting its one-liner is
 * reflected the next time anyone opens it. A stored copy would be a second place the name
 * lives, and the two would agree until somebody edited one.
 *
 * No invented questions. An agent whose maker did not supply any opens with a heading and
 * a line and no chips — which is honest, and better than four suggestions about airports
 * that this agent cannot answer.
 */
function welcomeFor(agent) {
  return {
    title: agent.name,
    blurb: agent.tagline || agent.description || '',
    questions: (agent.sampleQuestions ?? []).filter((q) => String(q).trim()),
  }
}

export function getAgent(id) {
  return allAgents().find((a) => a.id === id) ?? null
}

/**
 * The configuration the runtime should use for a request.
 *
 * The built-in agent resolves to the module singletons, which is what every caller used
 * before this file existed — so nothing changes for it. A created agent resolves to its own
 * record. One function, so a caller never has to know which kind it is holding.
 */
export function configFor(id) {
  const agent = getAgent(id)
  if (!agent || agent.builtIn) {
    return {
      id: agent?.id ?? BUILT_IN[0].id,
      builtIn: true,
      systemPrompt: SYSTEM_PROMPT,
      voiceAddendum: VOICE_ADDENDUM,
      // Every tool, filtered later by placement and by the workbench's own switches.
      toolNames: toolSchemas.map((t) => t.name),
      skills: null,
      transport: agent?.defaultTransport ?? 'openai-hybrid',
      model: null,
      voice: null,
    }
  }
  return {
    id: agent.id,
    builtIn: false,
    systemPrompt: agent.systemPrompt ?? '',
    voiceAddendum: agent.voiceAddendum ?? '',
    toolNames: agent.toolNames ?? [],
    customTools: (agent.customTools ?? []).map(normaliseTool).filter(Boolean),
    skills: agent.skills ?? [],
    transport: agent.defaultTransport,
    model: agent.model || null,
    voice: agent.voice || null,
  }
}

/**
 * Change a created agent, and say so on disk.
 *
 * Built-ins are refused rather than ignored: an edit that silently does nothing is worse
 * than one that says it cannot.
 */
export function updateAgent(id, patch) {
  const at = created.findIndex((a) => a.id === id)
  if (at === -1) return null
  created[at] = { ...created[at], ...patch, id }
  save()
  return created[at]
}

/**
 * A tool somebody declared, cleaned up enough to be stored and handed on.
 *
 * WHAT A DECLARED TOOL IS, AND WHAT IT IS NOT
 *
 * It is a contract: a name, what it is for, and the arguments the model may pass. That is
 * genuinely most of a tool — it is the whole of what the MODEL ever sees, and getting it
 * wrong is the usual reason a tool is never called or is called with nonsense. Writing it
 * here, in a form, is not a lesser version of writing it in code.
 *
 * It is NOT an implementation. Nothing in this file can make an HTTP request on your
 * behalf. `handler` is stored as text and never executed — it is a place to sketch what
 * should happen, so the declaration and the intent travel together to whoever writes the
 * real thing. Storing code you do not run is only honest if you say so, so the UI says so
 * and so does this comment.
 *
 * Parameters are kept as a list rather than as JSON Schema because a list is what a form
 * edits. The schema is derived on the way out, in one place, so the two cannot drift.
 */
export function normaliseTool(raw = {}) {
  // The same function the form uses while you type. See src/agent/toolName.js for why that
  // matters: when only the server knew the rule, a skill's trigger could name a tool the
  // store had renamed, and a trigger that never fires is a rule that silently never loads.
  const name = toolNameFrom(raw.name)
  if (!name) return null

  return {
    name,
    description: String(raw.description ?? '').trim(),
    placement: raw.placement === 'server' ? 'server' : 'browser',
    parameters: (Array.isArray(raw.parameters) ? raw.parameters : [])
      .map((p) => ({
        name: toolNameFrom(p?.name),
        type: ['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(p?.type)
          ? p.type
          : 'string',
        description: String(p?.description ?? '').trim(),
        required: Boolean(p?.required),
      }))
      .filter((p) => p.name),
    handler: String(raw.handler ?? ''),
    declaredAt: raw.declaredAt ?? new Date().toISOString(),
  }
}

/**
 * A declared tool as JSON Schema — the shape every provider actually wants.
 *
 * One conversion, used by whatever needs it, so the form's list and the model's schema stay
 * the same thing said twice rather than two things that agree until they do not.
 */
export function toolAsSchema(tool) {
  return {
    name: tool.name,
    description: tool.description,
    placement: tool.placement,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        tool.parameters.map((p) => [
          p.name,
          // Every parameter carries a description or ElevenLabs rejects the whole agent
          // with a 422 — the same fallback the sync script has needed since day one.
          { type: p.type, description: p.description || `The ${p.name}.` },
        ]),
      ),
      required: tool.parameters.filter((p) => p.required).map((p) => p.name),
    },
  }
}

export function mountAgentStoreRoutes(app) {
  /**
   * What a create form needs to offer — and what it deliberately does not.
   *
   * This payload used to carry the airport agent's eight tools, five skills and system
   * prompt. First as `tools` / `skillTemplates`, which made them look like the menu; then
   * renamed to `environmentTools` / `environmentSkills` and folded away in the UI, which
   * was the wrong fix for the right complaint.
   *
   * They are not this environment's furniture. They belong to ONE AGENT: eight functions
   * that reach the BTS scoring engine and mean nothing away from it, five skills about
   * rankings and weather, a prompt about demand percentiles. A screen for building a
   * different agent has no business offering them, folded or otherwise — the coupling was
   * the problem, not how prominent it was.
   *
   * So what goes out now is only what a NEW agent needs: the pipelines it can run on,
   * prompt shapes to start from, and the vocabulary for declaring a tool of its own.
   */
  app.get('/api/agent-store/options', (_req, res) =>
    res.json({
      transports: TRANSPORTS,
      promptTemplates: PROMPT_TEMPLATES,
      toolPlacements: [
        { id: 'browser', label: 'בדפדפן', note: 'רץ אצל המשתמש. מהיר, ואין לו סודות' },
        { id: 'server', label: 'בשרת', note: 'רץ אצלך. מפתחות ומסדי נתונים חיים כאן' },
      ],
      paramTypes: ['string', 'number', 'integer', 'boolean', 'array', 'object'],
    }),
  )

  app.post('/api/agent-store', (req, res) => {
    const body = req.body ?? {}
    if (!body.name?.trim()) return res.status(400).json({ error: 'a name is required' })
    if (!TRANSPORTS.some((t) => t.id === body.defaultTransport))
      return res.status(400).json({ error: 'pick a pipeline' })

    let id = slug(body.name)
    let n = 1
    // Built-ins count: two agents answering to one id would make the URL ambiguous.
    while (allAgents().some((a) => a.id === id)) id = `${slug(body.name)}-${++n}`

    const agent = {
      id,
      name: body.name.trim(),
      tagline: (body.tagline ?? '').trim(),
      description: (body.description ?? '').trim(),
      defaultTransport: body.defaultTransport,
      transports: [body.defaultTransport],
      languages: body.languages?.length ? body.languages : ['he', 'en'],
      model: body.model ?? '',
      voice: body.voice ?? '',
      systemPrompt: body.systemPrompt ?? '',
      voiceAddendum: body.voiceAddendum ?? '',
      // Borrowed from this deployment.
      toolNames: Array.isArray(body.toolNames) ? body.toolNames : [],
      // Declared by whoever made the agent. See normaliseTool.
      customTools: (Array.isArray(body.customTools) ? body.customTools : [])
        .map(normaliseTool)
        .filter(Boolean),
      skills: Array.isArray(body.skills) ? body.skills : [],
      // What the empty screen offers. Optional — see welcomeFor on why none is fine.
      sampleQuestions: (Array.isArray(body.sampleQuestions) ? body.sampleQuestions : [])
        .map((q) => String(q).trim())
        .filter(Boolean)
        .slice(0, 6),
      capabilities: { prompt: true, tools: true, evals: true, knowledge: false, vocabulary: false },
      createdAt: new Date().toISOString(),
    }
    created = [agent, ...created]
    save()
    res.json({ agent })
  })

  app.put('/api/agent-store/:id', (req, res) => {
    const at = created.findIndex((a) => a.id === req.params.id)
    if (at === -1) return res.status(404).json({ error: `no agent ${req.params.id}, or it is built in` })
    created[at] = { ...created[at], ...(req.body ?? {}), id: created[at].id }
    save()
    res.json({ agent: created[at] })
  })

  /**
   * Delete, and say no when it cannot.
   *
   * This filtered the list and answered `{ok:true}` whatever the id was — so deleting the
   * built-in agent reported success and changed nothing, and so did a typo. A confirmation
   * dialog in front of a call that always claims to have worked teaches people that the
   * dialog means nothing.
   *
   * The built-in is refused because it is defined by code that reads the airport dataset;
   * there is no record to remove. An unknown id is a 404 rather than a shrug.
   */
  app.delete('/api/agent-store/:id', (req, res) => {
    const { id } = req.params
    if (BUILT_IN.some((a) => a.id === id))
      return res.status(400).json({ error: 'הסוכן המובנה מוגדר בקוד ולא נשמר כרשומה — אין מה למחוק' })

    const before = created.length
    created = created.filter((a) => a.id !== id)
    if (created.length === before) return res.status(404).json({ error: `אין סוכן בשם ${id}` })

    save()
    res.json({ ok: true, id, remaining: created.length })
  })
}

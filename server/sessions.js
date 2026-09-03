/**
 * Conversations kept, so a hundred of them can be asked a question at once.
 *
 * WHY THE TRANSCRIPT AND NOT THE AUDIO
 *
 * Every question a dashboard is for — how often a caller asked for the weather and did not
 * get it, which transport that happens on, whether one path is slower than another — is
 * answerable from the turns. A recording answers only "how did it sound", which you ask of
 * one call and never of a thousand. It is also roughly 400x the size, it is biometric, and it
 * needs consent and a deletion story that structured text does not. So the transcript is
 * stored always and the audio is not stored here at all. If a recording is ever kept it
 * belongs beside this, keyed by conversation id, with its own retention.
 *
 * WHY JSON ON DISK AND NOT SQLITE
 *
 * SQL is the right SHAPE for this — every question is a GROUP BY — and it was written that
 * way first, on node:sqlite, which ships with Node and costs no dependency. Then the tests
 * failed with "No such built-in module: node:sqlite", because npm runs this project's scripts
 * under Node 20.13.1 while the shell's node is 24. That version split is already recorded in
 * this repo as a trap for the next upgrade; building the conversation store on top of it
 * would have made a documented annoyance into a hard dependency, and the server would have
 * refused to start.
 *
 * At this scale the tradeoff is not close. A thousand conversations of ten turns is ten
 * thousand records; grouping them in JavaScript takes milliseconds and works on every Node
 * this project can be started with. If the corpus ever reaches a size where that stops being
 * true, the shape of these functions is already the shape of the queries.
 *
 * WHY THE TOOL COUNT LIVES ON THE CONVERSATION
 *
 * This is the part that makes the dashboard mean anything. "The caller asked for the weather
 * and did not get it" is a correct refusal on gpt-realtime · voice, where the tool is not
 * offered at all, and a bug on elevenlabs · hybrid, where it is. Same tag, opposite verdicts.
 * Without offered/total recorded next to the provider, the dashboard shows one number for two
 * unrelated situations and quietly averages a working feature with a broken one.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = process.env.SESSIONS_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sessions')

/** Loaded once, then kept. The files are the source of truth. */
let cache = null

/** A filename that cannot escape the directory, whatever the id turns out to be. */
const fileFor = (id) => join(DIR, `${createHash('sha256').update(id).digest('hex').slice(0, 16)}.json`)

async function load() {
  if (cache) return cache
  cache = new Map()
  try {
    for (const name of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
      try {
        const stored = JSON.parse(await readFile(join(DIR, name), 'utf8'))
        cache.set(stored.id, stored)
      } catch {
        // A half-written file from an interrupted process must not stop the rest loading.
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('sessions: could not read the store:', err.message)
  }
  return cache
}

/** For tests, which need each case to start from nothing. */
export function resetSessions() {
  cache = new Map()
}

/**
 * Store one finished conversation and its turns.
 *
 * Writing the same id again replaces it. A call can end more than once from the browser's
 * point of view — a reload, a second end event — and two half-copies of one conversation
 * would double every count on the dashboard.
 */
export async function saveConversation({
  id,
  provider,
  providerLabel,
  toolsOffered,
  toolsTotal,
  lang,
  startedAt,
  endedAt,
  turns = [],
}) {
  if (!id) throw new Error('a conversation needs an id')
  // Without it every aggregate is meaningless, so it is required rather than defaulted.
  if (!provider) throw new Error('a conversation needs the provider it ran on')

  await load()
  const record = {
    id,
    provider,
    providerLabel: providerLabel ?? provider,
    toolsOffered: toolsOffered ?? null,
    toolsTotal: toolsTotal ?? null,
    lang: lang ?? null,
    startedAt: startedAt ?? new Date().toISOString(),
    endedAt: endedAt ?? new Date().toISOString(),
    turns: turns.map((turn, idx) => ({
      idx,
      ask: turn.ask ?? '',
      reply: turn.reply ?? '',
      ms: Number.isFinite(turn.ms) ? turn.ms : null,
      toolCalls: turn.toolCalls ?? [],
      // Tags arrive later, from the grader. Kept on the turn so a verdict cannot drift away
      // from the words it was about.
      tags: cache.get(id)?.turns?.[idx]?.tags ?? [],
    })),
  }

  await mkdir(DIR, { recursive: true })
  await writeFile(fileFor(id), JSON.stringify(record))
  cache.set(id, record)
  return { id, turns: record.turns.length }
}

/** The turns of one conversation, in the shape the tagger reads. */
export async function turnsOf(conversationId) {
  const store = await load()
  return (store.get(conversationId)?.turns ?? []).map((t) => ({
    turnId: t.idx,
    idx: t.idx,
    ask: t.ask,
    reply: t.reply,
    ms: t.ms,
    toolCalls: t.toolCalls,
  }))
}

/**
 * Attach tag results to stored turns.
 *
 * Replaces whatever a previous run left, so re-tagging after editing a tag does not leave the
 * old verdict beside the new one — a dashboard counting both would report a problem twice for
 * having been looked at twice.
 */
export async function saveTags(conversationId, taggedTurns = []) {
  const store = await load()
  const record = store.get(conversationId)
  if (!record) return

  taggedTurns.forEach((entry, at) => {
    const idx = entry.turnId ?? at
    const turn = record.turns[idx]
    if (!turn) return
    // A grader that could not be reached is not a finding. Storing it would put "the model
    // was busy" in the same column as "the agent invented a figure".
    turn.tags = (entry.hits ?? []).filter((h) => !h.failed)
  })

  await writeFile(fileFor(conversationId), JSON.stringify(record))
}

export async function listConversations({ limit = 50 } = {}) {
  const store = await load()
  return [...store.values()]
    .sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)))
    .slice(0, limit)
    .map(({ turns, ...rest }) => ({
      ...rest,
      turnCount: turns.length,
      tagHits: turns.reduce((n, t) => n + (t.tags?.length ?? 0), 0),
    }))
}

/**
 * The dashboard.
 *
 * Everything is grouped by provider as well as by tag, because that is the split that makes a
 * count readable. The tools offered travel with every row so a reader can tell a withheld
 * tool from a broken one without knowing the transports by heart.
 */
export async function dashboard() {
  const store = await load()
  const conversations = [...store.values()]

  const providers = new Map()
  const tags = new Map()
  let turnCount = 0
  let tagHits = 0

  for (const conversation of conversations) {
    const key = conversation.provider
    const row = providers.get(key) ?? {
      provider: key,
      providerLabel: conversation.providerLabel,
      toolsOffered: conversation.toolsOffered,
      toolsTotal: conversation.toolsTotal,
      conversations: 0,
      turns: 0,
      msTotal: 0,
      msCount: 0,
    }
    row.conversations += 1
    row.turns += conversation.turns.length

    for (const turn of conversation.turns) {
      turnCount += 1
      if (Number.isFinite(turn.ms)) {
        row.msTotal += turn.ms
        row.msCount += 1
      }
      for (const hit of turn.tags ?? []) {
        tagHits += 1
        // Keyed by tag AND provider: the same tag on two paths is two different findings.
        const tagKey = `${hit.id}::${key}`
        const at = tags.get(tagKey) ?? {
          tagId: hit.id,
          name: hit.name ?? hit.id,
          kind: hit.kind,
          provider: key,
          providerLabel: conversation.providerLabel,
          toolsOffered: conversation.toolsOffered,
          toolsTotal: conversation.toolsTotal,
          hits: 0,
          conversations: new Set(),
        }
        at.hits += 1
        at.conversations.add(conversation.id)
        tags.set(tagKey, at)
      }
    }
    providers.set(key, row)
  }

  return {
    totals: { conversations: conversations.length, turns: turnCount, tagHits },
    byProvider: [...providers.values()]
      .map(({ msTotal, msCount, ...rest }) => ({
        ...rest,
        avgMs: msCount ? Math.round(msTotal / msCount) : null,
      }))
      .sort((a, b) => b.conversations - a.conversations),
    byTag: [...tags.values()]
      .map((t) => ({ ...t, conversations: t.conversations.size }))
      .sort((a, b) => b.hits - a.hits),
  }
}

/**
 * Which tools actually ran, per provider.
 *
 * The question this project kept needing and could not ask: not "did the agent answer" but
 * "was the thing the caller wanted reachable from where they were standing". A row whose
 * offered count is below its total is a path that withholds tools by design, and a gap there
 * is the design working rather than a fault.
 */
export async function toolUsage() {
  const store = await load()
  const byProvider = new Map()

  for (const conversation of store.values()) {
    const row = byProvider.get(conversation.provider) ?? {
      provider: conversation.provider,
      providerLabel: conversation.providerLabel,
      toolsOffered: conversation.toolsOffered,
      toolsTotal: conversation.toolsTotal,
      tools: {},
    }
    for (const turn of conversation.turns) {
      for (const call of turn.toolCalls ?? []) {
        const at = (row.tools[call.tool] ??= { calls: 0, onServer: 0 })
        at.calls += 1
        if (call.ranOn === 'server') at.onServer += 1
      }
    }
    byProvider.set(conversation.provider, row)
  }
  return [...byProvider.values()]
}

export function mountSessionRoutes(app, { onSaved } = {}) {
  app.post('/api/sessions', async (req, res) => {
    try {
      const saved = await saveConversation(req.body ?? {})
      // Tagging is not the caller's business to wait for: the rules are instant and the LLM
      // tags are not, so the save answers now and the grading runs behind it.
      onSaved?.(req.body?.id)
      res.json(saved)
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  app.get('/api/sessions', async (req, res) =>
    res.json({ conversations: await listConversations({ limit: Number(req.query.limit) || 50 }) }),
  )

  app.get('/api/sessions/:id', async (req, res) => res.json({ turns: await turnsOf(req.params.id) }))

  app.get('/api/dashboard', async (_req, res) => {
    try {
      res.json({ ...(await dashboard()), toolUsage: await toolUsage() })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}

/**
 * A knowledge base the agent reaches through a tool, not through its context.
 *
 * WHY RETRIEVAL IS A TOOL AND NOT AN INJECTION
 *
 * The usual shape is to search on every turn and paste the hits into the prompt. That would
 * break the one contract this agent actually keeps: every figure it states came from a tool
 * result, and the trace under an answer proves which call produced it. Silently prepended
 * text is a source with no call, no id and no digest — every answer downstream of it becomes
 * unverifiable, and a day was spent this week making the agent invent less.
 *
 * So retrieval is `search_knowledge`, it appears in the trace like every other call, and the
 * chunks it returns carry their filename and position so the answer can cite them.
 *
 * WHAT IS STORED AND WHERE
 *
 * JSON on disk under data/knowledge. A hundred documents of policy notes is thousands of
 * chunks, not millions; a vector database here would be infrastructure with no work to do,
 * and one more thing to be running before the agent can answer.
 *
 * CHUNKING
 *
 * By headings and blank lines rather than by character count. A chunk cut mid-sentence
 * retrieves well and reads as nonsense, which is the failure mode where the agent quotes
 * something that does not say what it appears to say.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'knowledge')
const EMBED_MODEL = process.env.EMBED_MODEL || 'text-embedding-3-small'
const EMBED_URL = 'https://api.openai.com/v1/embeddings'

/** Formats whose text can be read without a parser. PDF needs a dependency; see ingest(). */
export const ACCEPTED = ['.md', '.txt', '.csv']

/** Chunks are held in memory after the first read; the files are the source of truth. */
let cache = null

async function load() {
  if (cache) return cache
  cache = []
  try {
    const files = await readdir(DIR)
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      try {
        cache.push(JSON.parse(await readFile(join(DIR, file), 'utf8')))
      } catch {
        // A half-written file from an interrupted process must not stop the rest loading.
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('knowledge: could not read the store:', err.message)
  }
  return cache
}

/**
 * Split on structure, then merge until a chunk is worth retrieving.
 *
 * A markdown heading starts a new chunk and travels with the text under it, so a retrieved
 * passage arrives with the thing it is about. Blank lines separate paragraphs. Very short
 * pieces are merged forward, because a chunk that is one line matches on almost nothing.
 *
 * WHY A HEADING ENDS A CHUNK AND SIZE DOES NOT
 *
 * This used to merge sections together until 1400 characters, which is not what the
 * paragraph above claims it does: size decided where an idea ended, and structure only
 * broke ties. A 980-character policy note with six headings became ONE chunk, and one
 * vector averaging six subjects matches each of them weakly. Asked a question the document
 * answers under its own heading, the store scored 0.246 and the agent said it had nothing.
 *
 * Splitting at every heading that follows a chunk already worth retrieving took the same
 * question to 0.528 and halved the overlap between questions the document answers and
 * questions it does not. So `min` is a floor on what can stand alone, `max` is a guard for
 * documents with no headings at all, and the heading is what actually decides.
 *
 * The floor matters: without it a heading is pushed out on its own and its body arrives in
 * the next chunk with no subject, which is the failure the first test here describes.
 */
export function chunk(text, { min = 120, max = 1400 } = {}) {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n(?=#{1,6}\s)|\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)

  const out = []
  let current = ''
  for (const block of blocks) {
    // A heading introduces what follows it, so it ends the chunk BEFORE it — but only once
    // that chunk can stand on its own, or the heading leaves with nothing under it.
    const isHeading = /^#{1,6}\s/.test(block)
    const standsAlone = current.length >= min
    if (current && standsAlone && (isHeading || current.length + block.length > max)) {
      out.push(current)
      current = block
    } else {
      current = current ? `${current}\n\n${block}` : block
    }
  }
  if (current) out.push(current)

  // A trailing scrap belongs with what came before it rather than alone.
  if (out.length > 1 && out[out.length - 1].length < min) {
    out[out.length - 2] += `\n\n${out.pop()}`
  }
  return out
}

/** OpenAI embeddings, batched. Errors are surfaced rather than swallowed into empty vectors. */
async function embed(texts, apiKey) {
  if (!apiKey) throw new Error('no OpenAI key on this server — embeddings need one')
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error?.message ?? `embeddings failed (${res.status})`)
  return body.data.map((d) => d.embedding)
}

const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0)
const norm = (a) => Math.sqrt(dot(a, a))
const cosine = (a, b) => dot(a, b) / (norm(a) * norm(b) || 1)

/**
 * Take a file into the store.
 *
 * `text` is already-decoded text: the browser reads the file and posts its contents, which
 * keeps this endpoint free of a multipart dependency and makes the accepted formats exactly
 * the ones whose text can be read without a parser. A PDF would need one — pdf-parse or
 * similar — and adding it is a deliberate decision rather than a quiet one, so it is not
 * accepted here yet and says so rather than failing oddly.
 */
export async function ingest({ name, text, apiKey }) {
  if (!name) throw new Error('a document needs a filename')
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (!ACCEPTED.includes(ext)) {
    throw new Error(
      `${ext || 'that'} is not accepted. This build reads ${ACCEPTED.join(', ')} — a PDF needs a parser dependency that has not been added.`,
    )
  }
  if (!text?.trim()) throw new Error('the file is empty')

  const pieces = chunk(text)
  const vectors = await embed(pieces, apiKey)
  const id = createHash('sha256').update(name).digest('hex').slice(0, 12)

  const doc = {
    id,
    name,
    addedAt: new Date().toISOString(),
    chars: text.length,
    model: EMBED_MODEL,
    chunks: pieces.map((body, i) => ({
      // Position travels with the text so an answer can say where it came from.
      loc: `${name}#${i + 1}`,
      index: i,
      text: body,
      embedding: vectors[i],
    })),
  }

  await mkdir(DIR, { recursive: true })
  await writeFile(join(DIR, `${id}.json`), JSON.stringify(doc))
  await load()
  cache = cache.filter((d) => d.id !== id).concat(doc)
  return { id, name, chunks: pieces.length, chars: text.length }
}

export async function removeDoc(id) {
  await load()
  const before = cache.length
  cache = cache.filter((d) => d.id !== id)
  try {
    await unlink(join(DIR, `${id}.json`))
  } catch {
    /* already gone */
  }
  return before !== cache.length
}

/** Documents in the store, without the vectors, for the console. */
export async function listDocs() {
  const docs = await load()
  return docs
    .map(({ id, name, addedAt, chars, chunks, model }) => ({
      id,
      name,
      addedAt,
      chars,
      chunks: chunks.length,
      model,
    }))
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
}

/**
 * The retrieval itself.
 *
 * Returns chunks with their source and their score. The score is returned rather than hidden
 * because a weak best match is the signal that the store has nothing on this — and the model
 * is told to say so instead of quoting the nearest paragraph.
 */
export async function search({ query, topK = 4, apiKey }) {
  const docs = await load()
  if (docs.length === 0) return { hits: [], docs: 0 }
  const [vector] = await embed([query], apiKey)

  const scored = []
  for (const doc of docs) {
    for (const c of doc.chunks) {
      scored.push({ score: cosine(vector, c.embedding), loc: c.loc, doc: doc.name, text: c.text })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return {
    docs: docs.length,
    hits: scored.slice(0, Math.min(topK, 8)).map((h) => ({
      ...h,
      score: Number(h.score.toFixed(3)),
    })),
  }
}

/**
 * The demo corpus, planted on a host that starts with an empty disk.
 *
 * WHY THIS EXISTS
 *
 * `data/knowledge/` is gitignored, and rightly — it holds documents somebody uploaded, and
 * a public repository is the wrong place for those by default. On a laptop that is the end
 * of it: you upload once and the index stays.
 *
 * On a free host there is no disk. Every deploy, and every wake from sleep, starts from the
 * repository — so `search_knowledge` searched an empty index and answered "the knowledge
 * base has nothing on this" to every question. That reads as an agent that does not know
 * things, not as a corpus that was never shipped, and it is the RAG path's whole
 * demonstration failing silently in front of whoever was sent the link.
 *
 * So the two invented policy documents live in `data/knowledge-seed/` as plain Markdown —
 * eight kilobytes, readable in a diff — and are ingested here when the store is empty.
 * Source text rather than the embedded JSON on purpose: the vectors are 264KB of numbers
 * tied to whichever model produced them, and committing those would freeze the index to
 * `text-embedding-3-small` forever.
 *
 * ONLY WHEN EMPTY, AND NEVER OVER ANYTHING
 *
 * A store with documents in it is a store somebody filled, and re-planting a demo corpus
 * over it — or beside it, duplicated — is the kind of helpfulness nobody asked for. This
 * runs once, on an empty index, and does nothing otherwise.
 *
 * Failure is quiet by design. No key, no network, a malformed file: the index stays empty,
 * which is exactly where it was. A seeder that could stop the server from booting would be
 * a worse problem than the one it solves.
 */
const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'knowledge-seed')

export async function seedIfEmpty(apiKey = process.env.OPENAI_API_KEY) {
  try {
    if (!apiKey) return { seeded: 0, why: 'no OpenAI key — embeddings need one' }
    if (!existsSync(SEED_DIR)) return { seeded: 0, why: 'no seed folder' }

    const existing = await listDocs()
    if (existing.length > 0) return { seeded: 0, why: `${existing.length} already there` }

    let seeded = 0
    for (const name of readdirSync(SEED_DIR)) {
      if (!ACCEPTED.includes(name.slice(name.lastIndexOf('.')).toLowerCase())) continue
      await ingest({ name, text: readFileSync(join(SEED_DIR, name), 'utf8'), apiKey })
      seeded += 1
    }
    return { seeded }
  } catch (err) {
    return { seeded: 0, why: err.message }
  }
}

export function mountKnowledgeRoutes(app) {
  app.get('/api/knowledge', async (_req, res) => {
    try {
      res.json({
        docs: await listDocs(),
        accepted: ACCEPTED,
        model: EMBED_MODEL,
        note: 'Retrieval is a tool, not an injection: search_knowledge appears in the trace and its chunks carry a source, so an answer built on them stays checkable.',
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/knowledge', async (req, res) => {
    try {
      const { name, text } = req.body ?? {}
      res.json(await ingest({ name, text, apiKey: process.env.OPENAI_API_KEY }))
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  app.delete('/api/knowledge/:id', async (req, res) => {
    res.json({ removed: await removeDoc(req.params.id) })
  })
}

/**
 * Re-chunk and re-embed every document in the store.
 *
 * WHY THIS IS NEEDED
 *
 * A document keeps the chunking it was ingested under, forever. Change chunk(), watch the
 * unit tests go green, and the live store still answers out of the old pieces — the code
 * and the data disagree and nothing says so. That happened here: splitting at headings
 * took a question the document answers from 0.246 to 0.528, and the stored copy stayed at
 * 0.246 because it had been ingested an hour earlier.
 *
 * Run it after any change to chunk(), or to the embedding model:
 *
 *   node scripts/reindex-knowledge.js
 *
 * Then RESTART the API server. It reads the store once and keeps it in memory, so a server
 * already running goes on answering out of the chunking it loaded at startup — the same
 * code-and-data split this script exists to close, one process further along. It bit us:
 * the store on disk had been reindexed to six chunks while the running server still
 * reported one, and listed a document that had only ever existed in its own cache.
 *
 * The text is reconstructed by joining the stored chunks with a blank line, which is what
 * separated them: chunk() splits on headings and blank lines and keeps everything else, so
 * the round trip loses only runs of consecutive blank lines. Nothing an embedding notices.
 */
import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ingest, listDocs } from '../server/knowledge.js'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'knowledge')

const before = await listDocs()
if (before.length === 0) {
  console.log('The knowledge base is empty; nothing to reindex.')
  process.exit(0)
}

console.log(`Reindexing ${before.length} document${before.length === 1 ? '' : 's'}…\n`)

let changed = 0
for (const file of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
  const doc = JSON.parse(await readFile(join(DIR, file), 'utf8'))
  const text = doc.chunks.map((c) => c.text).join('\n\n')

  // ingest() writes to the same id, because the id is a hash of the name — so this
  // replaces the document rather than growing a second copy of it.
  const result = await ingest({ name: doc.name, text, apiKey: process.env.OPENAI_API_KEY })
  const arrow = result.chunks === doc.chunks.length ? '=' : '→'
  if (result.chunks !== doc.chunks.length) changed += 1
  console.log(
    `  ${doc.name.padEnd(28)} ${String(doc.chunks.length).padStart(3)} ${arrow} ${String(result.chunks).padEnd(3)} chunks`,
  )
}

console.log(
  changed === 0
    ? '\nEvery document already matched the current chunking.'
    : `\n${changed} document${changed === 1 ? '' : 's'} re-chunked. The store and the code agree again.`,
)
console.log('Restart the API server: a running one is still holding the old chunks in memory.')

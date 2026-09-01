/**
 * Nothing the browser loads may reach a Node builtin.
 *
 * This exists because the build is not a net for it. Vite replaces node:fs and node:url
 * with a stub that throws on first property access, so an import that can only work on the
 * server compiles clean, ships, and takes out the page on load — "Module node:url has been
 * externalized for browser compatibility", from a module graph that looked fine in CI.
 *
 * It happened by moving one pure function next to the data that produces its input: the
 * live transports import it, vocabulary.js reads the airport dataset, and the dataset
 * reader opens files. Three hops, no warning, blank page.
 *
 * The walk starts from what the browser actually enters and follows relative imports only —
 * a bare specifier is a dependency, resolved by the bundler, and not this test's business.
 */
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(here, '../..')

/** Repo-relative, with forward slashes, so a failure reads the same on every platform. */
const rel = (file) => relative(SRC, file).split(sep).join('/')

/** Everything the browser is handed, directly or through a chain of relative imports. */
const ENTRIES = ['main.jsx', 'App.jsx', 'LivePanel.jsx']

async function walk(file, seen = new Map()) {
  if (seen.has(file)) return seen
  const source = await readFile(file, 'utf8').catch(() => null)
  if (source === null) return seen
  seen.set(file, source)
  for (const m of source.matchAll(/(?:^|\n)\s*import\s[^'"]*['"](\.[^'"]+)['"]/g)) {
    await walk(resolve(dirname(file), m[1]), seen)
  }
  return seen
}

describe('client bundle', () => {
  it('never reaches a Node builtin', async () => {
    const seen = new Map()
    for (const entry of ENTRIES) await walk(resolve(SRC, entry), seen)

    // Enough files to prove the walk actually followed the graph rather than stopping at
    // the entries — a silent traversal bug would make this test pass on anything.
    expect(seen.size).toBeGreaterThan(10)

    const offenders = []
    for (const [file, source] of seen) {
      for (const m of source.matchAll(/from\s+['"](node:[^'"]+)['"]/g)) {
        offenders.push(`${rel(file)} imports ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

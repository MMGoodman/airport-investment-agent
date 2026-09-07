/**
 * Named sets of cases you run again and again.
 *
 * WHY THESE PERSIST WHEN NOTHING ELSE HERE DOES
 *
 * Every other override in this workbench lives in memory and is gone on restart, deliberately:
 * they are experiments, and a experiment that outlives the sitting it belongs to becomes a
 * setting nobody remembers choosing. A preset is the opposite. It is the question you keep
 * asking — the same four cases against a different model each time — and its whole value is
 * that it is still there tomorrow. Retyping the selection every session would mean nobody
 * uses it twice.
 *
 * So it goes to disk, in the same JSON-on-disk shape the stored conversations use, for the
 * same reason: node:sqlite is not available under the Node that npm runs here.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'data'
const FILE = join(DIR, 'eval-presets.json')

/** A preset holds ids, not cases. A case edited later is a case the preset then runs. */
function load() {
  try {
    if (!existsSync(FILE)) return []
    const parsed = JSON.parse(readFileSync(FILE, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // A corrupt file should not stop the server booting. It is a convenience list.
    return []
  }
}

let presets = load()

function save() {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(presets, null, 2))
}

const slug = (name) =>
  String(name || 'preset')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9֐-׿]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'preset'

export function mountEvalPresetRoutes(app) {
  app.get('/api/evals/presets', (_req, res) => res.json({ presets }))

  app.post('/api/evals/presets', (req, res) => {
    const { name, ids = [], path = null } = req.body ?? {}
    if (!name?.trim()) return res.status(400).json({ error: 'a preset needs a name' })
    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json({ error: 'a preset needs at least one case' })

    let id = slug(name)
    let n = 1
    while (presets.some((p) => p.id === id)) id = `${slug(name)}-${++n}`
    /**
     * `path` is remembered but not enforced.
     *
     * The point of a preset is running the SAME set against a DIFFERENT model, so the model
     * cannot be part of what the preset pins. It is stored only as the one you used last,
     * which the screen offers back as a default and you are free to change.
     */
    const preset = { id, name: name.trim(), ids, lastPath: path, savedAt: new Date().toISOString() }
    presets = [preset, ...presets]
    save()
    res.json({ preset, presets })
  })

  app.put('/api/evals/presets/:id', (req, res) => {
    const at = presets.findIndex((p) => p.id === req.params.id)
    if (at === -1) return res.status(404).json({ error: `no preset ${req.params.id}` })
    presets[at] = { ...presets[at], ...(req.body ?? {}), id: presets[at].id }
    save()
    res.json({ preset: presets[at], presets })
  })

  app.delete('/api/evals/presets/:id', (req, res) => {
    presets = presets.filter((p) => p.id !== req.params.id)
    save()
    res.json({ presets })
  })
}

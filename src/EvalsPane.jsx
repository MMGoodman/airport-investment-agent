import { useCallback, useEffect, useState } from 'react'
import './EvalsPane.css'

/**
 * The evaluation set, readable and editable.
 *
 * WHAT THIS REPLACES
 *
 * A row of chips. The pane listed `lax-vs-sna`, `ambiguous-portland`, seventeen more — and
 * nothing else. Every one of those names stands for a claim about what the agent must do,
 * and none of the claims were on screen: not the question, not the tool it must reach for,
 * not the words the answer has to contain. The server was reducing each case to `c.id`
 * before sending it, so the information had been discarded a layer below the screen.
 *
 * TWO KINDS OF CASE, AND THE DIFFERENCE IS DELIBERATE
 *
 * Cases in eval/cases.js are the suite. They are shown in full and cannot be edited here,
 * because that file is hand-maintained on purpose: a case is a claim, and a claim needs a
 * person behind it. Captured drafts live in memory, are freely editable, and become part of
 * the suite only when someone pastes them in.
 *
 * So a file case you want to change is CLONED into a draft first. Nothing is locked away —
 * the deliberate step is kept, and the editing is not.
 */

/**
 * Every field a case can carry, and what each one means.
 *
 * The list is the documentation: `mustMentionOneOf` versus `mustAlsoMentionOneOf` is not
 * guessable, and a field nobody understands is a field nobody uses.
 */
const FIELDS = [
  { key: 'ask', label: 'השאלה', kind: 'text', hint: 'מה נשאל, כלשונו' },
  { key: 'lang', label: 'שפה', kind: 'line', hint: "he או en. ריק = שתיהן" },
  { key: 'expectTools', label: 'כלים שחייבים לרוץ', kind: 'list', hint: 'כולם, בכל סדר' },
  { key: 'expectToolsAny', label: 'לפחות אחד מהכלים', kind: 'list', hint: 'כשיש יותר מדרך נכונה אחת' },
  {
    key: 'expectToolsOnLastTurn',
    label: 'כלים בתור האחרון',
    kind: 'list',
    hint: 'לשיחות רב-תוריות: מה חייב לרוץ בסוף',
  },
  { key: 'expectArgs', label: 'ארגומנטים', kind: 'json', hint: 'תת-קבוצה. מה שלא נכתב לא נבדק' },
  { key: 'expectArgsOnLastTurn', label: 'ארגומנטים בתור האחרון', kind: 'json', hint: '' },
  { key: 'mustMention', label: 'חייב להזכיר', kind: 'list', hint: 'כל אחד מהם, אחרת נכשל' },
  { key: 'mustMentionOneOf', label: 'לפחות אחד מאלה', kind: 'list', hint: 'די באחד' },
  { key: 'mustAlsoMentionOneOf', label: 'ועוד אחד מאלה', kind: 'list', hint: 'קבוצה שנייה, בנפרד' },
  { key: 'mustNotMention', label: 'אסור שיזכיר', kind: 'list', hint: 'הכי שימושי נגד המצאות' },
  {
    key: 'mustReplyInHebrew',
    label: 'חייב לענות בעברית',
    kind: 'bool',
    hint: 'נבדק על התשובה עצמה, לא על השאלה',
  },
  {
    key: 'turns',
    label: 'שיחה מלאה',
    kind: 'lines',
    // It replaces `ask` rather than continuing it — the label said "follow-up turns, after
    // the first", which is how the runner came to prepend an empty one.
    hint: 'שורה לכל תור. אם מלא — מחליף את "השאלה" ולא מתווסף אחריה',
  },
]

const GROUPS = ['target', 'follow-up', 'scope', 'edge', 'hebrew']

const PATH_LABEL = {
  gemini: 'gemini · text',
  openai: 'gpt-realtime · 6/8',
  'openai-hybrid': 'gpt-realtime · 8/8',
  elevenlabs: 'elevenlabs · 6/8',
  'elevenlabs-hybrid': 'elevenlabs · 8/8',
}

const asList = (v) => (Array.isArray(v) ? v.join(', ') : (v ?? ''))
const fromList = (s) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

/** One field, rendered for reading or for editing depending on who owns the case. */
function Field({ field, value, editable, onChange }) {
  const empty =
    value == null || value === '' || value === false || (Array.isArray(value) && value.length === 0)
  // A field with nothing in it is noise on a case you are reading, and a necessary blank on
  // one you are writing.
  if (empty && !editable) return null

  return (
    <div className="ev-field">
      <span className="ev-key">
        {field.label}
        <span className="ev-keyname mono">{field.key}</span>
      </span>

      {!editable ? (
        <span className="ev-val mono">
          {field.kind === 'json' ? JSON.stringify(value) : field.kind === 'bool' ? 'כן' : asList(value)}
        </span>
      ) : field.kind === 'bool' ? (
        <label className="ev-bool">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span>{field.hint}</span>
        </label>
      ) : field.kind === 'text' || field.kind === 'lines' ? (
        <textarea
          rows={field.kind === 'lines' ? 3 : 2}
          value={field.kind === 'lines' ? asList(value).replace(/, /g, '\n') : (value ?? '')}
          placeholder={field.hint}
          onChange={(e) =>
            onChange(
              field.kind === 'lines'
                ? e.target.value.split('\n').map((x) => x.trim()).filter(Boolean)
                : e.target.value,
            )
          }
        />
      ) : field.kind === 'json' ? (
        <textarea
          rows={2}
          className="mono"
          defaultValue={value == null ? '' : JSON.stringify(value, null, 0)}
          placeholder={field.hint || '{ "region": "New England" }'}
          onBlur={(e) => {
            const raw = e.target.value.trim()
            if (!raw) return onChange(undefined)
            try {
              onChange(JSON.parse(raw))
              e.target.setCustomValidity('')
            } catch {
              // Left as typed rather than silently reverted: losing what someone wrote is
              // worse than showing it is not valid yet.
              e.target.setCustomValidity('not valid JSON')
              e.target.reportValidity()
            }
          }}
        />
      ) : (
        <input
          type="text"
          value={asList(value)}
          placeholder={field.hint}
          onChange={(e) => onChange(field.kind === 'list' ? fromList(e.target.value) : e.target.value)}
        />
      )}

      {field.hint && !editable && <span className="ev-hint">{field.hint}</span>}
    </div>
  )
}

function Case({ c, draft, path, onClone, onPatch, onDelete }) {
  const [open, setOpen] = useState(false)
  /** null · 'running' · a finished result. Local to the row, because that is where you asked. */
  const [run, setRun] = useState(null)

  /**
   * Running the case you are looking at, without leaving it.
   *
   * The Batch pane exists for choosing a set; this is the other question, and it is the more
   * common one: you have just edited an assertion and want to know whether it holds. Sending
   * someone to a second screen to select the row they already have open is a step that
   * exists only because the screens are separate.
   */
  const runOne = async (event) => {
    event.stopPropagation()
    setRun('running')
    try {
      const started = await fetch('/api/evals/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [c.id], path }),
      }).then((r) => r.json())
      if (started.error) throw new Error(started.error)

      // Polled rather than awaited: the endpoint answers immediately and the work continues
      // behind it, which is what makes a batch of nineteen the same code as one.
      for (let i = 0; i < 90; i += 1) {
        await new Promise((r) => setTimeout(r, 900))
        const state = await fetch(`/api/evals/run/${started.runId}`).then((r) => r.json())
        if (state.status !== 'running') return setRun(state.results[0] ?? null)
      }
      setRun({ error: 'לא הסתיים בזמן סביר' })
    } catch (err) {
      setRun({ error: err.message })
    }
  }

  return (
    <li className={`ev-case ${draft ? 'draft' : ''}`}>
      {/* Two controls, side by side rather than nested: a button inside a button is invalid
          and the inner one cannot be reached by keyboard at all. */}
      <div className="ev-row">
        <button type="button" className="ev-head" onClick={() => setOpen(!open)}>
          <span className="ev-caret">{open ? '▾' : '▸'}</span>
          <span className="ev-id mono">{c.id}</span>
          <span className="ev-group mono">{c.group}</span>
          {/* The question is the case. Shown on the closed row, because scanning ids was the
              whole problem. */}
          <span className="ev-ask">{c.ask}</span>
          {draft && <span className="ev-badge">טיוטה</span>}
        </button>

        {run && run !== 'running' && (
          <span className={`ev-verdict ${run.error ? 'err' : run.passed ? 'ok' : 'bad'}`}>
            {run.error ? '!' : run.passed ? '✓' : '✕'}
          </span>
        )}
        <button
          type="button"
          className="ev-run"
          disabled={run === 'running'}
          onClick={runOne}
          title={`הרץ מול ${path}`}
        >
          {run === 'running' ? 'רץ…' : 'הרץ'}
        </button>
      </div>

      {run && run !== 'running' && (
        <div className="ev-runout">
          {run.error ? (
            <div className="ev-failure">
              <p className="ev-why">{run.error}</p>
              {run.fix && <p className="ev-fix">{run.fix}</p>}
              {run.raw && (
                <details className="ev-raw">
                  <summary>מה שהספק החזיר</summary>
                  <p className="mono">{run.raw}</p>
                </details>
              )}
            </div>
          ) : (
            <>
              <ul className="ev-checks">
                {run.checks.map((k, i) => (
                  <li key={i} className={k.ok ? 'ok' : 'bad'}>
                    <span>{k.ok ? '✓' : '✕'}</span>
                    <span className="mono">{k.name}</span>
                    {k.detail && <span className="ev-detail">{k.detail}</span>}
                  </li>
                ))}
              </ul>
              {/* The answer it judged, because a verdict you cannot check is one you have
                  to believe — and this project has had two verdicts that were wrong. */}
              <p className="ev-reply">{run.reply}</p>
            </>
          )}
        </div>
      )}

      {open && (
        <div className="ev-body">
          {draft && (
            <div className="ev-field">
              <span className="ev-key">
                מזהה<span className="ev-keyname mono">group</span>
              </span>
              <select value={c.group ?? 'target'} onChange={(e) => onPatch({ group: e.target.value })}>
                {GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          )}

          {FIELDS.map((f) => (
            <Field
              key={f.key}
              field={f}
              value={c[f.key]}
              editable={Boolean(draft)}
              onChange={(v) => onPatch({ [f.key]: v })}
            />
          ))}

          {c._capturedReply && (
            <details className="ev-source">
              <summary>התשובה שממנה נגזרו ההצעות</summary>
              <p>{c._capturedReply}</p>
            </details>
          )}

          <div className="ev-actions">
            {draft ? (
              <button type="button" className="ev-danger" onClick={onDelete}>
                מחק טיוטה
              </button>
            ) : (
              /* The file stays hand-maintained; changing a case means owning a copy of it
                 first. See the note at the top of this file. */
              <button type="button" onClick={onClone}>
                שכפל לטיוטה כדי לערוך
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

export default function EvalsPane() {
  const [state, setState] = useState(null)
  const [captured, setCaptured] = useState([])
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('')
  const [paths, setPaths] = useState([])
  const [path, setPath] = useState('gemini')

  const load = useCallback(() => {
    Promise.all([
      fetch('/api/workbench').then((r) => r.json()),
      fetch('/api/scenarios').then((r) => r.json()),
      fetch('/api/evals/cases').then((r) => r.json()),
    ])
      .then(([wb, sc, ev]) => {
        setState(wb.evals)
        setCaptured(sc.captured ?? [])
        setPaths(ev.paths ?? [])
        setError(null)
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(load, [load])

  const patch = useCallback((id, body) => {
    // Optimistic, because a field that snaps back while you are typing in it is unusable.
    setCaptured((prev) => prev.map((c) => (c.id === id ? { ...c, ...body } : c)))
    fetch(`/api/scenarios/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((err) => setError(err.message))
  }, [])

  const clone = useCallback((c) => {
    fetch('/api/scenarios/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...c, cloneOf: c.id }),
    })
      .then((r) => r.json())
      .then((d) => setCaptured(d.captured ?? []))
      .catch((err) => setError(err.message))
  }, [])

  /**
   * A case written from nothing, rather than captured or cloned.
   *
   * Everything else here starts from something that already happened. But the most useful
   * case is often one for a failure you can DESCRIBE and have not managed to reproduce — and
   * until now there was no way to write one down without editing the file.
   */
  const blank = useCallback(() => {
    fetch('/api/scenarios/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `scenario-${Date.now().toString(36).slice(-4)}`,
        group: 'target',
        ask: '',
        expectTools: [],
        mustMention: [],
      }),
    })
      .then((r) => r.json())
      .then((d) => setCaptured(d.captured ?? []))
      .catch((err) => setError(err.message))
  }, [])

  const remove = useCallback((id) => {
    fetch(`/api/scenarios/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then((d) => setCaptured(d.captured ?? []))
      .catch((err) => setError(err.message))
  }, [])

  if (error) return <p className="ac-warn-note">{error}</p>
  if (!state) return <p className="ac-hint">טוען…</p>

  const q = filter.trim().toLowerCase()
  const match = (c) =>
    !q ||
    [c.id, c.group, c.ask, ...(c.expectTools ?? []), ...(c.mustMention ?? [])]
      .join(' ')
      .toLowerCase()
      .includes(q)

  const fileCases = (state.cases ?? []).filter(match)
  const drafts = captured.filter(match)

  return (
    <div className="ev">
      <div className="ev-top">
        <p className="ac-hint">{state.note}</p>
        <div className="ev-toolbar">
          <input
            type="search"
            className="ev-filter"
            value={filter}
            placeholder="סנן לפי מזהה, שאלה, כלי או מילה"
            onChange={(e) => setFilter(e.target.value)}
          />
          {/* Which path a row's run button uses. Here rather than per row, because you are
              comparing cases against one model, not models against one case. */}
          <label className="ev-path">
            <span>הרצה מול</span>
            <select value={path} onChange={(e) => setPath(e.target.value)}>
              {paths.map((p) => (
                <option key={p} value={p}>
                  {PATH_LABEL[p] ?? p}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="ac-apply" onClick={blank}>
            סנריו חדש
          </button>
        </div>
      </div>

      <section>
        <h4>
          טיוטות <span className="mono num">({drafts.length})</span>
        </h4>
        <p className="ac-hint">
          נתפסו משיחה או שוכפלו מהקובץ. חיות בזיכרון ונעלמות באתחול —{' '}
          <a href="/api/scenarios/export" target="_blank" rel="noreferrer">
            ייצא כקוד
          </a>{' '}
          והדבק ל-<span className="mono">eval/cases.js</span> כדי לשמור.
        </p>
        {drafts.length === 0 ? (
          <p className="ac-hint">אין טיוטות. שכפל מקרה מלמטה, או לכוד סנריו מתוך שיחה.</p>
        ) : (
          <ul className="ev-list">
            {drafts.map((c) => (
              <Case
                key={c.id}
                c={c}
                draft
                path={path}
                onPatch={(body) => patch(c.id, body)}
                onDelete={() => remove(c.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4>
          בקובץ <span className="mono num">({fileCases.length})</span>
        </h4>
        <p className="ac-hint">
          <span className="mono">eval/cases.js</span> — מתוחזק ביד בכוונה. פתח מקרה כדי לראות
          בדיוק מה הוא טוען, ושכפל אותו כדי לערוך.
        </p>
        <ul className="ev-list">
          {fileCases.map((c) => (
            <Case key={c.id} c={c} path={path} onClone={() => clone(c)} />
          ))}
        </ul>
      </section>
    </div>
  )
}

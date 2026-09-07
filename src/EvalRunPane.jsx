import { useCallback, useEffect, useRef, useState } from 'react'
import './EvalRunPane.css'

/**
 * Running cases against a path, and reading what came back.
 *
 * WHAT A RUN ACTUALLY IS
 *
 * A real conversation with the real model: the case's question is asked, whatever tools the
 * model reaches for are executed against the real engine, and the answer is checked. Nothing
 * is mocked, which is the only reason the result means anything — and also why the button
 * says what it costs before you press it.
 *
 * WHY THE EVIDENCE IS ALWAYS SHOWN
 *
 * A red row saying `mustMention: SNA` failed is a claim about a sentence, and this project
 * has been wrong about such claims twice: once when a grader was reading a truncated reply,
 * once when an assertion wanted an IATA code the voice path had correctly spoken as a city
 * name. So every result carries the reply it judged and the calls that produced it, and a
 * failing check names the value it wanted. You should be able to disagree with a verdict
 * without leaving the pane.
 */

const PATH_LABEL = {
  gemini: 'gemini · text',
  // The two realtime rows are the same model with different tool lists, which is the whole
  // comparison: a case that only passes on the second needs a server-placed tool.
  openai: 'gpt-realtime · 6/8 (ישיר)',
  'openai-hybrid': 'gpt-realtime · 8/8 (היברידי)',
  elevenlabs: 'elevenlabs · 6/8 (קסקייד)',
  'elevenlabs-hybrid': 'elevenlabs · 8/8 (היברידי)',
}

function Check({ check }) {
  return (
    <li className={check.ok ? 'ok' : 'bad'}>
      <span className="er-mark">{check.ok ? '✓' : '✕'}</span>
      <span className="er-check-name mono">{check.name}</span>
      {check.detail && <span className="er-check-detail">{check.detail}</span>}
    </li>
  )
}

function Result({ r }) {
  const [open, setOpen] = useState(!r.passed)

  return (
    <li className={`er-result ${r.error ? 'errored' : r.passed ? 'passed' : 'failed'}`}>
      <button type="button" className="er-result-head" onClick={() => setOpen(!open)}>
        <span className="er-mark">{r.error ? '!' : r.passed ? '✓' : '✕'}</span>
        <span className="er-id mono">{r.id}</span>
        {r.attempt > 1 && <span className="er-attempt mono">#{r.attempt}</span>}
        {r.source === 'draft' && <span className="er-badge">טיוטה</span>}
        <span className="er-ask">{r.ask}</span>
        <span className="er-ms mono">{r.ms} ms</span>
      </button>

      {open && (
        <div className="er-result-body">
          {r.error ? (
            /**
             * A dropped socket is not the agent being wrong, and is marked apart so nobody
             * reads it as a failure of the case.
             *
             * Three lines, in the order they are useful: what happened, what to do about it,
             * and the upstream text underneath. That text used to be the whole message —
             * `parts[0].data: required oneof field 'data' must have one initialized field`
             * was what a reader got, and it named nothing they could act on. It is still
             * here because it is the only thing worth searching for; it is just no longer
             * the headline.
             */
            <div className="er-failure">
              <p className="er-why">{r.error}</p>
              {r.fix && <p className="er-fix">{r.fix}</p>}
              {r.raw && (
                <details className="er-raw">
                  <summary>מה שהספק החזיר</summary>
                  <p className="mono">{r.raw}</p>
                </details>
              )}
            </div>
          ) : (
            <>
              <ul className="er-checks">
                {r.checks.map((c, i) => (
                  <Check key={i} check={c} />
                ))}
              </ul>

              <div className="er-evidence">
                <span className="er-label">מה שרץ</span>
                {r.toolCalls.length === 0 ? (
                  <span className="er-tool none">אף כלי לא רץ</span>
                ) : (
                  r.toolCalls.map((t, i) => (
                    <span key={i} className="er-tool mono">
                      {t.tool}
                      {t.args && Object.keys(t.args).length > 0 && (
                        <em> {JSON.stringify(t.args)}</em>
                      )}
                    </span>
                  ))
                )}
              </div>

              <div className="er-evidence">
                <span className="er-label">מה שנאמר</span>
                <p className="er-reply">{r.reply}</p>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}

export default function EvalRunPane() {
  const [cases, setCases] = useState([])
  const [paths, setPaths] = useState([])
  const [path, setPath] = useState('gemini')
  const [chosen, setChosen] = useState(() => new Set())
  const [run, setRun] = useState(null)
  const [error, setError] = useState(null)
  const [presets, setPresets] = useState([])
  const [presetName, setPresetName] = useState('')
  /** How many times each case runs. One is a draw from a distribution, not a measurement. */
  const [repeats, setRepeats] = useState(1)
  const [copied, setCopied] = useState(false)
  const poll = useRef(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/evals/cases').then((r) => r.json()),
      fetch('/api/evals/presets').then((r) => r.json()),
    ])
      .then(([d, p]) => {
        setCases(d.cases ?? [])
        setPaths(d.paths ?? [])
        setPresets(p.presets ?? [])
      })
      .catch((err) => setError(err.message))
  }, [])

  /**
   * Saving the selection under a name.
   *
   * The model is NOT part of it. A preset exists to run the same set against a different
   * model each time, so pinning the model would defeat it — the one you used last is
   * remembered and offered back, and that is all.
   */
  const savePreset = useCallback(() => {
    fetch('/api/evals/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: presetName, ids: [...chosen], path }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setPresets(d.presets ?? [])
        setPresetName('')
      })
      .catch((err) => setError(err.message))
  }, [presetName, chosen, path])

  const removePreset = useCallback((id) => {
    fetch(`/api/evals/presets/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then((d) => setPresets(d.presets ?? []))
      .catch((err) => setError(err.message))
  }, [])

  // A run outlives the poll that watches it; stopping the timer on unmount keeps a closed
  // pane from holding the server in a conversation nobody is reading.
  useEffect(() => () => clearInterval(poll.current), [])

  const watch = useCallback((runId) => {
    clearInterval(poll.current)
    poll.current = setInterval(() => {
      fetch(`/api/evals/run/${runId}`)
        .then((r) => r.json())
        .then((d) => {
          setRun(d)
          if (d.status !== 'running') clearInterval(poll.current)
        })
        .catch(() => clearInterval(poll.current))
    }, 900)
  }, [])

  const start = useCallback(
    (ids) => {
      setError(null)
      fetch('/api/evals/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, path, repeats }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.error) throw new Error(d.error)
          setRun({ id: d.runId, status: 'running', total: d.total, done: 0, results: [], path })
          watch(d.runId)
        })
        .catch((err) => setError(err.message))
    },
    [path, repeats, watch],
  )

  const stop = useCallback(() => {
    if (!run) return
    fetch(`/api/evals/run/${run.id}/stop`, { method: 'POST' }).catch(() => {})
  }, [run])

  const toggle = (id) =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const running = run?.status === 'running'
  const passed = (run?.results ?? []).filter((r) => r.passed === true).length
  const failed = (run?.results ?? []).filter((r) => r.passed === false).length
  const errored = (run?.results ?? []).filter((r) => r.passed === null).length

  /**
   * Attempts grouped back into the case they belong to.
   *
   * With repeats the interesting unit stops being the attempt and becomes the case: three
   * passes and two failures is not five results, it is one case that holds three times in
   * five. FLAKY is the verdict worth having — the behaviour is present and losing, which
   * reads nothing like absent and gets fixed differently.
   */
  const byCase = []
  for (const r of run?.results ?? []) {
    let g = byCase.find((x) => x.id === r.id)
    if (!g) {
      g = { id: r.id, ask: r.ask, source: r.source, attempts: [] }
      byCase.push(g)
    }
    g.attempts.push(r)
  }
  for (const g of byCase) {
    g.ok = g.attempts.filter((a) => a.passed === true).length
    g.of = g.attempts.length
    g.verdict = g.ok === g.of ? 'passed' : g.ok === 0 ? 'failed' : 'flaky'
    g.meanMs = Math.round(g.attempts.reduce((n, a) => n + a.ms, 0) / g.of)
  }

  /** The run as text, for pasting where a screenshot cannot be read. */
  const copy = async () => {
    const secs = (ms) => `${(ms / 1000).toFixed(1)}s`
    const lines = [
      `eval run — ${PATH_LABEL[run.path] ?? run.path}`,
      `${byCase.length} cases × ${run.repeats ?? 1} = ${run.total} conversations`,
      `elapsed ${secs(run.elapsedMs ?? 0)} · ${passed} passed · ${failed} failed${errored ? ` · ${errored} errored` : ''}`,
      '',
      ...byCase.flatMap((g) => [
        `${g.verdict === 'passed' ? 'PASS ' : g.verdict === 'failed' ? 'FAIL ' : 'FLAKY'} ${g.ok}/${g.of}  ${g.id}  (mean ${g.meanMs} ms)`,
        ...(g.verdict === 'passed'
          ? []
          : // Only what did not hold, and only once per distinct reason — a flaky case
            // repeats the same failing check on every attempt that failed.
            [...new Set(
              g.attempts.flatMap((a) =>
                a.error ? [`      ! ${a.error}`] : (a.checks ?? []).filter((c) => !c.ok).map((c) => `      x ${c.name}${c.detail ? ` — ${c.detail}` : ''}`),
              ),
            )]),
      ]),
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
    } catch {
      const el = document.createElement('textarea')
      el.value = lines.join('\n')
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      el.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="er">
      <div className="er-controls">
        <label className="er-path">
          <span>נתיב</span>
          <select value={path} onChange={(e) => setPath(e.target.value)} disabled={running}>
            {paths.map((p) => (
              <option key={p} value={p}>
                {PATH_LABEL[p] ?? p}
              </option>
            ))}
          </select>
        </label>

        <label className="er-path">
          <span>ריצות לכל מקרה</span>
          <select
            value={repeats}
            onChange={(e) => setRepeats(Number(e.target.value))}
            disabled={running}
            title="ריצה אחת היא דגימה, לא מדידה"
          >
            {[1, 2, 3, 5, 8].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="ac-apply"
          disabled={running || chosen.size === 0}
          onClick={() => start([...chosen])}
        >
          {/* The count is on the button because the cost is per case and the button is the
              last place to notice you selected nineteen. */}
          <bdi>הרץ {chosen.size} נבחרים</bdi>
        </button>

        <button
          type="button"
          disabled={running || cases.length === 0}
          onClick={() => start(cases.map((c) => c.id))}
        >
          <bdi>הרץ הכל ({cases.length})</bdi>
        </button>

        {running && (
          <button type="button" className="er-stop" onClick={stop}>
            עצור אחרי המקרה הנוכחי
          </button>
        )}
      </div>

      <section className="er-presets">
        <h4>מקבצים שמורים</h4>
        <p className="ac-hint">
          נשמרים לדיסק ושורדים אתחול — בניגוד לשאר מה שכאן. המודל אינו חלק מהמקבץ:{' '}
          <b>אותו מקבץ, מודל אחר בכל פעם.</b>
        </p>

        {presets.length === 0 ? (
          <p className="ac-hint">אין עדיין. סמן מקרים למטה ושמור אותם בשם.</p>
        ) : (
          <ul className="er-preset-list">
            {presets.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="er-preset"
                  disabled={running}
                  onClick={() => {
                    setChosen(new Set(p.ids))
                    if (p.lastPath && paths.includes(p.lastPath)) setPath(p.lastPath)
                  }}
                  title="טען את המקבץ לבחירה"
                >
                  {p.name}
                  <span className="mono">
                    <bdi>{p.ids.length}</bdi>
                  </span>
                </button>
                <button
                  type="button"
                  className="er-preset-run"
                  disabled={running}
                  onClick={() => start(p.ids)}
                >
                  הרץ
                </button>
                <button
                  type="button"
                  className="er-preset-del"
                  disabled={running}
                  onClick={() => removePreset(p.id)}
                  aria-label={`מחק ${p.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="er-save">
          <input
            type="text"
            value={presetName}
            placeholder="שם למקבץ — למשל: ארבע שאלות ההשוואה"
            onChange={(e) => setPresetName(e.target.value)}
          />
          <button type="button" disabled={!presetName.trim() || chosen.size === 0} onClick={savePreset}>
            <bdi>שמור {chosen.size} נבחרים</bdi>
          </button>
        </div>
      </section>

      <p className="ac-hint">
        כל מקרה הוא שיחה אמיתית עם המודל — הכלים רצים באמת מול המנוע. <b>עולה מכסת API.</b>{' '}
        הפרומפט שנשלח הוא זה שערוך אצלך כרגע, לא זה שבקובץ.
      </p>

      {error && <p className="ac-warn-note">{error}</p>}

      {run && (
        <div className="er-run">
          <div className="er-progress">
            <span className="er-progress-bar">
              <span style={{ inlineSize: `${(run.done / run.total) * 100}%` }} />
            </span>
            <span className="mono">
              <bdi>
                {run.done}/{run.total}
              </bdi>
            </span>
            <span className="er-tally">
              <b className="ok">{passed} ✓</b>
              {failed > 0 && <b className="bad">{failed} ✕</b>}
              {errored > 0 && <b className="err">{errored} !</b>}
            </span>
            <span className="er-status mono">
              {run.status === 'running'
                ? PATH_LABEL[run.path] ?? run.path
                : run.status === 'stopped'
                  ? 'נעצר'
                  : 'הסתיים'}
            </span>
            {/* How long the whole thing took, counted on the server so it survives a pane
                that was closed and reopened mid-run. */}
            {run.elapsedMs != null && (
              <span className="er-elapsed mono">
                <bdi>{(run.elapsedMs / 1000).toFixed(1)}s</bdi>
              </span>
            )}
            <button
              type="button"
              className="er-copy"
              onClick={copy}
              disabled={(run.results ?? []).length === 0}
            >
              {copied ? 'הועתק ✓' : 'העתק סיכום'}
            </button>
          </div>

          {(run.repeats ?? 1) > 1 && (
            <ul className="er-bycase">
              {byCase.map((g) => (
                <li key={g.id} className={g.verdict}>
                  <span className="er-mark">
                    {g.verdict === 'passed' ? '✓' : g.verdict === 'failed' ? '✕' : '≈'}
                  </span>
                  <span className="er-id mono">{g.id}</span>
                  <span className="mono">
                    <bdi>{g.ok}/{g.of}</bdi>
                  </span>
                  {/* The only verdict worth a word: present and losing, not absent. */}
                  <span className="er-flaky-note">
                    {g.verdict === 'flaky' ? 'לא יציב — עובר לפעמים' : ''}
                  </span>
                  <span className="er-ms mono">
                    <bdi>ממוצע {g.meanMs} ms</bdi>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <ul className="er-results">
            {(run.results ?? []).map((r) => (
              <Result key={r.id} r={r} />
            ))}
          </ul>
        </div>
      )}

      <section className="er-pick">
        <h4>
          <bdi>בחר מקרים ({cases.length})</bdi>
        </h4>
        <ul className="er-cases">
          {cases.map((c) => (
            <li key={c.id}>
              <label>
                <input
                  type="checkbox"
                  checked={chosen.has(c.id)}
                  onChange={() => toggle(c.id)}
                  disabled={running}
                />
                <span className="er-id mono">{c.id}</span>
                <span className="er-group mono">{c.group}</span>
                {c.source === 'draft' && <span className="er-badge">טיוטה</span>}
                <span className="er-ask">{c.ask}</span>
              </label>
              {/* One case on its own, because the question mid-session is nearly always
                  about one case and selecting it first is a step with no purpose. */}
              <button
                type="button"
                className="er-single"
                disabled={running}
                onClick={() => start([c.id])}
              >
                הרץ בודד
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

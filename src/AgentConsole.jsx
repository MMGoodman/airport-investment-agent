import { useCallback, useEffect, useRef, useState } from 'react'
import './AgentConsole.css'

/**
 * Everything that shapes the agent, in one place, while a call is not running.
 *
 * The instructions, the tools, the data behind them and the words the transcriber is
 * biased toward have lived only in source files. Changing one meant editing prompt.js,
 * restarting the API by hand and reloading, so a day of tuning was a day of guessing which
 * sentence in a 15,000-character prompt caused a wrong answer.
 *
 * It is a sheet rather than a third column because it is not part of running a call. The
 * runtime layout — conversation on one side, live panel on the other — is what you look at
 * during a session; this is what you open between sessions, and it needs the width.
 *
 * Sections collapse and carry their state in the summary line, so a closed one still says
 * what it holds. Ten always-open groups is how the pipeline board became a wall.
 */

const SECTIONS = [
  { id: 'prompt', label: 'הוראות' },
  { id: 'tools', label: 'כלים' },
  { id: 'knowledge', label: 'ידע' },
  { id: 'vocabulary', label: 'אוצר מילים' },
  { id: 'evals', label: 'הערכות' },
]

/** One collapsible section. The summary is always visible, so nothing hides completely. */
function Section({ id, label, summary, open, onToggle, children }) {
  return (
    <section className={`ac-section ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="ac-head"
        onClick={() => onToggle(open ? null : id)}
        aria-expanded={open}
        aria-controls={`ac-body-${id}`}
      >
        <span className="ac-caret" aria-hidden="true">
          {open ? '▾' : '◂'}
        </span>
        <span className="ac-label">{label}</span>
        <span className="ac-summary mono">{summary}</span>
      </button>
      {open && (
        <div className="ac-body" id={`ac-body-${id}`}>
          {children}
        </div>
      )}
    </section>
  )
}

/**
 * A block of instructions, editable, with the file version kept alongside.
 *
 * The count of changed characters is not decoration: you are editing twelve thousand of
 * them, and without it the only way to see what you did is to remember.
 */
function PromptBlock({ title, value, file, overridden, onChange, onRevert, hint }) {
  const delta = value.length - file.length
  return (
    <div className="ac-prompt">
      <div className="ac-prompt-head">
        <span className="ac-prompt-title">{title}</span>
        <span className="ac-prompt-meta mono">
          {value.length.toLocaleString()} תווים
          {overridden && (
            <>
              {' · '}
              <span className="ac-delta">
                {delta > 0 ? '+' : ''}
                {delta.toLocaleString()}
              </span>
            </>
          )}
        </span>
        {overridden && (
          <button type="button" className="ac-revert" onClick={onRevert}>
            חזור לקובץ
          </button>
        )}
      </div>
      <textarea
        className="ac-textarea mono"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck="false"
        dir="ltr"
        rows={14}
      />
      {hint && <p className="ac-hint">{hint}</p>}
    </div>
  )
}

export default function AgentConsole({ open, onClose }) {
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [section, setSection] = useState('prompt')
  const [draft, setDraft] = useState({ system: null, voiceAddendum: null })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(null)
  const closeRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/workbench')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'could not read the workbench')
      setState(body)
      setDraft({ system: null, voiceAddendum: null })
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  // Escape closes, and focus lands somewhere sensible rather than staying behind the sheet.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const patch = useCallback(
    async (body, note) => {
      setSaving(true)
      try {
        const res = await fetch('/api/workbench', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const out = await res.json()
        if (!res.ok) throw new Error(out.error ?? 'could not apply')
        setState(out.state)
        setDraft({ system: null, voiceAddendum: null })
        setSaved(note ?? (out.changed?.length ? out.changed.join(' · ') : 'נשמר'))
        setError(null)
      } catch (err) {
        setError(err.message)
      } finally {
        setSaving(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!saved) return undefined
    const t = setTimeout(() => setSaved(null), 4000)
    return () => clearTimeout(t)
  }, [saved])

  if (!open) return null

  const p = state?.prompt
  const systemValue = draft.system ?? p?.system ?? ''
  const voiceValue = draft.voiceAddendum ?? p?.voiceAddendum ?? ''
  const dirty =
    (draft.system !== null && draft.system !== p?.system) ||
    (draft.voiceAddendum !== null && draft.voiceAddendum !== p?.voiceAddendum)

  /**
   * A payload from a server older than this bundle is a normal thing to meet: the API has
   * no watcher, so it keeps running whatever it started with while Vite reloads the page
   * on every edit. A field that is not there yet should read as a gap, not take the sheet
   * down — which is what an unguarded .join on a missing array did.
   */
  const summaries = {
    prompt: p
      ? `${(p.system.length + p.voiceAddendum.length).toLocaleString()} תווים${
          p.systemIsOverridden || p.voiceAddendumIsOverridden ? ' · נערך' : ''
        }`
      : '…',
    tools: state ? `${state.tools.filter((t) => t.enabled).length} מתוך ${state.tools.length}` : '…',
    knowledge: state
      ? `${state.knowledge.airports} שדות · ${state.knowledge.regions.length} אזורים`
      : '…',
    vocabulary: state ? `${state.vocabulary.he.terms.length} מונחים` : '…',
    evals: state ? `${state.evals.total} מקרים` : '…',
  }

  return (
    <div className="ac-scrim" role="dialog" aria-modal="true" aria-label="ניהול הסוכן">
      <div className="ac">
        <header className="ac-top">
          <div>
            <h2>הסוכן</h2>
            <p className="ac-sub">
              שינויים חלים בשיחה הבאה, חיים בזיכרון בלבד, ונעלמים בהפעלה מחדש של השרת.
              <br />
              <code>src/agent/prompt.js</code> נשאר מקור האמת.
            </p>
          </div>
          <div className="ac-top-right">
            {saved && <span className="ac-saved">{saved}</span>}
            {error && <span className="ac-error">{error}</span>}
            <button type="button" className="ac-close" onClick={onClose} ref={closeRef}>
              סגור
            </button>
          </div>
        </header>

        <div className="ac-scroll">
          {!state && !error && <p className="ac-loading">קורא את הסוכן…</p>}

          {state && (
            <>
              <Section
                id="prompt"
                label={SECTIONS[0].label}
                summary={summaries.prompt}
                open={section === 'prompt'}
                onToggle={setSection}
              >
                <PromptBlock
                  title="פרומט מערכת"
                  value={systemValue}
                  file={p.fileSystem}
                  overridden={p.systemIsOverridden}
                  onChange={(v) => setDraft((d) => ({ ...d, system: v }))}
                  onRevert={() => patch({ systemPrompt: null }, 'הפרומט הוחזר לקובץ')}
                  hint="החוזה האנליטי: אילו מספרים מותר לומר, מה לעשות כששאלה מחוץ לתחום, ומתי לסיים שיחה."
                />
                <PromptBlock
                  title="תוספת קול"
                  value={voiceValue}
                  file={p.fileVoiceAddendum}
                  overridden={p.voiceAddendumIsOverridden}
                  onChange={(v) => setDraft((d) => ({ ...d, voiceAddendum: v }))}
                  onRevert={() => patch({ voiceAddendum: null }, 'תוספת הקול הוחזרה לקובץ')}
                  hint="נוסף רק בנתיבי הקול. אורך תשובה, איך נשמעים מספרים, ומה לא קוראים בקול."
                />

                <div className="ac-lang">
                  <span className="ac-prompt-title">בלוק שפה</span>
                  <p className="ac-hint">
                    נבנה מהשפה שנבחרה ולא ניתן לעריכה כאן — הוא נגזר מקוד.
                    {' '}
                    עברית {p.languageBlock.he.length.toLocaleString()} תווים · אנגלית{' '}
                    {p.languageBlock.en.length.toLocaleString()}.
                  </p>
                </div>

                <div className="ac-actions">
                  <button
                    type="button"
                    className="ac-apply"
                    disabled={!dirty || saving}
                    onClick={() =>
                      patch({
                        ...(draft.system !== null ? { systemPrompt: draft.system } : {}),
                        ...(draft.voiceAddendum !== null
                          ? { voiceAddendum: draft.voiceAddendum }
                          : {}),
                      })
                    }
                  >
                    {saving ? 'מחיל…' : 'החל על השיחה הבאה'}
                  </button>
                  {dirty && (
                    <button
                      type="button"
                      className="ac-discard"
                      onClick={() => setDraft({ system: null, voiceAddendum: null })}
                    >
                      בטל עריכה
                    </button>
                  )}
                </div>
              </Section>

              <Section
                id="tools"
                label={SECTIONS[1].label}
                summary={summaries.tools}
                open={section === 'tools'}
                onToggle={setSection}
              >
                <ul className="ac-tools">
                  {state.tools.map((tool) => {
                    const params = Object.entries(tool.parameters.properties ?? {})
                    return (
                      <li key={tool.name} className={`ac-tool ${tool.enabled ? '' : 'off'}`}>
                        <div className="ac-tool-head">
                          <label className="ac-tool-toggle">
                            <input
                              type="checkbox"
                              checked={tool.enabled}
                              onChange={(event) => {
                                const off = new Set(
                                  state.tools.filter((t) => !t.enabled).map((t) => t.name),
                                )
                                if (event.target.checked) off.delete(tool.name)
                                else off.add(tool.name)
                                patch({ disabledTools: [...off] })
                              }}
                            />
                            <span className="ac-tool-name mono">{tool.name}</span>
                          </label>
                          <span className={`ac-place ${tool.placement}`}>
                            {tool.placement === 'server' ? 'השרת שלך' : 'הדפדפן'}
                          </span>
                        </div>
                        <p className="ac-tool-desc">{tool.description}</p>
                        {params.length > 0 && (
                          <ul className="ac-params">
                            {params.map(([name, spec]) => (
                              <li key={name}>
                                <code className="mono">{name}</code>
                                <span className="ac-param-type mono">
                                  {spec.enum ? spec.enum.join(' | ') : spec.type}
                                </span>
                                {tool.required.includes(name) && (
                                  <span className="ac-required">חובה</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <p className="ac-hint">
                  <b>המיקום אינו ניתן לעריכה כאן.</b> מי מריץ כלי נקבע לפני שהשיחה מתחילה — זה
                  הטיעון כולו לשים אותו ברשימת הכלים ולא בהוראות, שאיתן אפשר להתווכח. כיבוי כאן
                  רק מצמצם: כלי שהטרנספורט מונע נשאר מנוע.
                </p>
              </Section>

              <Section
                id="knowledge"
                label={SECTIONS[2].label}
                summary={summaries.knowledge}
                open={section === 'knowledge'}
                onToggle={setSection}
              >
                <div className="ac-stats">
                  <div>
                    <b className="mono">{state.knowledge.airports}</b>
                    <span>שדות תעופה</span>
                  </div>
                  <div>
                    <b className="mono">{state.knowledge.annualRows}</b>
                    <span>שורות שנתיות</span>
                  </div>
                  <div>
                    <b className="mono">{(state.knowledge.years ?? []).join(' · ')}</b>
                    <span>שנים</span>
                  </div>
                </div>
                <p className="ac-hint">{state.knowledge.yearsNote}</p>

                <table className="ac-table">
                  <thead>
                    <tr>
                      <th>אזור</th>
                      <th>שדות</th>
                      <th>מדינות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.knowledge.regions.map((r) => (
                      <tr key={r.region}>
                        <td className="mono">{r.region}</td>
                        <td className="mono num">{r.airports}</td>
                        <td className="ac-states mono">{(r.states ?? []).join(' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="ac-hint">
                  המדינות הן התשובה לשאלה שהסוכן טעה בה בקול: ״אריזונה״ אינה אזור כאן, היא בתוך
                  Mountain.
                </p>

                <div className="ac-weights">
                  <span className="ac-prompt-title">משקלות הניקוד</span>
                  <ul>
                    {['utilization', 'growth', 'unmetDemand', 'constraint'].map((k) => (
                      <li key={k}>
                        <code className="mono">{k}</code>
                        <span className="ac-bar" aria-hidden="true">
                          <i style={{ inlineSize: `${state.knowledge.weights[k] * 100}%` }} />
                        </span>
                        <span className="mono num">{state.knowledge.weights[k].toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="ac-hint">{state.knowledge.weightsNote}</p>
                </div>

                <div className="ac-constraints">
                  <span className="ac-prompt-title">
                    הערות מחייבות ({state.knowledge.constraints.length})
                  </span>
                  <p className="ac-hint">{state.knowledge.constraintsNote}</p>
                  <ul>
                    {state.knowledge.constraints.map((c) => (
                      <li key={c.iata}>
                        <span className="ac-iata mono">{c.iata}</span>
                        <span className="ac-ctype">{c.type}</span>
                        <span className="ac-cnote">{c.note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Section>

              <Section
                id="vocabulary"
                label={SECTIONS[3].label}
                summary={summaries.vocabulary}
                open={section === 'vocabulary'}
                onToggle={setSection}
              >
                <div className="ac-stats">
                  <div>
                    <b className="mono">{state.vocabulary.he.terms.length}</b>
                    <span>מונחים · עברית</span>
                  </div>
                  <div>
                    <b className="mono">{state.vocabulary.en.terms.length}</b>
                    <span>מונחים · אנגלית</span>
                  </div>
                  <div>
                    <b className="mono">{state.vocabulary.phantomThreshold}</b>
                    <span>סף פאנטום</span>
                  </div>
                </div>
                <p className="ac-hint">{state.vocabulary.phantomNote}</p>
                <div className="ac-terms">
                  {state.vocabulary.he.terms.map((t) => (
                    <span key={t} className="ac-term mono">
                      {t}
                    </span>
                  ))}
                </div>
              </Section>

              <Section
                id="evals"
                label={SECTIONS[4].label}
                summary={summaries.evals}
                open={section === 'evals'}
                onToggle={setSection}
              >
                <p className="ac-hint">{state.evals.note}</p>
                {state.evals.groups.map((g) => (
                  <div key={g.group} className="ac-eval-group">
                    <span className="ac-prompt-title">
                      {g.group} <span className="mono num">({g.ids.length})</span>
                    </span>
                    <div className="ac-terms">
                      {g.ids.map((id) => (
                        <span key={id} className="ac-term mono">
                          {id}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

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
 * A rail and a pane, not an accordion. An accordion makes you scroll past what you are not
 * reading to reach what you are, and with a 12,000-character textarea in the first section
 * that is a long way down. A rail keeps every destination at a fixed position one click
 * away, which is what keeps five very different sections navigable.
 *
 * The rail collapses to icons and remembers that. Every item keeps its label as a title and
 * an aria-label there, because an icon on its own is not a label — it is a reminder for
 * someone who already knows which one it is.
 */

const RAIL_KEY = 'agent-console-rail'

/** 18px line icons at one stroke weight, so the rail reads as a single set. */
function Icon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }
  if (name === 'prompt') {
    return (
      <svg {...common}>
        <path d="M5 4h11l3 3v13H5z" />
        <path d="M8 10h8M8 14h8M8 18h5" />
      </svg>
    )
  }
  if (name === 'tools') {
    return (
      <svg {...common}>
        <path d="M9 5 5 12l4 7M15 5l4 7-4 7" />
      </svg>
    )
  }
  if (name === 'skills') {
    return (
      <svg {...common}>
        <path d="M12 3 4 7v6c0 4.4 3.4 7.4 8 8 4.6-.6 8-3.6 8-8V7z" />
        <path d="M9.5 12l1.8 1.9 3.4-3.6" />
      </svg>
    )
  }
  if (name === 'knowledge') {
    return (
      <svg {...common}>
        <ellipse cx="12" cy="6" rx="7" ry="2.8" />
        <path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6" />
        <path d="M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6" />
      </svg>
    )
  }
  if (name === 'vocabulary') {
    return (
      <svg {...common}>
        <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M4 7h5M4 12h5M4 17h5" />
      <path d="M13 7.5 14.8 9.3 18.5 5.5M13 16.5l1.8 1.8 3.7-3.8" />
    </svg>
  )
}

/** Grouped by what the section is for: what you set, what it knows, what checks it. */
const GROUPS = [
  {
    label: 'Behaviour',
    items: [
      { id: 'prompt', label: 'Instructions', icon: 'prompt' },
      { id: 'skills', label: 'Skills', icon: 'skills' },
      { id: 'tools', label: 'Tools', icon: 'tools' },
    ],
  },
  {
    label: 'Data',
    items: [
      { id: 'knowledge', label: 'Knowledge base', icon: 'knowledge' },
      { id: 'vocabulary', label: 'Vocabulary', icon: 'vocabulary' },
    ],
  },
  {
    label: 'Quality',
    items: [{ id: 'evals', label: 'Evals', icon: 'evals' }],
  },
]

const ALL_ITEMS = GROUPS.flatMap((group) => group.items)

/**
 * A block of instructions, editable, with the file version kept alongside.
 *
 * The character delta is not decoration: you are editing twelve thousand of them, and
 * without it the only way to see what you changed is to remember.
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
        rows={18}
      />
      {hint && <p className="ac-hint">{hint}</p>}
    </div>
  )
}

/**
 * A collapsed row that opens to everything belonging to it.
 *
 * Used by both skills and tools, because the question is the same from either side: what is
 * this, and what is it linked to. A list of names with no way to see inside makes you go and
 * read the source; a list of everything expanded is the wall the pipeline board used to be.
 */
function Disclosure({ title, meta, tone, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`ac-disc ${open ? 'open' : ''} ${tone ?? ''}`}>
      <button type="button" className="ac-disc-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ac-disc-caret" aria-hidden="true">{open ? '▾' : '◂'}</span>
        <span className="ac-disc-title">{title}</span>
        {meta && <span className="ac-disc-meta mono">{meta}</span>}
      </button>
      {open && <div className="ac-disc-body">{children}</div>}
    </div>
  )
}

/**
 * `bare` renders one pane and nothing around it.
 *
 * The workspace owns the rail and the frame now, so the console's own scrim, rail and
 * header would be a second set of both. Keeping one component for the pane bodies rather
 * than extracting them means the sheet and the workspace can never drift into showing
 * different things under the same name.
 */
export default function AgentConsole({ open, onClose, bare = false, pane: panePropCargo, onPaneChange }) {
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [panePriv, setPane] = useState('prompt')
  const pane = bare ? panePropCargo : panePriv
  const [draft, setDraft] = useState({ system: null, voiceAddendum: null })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(null)
  /** The uploaded knowledge base, loaded separately because it changes on its own. */
  const [docs, setDocs] = useState(null)
  const [uploading, setUploading] = useState(null)
  const [uploadNote, setUploadNote] = useState(null)
  const [railOpen, setRailOpen] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) !== 'collapsed'
    } catch {
      return true
    }
  })
  const closeRef = useRef(null)

  const toggleRail = useCallback(() => {
    setRailOpen((wasOpen) => {
      const next = !wasOpen
      try {
        localStorage.setItem(RAIL_KEY, next ? 'open' : 'collapsed')
      } catch {
        /* private window; the choice just does not survive a reload */
      }
      return next
    })
  }, [])

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

  const loadDocs = useCallback(() => {
    fetch('/api/knowledge')
      .then((r) => r.json())
      .then(setDocs)
      .catch(() => setDocs({ docs: [] }))
  }, [])

  useEffect(() => {
    if (open || bare) {
      load()
      loadDocs()
    }
  }, [open, bare, load, loadDocs])

  useEffect(() => {
    if (!open || bare) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, bare, onClose])

  const patch = useCallback(async (body, note) => {
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
  }, [])

  useEffect(() => {
    if (!saved) return undefined
    const t = setTimeout(() => setSaved(null), 4000)
    return () => clearTimeout(t)
  }, [saved])

  if (!open && !bare) return null

  const p = state?.prompt
  const systemValue = draft.system ?? p?.system ?? ''
  const voiceValue = draft.voiceAddendum ?? p?.voiceAddendum ?? ''
  const dirty =
    (draft.system !== null && draft.system !== p?.system) ||
    (draft.voiceAddendum !== null && draft.voiceAddendum !== p?.voiceAddendum)

  /**
   * The count beside each rail item, so a destination says what it holds before you go
   * there. Every read is guarded: a payload from a server older than this bundle is the
   * normal case here — the API has no watcher and keeps serving what it started with while
   * Vite reloads the page on every edit — and one unguarded field took the whole sheet down.
   */
  const badge = {
    prompt: p && (p.systemIsOverridden || p.voiceAddendumIsOverridden) ? 'נערך' : '',
    tools: state ? `${state.tools.filter((t) => t.enabled).length}/${state.tools.length}` : '',
    knowledge: state ? String(state.knowledge.airports) : '',
    vocabulary: state ? String(state.vocabulary.he.terms.length) : '',
    evals: state ? String(state.evals.total) : '',
  }

  const current = ALL_ITEMS.find((item) => item.id === pane) ?? ALL_ITEMS[0]

  const panes = (
    <>
        {!state && !error && <p className="ac-loading">קורא את הסוכן…</p>}

        {state && pane === 'prompt' && (
          <div className="ac-pane">
            <PromptBlock
              title="פרומט מערכת"
              value={systemValue}
              file={p.fileSystem}
              overridden={p.systemIsOverridden}
              onChange={(value) => setDraft((d) => ({ ...d, system: value }))}
              onRevert={() => patch({ systemPrompt: null }, 'הפרומט הוחזר לקובץ')}
              hint="החוזה האנליטי: אילו מספרים מותר לומר, מה לעשות כששאלה מחוץ לתחום, ומתי לסיים שיחה."
            />
            <PromptBlock
              title="תוספת קול"
              value={voiceValue}
              file={p.fileVoiceAddendum}
              overridden={p.voiceAddendumIsOverridden}
              onChange={(value) => setDraft((d) => ({ ...d, voiceAddendum: value }))}
              onRevert={() => patch({ voiceAddendum: null }, 'תוספת הקול הוחזרה לקובץ')}
              hint="נוסף רק בנתיבי הקול. אורך תשובה, איך נשמעים מספרים, ומה לא קוראים בקול."
            />
            <p className="ac-hint">
              <b>בלוק שפה</b> — נגזר מקוד ולא ניתן לעריכה כאן. עברית{' '}
              {p.languageBlock.he.length.toLocaleString()} תווים · אנגלית{' '}
              {p.languageBlock.en.length.toLocaleString()}.
            </p>

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
          </div>
        )}

        {state && pane === 'skills' && (
          <div className="ac-pane">
            <p className="ac-hint">
              הבסיס נשלח תמיד. הרחבה נטענת ברגע שאחד <b>מהכלים שלה</b> נקרא לראשונה — המודל
              שמושיט יד ל־<code>rank_airports</code> הוא הסימן שכללי הדירוג רלוונטיים עכשיו,
              אז אין נתב ואין מסווג, והסימן לא עולה כלום כי הקריאה קרתה ממילא.
            </p>

            {state.skills?.map((skill) => (
              <Disclosure
                key={skill.id}
                title={skill.name}
                tone={skill.always ? 'always' : ''}
                meta={
                  skill.always
                    ? 'נשלח תמיד'
                    : `${skill.chars.toLocaleString()} תווים · ${skill.tools.length} כלים`
                }
              >
                <p className="ac-hint">{skill.summary}</p>

                {skill.tools.length > 0 && (
                  <div className="ac-field">
                    <span className="ac-prompt-title">כלים שטוענים אותה</span>
                    <div className="ac-terms">
                      {skill.tools.map((tool) => (
                        <button
                          key={tool}
                          type="button"
                          className="ac-term ac-term-link mono"
                          onClick={() => onPaneChange?.('tools')}
                          title="עבור לכלים"
                        >
                          {tool}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {skill.instructions ? (
                  <pre className="ac-skill-text mono" dir="ltr">
                    {skill.instructions}
                  </pre>
                ) : (
                  <p className="ac-hint">
                    ההוראות של הבסיס הן <code>SYSTEM_PROMPT</code> — נמצאות בטאב ״הוראות״,
                    שם אפשר גם לערוך אותן.
                  </p>
                )}
              </Disclosure>
            ))}
          </div>
        )}


        {state && pane === 'tools' && (
          <div className="ac-pane">
            {state.tools.map((tool) => {
              const params = Object.entries(tool.parameters?.properties ?? {})
              return (
                <Disclosure
                  key={tool.name}
                  title={<span className="mono">{tool.name}</span>}
                  tone={tool.enabled ? '' : 'off'}
                  meta={
                    <>
                      {tool.skillName && <span className="ac-tool-skill">{tool.skillName}</span>}
                      <span className={`ac-place ${tool.placement}`}>
                        {tool.placement === 'server' ? 'השרת שלך' : 'הדפדפן'}
                      </span>
                    </>
                  }
                >
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
                    <span>מוצע למודל</span>
                  </label>
                  <p className="ac-tool-desc">{tool.description}</p>
                  {tool.skillName && (
                    <p className="ac-hint">
                      קריאה ראשונה לכלי הזה טוענת את הסקיל <b>{tool.skillName}</b> — הכללים שלו
                      מגיעים לפני שהמודל עונה.
                    </p>
                  )}
                  {params.length > 0 && (
                    <ul className="ac-params">
                      {params.map(([name, spec]) => (
                        <li key={name}>
                          <code className="mono">{name}</code>
                          <span className="ac-param-type mono">
                            {spec.enum ? spec.enum.join(' | ') : spec.type}
                          </span>
                          {(tool.required ?? []).includes(name) && (
                            <span className="ac-required">חובה</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Disclosure>
              )
            })}
            <p className="ac-hint">
              <b>המיקום אינו ניתן לעריכה כאן.</b> מי מריץ כלי נקבע לפני שהשיחה מתחילה — זה
              הטיעון כולו לשים אותו ברשימת הכלים ולא בהוראות, שאיתן אפשר להתווכח. כיבוי כאן
              רק מצמצם: כלי שהטרנספורט מונע נשאר מנוע.
            </p>
          </div>
        )}

        {state && pane === 'knowledge' && (
          <div className="ac-pane">
                <Disclosure
                  title="מסמכים שהעלית"
                  meta={`${docs?.docs?.length ?? 0} · ${docs?.model ?? ''}`}
                  defaultOpen
                >
                  <p className="ac-hint">{docs?.note}</p>

                  <label className="ac-upload">
                    <input
                      type="file"
                      accept={(docs?.accepted ?? ['.md', '.txt', '.csv']).join(',')}
                      onChange={async (event) => {
                        const file = event.target.files?.[0]
                        event.target.value = ''
                        if (!file) return
                        setUploading(file.name)
                        try {
                          // The browser reads the file and posts its text, which is why the
                          // accepted formats are exactly the ones readable without a parser
                          // and why this endpoint needs no multipart dependency.
                          const text = await file.text()
                          const res = await fetch('/api/knowledge', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: file.name, text }),
                          })
                          const body = await res.json()
                          if (!res.ok) throw new Error(body.error ?? 'could not add the file')
                          setUploadNote(`${body.name} — ${body.chunks} קטעים`)
                          loadDocs()
                        } catch (err) {
                          setUploadNote(err.message)
                        } finally {
                          setUploading(null)
                        }
                      }}
                    />
                    <span>{uploading ? `מעבד ${uploading}…` : 'הוסף מסמך'}</span>
                  </label>
                  {uploadNote && <p className="ac-hint">{uploadNote}</p>}

                  {/* Measured, not assumed, and re-measured after the 0.3 threshold this
                      used to cite was removed — the score gate is gone, but the problem it
                      described is not. A Hebrew question ranks the matching English passage
                      5th to 7th of nine chunks, and only four are returned, so the passage
                      that answers is not weaker in the result: it is absent from it.
                      text-embedding-3-large narrows the gap and does not close it. This
                      fails silently, which is why it is said where you upload. */}
                  <p className="ac-warn-note">
                    <b>העלה מסמכים בשפה שבה תשאל.</b> החיפוש חוצה-שפות לא עובד: שאלה בעברית
                    מדרגת את הקטע האנגלי המתאים במקום <span className="mono">5–7</span> מתוך
                    9, ונשלפים ארבעה. כלומר מסמך שעונה על השאלה לא חוזר חלש — הוא לא חוזר
                    בכלל, והסוכן לא יכול לדעת שהוא קיים.
                  </p>

                  {(docs?.docs ?? []).length === 0 ? (
                    <p className="ac-hint">
                      אין עדיין מסמכים. מה שתעלה כאן נחתך לקטעים לפי כותרות ופסקאות, מוטמע,
                      ונשלף דרך הכלי <code>search_knowledge</code> — לא מוזרק להקשר בשקט, כדי
                      שכל טענה שנבנית עליו תישאר ניתנת לבדיקה בטרייס.
                    </p>
                  ) : (
                    <ul className="ac-docs">
                      {docs.docs.map((doc) => (
                        <li key={doc.id}>
                          <span className="ac-doc-name mono">{doc.name}</span>
                          <span className="ac-doc-meta mono">
                            {doc.chunks} קטעים · {doc.chars.toLocaleString()} תווים
                          </span>
                          <button
                            type="button"
                            className="ac-doc-remove"
                            onClick={async () => {
                              await fetch(`/api/knowledge/${doc.id}`, { method: 'DELETE' })
                              loadDocs()
                            }}
                          >
                            הסר
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Disclosure>


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
                {state.knowledge.regions.map((region) => (
                  <tr key={region.region}>
                    <td className="mono">{region.region}</td>
                    <td className="mono num">{region.airports}</td>
                    <td className="ac-states mono">{(region.states ?? []).join(' ')}</td>
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
                {['utilization', 'growth', 'unmetDemand', 'constraint'].map((key) => (
                  <li key={key}>
                    <code className="mono">{key}</code>
                    <span className="ac-bar" aria-hidden="true">
                      <i
                        style={{
                          inlineSize: `${(state.knowledge.weights?.[key] ?? 0) * 100}%`,
                        }}
                      />
                    </span>
                    <span className="mono num">
                      {(state.knowledge.weights?.[key] ?? 0).toFixed(2)}
                    </span>
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
          </div>
        )}

        {state && pane === 'vocabulary' && (
          <div className="ac-pane">
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
              {state.vocabulary.he.terms.map((term) => (
                <span key={term} className="ac-term mono">
                  {term}
                </span>
              ))}
            </div>
          </div>
        )}

        {state && pane === 'evals' && (
          <div className="ac-pane">
            <p className="ac-hint">{state.evals.note}</p>
            {state.evals.groups.map((group) => (
              <div key={group.group} className="ac-eval-group">
                <span className="ac-prompt-title">
                  {group.group} <span className="mono num">({group.ids.length})</span>
                </span>
                <div className="ac-terms">
                  {group.ids.map((id) => (
                    <span key={id} className="ac-term mono">
                      {id}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
    </>
  )


  if (bare) {
    return (
      <div className="ac-bare">
        {saved && <p className="ac-saved">{saved}</p>}
        {panes}
      </div>
    )
  }

  return (
    <div className="ac-scrim" role="dialog" aria-modal="true" aria-label="ניהול הסוכן">
      <div className={`ac ${railOpen ? '' : 'rail-collapsed'}`}>
        <nav className="ac-rail" aria-label="מקטעי הסוכן">
          <div className="ac-rail-top">
            <button
              type="button"
              className="ac-rail-toggle"
              onClick={toggleRail}
              aria-expanded={railOpen}
              aria-label={railOpen ? 'צמצם את הסרגל' : 'הרחב את הסרגל'}
              title={railOpen ? 'צמצם את הסרגל' : 'הרחב את הסרגל'}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
                <path d="M14.5 4.5v15" />
              </svg>
            </button>
            {railOpen && <span className="ac-rail-title">הסוכן</span>}
          </div>

          {GROUPS.map((group) => (
            <div className="ac-rail-group" key={group.label}>
              {railOpen && <p className="ac-rail-group-label">{group.label}</p>}
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`ac-rail-item ${pane === item.id ? 'on' : ''}`}
                      onClick={() => setPane(item.id)}
                      aria-current={pane === item.id ? 'page' : undefined}
                      aria-label={item.label}
                      title={item.label}
                    >
                      <Icon name={item.icon} />
                      {railOpen && (
                        <>
                          <span className="ac-rail-label">{item.label}</span>
                          {badge[item.id] && (
                            <span className="ac-rail-badge mono">{badge[item.id]}</span>
                          )}
                        </>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="ac-main">
          <header className="ac-top">
            <div>
              <h2>{current.label}</h2>
              <p className="ac-sub">
                שינויים חלים בשיחה הבאה, חיים בזיכרון בלבד, ונעלמים בהפעלה מחדש של השרת.{' '}
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
            {panes}
          </div>
        </div>
      </div>
    </div>
  )
}

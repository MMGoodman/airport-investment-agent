import { useCallback, useEffect, useState } from 'react'
import './ScenarioCapture.css'

/**
 * Turn a conversation turn into an eval case, without leaving the conversation.
 *
 * Every case in eval/cases.js was written by hand after a failure was noticed, read out of
 * a trace and translated into assertions. That loop is why the suite is nineteen cases
 * after a day of finding bugs: most of what went wrong never became a test, because
 * writing one meant stopping and switching to JavaScript.
 *
 * This does the transcription. The question is what was asked, the tools are what actually
 * ran with the arguments they got, and the assertions are the figures and codes the answer
 * actually contained — each one a chip you keep or drop.
 *
 * Nothing is written to the file. A case is a claim about what the agent SHOULD do, and a
 * captured turn is what it DID — which is often the point, because you reach for this when
 * something went wrong. Reviewing is the whole job, so the reply that produced the
 * suggestions stays on screen while you decide.
 */

/** A suggestion you keep or drop. Kept ones become assertions; dropped ones are gone. */
function Chip({ value, on, onToggle }) {
  return (
    <button
      type="button"
      className={`sc-chip mono ${on ? 'on' : ''}`}
      onClick={onToggle}
      aria-pressed={on}
    >
      {value}
    </button>
  )
}

export default function ScenarioCapture({ turn, onClose }) {
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [keep, setKeep] = useState({ mention: new Set(), oneOf: new Set() })

  useEffect(() => {
    if (!turn) return undefined
    let alive = true
    setSaved(false)
    setError(null)
    fetch('/api/scenarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(turn),
    })
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'could not draft a scenario')
        return body.draft
      })
      .then((d) => {
        if (!alive) return
        setDraft(d)
        // Everything suggested starts kept; dropping is the deliberate act, not keeping.
        setKeep({
          mention: new Set(d.mustMention ?? []),
          oneOf: new Set(d.mustMentionOneOf ?? []),
        })
      })
      .catch((err) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [turn])

  const toggle = useCallback((bucket, value) => {
    setKeep((current) => {
      const next = new Set(current[bucket])
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return { ...current, [bucket]: next }
    })
  }, [])

  const save = useCallback(async () => {
    if (!draft) return
    try {
      const res = await fetch(`/api/scenarios/${encodeURIComponent(draft.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group: draft.group,
          ask: draft.ask,
          mustMention: [...keep.mention],
          mustMentionOneOf: [...keep.oneOf],
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'could not save')
      setSaved(true)
    } catch (err) {
      setError(err.message)
    }
  }, [draft, keep])

  useEffect(() => {
    if (!turn) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [turn, onClose])

  if (!turn) return null

  return (
    <div className="sc-scrim" role="dialog" aria-modal="true" aria-label="מקרה בחינה חדש">
      <div className="sc">
        <header className="sc-top">
          <div>
            <h3>מקרה בחינה מתוך השיחה</h3>
            <p className="sc-sub">
              נשמר בזיכרון. מקרה הוא טענה על מה שהסוכן <b>צריך</b> לעשות, ומה שנתפס כאן הוא מה
              שהוא <b>עשה</b> — קרא לפני ששומרים.
            </p>
          </div>
          <button type="button" className="ac-close" onClick={onClose}>
            סגור
          </button>
        </header>

        <div className="sc-body">
          {error && <p className="ac-error">{error}</p>}
          {!draft && !error && <p className="ac-loading">מכין טיוטה…</p>}

          {draft && (
            <>
              <label className="sc-field">
                <span>מזהה</span>
                <input
                  className="mono"
                  value={draft.id}
                  onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                  dir="ltr"
                  readOnly
                  title="נגזר מהשאלה. משנים אותו בקובץ, אחרי הייצוא."
                />
              </label>

              <label className="sc-field">
                <span>קבוצה</span>
                <select
                  value={draft.group}
                  onChange={(e) => setDraft({ ...draft, group: e.target.value })}
                >
                  {['target', 'follow-up', 'scope', 'edge', 'hebrew'].map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>

              <label className="sc-field">
                <span>השאלה</span>
                <textarea
                  rows={2}
                  value={draft.ask}
                  onChange={(e) => setDraft({ ...draft, ask: e.target.value })}
                />
              </label>

              {draft.expectTools?.length > 0 && (
                <div className="sc-field">
                  <span>כלים שרצו</span>
                  <div className="sc-chips">
                    {draft.expectTools.map((t) => (
                      <span key={t} className="sc-chip on mono locked">
                        {t}
                      </span>
                    ))}
                  </div>
                  <p className="sc-hint">
                    נתפסו מהריצה בפועל, לא נוחשו. הארגומנטים נשמרים איתם.
                  </p>
                </div>
              )}

              {draft.mustMention?.length > 0 && (
                <div className="sc-field">
                  <span>חייב להזכיר</span>
                  <div className="sc-chips">
                    {draft.mustMention.map((v) => (
                      <Chip
                        key={v}
                        value={v}
                        on={keep.mention.has(v)}
                        onToggle={() => toggle('mention', v)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {draft.mustMentionOneOf?.length > 0 && (
                <div className="sc-field">
                  <span>מספרים שנאמרו</span>
                  <div className="sc-chips">
                    {draft.mustMentionOneOf.map((v) => (
                      <Chip
                        key={v}
                        value={v}
                        on={keep.oneOf.has(v)}
                        onToggle={() => toggle('oneOf', v)}
                      />
                    ))}
                  </div>
                  <p className="sc-hint">
                    החוזה של הסוכן הוא ששום מספר לא מופיע בלי שהגיע מכלי — ולכן המספרים הם
                    בדיוק מה ששווה לנעוץ. השאר רק את אלה שהתשובה <b>חייבת</b> להכיל.
                  </p>
                </div>
              )}

              <details className="sc-source">
                <summary>התשובה שממנה נגזרו ההצעות</summary>
                <p>{draft._capturedReply || '(לא נשמרה תשובה)'}</p>
              </details>

              <div className="sc-actions">
                <button type="button" className="ac-apply" onClick={save} disabled={saved}>
                  {saved ? 'נשמר' : 'שמור מקרה'}
                </button>
                {saved && (
                  <a className="sc-export" href="/api/scenarios/export" target="_blank" rel="noreferrer">
                    ייצא הכל כקוד ל-eval/cases.js
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

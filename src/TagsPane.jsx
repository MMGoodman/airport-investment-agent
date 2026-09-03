import { useCallback, useEffect, useState } from 'react'
import { turnsFrom } from './turns.js'
import './TagsPane.css'

/**
 * Defining tags, and running them over the conversation on screen.
 *
 * The engine was proved on real turns before this existed, which is the right order: a
 * console around a rule language nobody has tested is a lot of buttons for a guess. What it
 * found on its first real run — an answer naming three New York airports on the back of a
 * knowledge search that returned nothing — is the thing this screen exists to make routine.
 *
 * TWO KINDS, SHOWN AS TWO KINDS
 *
 * A rule and an LLM tag are not variants of one form. A rule is a predicate you can read and
 * argue with before running it; an LLM tag is a question whose answer arrives with a reason
 * and might be wrong. Presenting them identically would suggest the verdicts are equally
 * hard, and they are not — so a rule shows its clauses and an LLM tag shows its prompt, and
 * a hit from each is labelled.
 */

const EMPTY_RULE = { id: '', name: '', kind: 'rule', summary: '', rule: { all: [['noTools', '', false]] } }
const EMPTY_LLM = { id: '', name: '', kind: 'llm', summary: '', prompt: '' }

/** Predicates that take an argument, so the form knows when to offer a field. */
const TAKES_ARG = new Set(['usedTool', 'slowerThan', 'askMatches', 'replyMatches'])

const PREDICATE_HELP = {
  noTools: 'לא רצה אף קריאת כלי',
  usedTool: 'כלי בשם הזה רץ',
  ranOnServer: 'כלי מושם רץ מחוץ לדפדפן',
  slowerThan: 'איטי מ־N מילישניות',
  askMatches: 'השאלה תואמת ביטוי רגולרי',
  replyMatches: 'התשובה תואמת ביטוי רגולרי',
  noFigures: 'אין בתשובה שום כמות — לא בספרות ולא במילים',
}

function RuleEditor({ draft, setDraft, predicates }) {
  const clauses = draft.rule?.all ?? []

  return (
    <div className="tg-rule">
      {clauses.map(([name, arg, negate], i) => (
        <div className="tg-clause" key={i}>
          <select
            value={name}
            onChange={(e) => {
              const chosen = e.target.value
              const next = [...clauses]
              next[i] = [chosen, TAKES_ARG.has(chosen) ? (arg ?? '') : '', negate]
              setDraft({ ...draft, rule: { all: next } })
            }}
          >
            {predicates.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          {TAKES_ARG.has(name) && (
            <input
              type="text"
              value={arg ?? ''}
              placeholder={name === 'slowerThan' ? '5000' : name === 'usedTool' ? 'end_call' : 'ביטוי'}
              onChange={(e) => {
                const next = [...clauses]
                next[i] = [name, e.target.value, negate]
                setDraft({ ...draft, rule: { all: next } })
              }}
            />
          )}

          <label className="tg-negate">
            <input
              type="checkbox"
              checked={Boolean(negate)}
              onChange={(e) => {
                const next = [...clauses]
                next[i] = [name, arg, e.target.checked]
                setDraft({ ...draft, rule: { all: next } })
              }}
            />
            <span>הפוך</span>
          </label>

          {clauses.length > 1 && (
            <button
              type="button"
              className="tg-drop"
              onClick={() => setDraft({ ...draft, rule: { all: clauses.filter((_, at) => at !== i) } })}
              aria-label="הסר תנאי"
            >
              ×
            </button>
          )}
          <span className="tg-help">{PREDICATE_HELP[name] ?? ''}</span>
        </div>
      ))}

      {/* Every clause must hold — there is no "any", because a tag firing on either of two
          unrelated conditions is usually two tags. Said here so nobody looks for the switch. */}
      <p className="ac-hint">כל התנאים חייבים להתקיים יחד.</p>
      <button
        type="button"
        className="tg-add-clause"
        onClick={() => setDraft({ ...draft, rule: { all: [...clauses, ['noTools', '', false]] } })}
      >
        + תנאי
      </button>
    </div>
  )
}

export default function TagsPane({ messages = [] }) {
  const [tags, setTags] = useState([])
  const [predicates, setPredicates] = useState([])
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const [useLlm, setUseLlm] = useState(true)

  const load = useCallback(() => {
    fetch('/api/tags')
      .then((r) => r.json())
      .then((d) => {
        setTags(d.tags ?? [])
        setPredicates(d.predicates ?? [])
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(load, [load])

  const save = async () => {
    setError(null)
    const body = { ...draft, id: draft.id?.trim() || draft.name?.trim().replace(/\s+/g, '-') }
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) return setError(json.error ?? 'לא נשמר')
    setTags(json.tags ?? [])
    setDraft(null)
  }

  const remove = async (id) => {
    await fetch(`/api/tags/${encodeURIComponent(id)}`, { method: 'DELETE' })
    load()
  }

  const turns = turnsFrom(messages)

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/tags/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turns, useLlm }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'ההרצה נכשלה')
      setResult(json)
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="tg">
      {error && <p className="ac-warn-note">{error}</p>}

      {/* The run comes first: the tags below are a means to it, and a screen that opens on
          a form makes you configure something before you have seen what it does. */}
      <section className="tg-run">
        <div className="tg-run-head">
          <div>
            <b>הרץ על השיחה הנוכחית</b>
            <p className="ac-hint">
              {turns.length === 0
                ? 'אין עדיין תורות בשיחה הזו. שאל משהו, ואז חזור לכאן.'
                : `${turns.length} תורות על המסך`}
            </p>
          </div>
          <button type="button" className="tg-run-go" onClick={run} disabled={running || turns.length === 0}>
            {running ? 'מריץ…' : 'הרץ תגיות'}
          </button>
        </div>
        <label className="tg-llm-toggle">
          <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
          {/* Rules cost nothing; the LLM tags cost a call per turn per tag. Worth being able
              to skip when you only want the deterministic answer. */}
          <span>כלול תגיות LLM (קריאה למודל לכל תור)</span>
        </label>
      </section>

      {result && (
        <section className="tg-result">
          <h4>סיכום</h4>
          <ul className="tg-counts">
            {result.summary.map((s) => (
              <li key={s.id} className={s.count ? 'hit' : ''}>
                <span className="tg-count mono">{s.count}</span>
                <span className="tg-count-name">{s.name}</span>
                <span className="tg-kind mono">{s.kind}</span>
              </li>
            ))}
          </ul>

          <h4>לפי תור</h4>
          {result.turns.map((entry, i) =>
            entry.hits.length === 0 ? null : (
              <div className="tg-turn" key={i}>
                <p className="tg-ask">{entry.turn.ask}</p>
                <p className="tg-reply">{entry.turn.reply}</p>
                <ul className="tg-hits">
                  {entry.hits.map((hit, at) => (
                    <li key={at} className={hit.failed ? 'failed' : hit.kind}>
                      <span className="tg-kind mono">{hit.kind}</span>
                      <b>{hit.name}</b>
                      {/* The reason is the whole value of an LLM verdict: a tag that says yes
                          and cannot say why is an assertion. */}
                      {hit.why && (
                        <span className="tg-why">
                          {hit.why}
                          {/* The quote is what makes a verdict checkable rather than trusted.
                              A grader that accuses without one is asserting, and this one was
                              measurably wrong about figures that were in front of it. */}
                          {hit.quote && <q className="tg-quote">{hit.quote}</q>}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
          {result.turns.every((t) => t.hits.length === 0) && (
            <p className="ac-hint">אף תגית לא נדלקה על השיחה הזו.</p>
          )}
        </section>
      )}

      <section className="tg-defs">
        <div className="tg-defs-head">
          <h4>תגיות</h4>
          <div className="tg-new">
            <button type="button" onClick={() => setDraft({ ...EMPTY_RULE })}>
              + כלל
            </button>
            <button type="button" onClick={() => setDraft({ ...EMPTY_LLM })}>
              + LLM
            </button>
          </div>
        </div>

        {draft && (
          <div className="tg-editor">
            <div className="tg-editor-row">
              <input
                type="text"
                placeholder="שם התגית"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <input
                type="text"
                className="mono"
                placeholder="id (אופציונלי)"
                value={draft.id}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              />
            </div>
            <input
              type="text"
              placeholder="מה התגית הזו מחפשת"
              value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            />

            {draft.kind === 'rule' ? (
              <RuleEditor draft={draft} setDraft={setDraft} predicates={predicates} />
            ) : (
              <textarea
                rows={4}
                placeholder="השאלה שתישאל על כל תור. התשובה תחזור עם נימוק."
                value={draft.prompt}
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              />
            )}

            <div className="tg-editor-actions">
              <button type="button" className="tg-save" onClick={save}>
                שמור
              </button>
              <button type="button" onClick={() => setDraft(null)}>
                בטל
              </button>
            </div>
          </div>
        )}

        <ul className="tg-list">
          {tags.map((tag) => (
            <li key={tag.id} className={tag.kind}>
              <div className="tg-list-head">
                <span className="tg-kind mono">{tag.kind}</span>
                <b>{tag.name}</b>
                <button type="button" className="tg-edit" onClick={() => setDraft({ ...tag })}>
                  ערוך
                </button>
                <button type="button" className="tg-drop" onClick={() => remove(tag.id)} aria-label="מחק">
                  ×
                </button>
              </div>
              {tag.summary && <p className="tg-summary">{tag.summary}</p>}
              <p className="tg-def mono">
                {tag.kind === 'rule'
                  ? (tag.rule?.all ?? [])
                      .map(([n, a, neg]) => `${neg ? '!' : ''}${n}${a ? `(${a})` : ''}`)
                      .join(' · ')
                  : tag.prompt}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

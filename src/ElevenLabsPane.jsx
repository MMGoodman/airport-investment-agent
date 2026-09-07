import { useCallback, useEffect, useState } from 'react'
import './ElevenLabsPane.css'

/**
 * The ElevenLabs agent's settings, and what the platform currently holds.
 *
 * WHY IT SHOWS BOTH
 *
 * Every other pane in this workbench edits something this process owns, so what you typed
 * IS what is running. Here it is not: the agent lives on their servers, and this pane sends
 * to it. Between typing and applying, the two disagree — and the disagreement is the thing
 * you most need to see, because a setting you meant to change and did not is invisible in
 * any interface that shows only one of them.
 *
 * So the live column is read back from their API on every load, and a field whose value
 * differs from it is marked. Nothing is inferred from what was sent.
 */

function Field({ field, value, live, voices, onChange }) {
  const options = field.from === 'voices' ? voices.map((v) => v.id) : (field.options ?? null)
  const labelFor = (id) => {
    if (field.from === 'voices') return voices.find((v) => v.id === id)?.name ?? id
    const warn = field.avoid?.[id]
    return warn ? `${id} — ${warn}` : id || '(ריק)'
  }

  /**
   * A blank field is not a disagreement.
   *
   * It means "whatever the sync script falls back to", and that fallback is usually exactly
   * what the platform is running. Marking those amber flagged half the pane on first open —
   * including the transcriber, which was neither unset nor wrong, just not overridden.
   *
   * So: only a value you have actually chosen can differ. A blank one shows what the
   * default turned out to be, which is the useful thing to know about it.
   */
  const chosen = String(value ?? '').trim() !== ''
  const differs = chosen && live != null && String(live) !== String(value)

  return (
    <div className={`el-field ${differs ? 'differs' : ''}`}>
      <span className="el-key">
        {field.label}
        <span className="el-keyname mono">{field.key.replace('ELEVENLABS_', '')}</span>
      </span>

      <span className="el-input">
        {options ? (
          <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
            {/* The current value first even when it is not in the list — a model typed into
                .env must not vanish because this file has not heard of it. */}
            {!options.includes(value ?? '') && <option value={value ?? ''}>{labelFor(value)}</option>}
            {options.map((o) => (
              <option key={o} value={o}>
                {labelFor(o)}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={field.kind === 'number' ? 'number' : 'text'}
            value={value ?? ''}
            step={field.kind === 'number' ? 'any' : undefined}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        <span className="el-hint">
          {field.hint}
          {/* Where the list came from. A picker built from a guess is what offered a model
              that does not exist; one read off the platform cannot. */}
          {field.discovered && (
            <span className="el-discovered"> · <bdi>{options.length} ערכים מה-API שלהם</bdi></span>
          )}
          {/* Where a field carries a constraint that is not in its own list of values. */}
          {field.note && <span className="el-note"> · {field.note}</span>}
        </span>
      </span>

      <span className={`el-live mono ${chosen ? '' : 'default'}`}>
        {live == null
          ? ''
          : differs
            ? `אצלם: ${labelFor(live)}`
            : chosen
              ? '✓'
              : // Not set here, so the script's default decided it. This is what it decided.
                `ברירת מחדל: ${labelFor(live)}`}
      </span>
    </div>
  )
}

/** Which live reading corresponds to which field. Only some settings come back from them. */
const LIVE_KEY = {
  ELEVENLABS_LLM: 'llm',
  ELEVENLABS_VOICE_ID: 'voiceId',
  ELEVENLABS_TTS_MODEL: 'ttsModel',
  ELEVENLABS_ASR_PROVIDER: 'transcriber',
  ELEVENLABS_TURN_EAGERNESS: 'turnEagerness',
  ELEVENLABS_TURN_TIMEOUT: 'turnTimeout',
}

export default function ElevenLabsPane() {
  const [state, setState] = useState(null)
  const [values, setValues] = useState({})
  const [error, setError] = useState(null)
  const [applying, setApplying] = useState(false)
  const [output, setOutput] = useState(null)

  const load = useCallback(() => {
    fetch('/api/elevenlabs/config')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setState(d)
        setValues(d.values)
        setError(null)
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(load, [load])

  const apply = useCallback(() => {
    setApplying(true)
    setOutput(null)
    fetch('/api/elevenlabs/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })
      .then((r) => r.json())
      .then((d) => {
        setOutput(d)
        // Re-read rather than assume: the point of the live column is that it is measured.
        load()
      })
      .catch((err) => setError(err.message))
      .finally(() => setApplying(false))
  }, [values, load])

  if (error) return <p className="ac-warn-note">{error}</p>
  if (!state) return <p className="ac-hint">טוען…</p>

  const live = state.live.hybrid ?? state.live.direct
  const changed = state.fields.some(
    (f) => String(values[f.key] ?? '') !== String(state.values[f.key] ?? ''),
  )

  return (
    <div className="el">
      <p className="ac-hint">{state.note}</p>

      {live && (
        <p className="el-live-note">
          מה שרץ אצלם כרגע: <b>{live.name}</b> · {live.llm} · {live.transcriber} ·{' '}
          <bdi>{live.ignoreTerms} מילים שלא קוטעות</bdi>
        </p>
      )}

      <div className="el-fields">
        {state.fields.map((f) => (
          <Field
            key={f.key}
            field={f}
            value={values[f.key]}
            live={live?.[LIVE_KEY[f.key]]}
            voices={state.voices}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
          />
        ))}
      </div>

      <div className="el-actions">
        <button type="button" className="ac-apply" onClick={apply} disabled={applying}>
          {applying ? 'מסנכרן…' : 'החל ושלח לסוכן'}
        </button>
        {changed && !applying && <span className="el-dirty">יש שינויים שלא נשלחו</span>}
        <button type="button" onClick={() => setValues(state.values)} disabled={applying || !changed}>
          בטל שינויים
        </button>
      </div>

      {output && (
        /* The sync script's own words. It names both agents, the tool split and where the
           backup went; a friendlier summary would drop the half that matters. */
        <div className={`el-output ${output.ok ? '' : 'bad'}`}>
          <span className="el-output-head">
            {output.ok ? 'סונכרן' : `נכשל (exit ${output.code})`}
          </span>
          {/* The reassuring half, which the raw output does not say: validation runs before
              anything is written, so a rejected apply leaves the agent exactly as it was. */}
          {!output.ok && (
            <p className="el-untouched">
              הסוכן <b>לא השתנה</b> — הוולידציה נכשלה לפני שנכתב משהו. הערכים שלמעלה עדיין
              ממתינים לשליחה.
            </p>
          )}
          <pre className="mono">{output.output || output.error}</pre>
        </div>
      )}
    </div>
  )
}

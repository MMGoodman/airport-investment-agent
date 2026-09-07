import { useEffect, useState } from 'react'
import { toolNameFrom } from './agent/toolName.js'
import './CreateAgent.css'

/**
 * Making an agent: what it is, then how it runs, then what it can do.
 *
 * THE ORDER, AND WHY IT IS NOT THE ONE THIS FILE ARGUED FOR
 *
 * The pipeline used to be step one, defended here on the grounds that it decides what the
 * later steps contain. That is true of exactly two fields — the voice picker and the voice
 * addendum — and both are conditional renders that work from any position. Against that
 * sat a real cost: the first question asked was `elevenlabs · hybrid`, which is the last
 * thing anyone has decided. You sit down knowing "an insurance agent", not knowing which
 * transport it should run on.
 *
 * So identity is first, and the pipeline second — with the MODEL AND VOICE moved into it.
 * Those were under "identity", where they never belonged: a voice is a property of the
 * pipeline that offers it, not of who the agent is, and the step that mixed a name with a
 * model was two questions wearing one heading.
 *
 * What remains order-forced is further down: tools before skills, because a skill names the
 * tools whose first call loads it and nothing names skills back.
 *
 * WHAT CHANGED, AND WHY IT WAS WRONG BEFORE
 *
 * This flow used to end by offering the airport analyst's eight tools and five skills to
 * every new agent, and its 8,700-character prompt as the only starting point. That is the
 * right form for building a SECOND AIRPORT AGENT and the wrong one for building anything
 * else — which is what this screen is for. Somebody making a travel-insurance agent was
 * asked which airport-ranking functions it should have.
 *
 * So the last three steps now start empty and offer authoring instead of borrowing: prompt
 * templates that are about the shape of a prompt rather than about aviation, a tool you
 * declare yourself, a skill you write yourself. The deployment's own tools and skills are
 * still reachable, folded away, under a heading that says whose they are.
 *
 * WHERE THE LINE STILL IS
 *
 * A declared tool is a contract, not an implementation — a name, a purpose and the
 * arguments the model may pass. That is the whole of what the model ever sees, so it is
 * most of a tool. It is not the code that answers it. The step says this out loud and hands
 * you the specification to give to whoever writes that code, rather than implying a
 * "create tool" button does more than it does.
 */

const STEPS = ['זהות', 'איך הוא רץ', 'פרומפט', 'כלים', 'סקילים']

export default function CreateAgent({ onCreated, onCancel }) {
  const [options, setOptions] = useState(null)
  const [step, setStep] = useState(0)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [openai, setOpenai] = useState(null)
  const [voices, setVoices] = useState([])

  const [draft, setDraft] = useState({
    defaultTransport: '',
    name: '',
    tagline: '',
    model: '',
    voice: '',
    systemPrompt: '',
    voiceAddendum: '',
    // Borrowed from this deployment. Empty, and it stays empty unless someone opens the
    // folded section and asks for one.
    toolNames: [],
    // Declared here.
    customTools: [],
    skills: [],
    sampleQuestions: [],
  })

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))

  /** Edit one declared tool in place, by index, without rebuilding the list at the callsite. */
  const setTool = (at, patch) =>
    setDraft((d) => ({
      ...d,
      customTools: d.customTools.map((t, i) => (i === at ? { ...t, ...patch } : t)),
    }))

  const setParam = (at, pAt, patch) =>
    setTool(at, {
      parameters: draft.customTools[at].parameters.map((p, i) => (i === pAt ? { ...p, ...patch } : p)),
    })

  useEffect(() => {
    fetch('/api/agent-store/options')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setOptions(d)
      })
      .catch((err) => setError(err.message))
  }, [])

  /**
   * The model and voice lists, from whichever platform the chosen pipeline runs on.
   *
   * Fetched when the pipeline is picked rather than up front: asking OpenAI for its voices
   * to build an ElevenLabs agent is a request nobody needed.
   */
  const transport = options?.transports.find((t) => t.id === draft.defaultTransport)
  useEffect(() => {
    if (transport?.voice === 'openai' && !openai) {
      fetch('/api/openai/config')
        .then((r) => r.json())
        .then((d) => !d.error && setOpenai(d))
        .catch(() => {})
    }
    if (transport?.voice === 'elevenlabs' && voices.length === 0) {
      fetch('/api/elevenlabs/config')
        .then((r) => r.json())
        .then((d) => !d.error && setVoices(d.voices ?? []))
        .catch(() => {})
    }
  }, [transport, openai, voices.length])

  const create = () => {
    setSaving(true)
    fetch('/api/agent-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        onCreated?.(d.agent)
      })
      .catch((err) => setError(err.message))
      .finally(() => setSaving(false))
  }

  if (error) return <p className="ac-warn-note">{error}</p>
  if (!options) return <p className="ac-hint">טוען…</p>

  // One entry per step, in step order. Swapping the first two steps without swapping these
  // would gate the name on the pipeline and the pipeline on nothing.
  const canAdvance = [
    Boolean(draft.name.trim()),
    Boolean(draft.defaultTransport),
    Boolean(draft.systemPrompt.trim()),
    true,
    true,
  ][step]

  return (
    <div className="ca">
      <div className="ca-head">
        <h2>סוכן חדש</h2>
        <button type="button" className="ca-cancel" onClick={onCancel}>
          ביטול
        </button>
      </div>

      <ol className="ca-steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <span className="mono">{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="ca-step">
          <label className="ca-field">
            <span>שם</span>
            <input
              type="text"
              value={draft.name}
              placeholder="למשל: סוכן ביטוח נסיעות"
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
          <label className="ca-field">
            <span>שורה אחת</span>
            <input
              type="text"
              value={draft.tagline}
              placeholder="מה הוא עושה, במשפט"
              onChange={(e) => set({ tagline: e.target.value })}
            />
          </label>

          {/**
           * What the empty conversation offers, if anything.
           *
           * Optional and it stays optional: an agent with none opens with its name and its
           * one-liner, which is honest. The alternative — filling the space with another
           * agent's questions — is exactly the bug that made every new agent greet its first
           * caller by offering to compare airport congestion.
           */}
          <span className="ca-sub">שאלות לדוגמה במסך הפתיחה</span>
          <p className="ac-hint">אופציונלי. אלה הצ'יפים שנלחצים בשיחה ריקה.</p>
          <div className="ca-samples">
            {draft.sampleQuestions.map((q, at) => (
              <div key={at}>
                <input
                  type="text"
                  value={q}
                  placeholder="מה הלקוח באמת ישאל"
                  onChange={(e) =>
                    set({
                      sampleQuestions: draft.sampleQuestions.map((s, i) =>
                        i === at ? e.target.value : s,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="ca-drop"
                  onClick={() =>
                    set({ sampleQuestions: draft.sampleQuestions.filter((_, i) => i !== at) })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            {draft.sampleQuestions.length < 6 && (
              <button
                type="button"
                className="ca-add-small"
                onClick={() => set({ sampleQuestions: [...draft.sampleQuestions, ''] })}
              >
                + שאלה
              </button>
            )}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="ca-step">
          <p className="ac-hint">
            הצנרת, והקול שהיא קובעת. סוכן טקסט לא בוחר קול; קסקייד בוחר שלושה שלבים
            בנפרד; מודל נייטיב אחד עושה הכל.
          </p>
          <div className="ca-pipes">
            {options.transports.map((t) => (
              <label key={t.id} className={draft.defaultTransport === t.id ? 'on' : ''}>
                <input
                  type="radio"
                  name="pipe"
                  checked={draft.defaultTransport === t.id}
                  onChange={() => set({ defaultTransport: t.id, model: '', voice: '' })}
                />
                <span>
                  <b className="mono">{t.label}</b>
                  <em>{t.note}</em>
                </span>
              </label>
            ))}
          </div>

          {/* Only where the pipeline has one to choose — and now beside the pipeline that
              decides it, rather than a step earlier under "identity", where a model and a
              voice never belonged. */}
          {transport?.voice === 'openai' && openai && (
            <>
              <label className="ca-field">
                <span>מודל</span>
                <select value={draft.model} onChange={(e) => set({ model: e.target.value })}>
                  <option value="">{openai.current.model} (ברירת מחדל)</option>
                  {openai.models.realtime.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="ca-field">
                <span>קול</span>
                <select value={draft.voice} onChange={(e) => set({ voice: e.target.value })}>
                  <option value="">{openai.current.voice} (ברירת מחדל)</option>
                  {openai.voices.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>
            </>
          )}

          {transport?.voice === 'elevenlabs' && (
            <>
              <label className="ca-field">
                <span>קול</span>
                <select value={draft.voice} onChange={(e) => set({ voice: e.target.value })}>
                  <option value="">ברירת המחדל של הסוכן הקיים</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </label>
              {/* The constraint that has already cost one failed sync. */}
              <p className="ac-hint">
                מודל השפה ומודל ההקראה נבחרים בפאנל ElevenLabs אחרי היצירה — הם מוגדרים על
                הסוכן אצלם, לא על הסשן.
              </p>
            </>
          )}

          {transport && transport.voice === false && (
            <p className="ac-hint">נתיב טקסט — אין קול לבחור.</p>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="ca-step">
          <p className="ac-hint">
            מה שהמודל מקבל לפני כל שיחה. זה החלק שקובע יותר מכל היתר.
          </p>

          {/**
           * Templates about the SHAPE of a prompt, not about this deployment's subject.
           *
           * What was here: one button copying the airport analyst's 8,700 characters. For a
           * second airport agent, the fastest possible start. For anything else, a wall of
           * rules about peer sets and demand scores that has to be read and deleted first —
           * and unread, it quietly hands a travel-insurance agent instructions about never
           * presenting a score as a return on investment.
           *
           * Each of these is short enough to read in full, which is the only way a template
           * is a starting point rather than an inheritance.
           */}
          <div className="ca-templates">
            {options.promptTemplates.map((t) => (
              <button
                key={t.id}
                type="button"
                className={draft.systemPrompt === t.systemPrompt ? 'on' : ''}
                onClick={() => set({ systemPrompt: t.systemPrompt, voiceAddendum: t.voiceAddendum })}
              >
                <b>{t.name}</b>
                <em>{t.note}</em>
              </button>
            ))}
          </div>

          <textarea
            className="ca-prompt"
            rows={14}
            value={draft.systemPrompt}
            placeholder="מי הסוכן, מה מותר לו לומר, ומה אסור לו להמציא."
            onChange={(e) => set({ systemPrompt: e.target.value })}
          />
          {transport?.voice && (
            <>
              <span className="ca-sub">תוספת לנתיב הקולי</span>
              <textarea
                className="ca-prompt"
                rows={5}
                value={draft.voiceAddendum}
                placeholder="איך לדבר כשמקריאים אותו בקול — אורך, מספרים, קצב."
                onChange={(e) => set({ voiceAddendum: e.target.value })}
              />
            </>
          )}
        </section>
      )}

      {step === 3 && (
        <section className="ca-step">
          {/**
           * The honest description of what this step produces.
           *
           * A contract is most of a tool — it is the entirety of what the model ever sees,
           * and a badly named or badly described one is the usual reason a tool is never
           * called or is called with nonsense. It is not the code that answers it, and
           * saying so here is cheaper than letting someone discover it when the agent
           * reports a tool failure.
           */}
          <p className="ac-hint">
            כלי הוא <b>חוזה</b>: שם, למה הוא, ואילו ארגומנטים המודל רשאי להעביר. זה כל מה
            שהמודל אי פעם רואה — ולכן זה רוב הכלי. <b>זה לא הקוד שעונה לו.</b> אחרי היצירה
            אפשר להעתיק את המפרט ולתת למי שכותב את המימוש.
          </p>

          <ul className="ca-decl">
            {draft.customTools.map((tool, at) => (
              <li key={at}>
                <div className="ca-decl-head">
                  <input
                    type="text"
                    className="mono"
                    value={tool.name}
                    placeholder="get_policy_status"
                    /* Scrubbed as you type, with the same function the store uses. A name
                       that changes on save is a name the skill step already offered as a
                       trigger under its old spelling. */
                    onChange={(e) => setTool(at, { name: toolNameFrom(e.target.value) })}
                  />
                  <select
                    value={tool.placement}
                    onChange={(e) => setTool(at, { placement: e.target.value })}
                  >
                    {options.toolPlacements.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="ca-drop"
                    onClick={() =>
                      set({ customTools: draft.customTools.filter((_, i) => i !== at) })
                    }
                  >
                    הסר
                  </button>
                </div>

                <input
                  type="text"
                  value={tool.description}
                  placeholder="מה הוא עושה, ומתי המודל אמור לקרוא לו"
                  onChange={(e) => setTool(at, { description: e.target.value })}
                />

                <div className="ca-params">
                  {tool.parameters.map((p, pAt) => (
                    <div className="ca-param" key={pAt}>
                      <input
                        type="text"
                        className="mono"
                        value={p.name}
                        placeholder="policy_id"
                        onChange={(e) => setParam(at, pAt, { name: toolNameFrom(e.target.value) })}
                      />
                      <select
                        value={p.type}
                        onChange={(e) => setParam(at, pAt, { type: e.target.value })}
                      >
                        {options.paramTypes.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={p.description}
                        placeholder="מה זה, במילים של המשתמש"
                        onChange={(e) => setParam(at, pAt, { description: e.target.value })}
                      />
                      <label title="חובה">
                        <input
                          type="checkbox"
                          checked={p.required}
                          onChange={(e) => setParam(at, pAt, { required: e.target.checked })}
                        />
                        <span>חובה</span>
                      </label>
                      <button
                        type="button"
                        className="ca-drop"
                        onClick={() =>
                          setTool(at, {
                            parameters: tool.parameters.filter((_, i) => i !== pAt),
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="ca-add-small"
                    onClick={() =>
                      setTool(at, {
                        parameters: [
                          ...tool.parameters,
                          { name: '', type: 'string', description: '', required: false },
                        ],
                      })
                    }
                  >
                    + פרמטר
                  </button>
                </div>

                {/* Stored as text, never executed. The label says so rather than implying a
                    box that runs what you type. */}
                <details className="ca-handler">
                  <summary>סקיצה של המימוש — נשמרת כטקסט, לא רצה</summary>
                  <textarea
                    className="ca-prompt mono"
                    rows={6}
                    value={tool.handler}
                    placeholder={`// ${tool.name || 'tool'}(args) — מה אמור לקרות\n// למשל: GET https://api.example.com/...\n// מה חוזר, ומה קורה כשזה נכשל`}
                    onChange={(e) => setTool(at, { handler: e.target.value })}
                  />
                </details>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="ca-add"
            onClick={() =>
              set({
                customTools: [
                  ...draft.customTools,
                  { name: '', description: '', placement: 'browser', parameters: [], handler: '' },
                ],
              })
            }
          >
            + כלי חדש
          </button>

          {/**
           * NOTHING BORROWED. The airport agent's eight tools are not offered here.
           *
           * They were the whole step once, then a folded section "still reachable" — and
           * folding it was the wrong fix for the right complaint. Those tools are not this
           * environment's furniture; they are ONE AGENT'S, code that reaches the BTS scoring
           * engine and means nothing without it. Offering them from a screen that builds a
           * different agent is the same coupling wearing a `<details>`.
           *
           * An agent's tools belong to that agent. If a second one over the same data is
           * ever wanted, the honest shape is copying an agent — not a menu that quietly
           * makes every new agent part airport analyst.
           */}
        </section>
      )}

      {step === 4 && (
        <section className="ca-step">
          <p className="ac-hint">
            סקיל הוא כללים שנטענים רק כשהם נעשים רלוונטיים — בפעם הראשונה שאחד מהכלים שלו
            נקרא. ככה הפרומפט הבסיסי נשאר קטן, והכללים המותנים מגיעים כשיש להם מקום.
          </p>

          <ul className="ca-decl">
            {draft.skills.map((skill, at) => (
              <li key={at}>
                <div className="ca-decl-head">
                  <input
                    type="text"
                    className="mono"
                    value={skill.id ?? ''}
                    placeholder="claims"
                    onChange={(e) =>
                      set({
                        skills: draft.skills.map((s, i) =>
                          i === at ? { ...s, id: e.target.value, name: e.target.value } : s,
                        ),
                      })
                    }
                  />
                  <label className="ca-always" title="נטען בכל שיחה במקום להמתין לכלי">
                    <input
                      type="checkbox"
                      checked={Boolean(skill.eager)}
                      onChange={(e) =>
                        set({
                          skills: draft.skills.map((s, i) =>
                            i === at ? { ...s, eager: e.target.checked } : s,
                          ),
                        })
                      }
                    />
                    <span>תמיד</span>
                  </label>
                  <button
                    type="button"
                    className="ca-drop"
                    onClick={() => set({ skills: draft.skills.filter((_, i) => i !== at) })}
                  >
                    הסר
                  </button>
                </div>

                {/**
                 * Which tools bring it, chosen from the ones this agent actually has.
                 *
                 * A skill pointing at a tool the agent was never given is a rule that can
                 * never load — silently, because nothing ever calls the trigger. Offering
                 * only the declared and borrowed tools makes that unrepresentable.
                 *
                 * A skill marked "always" needs no trigger, so the picker is hidden rather
                 * than shown as a list that does nothing.
                 */}
                {!skill.eager && (
                  <div className="ca-triggers">
                    {[...draft.customTools.map((t) => t.name).filter(Boolean), ...draft.toolNames]
                      .map((name) => (
                        <label key={name}>
                          <input
                            type="checkbox"
                            checked={(skill.tools ?? []).includes(name)}
                            onChange={(e) =>
                              set({
                                skills: draft.skills.map((s, i) =>
                                  i === at
                                    ? {
                                        ...s,
                                        tools: e.target.checked
                                          ? [...(s.tools ?? []), name]
                                          : (s.tools ?? []).filter((n) => n !== name),
                                      }
                                    : s,
                                ),
                              })
                            }
                          />
                          <span className="mono">{name}</span>
                        </label>
                      ))}
                    {draft.customTools.length === 0 && draft.toolNames.length === 0 && (
                      <span className="ac-hint">
                        אין עדיין כלים. חזור לשלב הקודם, או סמן <b>תמיד</b>.
                      </span>
                    )}
                  </div>
                )}

                <textarea
                  className="ca-prompt"
                  rows={5}
                  value={skill.instructions ?? ''}
                  placeholder="הכללים שנטענים כאן. מה לומר, מה לא, ומה לעשות כשהכלי מחזיר כלום."
                  onChange={(e) =>
                    set({
                      skills: draft.skills.map((s, i) =>
                        i === at ? { ...s, instructions: e.target.value } : s,
                      ),
                    })
                  }
                />
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="ca-add"
            onClick={() =>
              set({
                skills: [...draft.skills, { id: '', name: '', tools: [], instructions: '', eager: false }],
              })
            }
          >
            + סקיל חדש
          </button>

          {/* The airport agent's five skills are not offered here either, and for the same
              reason: they are rules about rankings, weather and hanging up, written for one
              agent. See the tools step. */}
        </section>
      )}

      <div className="ca-actions">
        {step > 0 && (
          <button type="button" onClick={() => setStep(step - 1)}>
            חזרה
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" className="ac-apply" disabled={!canAdvance} onClick={() => setStep(step + 1)}>
            הבא
          </button>
        ) : (
          <button type="button" className="ac-apply" disabled={saving} onClick={create}>
            {saving ? 'יוצר…' : 'צור סוכן'}
          </button>
        )}
      </div>
    </div>
  )
}

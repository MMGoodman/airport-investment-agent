import { useCallback, useEffect, useState } from 'react'
import './Dashboard.css'

/**
 * What happened across every stored conversation.
 *
 * ONE IDEA CARRIES THIS SCREEN
 *
 * The same tag means opposite things on two transports. "The caller asked for the weather and
 * did not get it" is the placement working on a path where that tool is withheld, and a bug on
 * a path where it is not. A dashboard that shows one number for both is worse than no
 * dashboard: it reports a problem that is half a feature and invites someone to go fix the
 * half that was never broken.
 *
 * So no count appears without the path it happened on, and no tag row appears without the
 * verdict that follows from how many tools that path carried. The verdict is rendered as a
 * sentence rather than a colour, because a colour needs a legend and this needs to be read
 * correctly by someone seeing it for the first time.
 */

const nf = new Intl.NumberFormat('he-IL')

/**
 * Whether a gap on this path is a fault or the design.
 *
 * Only tags that are ABOUT something not happening get a verdict. "A placed tool ran" is not
 * better or worse for having run on a narrowed path, and labelling it would train the reader
 * to ignore the label where it matters.
 */
const ABSENCE_TAGS = new Set(['asked-and-not-answered', 'answered-without-a-tool'])

function verdictFor(row) {
  if (!ABSENCE_TAGS.has(row.tagId)) return null
  if (row.toolsOffered == null || row.toolsTotal == null) return null
  return row.toolsOffered < row.toolsTotal
    ? { tone: 'expected', text: 'תקין — הכלי נמנע בנתיב הזה' }
    : { tone: 'fault', text: 'תקלה — הכלי היה זמין ולא רץ' }
}

function Stat({ label, value, hint }) {
  return (
    <div className="db-stat">
      <span className="db-stat-value mono">{value}</span>
      <span className="db-stat-label">{label}</span>
      {hint && <span className="db-stat-hint">{hint}</span>}
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [conversations, setConversations] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/dashboard').then((r) => r.json()),
      fetch('/api/sessions?limit=20').then((r) => r.json()),
    ])
      .then(([dash, sessions]) => {
        if (dash.error) throw new Error(dash.error)
        setData(dash)
        setConversations(sessions.conversations ?? [])
        setError(null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  if (loading && !data) return <p className="ac-hint">טוען…</p>
  if (error) return <p className="ac-warn-note">{error}</p>

  const empty = (data?.totals?.conversations ?? 0) === 0

  return (
    <div className="db">
      <div className="db-head">
        <div className="db-stats">
          <Stat label="שיחות" value={nf.format(data.totals.conversations)} />
          <Stat label="תורות" value={nf.format(data.totals.turns)} />
          <Stat
            label="תגיות שנדלקו"
            value={nf.format(data.totals.tagHits)}
            hint={data.totals.turns ? `${Math.round((data.totals.tagHits / data.totals.turns) * 100)}% מהתורות` : null}
          />
        </div>
        <button type="button" className="db-refresh" onClick={load}>
          רענן
        </button>
      </div>

      {empty && (
        <p className="ac-hint">
          עדיין לא נשמרה שיחה. שיחות קוליות נשמרות ומתויגות מעצמן ברגע שהן נסגרות — נהל שיחה
          וסיים אותה, וחזור לכאן.
        </p>
      )}

      {!empty && (
        <>
          <section className="db-section">
            <h4>לפי נתיב</h4>
            <div className="db-table" role="table">
              <div className="db-row db-header" role="row">
                <span>נתיב</span>
                <span>שיחות</span>
                <span>תורות</span>
                <span>לטנסי ממוצעת</span>
                <span>כלים</span>
              </div>
              {data.byProvider.map((row) => (
                <div className="db-row" role="row" key={row.provider}>
                  <span className="db-path mono">{row.providerLabel}</span>
                  <span className="mono">{nf.format(row.conversations)}</span>
                  <span className="mono">{nf.format(row.turns)}</span>
                  <span className="mono">{row.avgMs == null ? '—' : `${nf.format(row.avgMs)} ms`}</span>
                  {/* Narrowed paths are marked here as well as in the tag rows: it is the
                      fact that explains most of what is below it. */}
                  <span
                    className={`mono db-tools ${
                      row.toolsOffered != null && row.toolsOffered < row.toolsTotal ? 'narrowed' : ''
                    }`}
                  >
                    {row.toolsOffered ?? '?'}/{row.toolsTotal ?? '?'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="db-section">
            <h4>תגיות, לפי הנתיב שבו נדלקו</h4>
            <p className="ac-hint">
              אותה תגית על שני נתיבים היא שני ממצאים שונים. ספירת הכלים היא מה שמבדיל ביניהם.
            </p>
            <ul className="db-tags">
              {data.byTag.map((row) => {
                const verdict = verdictFor(row)
                return (
                  <li key={`${row.tagId}:${row.provider}`} className={verdict?.tone ?? ''}>
                    <div className="db-tag-head">
                      <span className="db-hits mono">{nf.format(row.hits)}</span>
                      <b>{row.name}</b>
                      <span className="db-kind mono">{row.kind}</span>
                      <span className="db-tag-path mono">{row.providerLabel}</span>
                      <span
                        className={`mono db-tools ${
                          row.toolsOffered != null && row.toolsOffered < row.toolsTotal ? 'narrowed' : ''
                        }`}
                      >
                        {row.toolsOffered ?? '?'}/{row.toolsTotal ?? '?'}
                      </span>
                    </div>
                    {verdict && <p className={`db-verdict ${verdict.tone}`}>{verdict.text}</p>}
                    <p className="db-tag-meta">
                      ב-{nf.format(row.conversations)} {row.conversations === 1 ? 'שיחה' : 'שיחות'}
                    </p>
                  </li>
                )
              })}
              {data.byTag.length === 0 && <p className="ac-hint">אף תגית לא נדלקה עדיין.</p>}
            </ul>
          </section>

          <section className="db-section">
            <h4>שימוש בכלים</h4>
            <div className="db-usage">
              {data.toolUsage.map((row) => {
                const tools = Object.entries(row.tools).sort((a, b) => b[1].calls - a[1].calls)
                return (
                  <div className="db-usage-path" key={row.provider}>
                    <div className="db-usage-head">
                      <span className="db-path mono">{row.providerLabel}</span>
                      <span
                        className={`mono db-tools ${
                          row.toolsOffered != null && row.toolsOffered < row.toolsTotal ? 'narrowed' : ''
                        }`}
                      >
                        {row.toolsOffered ?? '?'}/{row.toolsTotal ?? '?'}
                      </span>
                    </div>
                    {tools.length === 0 ? (
                      <p className="ac-hint">אף כלי לא רץ בנתיב הזה.</p>
                    ) : (
                      <ul>
                        {tools.map(([name, use]) => (
                          <li key={name}>
                            <span className="mono db-tool-name">{name}</span>
                            <span className="mono db-tool-calls">{nf.format(use.calls)}</span>
                            {/* Which of them never touched the browser: the placement
                                working, counted rather than asserted. */}
                            {use.onServer > 0 && (
                              <span className="db-tool-server">{nf.format(use.onServer)} בשרת</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="db-section">
            <h4>שיחות אחרונות</h4>
            <ul className="db-calls">
              {conversations.map((c) => (
                <li key={c.id}>
                  <span className="db-path mono">{c.providerLabel}</span>
                  <span className="db-call-meta mono">
                    {c.turnCount} תורות · {c.tagHits} תגיות
                  </span>
                  <span className="db-call-when">
                    {c.endedAt ? new Date(c.endedAt).toLocaleString('he-IL') : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

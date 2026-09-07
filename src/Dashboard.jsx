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

/**
 * What the agent actually does with a turn, as a shape rather than a list.
 *
 * The question "how is my agent behaving" is not answered by any single number here. It is
 * answered by proportions: of everything it was asked, how much did it look something up,
 * how much of that ran where the browser could not reach, and how much came back with a
 * finding on it.
 *
 * A funnel rather than a pie, because these are nested — every server call is a tool call,
 * and a tagged turn may or may not have used a tool. Widths are shares of all turns, so two
 * bars can be compared by eye without reading either number.
 *
 * The last bar is the only one where bigger is worse, and it is the only one in amber.
 */
function Behaviour({ data }) {
  const turns = data.totals.turns
  if (turns === 0) return null

  const withTools = data.toolUsage.reduce(
    (n, path) => n + Object.values(path.tools).reduce((m, t) => m + t.calls, 0),
    0,
  )
  const onServer = data.toolUsage.reduce(
    (n, path) => n + Object.values(path.tools).reduce((m, t) => m + t.onServer, 0),
    0,
  )
  const tagged = data.totals.tagHits

  const bars = [
    { label: 'תורות', value: turns, tone: 'base', note: 'כל מה שנשאל' },
    { label: 'קריאות כלים', value: withTools, tone: 'tools', note: 'חיפש במקום לענות מהזיכרון' },
    { label: 'רצו בשרת', value: onServer, tone: 'server', note: 'הדפדפן לא יכול היה להריץ' },
    { label: 'תגיות שנדלקו', value: tagged, tone: 'flag', note: 'ממצא על תור' },
  ]
  const widest = Math.max(...bars.map((b) => b.value), 1)

  return (
    <section className="db-section">
      <h4>איך הסוכן מתנהג</h4>
      <p className="ac-hint">
        פרופורציות על פני כל השיחות. השורה האחרונה היא היחידה שגבוה בה גרוע.
      </p>
      <ul className="db-bars">
        {bars.map((bar) => (
          <li key={bar.label} className={bar.tone}>
            <span className="db-bar-label">{bar.label}</span>
            <span className="db-bar-track">
              <span className="db-bar-fill" style={{ inlineSize: `${(bar.value / widest) * 100}%` }} />
            </span>
            <span className="db-bar-value mono">{nf.format(bar.value)}</span>
            <span className="db-bar-share mono">
              {bar.value === turns ? '' : `${Math.round((bar.value / turns) * 100)}%`}
            </span>
            <span className="db-bar-note">{bar.note}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Stat({ label, value, hint }) {
  return (
    <div className="db-stat">
      <span className="db-stat-value mono">{value}</span>
      <span className="db-stat-label">{label}</span>
      {hint && (
        <span className="db-stat-hint">
          <bdi>{hint}</bdi>
        </span>
      )}
    </div>
  )
}

export default function Dashboard({ onOpenPath }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((dash) => {
        if (dash.error) throw new Error(dash.error)
        setData(dash)
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
          <Behaviour data={data} />

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
                /* Every row is a claim about a set of conversations, and the only way to
                   check a claim is to read one — so a row is a way in, not a dead end. */
                <button
                  type="button"
                  className="db-row db-row-go"
                  key={row.provider}
                  onClick={() => onOpenPath?.({ provider: row.provider })}
                  title={`הצג את השיחות של ${row.providerLabel}`}
                >
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
                </button>
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
                    <button
                      type="button"
                      className="db-tag-head db-row-go"
                      onClick={() => onOpenPath?.({ provider: row.provider })}
                      title="הצג את השיחות של הנתיב הזה"
                    >
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
                    </button>
                    {verdict && <p className={`db-verdict ${verdict.tone}`}>{verdict.text}</p>}
                    {/* Isolated for the same reason as the History rows: a count beside a
                        Hebrew noun inside an LTR box gets reordered, and reads as a
                        different, equally fluent number. */}
                    <p className="db-tag-meta">
                      <bdi>
                        ב-{nf.format(row.conversations)}{' '}
                        {row.conversations === 1 ? 'שיחה' : 'שיחות'}
                      </bdi>
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

        </>
      )}
    </div>
  )
}

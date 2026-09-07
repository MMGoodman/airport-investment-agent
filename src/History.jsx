import { useCallback, useEffect, useMemo, useState } from 'react'
import './History.css'

/**
 * Stored conversations, and one of them read back.
 *
 * Its own tab rather than a section of the dashboard, because they answer different
 * questions and are used at different moments. The dashboard answers "how is the agent
 * behaving" across everything; this answers "what happened in that call". Buried at the
 * bottom of an aggregate, a transcript is something you scroll past on your way to a
 * number — and the transcript is where a number stops being a number.
 *
 * A count of "claim with no source: 4" means nothing until you can read the four sentences.
 */

const nf = new Intl.NumberFormat('he-IL')

/**
 * How the list is ordered.
 *
 * Newest first stays the default, because the last call is the one you were just in and
 * came here to check. The other three exist for questions the default cannot answer at
 * twenty-nine rows and will not answer at two hundred:
 *
 * `tags` is the one that earns its place. A tag is the grader saying something is worth a
 * look — a figure with no source, a tool that should have run — and twenty-four of the
 * twenty-nine stored calls carry at least one. Sorted by time they are scattered through
 * the list; sorted by tag count the ones worth reading are the ones at the top.
 */
const SORTS = {
  new: { label: 'חדש → ישן', by: (a, b) => String(b.endedAt).localeCompare(String(a.endedAt)) },
  old: { label: 'ישן → חדש', by: (a, b) => String(a.endedAt).localeCompare(String(b.endedAt)) },
  tags: { label: 'הכי הרבה תגיות', by: (a, b) => b.tagHits - a.tagHits || String(b.endedAt).localeCompare(String(a.endedAt)) },
  turns: { label: 'הכי ארוכה', by: (a, b) => b.turnCount - a.turnCount || String(b.endedAt).localeCompare(String(a.endedAt)) },
}

/**
 * What to group by, and why these two.
 *
 * PIPELINE is the category this project actually has. Every comparison here is between
 * paths — 8/8 against 6/8, cascade against native, what a webhook can reach that a browser
 * cannot — and a flat list mixes four of them into one column where the only way to compare
 * is to read the small grey label on every row.
 *
 * DAY is the other question that gets asked out loud: what did I do on Thursday. Sorted by
 * time the answer is there, but it is a boundary you have to find by reading timestamps.
 *
 * Language is deliberately not offered. Every stored conversation is Hebrew, so it would
 * be a control that produces one group — an option that cannot change anything is worse
 * than a missing one, because someone tries it before believing that.
 */
const GROUPS = {
  none: { label: 'ללא קיבוץ' },
  provider: { label: 'לפי פייפליין', key: (c) => c.provider, title: (c) => c.providerLabel },
  day: {
    label: 'לפי יום',
    // The ISO prefix sorts as text and needs no Date to compare; the label is built from it
    // only for display, so a locale change cannot reorder the groups.
    key: (c) => String(c.endedAt).slice(0, 10),
    title: (c) => (c.endedAt ? new Date(c.endedAt).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }) : '—'),
  },
}

export default function History({ focus, onFocusUsed }) {
  const [conversations, setConversations] = useState([])
  const [open, setOpen] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState('new')
  const [groupBy, setGroupBy] = useState('none')

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/sessions?limit=100')
      .then((r) => r.json())
      .then((d) => {
        setConversations(d.conversations ?? [])
        setError(null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const openConversation = useCallback((id) => {
    setOpen({ id, loading: true })
    fetch(`/api/sessions/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setOpen({ id, conversation: d.conversation })
      })
      .catch((err) => setOpen({ id, error: err.message }))
  }, [])

  /**
   * Arriving from the dashboard with something already chosen.
   *
   * A row there is a claim about a set of conversations, and the only way to check a claim is
   * to read one — so clicking a row lands here with either a conversation open or the list
   * narrowed to the ones the row was counting.
   */
  useEffect(() => {
    if (!focus?.conversationId) return
    openConversation(focus.conversationId)
    // Consumed, because opening a conversation is a one-shot instruction. A provider filter
    // is NOT: clearing it here dropped it before the list could use it, and the pane arrived
    // showing everything — which looks exactly like the click having done nothing.
    onFocusUsed?.()
    // openConversation is stable; focus is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  /**
   * Filter, then sort, then group — in that order, and the order matters.
   *
   * Sorting inside each group rather than once across the list is what makes "newest first"
   * mean the same thing in every section. Group first and the sort would only ever reorder
   * whichever group you happened to look at.
   */
  const groups = useMemo(() => {
    const filtered = focus?.provider
      ? conversations.filter((c) => c.provider === focus.provider)
      : conversations
    const sorted = [...filtered].sort(SORTS[sort].by)

    const spec = GROUPS[groupBy]
    if (!spec.key) return [{ key: 'all', title: null, items: sorted }]

    const map = new Map()
    for (const c of sorted) {
      const key = spec.key(c)
      if (!map.has(key)) map.set(key, { key, title: spec.title(c), items: [] })
      map.get(key).items.push(c)
    }

    const out = [...map.values()]
    /**
     * Days follow the reading direction; pipelines follow their size.
     *
     * A day grouping that ignored the sort would put the oldest day first while every row
     * inside it ran newest-first — two directions in one list. Pipelines have no inherent
     * order, so the largest goes on top: it is the one with something to compare against.
     */
    if (groupBy === 'day') out.sort((a, b) => (sort === 'old' ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key)))
    else out.sort((a, b) => b.items.length - a.items.length)
    return out
  }, [conversations, focus?.provider, sort, groupBy])

  const total = groups.reduce((n, g) => n + g.items.length, 0)

  if (open) return <Transcript state={open} onBack={() => setOpen(null)} />
  if (loading && conversations.length === 0) return <p className="ac-hint">טוען…</p>
  if (error) return <p className="ac-warn-note">{error}</p>

  return (
    <div className="hs">
      <div className="hs-head">
        <div>
          <b>
            <bdi>{nf.format(total)} שיחות</bdi>
          </b>
          {focus?.provider && (
            <>
              <span className="hs-filter">{focus.provider}</span>
              {/* The way out of a filter has to be where the filter is, or the pane looks
                  broken to somebody who arrived here and cannot find the rest. */}
              <button type="button" className="hs-clear" onClick={() => onFocusUsed?.()}>
                הצג הכל
              </button>
            </>
          )}
        </div>

        <div className="hs-controls">
          <label>
            <span>מיון</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {Object.entries(SORTS).map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>קיבוץ</span>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {Object.entries(GROUPS).map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="hs-refresh" onClick={load}>
            רענן
          </button>
        </div>
      </div>

      {total === 0 && (
        <p className="ac-hint">
          עדיין לא נשמרה שיחה. שיחות קוליות נשמרות ומתויגות מעצמן ברגע שהן נסגרות.
        </p>
      )}

      {/* One list when ungrouped, one per group otherwise — the same rows either way, so a
          change to a row cannot land in one view and miss the other. */}
      {groups.map((group) => (
        <section className="hs-group" key={group.key}>
          {group.title && (
            <h3 className="hs-group-head">
              <span className="mono">{group.title}</span>
              <bdi className="hs-group-count">{group.items.length} שיחות</bdi>
            </h3>
          )}
          {/**
           * Under a pipeline heading the pipeline column is noise.
           *
           * Grouped by provider, every row repeated the label already standing above it —
           * eleven identical `elevenlabs · hybrid` under a heading saying `elevenlabs ·
           * hybrid`. Grouped by DAY it stays, because a day mixes paths and the label is
           * then the thing that distinguishes one row from the next.
           */}
          <ul className={`hs-list ${groupBy === 'provider' ? 'no-path' : ''}`}>
            {group.items.map((c) => (
              <Row key={c.id} conversation={c} onOpen={openConversation} showPath={groupBy !== 'provider'} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** One row in the scanning view. */
function Row({ conversation: c, onOpen, showPath = true }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(c.id)}>
        {showPath && <span className="hs-path mono">{c.providerLabel}</span>}
        {/**
         * Each count is isolated from the next, or they swap partners.
         *
         * Written as "11 תורות · 9 תגיות" inside an LTR row, the bidi algorithm folds the
         * separator and the second number into one right-to-left run and lays it out
         * backwards. A conversation with 11 turns and 9 tags rendered as "11 תגיות 9
         * תורות" — every number attached to the wrong word, on every row, and each one a
         * readable Hebrew phrase that happened to be false.
         *
         * <bdi> is exactly this: a unit the algorithm may place, but not reorder inside.
         * The counts stay with their own nouns whatever surrounds them.
         */}
        <span className="hs-meta">
          <bdi>{c.turnCount} תורות</bdi>
          {/* A conversation with tags is the one worth opening, so it says so rather than
              making every row look alike. */}
          {c.tagHits > 0 && (
            <b className="hs-tags">
              {' · '}
              <bdi>{c.tagHits} תגיות</bdi>
            </b>
          )}
        </span>
        <span className="hs-when mono">
          {c.endedAt ? new Date(c.endedAt).toLocaleString('he-IL') : ''}
        </span>
        <span className={`hs-tools mono ${c.toolsOffered < c.toolsTotal ? 'narrowed' : ''}`}>
          {c.toolsOffered ?? '?'}/{c.toolsTotal ?? '?'}
        </span>
      </button>
    </li>
  )
}

/**
 * One conversation, whole.
 *
 * Every turn shows what ran beneath it, so a tag about something NOT running can be checked
 * against an empty list rather than taken on faith. And an LLM verdict shows the words it
 * quoted, because a grader that cannot point at what it means was measurably wrong here
 * before.
 */
function Transcript({ state, onBack }) {
  const { conversation, error } = state

  return (
    <div className="hs">
      <div className="hs-head">
        <button type="button" className="hs-refresh" onClick={onBack}>
          ← חזרה לרשימה
        </button>
        {conversation && (
          <span className="hs-path mono">
            {conversation.providerLabel}
            {' · '}
            <bdi>{conversation.turns.length} תורות</bdi>
            {' · '}
            {/* The ratio is two numbers around a slash; isolated, it cannot be flipped into
                8/6 by the Hebrew word that follows it. */}
            <bdi>
              {conversation.toolsOffered}/{conversation.toolsTotal} כלים
            </bdi>
          </span>
        )}
      </div>

      {error && <p className="ac-warn-note">{error}</p>}
      {!conversation && !error && <p className="ac-hint">טוען…</p>}

      {conversation?.turns.map((turn) => (
        <article className="hs-turn" key={turn.idx}>
          <p className="hs-ask">{turn.ask}</p>
          <p className="hs-reply">{turn.reply}</p>

          <div className="hs-foot">
            {turn.toolCalls.length === 0 ? (
              <span className="hs-tool none">אף כלי לא רץ</span>
            ) : (
              turn.toolCalls.map((call, at) => (
                <span className="hs-tool mono" key={at}>
                  {call.tool}
                  {call.ranOn === 'server' && <em> · בשרת</em>}
                </span>
              ))
            )}
            {Number.isFinite(turn.ms) && <span className="hs-ms mono">{nf.format(turn.ms)} ms</span>}
          </div>

          {(turn.tags ?? []).length > 0 && (
            <ul className="hs-turn-tags">
              {turn.tags.map((tag, at) => (
                <li key={at} className={tag.kind}>
                  <span className="hs-kind mono">{tag.kind}</span>
                  <b>{tag.name}</b>
                  {tag.why && <span className="hs-why">{tag.why}</span>}
                  {tag.quote && <q className="hs-quote">{tag.quote}</q>}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  )
}

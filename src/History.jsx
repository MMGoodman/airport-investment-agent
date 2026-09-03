import { useCallback, useEffect, useState } from 'react'
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

export default function History({ focus, onFocusUsed }) {
  const [conversations, setConversations] = useState([])
  const [open, setOpen] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

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

  const shown = focus?.provider
    ? conversations.filter((c) => c.provider === focus.provider)
    : conversations

  if (open) return <Transcript state={open} onBack={() => setOpen(null)} />
  if (loading && conversations.length === 0) return <p className="ac-hint">טוען…</p>
  if (error) return <p className="ac-warn-note">{error}</p>

  return (
    <div className="hs">
      <div className="hs-head">
        <div>
          <b>{nf.format(shown.length)} שיחות</b>
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
        <button type="button" className="hs-refresh" onClick={load}>
          רענן
        </button>
      </div>

      {shown.length === 0 && (
        <p className="ac-hint">
          עדיין לא נשמרה שיחה. שיחות קוליות נשמרות ומתויגות מעצמן ברגע שהן נסגרות.
        </p>
      )}

      <ul className="hs-list">
        {shown.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => openConversation(c.id)}>
              <span className="hs-path mono">{c.providerLabel}</span>
              <span className="hs-meta">
                {c.turnCount} תורות
                {/* A conversation with tags is the one worth opening, so it says so rather
                    than making every row look alike. */}
                {c.tagHits > 0 && <b className="hs-tags"> · {c.tagHits} תגיות</b>}
              </span>
              <span className="hs-when mono">
                {c.endedAt ? new Date(c.endedAt).toLocaleString('he-IL') : ''}
              </span>
              <span className={`hs-tools mono ${c.toolsOffered < c.toolsTotal ? 'narrowed' : ''}`}>
                {c.toolsOffered ?? '?'}/{c.toolsTotal ?? '?'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
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
            {conversation.providerLabel} · {conversation.turns.length} תורות ·{' '}
            {conversation.toolsOffered}/{conversation.toolsTotal} כלים
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

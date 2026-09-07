import { useCallback, useEffect, useRef, useState } from 'react'
import { applyTheme, readTheme } from './theme.js'
import AgentConsole from './AgentConsole.jsx'
import Home from './Home.jsx'
import AgentWorkspace from './AgentWorkspace.jsx'
import ScenarioCapture from './ScenarioCapture.jsx'
import TagsPane from './TagsPane.jsx'
import Dashboard from './Dashboard.jsx'
import EvalsPane from './EvalsPane.jsx'
import EvalRunPane from './EvalRunPane.jsx'
import ElevenLabsPane from './ElevenLabsPane.jsx'
import History from './History.jsx'
import { turnsFrom } from './turns.js'
import ToolTrace from './ToolTrace.jsx'
import LivePanel from './LivePanel.jsx'
import Markdown from './Markdown.jsx'
import ComparisonSheet from './ComparisonSheet.jsx'
import { toPlainText } from './markdown.js'
import { useDictation, useSpeech } from './voice.js'
import './App.css'

const AGENT_NAME = 'Airport Agent'

/**
 * `/agents/<id>` -> the id, in any alphabet.
 *
 * One function because the initial read and the popstate handler have to agree, and when
 * they were two copies of the same regex they agreed on the wrong thing in two places.
 */
function agentIdFromPath() {
  const match = window.location.pathname.match(/^\/agents\/([^/?#]+)/)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    // A malformed escape is not an agent id; treat it as no agent rather than throwing on
    // the very first render.
    return match[1]
  }
}

// The four acceptance questions moved to the airport agent's own record in server/agents.js
// — see the welcome block there. They were never four questions about this application; they
// were four questions about that agent, and keeping them here is what made every other agent
// open by offering them.

function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [health, setHealth] = useState(null)
  const [agents, setAgents] = useState(null)
  /**
   * Which agent is open, or null for the environment's front door.
   *
   * Kept in the URL through the History API rather than a router: it is two views, the
   * back button has to work, and a dependency for that would be more machinery than the
   * problem. The path is the only state — reading it on popstate is what makes back and
   * forward behave without a second source of truth.
   */
  /**
   * The id out of the path — and `\w` was the wrong alphabet for it.
   *
   * Agent ids are slugged from the name and the slug keeps Hebrew letters, because an agent
   * called "סוכן ביטוח נסיעות" should not become "agent-2". But `[\w-]` is ASCII, so that
   * id never matched: opening the agent worked, and RELOADING the page threw you back to
   * the list with no error and nothing to search for. Every agent named in Hebrew — which
   * here is all of them — was one refresh away from vanishing.
   *
   * Decoded too, because the browser percent-encodes those letters in the address bar and
   * a raw `%D7%A1...` matches no agent in the list.
   */
  const [agentId, setAgentId] = useState(() => agentIdFromPath())

  const openAgent = useCallback((id) => {
    window.history.pushState({ agentId: id }, '', `/agents/${encodeURIComponent(id)}`)
    setAgentId(id)
  }, [])

  const goHome = useCallback(() => {
    window.history.pushState({ agentId: null }, '', '/')
    setAgentId(null)
  }, [])

  useEffect(() => {
    const onPop = () => setAgentId(agentIdFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Named, because creating an agent has to be able to ask for the list again.
  const loadAgents = useCallback(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then(setAgents)
      .catch(() => setAgents({ agents: [] }))
  }, [])

  useEffect(loadAgents, [loadAgents])
  // Which brain answers, and over which pipe. All three share the same tools.
  const [providers, setProviders] = useState([])
  const [providerId, setProviderId] = useState('gemini')
  // Applies to all three paths: it steers the reply, and on the live paths the
  // transcriber and the voice as well.
  // Read once from storage; the inline script in index.html already applied it.
  const [theme, setTheme] = useState(readTheme)
  /**
   * Which settings pane is open in the workspace, and the two DOM nodes LivePanel draws
   * into.
   *
   * They are state rather than refs because a ref does not re-render: LivePanel has to be
   * told the slot exists, and a callback ref that sets state is the shortest honest way to
   * do that. Null until the pane is opened, which is also correct — a portal with nowhere
   * to go renders inline, and inline is where the settings belong when there is no pane.
   */
  /** The turn being turned into an eval case, or null. */
  const [capturing, setCapturing] = useState(null)
  /** Set when a dashboard row is clicked, consumed by the history pane it navigates to. */
  const [historyFocus, setHistoryFocus] = useState(null)
  const [wsPane, setWsPane] = useState(null)
  const [settingsSlot, setSettingsSlot] = useState(null)
  const [traceSlot, setTraceSlot] = useState(null)
  const [lang, setLang] = useState('he')
  const [readAloud, setReadAloud] = useState(false)
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  // Anything already typed stays put; dictation appends to it rather than replacing it.
  const dictationBase = useRef('')
  const dictation = useDictation({
    onTranscript: (heard) => setInput(`${dictationBase.current} ${heard}`.trimStart()),
  })
  const { speak, cancel: cancelSpeech, supported: speechSupported } = useSpeech()

  // Index of the last message read out, so a re-render never repeats an answer.
  const spokenThrough = useRef(0)

  useEffect(() => {
    fetch('/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }))

    fetch('/api/voice/providers')
      .then((res) => res.json())
      .then((d) => {
        setProviders(d.providers ?? [])
        if (d.defaultLang) setLang(d.defaultLang)
      })
      .catch(() => setProviders([]))
  }, [])

  useEffect(() => {
    if (!readAloud || messages.length <= spokenThrough.current) return
    spokenThrough.current = messages.length
    const last = messages[messages.length - 1]
    // Live-path answers arrive marked spoken: the provider's voice already said them.
    if (last?.role === 'assistant' && !last.spoken) speak(toPlainText(last.content), lang)
  }, [messages, readAloud, speak, lang])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Grow the box with the text. An empty box falls back to the CSS height —
  // measuring scrollHeight while empty would size it to the placeholder.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    if (!input) {
      el.style.height = ''
      return
    }
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [input])

  async function send(text = input) {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    dictation.stop()
    cancelSpeech()

    const next = [...messages, { role: 'user', content: trimmed }]
    setMessages(next)
    setInput('')
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Which agent is answering. The server resolves its prompt and its tools from
        // this; without it every conversation would run the built-in one.
        body: JSON.stringify({ messages: next, lang, agent: agentId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Server returned ${res.status}`)
      setMessages([
        ...next,
        { role: 'assistant', content: data.reply, toolCalls: data.toolCalls },
      ])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // A live turn lands in the same list a typed one does, so ToolTrace renders it the same.
  // Marked as already spoken: the provider's own voice said it, and the read-aloud effect
  // reading it AGAIN put a hardcoded en-US browser voice on top of a Hebrew answer — the
  // session played every reply twice, in two languages at once.
  const appendLive = useCallback((message) => {
    setMessages((prev) => [...prev, { ...message, spoken: true }])
    setError(null)
  }, [])

  /**
   * The latest conversation and transport, readable from a stable callback.
   *
   * saveConversation is handed to LivePanel, which lists it in the dependencies of the
   * cleanup that hangs up a call. A callback that changed identity on every render would
   * therefore end the session on every render — so it has to be stable, and stable means it
   * cannot close over state directly.
   */
  const messagesRef = useRef(messages)
  const providersRef = useRef(providers)
  const providerIdRef = useRef(providerId)
  useEffect(() => {
    messagesRef.current = messages
    providersRef.current = providers
    providerIdRef.current = providerId
  }, [messages, providers, providerId])

  /**
   * Store the call when it ends, and let the server tag it.
   *
   * Automatic on purpose. A dashboard that depends on someone remembering to press a button
   * after every conversation is a dashboard of the calls somebody felt like recording, which
   * is the opposite of what it is for.
   *
   * The provider goes with it, and so does how many tools that path carries — without those
   * two columns "the caller asked for the weather and did not get it" reads the same whether
   * the tool was withheld by design or failed, and those want opposite responses.
   */
  const saveConversation = useCallback(
    async (sessionId, report = () => {}) => {
      /**
       * Say what happened, always.
       *
       * This swallowed every failure on the grounds that a finished call should not end in an
       * error — which is true, and it made the storing invisible. A conversation went
       * unsaved and the only way to notice was to open the dashboard and find it missing,
       * with nothing anywhere saying why. A silent success is just as bad: you cannot tell
       * "it worked" from "it never ran".
       *
       * So it reports into the session trace, which is where someone is already looking when
       * a call ends, and never as an error banner over a call that went fine.
       */
      const turns = turnsFrom(messagesRef.current)
      if (!sessionId) return report('not stored — this call had no session id')
      if (turns.length === 0) return report('not stored — no completed turns in this call')

      const path = providersRef.current.find((p) => p.id === providerIdRef.current)
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: sessionId,
            provider: path?.id ?? 'unknown',
            providerLabel: path?.short ?? path?.label,
            toolsOffered: path?.tools?.offered,
            toolsTotal: path?.tools?.total,
            lang,
            endedAt: new Date().toISOString(),
            turns,
          }),
        })
        const body = await res.json()
        report(
          res.ok
            ? `stored ${body.turns} ${body.turns === 1 ? 'turn' : 'turns'} — tagging on the server`
            : `not stored — ${body.error ?? res.status}`,
        )
      } catch (err) {
        report(`not stored — ${err.message}`)
      }
    },
    [lang],
  )

  /**
   * Add tool calls to an answer that is already on screen.
   *
   * On the ElevenLabs hybrid the placed tools are fetched by their cloud, so no event reaches
   * this page while the turn is running — they are only known once the turn reconciles
   * against the server log, which is after the answer has been appended. Without this the
   * rail listed the weather call and the trace under the answer did not, so the same call was
   * present in one place and missing in another, which is worse than missing in both.
   *
   * Added to the last assistant message rather than a new one, because that is the answer
   * they belong to.
   */
  const amendLiveTools = useCallback((toolCalls) => {
    if (!toolCalls?.length) return
    setMessages((prev) => {
      const at = prev.findLastIndex((m) => m.role === 'assistant')
      if (at === -1) return prev
      /**
       * Only the calls this answer is not already carrying.
       *
       * The reconcile reads the whole session's server log, so a call the live session had
       * already delivered came back round and was appended again — one stored answer listed
       * get_airport_weather three times for a single lookup.
       *
       * Matched on tool and arguments rather than on an id, because THERE IS NO SHARED ID.
       * The sideband knows OpenAI's call id and the log knows the server's own; trying to
       * match them broke the audit instead. Two server calls to the same tool with identical
       * arguments inside one answer are indistinguishable to a reader anyway, so collapsing
       * them loses nothing.
       */
      const key = (c) => `${c.tool}::${JSON.stringify(c.args ?? {})}`
      const held = new Set(
        (prev[at].toolCalls ?? []).filter((c) => c.ranOn === 'server').map(key),
      )
      const fresh = toolCalls.filter((call) => !held.has(key(call)))
      if (fresh.length === 0) return prev
      const next = [...prev]
      next[at] = { ...next[at], toolCalls: [...(next[at].toolCalls ?? []), ...fresh] }
      return next
    })
  }, [])


  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  function toggleMic() {
    if (dictation.listening) {
      dictation.stop()
      return
    }
    dictationBase.current = input
    dictation.start()
  }

  // Turning it on mid-conversation should not replay the answer already on screen.
  function toggleReadAloud() {
    if (readAloud) {
      cancelSpeech()
      setReadAloud(false)
      return
    }
    spokenThrough.current = messages.length
    setReadAloud(true)
  }

  const activeProvider = providers.find((p) => p.id === providerId) ?? null
  const live = activeProvider?.mode === 'live'

  const openAgentRecord = agents?.agents?.find((a) => a.id === agentId) ?? null

  if (!agentId) {
    return (
      <Home
        agents={agents}
        health={health}
        lang={lang}
        onLang={setLang}
        onOpenAgent={openAgent}
        onAgentsChanged={loadAgents}
        error={error}
      />
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {/* Back to the environment. The agent is a place you are inside of. */}
          <button type="button" className="brand-back" onClick={goHome} aria-label="חזרה לסוכנים">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <span className="mark" aria-hidden="true" />
          <div>
            <h1>{openAgentRecord?.name ?? 'Airport Investment Agent'}</h1>
            <p className="tagline">
              {openAgentRecord?.tagline ?? 'US terminal expansion — demand opportunity analysis'}
            </p>
          </div>
        </div>
        <div className="topbar-right">
          {/*
            Which path this is, and how much of the agent it carries.
            The second half is the part that was missing: two of the five paths run six
            tools and three run eight, and a caller asked why the weather tool "did not
            work" on the direct line when it had never been offered there. The switcher
            said which model; nothing said what the model could reach.
            Amber when something is withheld, because that is a fact about the answer you
            are about to get rather than a decoration.
          */}
          {activeProvider && (
            <span
              className={`path-chip ${activeProvider.tools?.withheld?.length ? 'narrowed' : ''}`}
              title={
                activeProvider.tools?.withheld?.length
                  ? `${activeProvider.pipeline}

Not on this path: ${activeProvider.tools.withheld.join(', ')} — they run only where the server holds the session.`
                  : activeProvider.pipeline
              }
            >
              <span className="path-chip-name mono">
                {activeProvider.short ?? activeProvider.label}
              </span>
              {activeProvider.tools && (
                <span className="path-chip-tools mono">
                  {activeProvider.tools.offered}/{activeProvider.tools.total}
                </span>
              )}
            </span>
          )}
          <button
            type="button"
            className={`toggle ${readAloud ? 'on' : ''}`}
            onClick={toggleReadAloud}
            disabled={!speechSupported}
            aria-pressed={readAloud}
            title={
              speechSupported
                ? 'Read answers aloud'
                : 'This browser has no speech synthesis — try Chrome or Edge'
            }
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M11 5 6.5 9H3v6h3.5L11 19V5Z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              {readAloud ? (
                <path
                  d="M15 9.5a3.5 3.5 0 0 1 0 5M17.8 6.8a7 7 0 0 1 0 10.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="m16 10 5 4m0-4-5 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              )}
            </svg>
            <span>{readAloud ? 'voice on' : 'voice off'}</span>
          </button>

          {/* Three states, because "system" is a real choice and a two-way toggle cannot
              return to it. Labelled by what it does, not by an icon alone. */}
          <label className="switcher theme" title="Which ground the console is read on">
            <select
              value={theme}
              onChange={(event) => setTheme(applyTheme(event.target.value))}
              aria-label="Theme"
            >
              <option value="system">מערכת</option>
              <option value="dark">כהה</option>
              <option value="light">בהיר</option>
            </select>
          </label>

          <label
            className="switcher lang"
            title={
              providerId === 'elevenlabs'
                ? 'Reply language. On this provider it also switches the transcriber and the voice, so choose it before starting the call — it cannot change mid-session.'
                : 'Reply language. Speech recognition auto-detects, so you can ask in one language and be answered in another, or just ask the agent to switch.'
            }
          >
            <select value={lang} onChange={(event) => setLang(event.target.value)} aria-label="Language">
              <option value="en">EN</option>
              <option value="he">HE</option>
            </select>
          </label>

        </div>
      </header>


      <ScenarioCapture open={capturing} turns={turnsFrom(messages)} onClose={() => setCapturing(null)} />

      <AgentWorkspace
        agent={openAgentRecord}
        /**
         * Delete, then leave — in that order, and only if the server agreed.
         *
         * Navigating first would show the list with the agent still on it until the reload
         * landed, and would hide a refusal entirely. The error is thrown so the dialog can
         * show it in place rather than dropping someone back to a home screen that still
         * has the agent they just tried to remove.
         */
        onDelete={async (id) => {
          const res = await fetch(`/api/agent-store/${encodeURIComponent(id)}`, {
            method: 'DELETE',
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(body.error ?? 'המחיקה נכשלה')
          loadAgents()
          goHome()
        }}
        nav={[
          {
            label: 'Runtime',
            items: [
              { id: 'model', label: 'Model & pipeline', icon: 'model', badge: activeProvider?.mode === 'live' ? 'חי' : '' },
              {
                id: 'config',
                label: 'Configuration',
                icon: 'config',
                /**
                 * One heading, one page per provider.
                 *
                 * They were in two unrelated places: the OpenAI pipeline sat inside the
                 * model picker, and ElevenLabs had a pane of its own three groups down. Both
                 * answer the same question — how is this path configured — and nothing about
                 * the old arrangement said so.
                 */
                children: [
                  { id: 'config-openai', label: 'OpenAI' },
                  { id: 'config-elevenlabs', label: 'ElevenLabs' },
                ],
              },
            ],
          },
          {
            label: 'Behaviour',
            items: [
              { id: 'prompt', label: 'Instructions', icon: 'prompt' },
              /**
               * Tools before Skills, matching the create flow — and the create flow is the
               * one with no choice in the matter.
               *
               * A skill is instructions plus THE TOOLS WHOSE FIRST CALL LOADS THEM. It
               * points at tools; nothing points back. So when you are building an agent the
               * tools have to exist before a skill can name one, and the authoring step
               * says so out loud: with no tools declared yet it offers "go back a step, or
               * mark it always".
               *
               * Here in settings nothing depends on anything — it is all already made — so
               * this order is free. Which is exactly why it should follow the one that is
               * not: two screens listing the same two things in opposite orders is a cost
               * paid by every reader, for nothing.
               */
              { id: 'tools', label: 'Tools', icon: 'tools' },
              { id: 'skills', label: 'Skills', icon: 'skills' },
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
            items: [
              {
                id: 'evals',
                label: 'Evals',
                icon: 'evals',
                // Two things you do with the same set: read and edit the claims, or run
                // them against a model. Separate panes because they are separate sittings.
                children: [
                  { id: 'evals', label: 'Scenarios' },
                  { id: 'evals-run', label: 'Batch' },
                ],
              },
              { id: 'tags', label: 'Tags', icon: 'tags' },
              { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
              { id: 'history', label: 'History', icon: 'history' },
            ],
          },
        ]}
        activePane={wsPane}
        onPane={setWsPane}
        pane={
          wsPane === 'model' ? (
            <div className="ws-model">
              <label className="home-field">
                <span>מודל</span>
                <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
                  {providers.map((option) => (
                    <option key={option.id} value={option.id} disabled={!option.available}>
                      {option.label}
                      {option.available ? '' : ' — unavailable'}
                    </option>
                  ))}
                </select>
              </label>
              <p className="ac-hint">
                הכוונון עצמו יושב תחת <b>Configuration</b> — כאן בוחרים איזה נתיב רץ, שם
                מכווננים אותו.
              </p>
            </div>
          ) : wsPane === 'dashboard' ? (
            /* Across every stored conversation rather than this one — the only panes here
               that are about the corpus instead of the agent's configuration. A row is a
               claim about a set of calls, so clicking one lands in History with that set. */
            <Dashboard
              onOpenPath={(focus) => {
                setHistoryFocus(focus)
                setWsPane('history')
              }}
            />
          ) : wsPane === 'history' ? (
            <History focus={historyFocus} onFocusUsed={() => setHistoryFocus(null)} />
          ) : wsPane === 'config-openai' ? (
            <div className="ws-model">
              {/* LivePanel draws its pipeline board in here. It keeps its own state; only
                  the drawing moves — which is why this is a portal target and not a copy of
                  the controls. */}
              <div ref={setSettingsSlot} />
              {!live && (
                <p className="ac-hint">
                  צינור העיבוד נפתח לכוונון רק בנתיבי הקול. בנתיב הטקסט אין זיהוי תור ואין
                  מתמלל, אז אין מה לקנפג — בחר נתיב קולי ב-<b>Model &amp; pipeline</b>.
                </p>
              )}
            </div>
          ) : wsPane === 'config-elevenlabs' ? (
            <ElevenLabsPane />
          ) : wsPane === 'evals-run' ? (
            <EvalRunPane />
          ) : wsPane === 'evals' ? (
            /* Its own pane at last. It had no branch here at all, so the nav item fell
               through to the console's chip list — which showed case ids and nothing else. */
            <EvalsPane />
          ) : wsPane === 'tags' ? (
            /* The one pane that reads the conversation rather than the agent's
               configuration: tagging is a question asked of what was just said. */
            <TagsPane messages={messages} />
          ) : wsPane ? (
            <AgentConsole agentId={agentId} bare pane={wsPane} onPaneChange={setWsPane} />
          ) : null
        }
        rail={live ? <div ref={setTraceSlot} /> : null}
        railLive={live}
        center={
          <>
        <main className="messages">
        {/**
         * The empty screen, belonging to the agent rather than to this file.
         *
         * It was three literals here — a heading about US airport expansion, a paragraph
         * about BTS T-100, and four sample questions — so every agent opened as the airport
         * analyst. An insurance agent created minutes earlier greeted its first caller by
         * offering to compare LAX and SNA congestion.
         *
         * The chips are only rendered when the agent has some. An agent whose maker wrote
         * none gets a heading and a line, which is the honest empty state; borrowing another
         * agent's questions to fill the space is how this went wrong in the first place.
         */}
        {messages.length === 0 && !loading && (
          <div className="welcome">
            <h2>{openAgentRecord?.welcome?.title ?? openAgentRecord?.name ?? 'שיחה חדשה'}</h2>
            {openAgentRecord?.welcome?.blurb && <p>{openAgentRecord.welcome.blurb}</p>}
            {(openAgentRecord?.welcome?.questions ?? []).length > 0 && (
              <div className="chips">
                {openAgentRecord.welcome.questions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    className="chip"
                    onClick={() => setInput(question)}
                  >
                    {question}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((message, i) => (
          <article key={i} className={`row ${message.role}`}>
            <span className="who">{message.role === 'user' ? 'You' : AGENT_NAME}</span>
            <div className="bubble">
              {message.role === 'user' ? message.content : <Markdown text={message.content} />}
            </div>
            <ToolTrace calls={message.toolCalls} />
            {/* The per-answer button lived here and was the wrong shape: it made a case out
                of ONE exchange, chosen by whichever answer you happened to be hovering, and
                a conversation is what you actually want to keep. It moved to the composer
                as a single action over the whole call, with the turns selectable there. */}
          </article>
        ))}

        {loading && (
          <article className="row assistant">
            <span className="who">{AGENT_NAME}</span>
            <div className="bubble typing">
              <i />
              <i />
              <i />
            </div>
          </article>
        )}

        {error && (
          <div className="error">
            <span className="error-label">Request failed</span>
            {error}
          </div>
        )}

          <div ref={bottomRef} />
        </main>

        {live && (
          <LivePanel
            provider={activeProvider}
            agentId={agentId}
            lang={lang}
            onAppend={appendLive}
            onAmendTools={amendLiveTools}
            onEnded={saveConversation}
            onError={setError}
            slots={{ settings: settingsSlot, trace: traceSlot }}
          />
        )}

      {/*
        One action over the whole conversation.
        It used to be a button per answer, which made a case out of whichever exchange you
        happened to be hovering — and the thing worth keeping is usually a sequence: the
        question, the follow-up that misread it, and the correction. Which turns go in is
        chosen inside, where you can see them all at once.
      */}
      {turnsFrom(messages).length > 0 && (
        <div className="capture-bar">
          <button type="button" className="capture-go" onClick={() => setCapturing({ lang })}>
            Create scenario
          </button>
          <span className="capture-hint">
            {turnsFrom(messages).length} {turnsFrom(messages).length === 1 ? 'turn' : 'turns'} in
            this conversation
          </span>
        </div>
      )}

      {/* Above whichever bottom bar this path has — the composer on text, the call controls
          on voice — because that is the one place on screen that does not scroll away. */}
      <ComparisonSheet live={live} onPick={setInput} />

      {!live && (
      <form
        className="composer-inner composer"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <div className="field">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={dictation.listening ? 'Listening…' : 'Ask about an airport…'}
            rows={1}
            disabled={loading}
          />
          <button
            type="button"
            className={`ghost ${dictation.listening ? 'live' : ''}`}
            onClick={toggleMic}
            disabled={loading || !dictation.supported}
            aria-pressed={dictation.listening}
            title={
              dictation.supported
                ? 'Ask by voice'
                : 'This browser has no speech recognition — try Chrome or Edge'
            }
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <rect
                x="9"
                y="2.5"
                width="6"
                height="11"
                rx="3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
              />
              <path
                d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button type="submit" aria-label="Send" disabled={loading || !input.trim()}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M4 12h15M13 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <p className="hint">
          {dictation.error ? (
            <span className="hint-warn">{dictation.error}</span>
          ) : dictation.listening ? (
            'Speak your question — it stops on its own when you pause.'
          ) : (
            <>
              <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line ·
              mic to dictate
            </>
          )}
        </p>
      </form>
      )}
          </>
        }
      />
    </div>
  )
}

export default App

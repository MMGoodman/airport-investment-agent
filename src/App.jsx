import { useCallback, useEffect, useRef, useState } from 'react'
import { applyTheme, readTheme } from './theme.js'
import AgentConsole from './AgentConsole.jsx'
import Home from './Home.jsx'
import AgentWorkspace from './AgentWorkspace.jsx'
import ScenarioCapture from './ScenarioCapture.jsx'
import ToolTrace from './ToolTrace.jsx'
import LivePanel from './LivePanel.jsx'
import Markdown from './Markdown.jsx'
import { toPlainText } from './markdown.js'
import { useDictation, useSpeech } from './voice.js'
import './App.css'

const AGENT_NAME = 'Airport Agent'

// SPEC §1 — the four acceptance questions. They only get real answers once the
// scoring engine and tools land in M3/M4; until then they document the target.
const TARGET_QUESTIONS = [
  'Which airports in New England are strong candidates for terminal expansion?',
  'Compare LAX and SNA congestion levels.',
  'What is the percentage of long-haul flights out of Anchorage (ANC)?',
  'What is the unmet flight demand at SFO, and why?',
]

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
  const [agentId, setAgentId] = useState(() => {
    const match = window.location.pathname.match(/^\/agents\/([\w-]+)/)
    return match ? match[1] : null
  })

  const openAgent = useCallback((id) => {
    window.history.pushState({ agentId: id }, '', `/agents/${id}`)
    setAgentId(id)
  }, [])

  const goHome = useCallback(() => {
    window.history.pushState({ agentId: null }, '', '/')
    setAgentId(null)
  }, [])

  useEffect(() => {
    const onPop = () => {
      const match = window.location.pathname.match(/^\/agents\/([\w-]+)/)
      setAgentId(match ? match[1] : null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then(setAgents)
      .catch(() => setAgents({ agents: [] }))
  }, [])
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
        body: JSON.stringify({ messages: next, lang }),
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


      <ScenarioCapture turn={capturing} onClose={() => setCapturing(null)} />

      <AgentWorkspace
        nav={[
          {
            label: 'הפעלה',
            items: [{ id: 'model', label: 'מודל וצינור', icon: 'model', badge: activeProvider?.mode === 'live' ? 'חי' : '' }],
          },
          {
            label: 'הגדרה',
            items: [
              { id: 'prompt', label: 'הוראות', icon: 'prompt' },
              { id: 'tools', label: 'כלים', icon: 'tools' },
            ],
          },
          {
            label: 'ידע',
            items: [
              { id: 'knowledge', label: 'מאגר נתונים', icon: 'knowledge' },
              { id: 'vocabulary', label: 'אוצר מילים', icon: 'vocabulary' },
            ],
          },
          { label: 'בקרה', items: [{ id: 'evals', label: 'הערכות', icon: 'evals' }] },
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
              {/* LivePanel draws its pipeline board in here. It keeps its own state; only
                  the drawing moves. */}
              <div ref={setSettingsSlot} />
              {!live && (
                <p className="ac-hint">
                  צינור העיבוד נפתח לכוונון רק בנתיבי הקול — בנתיב הטקסט אין זיהוי תור ואין
                  מתמלל, אז אין מה לקנפג.
                </p>
              )}
            </div>
          ) : wsPane ? (
            <AgentConsole bare pane={wsPane} />
          ) : null
        }
        rail={live ? <div ref={setTraceSlot} /> : null}
        railLive={live}
        center={
          <>
        <main className="messages">
        {messages.length === 0 && !loading && (
          <div className="welcome">
            <h2>Ask about US airport expansion candidates</h2>
            <p>
              Every figure comes from a deterministic scoring engine over BTS T-100 data —
              open the tool trace under any answer to see exactly which call produced it.
              Follow-up questions work; try “why is the second one ahead of the third?”.
            </p>
            <div className="chips">
              {TARGET_QUESTIONS.map((question) => (
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
          </div>
        )}

        {messages.map((message, i) => (
          <article key={i} className={`row ${message.role}`}>
            <span className="who">{message.role === 'user' ? 'You' : AGENT_NAME}</span>
            <div className="bubble">
              {message.role === 'user' ? message.content : <Markdown text={message.content} />}
            </div>
            <ToolTrace calls={message.toolCalls} />
            {/* An answer plus the question above it is a case. The button is quiet until
                the message is hovered: capturing is occasional, and one on every answer
                would compete with the answers. */}
            {message.role === 'assistant' && messages[i - 1]?.role === 'user' && (
              <button
                type="button"
                className="msg-capture"
                onClick={() =>
                  setCapturing({
                    ask: messages[i - 1].content,
                    reply: message.content,
                    toolCalls: message.toolCalls ?? [],
                    lang,
                  })
                }
              >
                צור מקרה בחינה
              </button>
            )}
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
            lang={lang}
            onAppend={appendLive}
            onError={setError}
            slots={{ settings: settingsSlot, trace: traceSlot }}
          />
        )}

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

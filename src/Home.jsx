import { useEffect, useState } from 'react'
import { applyTheme, readTheme } from './theme.js'
import './Home.css'

/**
 * The environment's front door: what is set for everything, and which agents exist.
 *
 * The project used to open directly into one agent's conversation, which made the agent
 * and the environment the same thing. They are not: language, theme and which server this
 * talks to belong to the environment, and a prompt belongs to an agent. Separating them is
 * what makes a second agent an addition rather than a rewrite.
 *
 * One card today. It is deliberately not styled as a placeholder grid waiting to be filled
 * — an empty slot promising more is a worse thing to look at than one real entry.
 */
export default function Home({ agents, health, lang, onLang, onOpenAgent, error }) {
  const [theme, setTheme] = useState(readTheme)
  const [note, setNote] = useState(null)

  useEffect(() => {
    if (!agents) return
    setNote(agents.note ?? null)
  }, [agents])

  const list = agents?.agents ?? []

  return (
    <div className="home">
      <header className="home-top">
        <div className="home-brand">
          <span className="home-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="30" height="30" fill="none">
              <circle cx="16" cy="16" r="13" stroke="var(--live)" strokeWidth="1.6" />
              <circle cx="16" cy="16" r="5" fill="var(--live)" />
            </svg>
          </span>
          <div>
            <h1>סוכנים קוליים</h1>
            <p>סביבה לבנות, לכוונן ולבחון סוכנים שמדברים.</p>
          </div>
        </div>
      </header>

      <section className="home-section">
        <h2>הגדרות כלליות</h2>
        <p className="home-hint">חלות על הסביבה, לא על סוכן מסוים.</p>

        <div className="home-settings">
          <label className="home-field">
            <span>ערכת נושא</span>
            <select value={theme} onChange={(e) => setTheme(applyTheme(e.target.value))}>
              <option value="system">מערכת</option>
              <option value="dark">כהה</option>
              <option value="light">בהיר</option>
            </select>
          </label>

          <label className="home-field">
            <span>שפת ברירת מחדל</span>
            <select value={lang} onChange={(e) => onLang(e.target.value)}>
              <option value="he">עברית</option>
              <option value="en">English</option>
            </select>
          </label>

          <div className="home-field">
            <span>שרת</span>
            <div className={`home-health ${health?.ok ? 'up' : 'down'}`}>
              <i aria-hidden="true" />
              <span className="mono">
                {health?.ok
                  ? `${health.airports} שדות · ${health.model}`
                  : 'אין חיבור לשרת ה-API'}
              </span>
            </div>
          </div>
        </div>
        {error && <p className="home-error">{error}</p>}
      </section>

      <section className="home-section">
        <h2>הסוכנים</h2>
        {note && <p className="home-hint">{note}</p>}

        <ul className="home-agents">
          {list.map((agent) => (
            <li key={agent.id}>
              <button type="button" className="home-agent" onClick={() => onOpenAgent(agent.id)}>
                <span className="home-agent-name">{agent.name}</span>
                <span className="home-agent-tagline">{agent.tagline}</span>
                <span className="home-agent-desc">{agent.description}</span>
                <span className="home-agent-stats mono">
                  <span>{agent.summary.tools} כלים</span>
                  <span>{agent.summary.airports} שדות</span>
                  <span>{agent.summary.evalCases} מקרי בחינה</span>
                </span>
                <span className="home-agent-go" aria-hidden="true">
                  ←
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && !error && <li className="home-loading">קורא סוכנים…</li>}
        </ul>
      </section>
    </div>
  )
}

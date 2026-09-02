import { useCallback, useEffect, useState } from 'react'
import './AgentWorkspace.css'

/**
 * The shape of being inside an agent.
 *
 * Settings on the left, the conversation in the middle, the live trace on the right while
 * a call runs. Three columns that scroll independently, because the two things you do at
 * once — talk to it and watch what it does — were previously stacked in one column, so
 * following a trace dragged the composer off screen.
 *
 * This component owns the frame and nothing else. The settings panes are handed in as
 * children so that LivePanel can keep its own state machine and portal its board here,
 * rather than having that machine lifted out of a piece the session is tested against
 * every few minutes.
 */

const SIDE_KEY = 'agent-side-rail'

function Icon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }
  if (name === 'model') {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M9 9h6v6H9z" />
      </svg>
    )
  }
  if (name === 'prompt') {
    return (
      <svg {...common}>
        <path d="M5 4h11l3 3v13H5z" />
        <path d="M8 10h8M8 14h8M8 18h5" />
      </svg>
    )
  }
  if (name === 'skills') {
    return (
      <svg {...common}>
        <path d="M12 3 4 7v6c0 4.4 3.4 7.4 8 8 4.6-.6 8-3.6 8-8V7z" />
        <path d="M9.5 12l1.8 1.9 3.4-3.6" />
      </svg>
    )
  }
  if (name === 'tools') {
    return (
      <svg {...common}>
        <path d="M9 5 5 12l4 7M15 5l4 7-4 7" />
      </svg>
    )
  }
  if (name === 'knowledge') {
    return (
      <svg {...common}>
        <ellipse cx="12" cy="6" rx="7" ry="2.8" />
        <path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6" />
        <path d="M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6" />
      </svg>
    )
  }
  if (name === 'vocabulary') {
    return (
      <svg {...common}>
        <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M4 7h5M4 12h5M4 17h5" />
      <path d="M13 7.5 14.8 9.3 18.5 5.5M13 16.5l1.8 1.8 3.7-3.8" />
    </svg>
  )
}

export default function AgentWorkspace({
  nav,
  pane,
  activePane,
  onPane,
  center,
  rail,
  railTitle,
  railLive,
}) {
  const [sideOpen, setSideOpen] = useState(() => {
    try {
      return localStorage.getItem(SIDE_KEY) !== 'collapsed'
    } catch {
      return true
    }
  })

  const toggleSide = useCallback(() => {
    setSideOpen((wasOpen) => {
      const next = !wasOpen
      try {
        localStorage.setItem(SIDE_KEY, next ? 'open' : 'collapsed')
      } catch {
        /* private window; the choice just does not survive a reload */
      }
      return next
    })
  }, [])

  // Escape closes the settings pane rather than the whole agent — the pane is the thing
  // that is over something, and closing what is on top is what Escape means.
  useEffect(() => {
    if (!activePane) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onPane(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activePane, onPane])

  const current = nav.flatMap((g) => g.items).find((i) => i.id === activePane) ?? null

  return (
    <div className={`ws ${rail ? 'with-rail' : ''} ${sideOpen ? '' : 'side-collapsed'}`}>
      <nav className="ws-side" aria-label="Agent settings">
        <div className="ws-side-top">
          <button
            type="button"
            className="ws-side-toggle"
            onClick={toggleSide}
            aria-expanded={sideOpen}
            aria-label={sideOpen ? 'צמצם את הסרגל' : 'הרחב את הסרגל'}
            title={sideOpen ? 'צמצם את הסרגל' : 'הרחב את הסרגל'}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
              <path d="M9.5 4.5v15" />
            </svg>
          </button>
          {sideOpen && <span className="ws-side-title">Agent settings</span>}
        </div>

        <div className="ws-side-nav">
          {nav.map((group) => (
            <div key={group.label}>
              {sideOpen && <p className="ws-group-label">{group.label}</p>}
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`ws-item ${activePane === item.id ? 'on' : ''}`}
                      onClick={() => onPane(activePane === item.id ? null : item.id)}
                      aria-current={activePane === item.id ? 'true' : undefined}
                      aria-label={item.label}
                      title={item.label}
                    >
                      <Icon name={item.icon} />
                      {sideOpen && (
                        <>
                          <span className="ws-item-label">{item.label}</span>
                          {item.badge && <span className="ws-item-badge mono">{item.badge}</span>}
                        </>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="ws-center">
        {activePane && (
          <aside className="ws-side-pane" aria-label={current?.label}>
            <div className="ws-pane-top">
              <h3>{current?.label}</h3>
              <button type="button" className="ac-close" onClick={() => onPane(null)}>
                סגור
              </button>
            </div>
            <div className="ws-pane-body">{pane}</div>
          </aside>
        )}
        {center}
      </div>

      {rail && (
        <aside className="ws-rail" aria-label="מהלך השיחה">
          <div className="ws-rail-top">
            <span className="ws-rail-title">{railTitle ?? 'מהלך השיחה'}</span>
            {railLive && (
              <span className="ws-rail-live">
                <i aria-hidden="true" />
                חי
              </span>
            )}
          </div>
          <div className="ws-rail-body">{rail}</div>
        </aside>
      )}
    </div>
  )
}

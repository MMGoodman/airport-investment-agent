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
  if (name === 'trash') {
    return (
      <svg {...common}>
        <path d="M4 7h16" />
        <path d="M10 4h4M6 7l1 13h10l1-13" />
        <path d="M10 11v6M14 11v6" />
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
  /**
   * Evals: a list with things checked off it. The one that IS a checklist.
   *
   * It used to be the fallback, which is how four items in the Quality group ended up
   * wearing it — Tags, Dashboard and History all named `evals` because that was the only
   * shape there, and a sidebar where four rows are identical is one you navigate by
   * counting positions instead of by looking.
   */
  if (name === 'evals') {
    return (
      <svg {...common}>
        <path d="M4 7h5M4 12h5M4 17h5" />
        <path d="M13 7.5 14.8 9.3 18.5 5.5M13 16.5l1.8 1.8 3.7-3.8" />
      </svg>
    )
  }
  /** Configuration: sliders. The pane behind it is mostly sliders. */
  if (name === 'config') {
    return (
      <svg {...common}>
        <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h8M16 17h4" />
        <circle cx="16" cy="7" r="1.8" />
        <circle cx="10" cy="12" r="1.8" />
        <circle cx="14" cy="17" r="1.8" />
      </svg>
    )
  }
  /** ElevenLabs: a waveform, for the path whose stages are all about sound. */
  if (name === 'elevenlabs') {
    return (
      <svg {...common}>
        <path d="M3 12h2.5l2-5 3 12 3-16 2.5 9H21" />
      </svg>
    )
  }
  /** Tags: the luggage-label shape, with the eyelet that makes it read as one. */
  if (name === 'tags') {
    return (
      <svg {...common}>
        <path d="M12.6 3H4v8.6l8.4 8.4 8.6-8.6z" />
        <circle cx="8" cy="8" r="1.4" />
      </svg>
    )
  }
  /**
   * Dashboard: a gauge, not a bar chart.
   *
   * Vocabulary is already an equaliser of vertical bars, and two bar-shaped icons in one
   * rail are the same problem this is fixing.
   */
  if (name === 'dashboard') {
    return (
      <svg {...common}>
        <path d="M4 17a8 8 0 0 1 16 0" />
        <path d="M12 17l4.2-4.4" />
        <circle cx="12" cy="17" r="1.2" />
      </svg>
    )
  }
  /** History: a clock whose arrow runs backwards, which is the whole idea. */
  if (name === 'history') {
    return (
      <svg {...common}>
        <path d="M3.5 8.5V4M3.5 8.5H8" />
        <path d="M3.9 8.4A8.5 8.5 0 1 1 3.5 13" />
        <path d="M12 8v4.4l3 1.8" />
      </svg>
    )
  }
  // An unnamed icon should look unnamed rather than borrowing a meaning from whichever
  // shape happened to be last in the file.
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="7" />
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
  /** The agent being edited, and how to remove it. Absent for the built-in — see below. */
  agent,
  onDelete,
}) {
  /**
   * Deleting is two steps, and the second one has to say what it destroys.
   *
   * An agent is a prompt somebody wrote, tools they declared and skills they authored — the
   * work of a sitting, held in one JSON file, with no undo and no trash. A single click at
   * the bottom of a sidebar is not enough distance from that.
   *
   * So the dialog names the agent and counts what goes with it. "Delete this agent?" is a
   * question nobody reads; "מוחק את ביטוח נסיעות — 2 כלים, 1 סקיל" is one they answer.
   */
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
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

  // Children count as items: the pane title has to resolve for a sub-tab too.
  const allItems = nav.flatMap((g) => g.items.flatMap((i) => [i, ...(i.children ?? [])]))
  const current = allItems.find((i) => i.id === activePane) ?? null

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
                {group.items.map((item) => {
                  /**
                   * An item with children is a heading you can open, not a pane.
                   *
                   * Clicking it selects its first child rather than toggling something with
                   * nothing behind it — a parent that opens to reveal a list and shows an
                   * empty pane meanwhile is two clicks to get anywhere and one to get lost.
                   */
                  const children = item.children ?? []
                  const childActive = children.some((c) => c.id === activePane)
                  const on = activePane === item.id || childActive

                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`ws-item ${on ? 'on' : ''} ${children.length ? 'parent' : ''}`}
                        onClick={() =>
                          onPane(
                            children.length
                              ? childActive
                                ? null
                                : children[0].id
                              : activePane === item.id
                                ? null
                                : item.id,
                          )
                        }
                        aria-current={on ? 'true' : undefined}
                        aria-expanded={children.length ? childActive : undefined}
                        aria-label={item.label}
                        title={item.label}
                      >
                        <Icon name={item.icon} />
                        {sideOpen && (
                          <>
                            <span className="ws-item-label">{item.label}</span>
                            {item.badge && <span className="ws-item-badge mono">{item.badge}</span>}
                            {children.length > 0 && (
                              /* The same chevron the back-to-agents button draws, at the
                                 same stroke weight — a nav that uses a text arrow in one
                                 place and a drawn one in another reads as two nav bars. */
                              <svg
                                className={`ws-item-caret ${childActive ? 'open' : ''}`}
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M9 6l6 6-6 6" />
                              </svg>
                            )}
                          </>
                        )}
                      </button>

                      {/* Collapsed rail: children would be unlabelled icons under an
                          unlabelled icon, so they stay closed until there is room to say
                          what they are. */}
                      {sideOpen && childActive && (
                        <ul className="ws-subnav">
                          {children.map((child) => (
                            <li key={child.id}>
                              <button
                                type="button"
                                className={`ws-subitem ${activePane === child.id ? 'on' : ''}`}
                                onClick={() => onPane(child.id)}
                                aria-current={activePane === child.id ? 'true' : undefined}
                              >
                                {child.label}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>

        {/**
         * Only for an agent that is a record.
         *
         * The built-in is defined by code that reads the airport dataset — there is nothing
         * on disk to remove, and the server refuses the call. A button that is always there
         * and sometimes fails is worse than one that appears only when it means something.
         */}
        {agent && !agent.builtIn && onDelete && (
          <div className="ws-side-foot">
            <button
              type="button"
              className={`ws-delete ${sideOpen ? '' : 'icon-only'}`}
              onClick={() => {
                setDeleteError(null)
                setConfirming(true)
              }}
              aria-label="מחק את הסוכן"
              title="מחק את הסוכן"
            >
              <Icon name="trash" />
              {sideOpen && <span>מחק סוכן</span>}
            </button>
          </div>
        )}
      </nav>

      {confirming && agent && (
        <div
          className="ws-confirm-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ws-confirm-title"
          /* Click outside cancels. The destructive path stays deliberate: it is the one
             button you have to actually aim at. */
          onClick={() => !deleting && setConfirming(false)}
          onKeyDown={(e) => e.key === 'Escape' && !deleting && setConfirming(false)}
        >
          <div className="ws-confirm" onClick={(e) => e.stopPropagation()}>
            <h3 id="ws-confirm-title">למחוק את {agent.name}?</h3>
            {/* What goes with it, counted rather than described. */}
            <ul className="ws-confirm-loss">
              <li>
                <bdi>{(agent.systemPrompt ?? '').length} תווים</bdi> של פרומפט
              </li>
              <li>
                <bdi>
                  {(agent.toolNames ?? []).length + (agent.customTools ?? []).length} כלים
                </bdi>
                {/* Isolated too. Two counts beside each other in one right-to-left run is
                    precisely how "11 תורות · 9 תגיות" became "11 תגיות 9 תורות" in the
                    history list — both numbers readable, both attached to the wrong noun. */}
                {(agent.customTools ?? []).length > 0 && (
                  <b>
                    {' · '}
                    <bdi>{agent.customTools.length} שהצהרת בעצמך</bdi>
                  </b>
                )}
              </li>
              <li>
                <bdi>{(agent.skills ?? []).length} סקילים</bdi>
              </li>
            </ul>
            <p className="ws-confirm-warn">
              אין ביטול ואין סל מיחזור. השיחות השמורות נשארות — הן לא חלק מהסוכן.
            </p>

            {deleteError && <p className="ac-warn-note">{deleteError}</p>}

            <div className="ws-confirm-actions">
              <button type="button" onClick={() => setConfirming(false)} disabled={deleting}>
                ביטול
              </button>
              <button
                type="button"
                className="ws-confirm-go"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true)
                  setDeleteError(null)
                  try {
                    await onDelete(agent.id)
                    // No setConfirming(false): a successful delete navigates away and this
                    // whole tree unmounts. Clearing state on a gone component is the warning
                    // nobody needs to see.
                  } catch (err) {
                    setDeleteError(err.message)
                    setDeleting(false)
                  }
                }}
              >
                {deleting ? 'מוחק…' : 'מחק לצמיתות'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="ws-center">
        {activePane && (
          <section className="ws-pane" aria-label={current?.label}>
            <div className="ws-pane-top">
              <h3>{current?.label}</h3>
              {/* Back to the conversation, not "close". While you are editing instructions or
                  reading the dashboard there is no reason to be looking at a composer you are
                  not using — the pane takes the room instead of floating over it, so the way
                  out has to name where it goes. */}
              <button type="button" className="ws-to-call" onClick={() => onPane(null)}>
                {railLive ? 'חזרה לשיחה החיה' : 'חזרה לשיחה'}
              </button>
            </div>
            <div className="ws-pane-body">{pane}</div>
          </section>
        )}
        {/*
          Hidden, never unmounted.
          LivePanel holds the session — the peer connection, the microphone, the tool
          handlers. Rendering the pane INSTEAD of it would tear all of that down and hang up
          the call the moment somebody opened the settings, which is exactly when they are
          least expecting to be disconnected. So it stays mounted and goes invisible.
        */}
        <div className="ws-center-body" hidden={Boolean(activePane)}>
          {center}
        </div>
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

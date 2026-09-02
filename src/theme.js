/**
 * Which ground the console is read on.
 *
 * Three states, not two. "system" is the default and is a real choice — it means follow
 * the machine — so the control has to be able to return to it rather than only toggling
 * between the two explicit ones. A stored value writes data-theme on the root; "system"
 * removes the attribute and lets the media query in index.css decide.
 *
 * The value is also applied by an inline script in index.html before first paint. Doing it
 * only from here would flash the wrong ground on every load, which on a dark-first console
 * is the entire screen.
 */
const KEY = 'theme'
export const THEMES = ['system', 'dark', 'light']

/** What is stored, not what is showing — those differ under "system". */
export function readTheme() {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === 'dark' || stored === 'light' ? stored : 'system'
  } catch {
    // A private window, or site data blocked. The media query still works.
    return 'system'
  }
}

export function applyTheme(theme) {
  const root = document.documentElement
  if (theme === 'dark' || theme === 'light') {
    root.dataset.theme = theme
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* nothing to store into; the attribute still holds for this page */
    }
  } else {
    delete root.dataset.theme
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* as above */
    }
  }
  return theme
}

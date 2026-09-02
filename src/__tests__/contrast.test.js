/**
 * Every text colour in the token system, against every ground it lands on.
 *
 * This is a test rather than a one-off check because the palette it replaced had failed
 * quietly for a long time: --text-dim carried most of the Hebrew explanatory prose at
 * 3.97:1 in light and 3.48:1 on a sunk panel, and --warn was never declared at all, so the
 * "your settings have drifted" line — the one that most needs to be read — fell back to a
 * hardcoded #d7860b at 2.88:1.
 *
 * Nothing in lint, the build or the other tests can see a contrast ratio. This can.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'),
  'utf8',
)

const channels = (hex) => {
  let h = hex.replace('#', '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
}
const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = (hex) => {
  const [r, g, b] = channels(hex).map(linear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The hex tokens declared in one block of the stylesheet. */
const tokensIn = (from, to) => {
  const start = css.indexOf(from)
  expect(start, `block not found: ${from}`).toBeGreaterThan(-1)
  const chunk = css.slice(start, to ? css.indexOf(to, start) : undefined)
  const found = {}
  for (const m of chunk.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{3,8})/gi)) found[m[1]] = m[2]
  return found
}

const MODES = {
  dark: tokensIn(':root {', ":root[data-theme='light']"),
  light: tokensIn(":root[data-theme='light']", '@media (prefers-color-scheme: light)'),
}

const FOREGROUNDS = ['text-strong', 'text', 'text-dim', 'signal', 'live', 'danger']
const GROUNDS = ['bg-panel', 'bg-sunk', 'bg']

describe.each(Object.entries(MODES))('%s theme', (mode, tokens) => {
  it('declares every foreground and ground it needs', () => {
    for (const name of [...FOREGROUNDS, ...GROUNDS]) {
      expect(tokens[name], `${mode} is missing --${name}`).toMatch(/^#[0-9a-f]{3,8}$/i)
    }
  })

  it.each(FOREGROUNDS)('%s reaches 4.5:1 on every ground', (fg) => {
    for (const bg of GROUNDS) {
      const ratio = contrast(tokens[fg], tokens[bg])
      expect(
        Number(ratio.toFixed(2)),
        `--${fg} ${tokens[fg]} on --${bg} ${tokens[bg]} in ${mode}`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('separates interactive regions with a rule that reaches 3:1', () => {
    // WCAG 1.4.11. --rule is a decorative hairline and is deliberately below this;
    // --rule-strong is the one used where a border carries meaning.
    expect(contrast(tokens['rule-strong'], tokens['bg-panel'])).toBeGreaterThanOrEqual(3)
  })
})

describe('tokens referenced by the app', () => {
  it('declares everything App.css asks for', () => {
    // --warn and --muted were used with hardcoded fallbacks and never declared, which is
    // how the least readable colour in the app got in.
    const appCss = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../App.css'),
      'utf8',
    )
    const used = new Set([...appCss.matchAll(/var\(--([a-z-]+)/g)].map((m) => m[1]))
    // App.css declares --gutter itself, so both files count as sources.
    const declared = new Set(
      [...css.matchAll(/--([a-z-]+):/g), ...appCss.matchAll(/^\s*--([a-z-]+):/gm)].map(
        (m) => m[1],
      ),
    )
    const missing = [...used].filter((name) => !declared.has(name))
    expect(missing).toEqual([])
  })
})

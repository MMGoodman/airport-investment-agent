/**
 * The gate that decides whether end_call actually hangs up.
 *
 * Every "should not end" case here is a real transcript from a live session or from
 * probe-hangup. The first one ended a call in front of someone.
 */
import { describe, it, expect } from 'vitest'
import { isFarewell } from '../farewell.js'

describe('isFarewell', () => {
  it('does not end a call on thanks, however final it sounds', () => {
    // Measured at 16/24 across eight samples of each: the prompt rule is present and losing.
    // This is the case that cut a call off mid-demo.
    expect(isFarewell('אוקיי, תודה רבה.')).toBe(false)
    expect(isFarewell('אה, תודה רבה.')).toBe(false)
    expect(isFarewell('אוקיי, מגניב. אממ, טוב, תודה רבה לך.')).toBe(false)
    expect(isFarewell('תודה רבה.')).toBe(false)
  })

  it('does not end a call on an acknowledgement or a fragment', () => {
    expect(isFarewell('אוקיי.')).toBe(false)
    expect(isFarewell('שדה תעופה.')).toBe(false)
    expect(isFarewell('')).toBe(false)
    expect(isFarewell(null)).toBe(false)
  })

  it('ends a call on an explicit goodbye', () => {
    expect(isFarewell('ביי, להתראות.')).toBe(true)
    expect(isFarewell('סיימתי, תודה. אפשר לנתק.')).toBe(true)
    expect(isFarewell('להתראות')).toBe(true)
  })

  it('reads an English goodbye too, for a call switched mid-session', () => {
    expect(isFarewell('Okay, bye!')).toBe(true)
    expect(isFarewell("That's all, thanks")).toBe(true)
    expect(isFarewell('thanks a lot')).toBe(false)
  })

  it('is not fooled by punctuation the transcriber may or may not add', () => {
    expect(isFarewell('ביי')).toBe(true)
    expect(isFarewell('ביי.')).toBe(true)
    expect(isFarewell('ביי!')).toBe(true)
  })
})

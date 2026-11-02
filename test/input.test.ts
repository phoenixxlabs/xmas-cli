import { afterEach, describe, expect, it, vi } from 'vitest'
import { InputRouter, hotkeyBytes } from '../src/input.js'

function setup(opts: { top?: number; rows?: number; wantsFocus?: boolean } = {}) {
  const sent: string[] = []
  const events: string[] = []
  const r = new InputRouter(
    {
      hotkey: (n) => events.push(`hotkey:${n}`),
      focus: (f) => events.push(`focus:${f}`),
      childWantsFocus: () => !!opts.wantsFocus,
      topOffset: () => opts.top ?? 0,
      childRows: () => opts.rows ?? 30,
    },
    (s) => sent.push(s),
    10,
  )
  r.setHotkeys({ snow: 'ctrl+alt+s', lights: 'alt+l' })
  return { r, sent, events, out: () => sent.join('') }
}

afterEach(() => vi.useRealTimers())

describe('hotkeyBytes', () => {
  it('encodes ctrl+alt and alt', () => {
    expect(hotkeyBytes('ctrl+alt+s')).toBe('\x1b\x13')
    expect(hotkeyBytes('alt+l')).toBe('\x1bl')
  })
  it('refuses keys that would steal plain ctrl chords from claude', () => {
    expect(hotkeyBytes('ctrl+s')).toBeNull()
    expect(hotkeyBytes('s')).toBeNull()
  })
})

describe('InputRouter', () => {
  it('forwards ordinary typing untouched', () => {
    const { r, out } = setup()
    r.feed('hello é世')
    expect(out()).toBe('hello é世')
  })

  it('consumes hotkeys and forwards the rest', () => {
    const { r, out, events } = setup()
    r.feed('a\x1b\x13b')
    expect(events).toEqual(['hotkey:snow'])
    expect(out()).toBe('ab')
  })

  it('does not interpret anything inside a bracketed paste', () => {
    const { r, out, events } = setup()
    r.feed('\x1b[200~x\x1b\x13y\x1b[I\x1b[201~z')
    expect(events).toEqual([])
    expect(out()).toBe('\x1b[200~x\x1b\x13y\x1b[I\x1b[201~z')
  })

  it('survives a paste end marker split across chunks', () => {
    const { r, out, events } = setup()
    r.feed('\x1b[200~abc\x1b[20')
    r.feed('1~\x1b\x13')
    expect(out()).toBe('\x1b[200~abc\x1b[201~')
    expect(events).toEqual(['hotkey:snow'])
  })

  it('reassembles a CSI sequence split across chunks', () => {
    const { r, out } = setup()
    r.feed('\x1b[')
    r.feed('A')
    expect(out()).toBe('\x1b[A')
  })

  it('releases a lone Esc after the delay', () => {
    vi.useFakeTimers()
    const { r, out } = setup()
    r.feed('\x1b')
    expect(out()).toBe('')
    vi.advanceTimersByTime(20)
    expect(out()).toBe('\x1b')
  })

  it('swallows focus reports unless the child asked for them, but always reports them', () => {
    const a = setup({ wantsFocus: false })
    a.r.feed('\x1b[I\x1b[O')
    expect(a.out()).toBe('')
    expect(a.events).toEqual(['focus:true', 'focus:false'])
    const b = setup({ wantsFocus: true })
    b.r.feed('\x1b[I')
    expect(b.out()).toBe('\x1b[I')
  })

  it('shifts mouse rows by the reserved band and drops clicks on the band', () => {
    const { r, out } = setup({ top: 1, rows: 20 })
    r.feed('\x1b[<0;10;5M')
    r.feed('\x1b[<0;10;1M') // on the band
    r.feed('\x1b[<64;3;21m')
    expect(out()).toBe('\x1b[<0;10;4M\x1b[<64;3;20m')
  })

  it('leaves mouse reports alone when nothing is reserved', () => {
    const { r, out } = setup({ top: 0 })
    r.feed('\x1b[<0;10;5M')
    expect(out()).toBe('\x1b[<0;10;5M')
  })

  it('passes SS3 and Alt+key sequences through', () => {
    const { r, out } = setup()
    r.feed('\x1bOA\x1bx')
    expect(out()).toBe('\x1bOA\x1bx')
  })
})

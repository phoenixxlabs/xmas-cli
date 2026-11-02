import { describe, expect, it } from 'vitest'
import { PAST_TENSE, drawWords } from '../src/fx/words.js'
import { gridFrom } from './helpers.js'

describe('drawWords', () => {
  it('swaps the verb and keeps the rest of the line, shifted', () => {
    const g = gridFrom(['✻ Churned for 2s · done 10:37', '', 'Cooked for 5s is not a status line'], 60)
    expect(drawWords(g, { enabled: true })).toBe(1)
    const row = g.rowText(0).trimEnd()
    const m = /^✻ (\w+) for 2s · done 10:37$/.exec(row)
    expect(m, row).not.toBeNull()
    expect(PAST_TENSE).toContain(m![1])
    expect(g.rowText(2).trimEnd()).toBe('Cooked for 5s is not a status line')
  })

  it('is stable for the same line and clips instead of overflowing', () => {
    const a = gridFrom(['✻ Sautéed for 1m 4s'], 30)
    const b = gridFrom(['✻ Sautéed for 1m 4s'], 30)
    drawWords(a, { enabled: true })
    drawWords(b, { enabled: true })
    expect(a.toText()).toBe(b.toText())
    const tight = gridFrom(['✻ Baked for 3s'], 14)
    expect(() => drawWords(tight, { enabled: true })).not.toThrow()
    expect(tight.rowText(0).length).toBeLessThanOrEqual(14)
  })

  it('leaves working lines and other text alone, and respects the switch', () => {
    const g = gridFrom(['✻ Caroling… (3s · esc to interrupt)', '* Baked for 3s'], 50)
    expect(drawWords(g, { enabled: false })).toBe(0)
    expect(g.rowText(1).trimEnd()).toBe('* Baked for 3s')
    expect(drawWords(gridFrom(['✻ Caroling… (3s · esc to interrupt)'], 50), { enabled: true })).toBe(0)
  })
})

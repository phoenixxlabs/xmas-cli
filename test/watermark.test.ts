import { describe, expect, it } from 'vitest'
import { Grid } from '../src/grid.js'
import { Watermark } from '../src/fx/watermark.js'

function logo(g: Grid): void {
  for (let y = 4; y < 14; y++) g.text(30, y, '⣿⣿⣿⣷⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿')
}

describe('watermark', () => {
  it('keeps the logo after the agent wipes it and paints it behind other things', () => {
    const w = new Watermark()
    const shown = new Grid(100, 20)
    logo(shown)
    w.capture(shown)
    expect(w.captured).toBe(true)

    const later = new Grid(100, 20)
    later.text(32, 6, 'hello')
    w.draw(later)
    expect(later.rowText(6, 32, 37)).toBe('hello')
    expect(later.rowText(8, 30, 44)).toBe('⣿⣿⣿⣷⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿')
    expect(later.rowText(2).trim()).toBe('')
  })

  it('ignores ordinary screens', () => {
    const w = new Watermark()
    const g = new Grid(100, 20)
    g.text(0, 0, 'just some text, no art here')
    w.capture(g)
    expect(w.captured).toBe(false)
  })
})

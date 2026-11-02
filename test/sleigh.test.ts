import { describe, expect, it } from 'vitest'
import { Grid } from '../src/grid.js'
import { Flyby } from '../src/fx/sleigh.js'
import { emptyScene } from '../src/scene.js'

const cfg = { enabled: true, minGap: 10, maxGap: 10, items: true }

// plays a flight over `g`, repainting the original screen before every frame the way the
// compositor does, and leaves the last frame in `g`
function fly(g: Grid, seconds: number, f = new Flyby(cfg)): Flyby {
  const base = new Grid(g.cols, g.rows)
  base.copyFrom(g)
  const scene = emptyScene(g)
  scene.noSnowFromRow = g.rows - 4
  f.trigger()
  for (let t = 0; t < seconds; t += 0.05) {
    g.copyFrom(base)
    f.update(0.05, g, scene)
    f.draw(g, scene, t)
  }
  return f
}

describe('flyby', () => {
  it('waits for its gap, then crosses the screen and goes away', () => {
    const g = new Grid(120, 30)
    const f = new Flyby(cfg)
    const scene = emptyScene(g)
    f.update(5, g, scene)
    expect(f.isFlying).toBe(false)
    f.trigger()
    f.update(0.05, g, scene)
    expect(f.isFlying).toBe(true)
    for (let i = 0; i < 20 * 20; i++) f.update(0.05, g, scene)
    expect(f.isFlying).toBe(false)
  })

  it('only paints blank cells and stays above the prompt area', () => {
    const g = new Grid(120, 30)
    // a block of text across the middle of the screen
    for (let y = 12; y < 18; y++) g.text(0, y, 'x'.repeat(120))
    const before = new Grid(120, 30)
    before.copyFrom(g)
    // stop mid-flight so the sleigh is still on screen
    fly(g, 8)
    for (let y = 12; y < 18; y++) expect(g.rowText(y)).toBe(before.rowText(y))
    for (let y = 26; y < 30; y++) expect(g.rowText(y).trim()).toBe('')
    expect(g.toText().includes('█')).toBe(true)
  })

  it('does not take off when no stretch of rows is free', () => {
    const g = new Grid(120, 30)
    for (let y = 0; y < 30; y++) g.text(0, y, 'x'.repeat(120))
    const f = fly(g, 3)
    expect(f.isFlying).toBe(false)
  })

  it('does nothing when disabled', () => {
    const g = new Grid(120, 30)
    fly(g, 5, new Flyby({ ...cfg, enabled: false }))
    expect(g.toText().trim()).toBe('')
  })
})

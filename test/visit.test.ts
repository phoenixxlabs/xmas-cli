import { describe, expect, it } from 'vitest'
import { Grid, hex } from '../src/grid.js'
import { VisitingSanta } from '../src/fx/visit.js'
import { emptyScene } from '../src/scene.js'

const cfg = { enabled: true, minGap: 10, maxGap: 10 }

function setup(): { g: Grid; scene: ReturnType<typeof emptyScene> } {
  const g = new Grid(120, 30)
  const scene = emptyScene(g)
  scene.noSnowFromRow = 26
  return { g, scene }
}

describe('visiting santa', () => {
  it('waits for its gap, walks in, and leaves again', () => {
    const { g, scene } = setup()
    const v = new VisitingSanta(cfg)
    v.update(5, g, scene)
    expect(v.isVisiting).toBe(false)
    v.trigger()
    v.update(0.05, g, scene)
    expect(v.isVisiting).toBe(true)
    // it should be over well within a minute
    for (let i = 0; i < 20 * 60 && v.isVisiting; i++) v.update(0.05, g, scene)
    expect(v.isVisiting).toBe(false)
  })

  it('stands on the lowest empty rows above the prompt and only paints blank cells', () => {
    const { g, scene } = setup()
    // text on the row just above the prompt: Santa must use the rows above it
    g.text(0, 25, 'x'.repeat(120))
    const v = new VisitingSanta(cfg)
    v.trigger()
    v.update(0.05, g, scene)
    for (let i = 0; i < 20 * 10; i++) v.update(0.05, g, scene)
    v.draw(g, scene)
    expect(g.rowText(25)).toBe('x'.repeat(120))
    const painted: number[] = []
    for (let y = 0; y < 30; y++) if (y !== 25 && g.rowText(y).trim()) painted.push(y)
    expect(painted.length).toBeGreaterThan(0)
    expect(Math.max(...painted)).toBeLessThan(25)
  })

  it('eats the cookies one at a time', () => {
    const { g, scene } = setup()
    const v = new VisitingSanta(cfg)
    v.trigger()
    const count = (): number => {
      const frame = new Grid(120, 30)
      v.draw(frame, scene)
      let n = 0
      for (let i = 0; i < frame.ch.length; i++) if (frame.fg[i] === hex('#d9b98a') && frame.ch[i] === '█') n++
      return n
    }
    v.update(0.05, g, scene)
    for (let i = 0; i < 20 * 8; i++) v.update(0.05, g, scene)
    const early = count()
    for (let i = 0; i < 20 * 6; i++) v.update(0.05, g, scene)
    expect(count()).toBeLessThan(early)
  })

  it('does nothing when disabled', () => {
    const { g, scene } = setup()
    const v = new VisitingSanta({ ...cfg, enabled: false })
    v.trigger()
    for (let i = 0; i < 200; i++) v.update(0.05, g, scene)
    v.draw(g, scene)
    expect(g.toText().trim()).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import {
  A_BOLD,
  A_DIM,
  A_INVERSE,
  A_ITALIC,
  A_STRIKE,
  A_UNDERLINE,
  Grid,
  W_LEAD,
  W_TAIL,
  pal,
  rgb,
} from '../src/grid.js'
import { Renderer } from '../src/render.js'
import { mulberry32 } from '../src/fx/rng.js'
import { feed, gridsEqual, makeEmu } from './helpers.js'

const ATTRS = [A_BOLD, A_DIM, A_ITALIC, A_UNDERLINE, A_INVERSE, A_STRIKE]
const CHARS = ['a', 'Z', '─', '█', '▐', '✻', '·', '*', '❄', 'é', ' ', ' ', ' ']
const WIDE = ['好', '世', '界']

function breakPair(g: Grid, i: number): void {
  if (g.w[i] === W_LEAD) g.set((i % g.cols) + 1, Math.floor(i / g.cols), ' ')
  else if (g.w[i] === W_TAIL) g.set((i % g.cols) - 1, Math.floor(i / g.cols), ' ')
}

function randomize(g: Grid, rnd: () => number, density: number): void {
  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) {
      if (rnd() > density) continue
      const i = y * g.cols + x
      const wide = rnd() < 0.08 && x + 1 < g.cols
      breakPair(g, i)
      if (wide) breakPair(g, i + 1)
      const fg =
        rnd() < 0.3
          ? 0
          : rnd() < 0.5
            ? pal(Math.floor(rnd() * 256))
            : rgb(Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256))
      const bg =
        rnd() < 0.7 ? 0 : rnd() < 0.5 ? pal(Math.floor(rnd() * 256)) : rgb(Math.floor(rnd() * 256), 20, 40)
      let at = 0
      for (const a of ATTRS) if (rnd() < 0.12) at |= a
      if (wide) {
        g.set(x, y, WIDE[Math.floor(rnd() * WIDE.length)]!, fg, bg, at)
        g.w[i] = W_LEAD
        g.set(x + 1, y, '', fg, bg, at)
        g.w[i + 1] = W_TAIL
        x++
      } else {
        g.set(x, y, CHARS[Math.floor(rnd() * CHARS.length)]!, fg, bg, at)
      }
    }
  }
}

async function roundTrip(seed: number, cols: number, rows: number): Promise<void> {
  const rnd = mulberry32(seed)
  const r = new Renderer()
  const emu = makeEmu(cols, rows)
  const shown = new Grid(cols, rows)
  const truth = new Grid(cols, rows)
  for (let frame = 0; frame < 6; frame++) {
    randomize(truth, rnd, frame === 0 ? 0.9 : 0.06)
    const bytes = r.frame(truth, { x: 3, y: 2, visible: true, shape: 0 })
    await feed(emu, bytes)
    emu.snapshot(shown)
    expect(gridsEqual(truth, shown), `seed ${seed} frame ${frame}`).toBeNull()
  }
}

describe('Renderer round trip through a real xterm', () => {
  it('reproduces random frames exactly, full and incremental', async () => {
    for (let seed = 1; seed <= 12; seed++) await roundTrip(seed, 40 + seed, 12)
  })

  it('handles the last column and last row', async () => {
    await roundTrip(99, 17, 5)
  })

  it('emits nothing when nothing changed', () => {
    const r = new Renderer()
    const g = new Grid(10, 3)
    g.text(0, 0, 'hello')
    const cur = { x: 1, y: 1, visible: true, shape: 0 }
    expect(r.frame(g, cur)).not.toBe('')
    expect(r.frame(g, cur)).toBe('')
  })

  it('repaints fully after invalidate', () => {
    const r = new Renderer()
    const g = new Grid(10, 3)
    r.frame(g, null)
    r.invalidate()
    expect(r.frame(g, null)).not.toBe('')
  })

  it('moves only the changed cells', () => {
    const r = new Renderer()
    const g = new Grid(80, 24)
    r.frame(g, null)
    g.set(40, 12, 'x')
    const out = r.frame(g, null)
    expect(out.length).toBeLessThan(80)
    expect(out).toContain('x')
  })
})

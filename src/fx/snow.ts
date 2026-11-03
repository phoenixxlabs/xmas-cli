// falling snow. only goes into blank cells with some room either side, keeps out of the prompt
// box and footer, and settles into small drifts on claude's rules before melting

import { Grid, hex } from '../grid.js'
import type { Scene } from '../scene.js'
import { mulberry32 } from './rng.js'

export interface SnowConfig {
  enabled: boolean
  // flakes per cell
  density: number
  // 0 is still air
  wind: number
  // blank cells needed either side of a flake
  clearance: number
  drift: boolean
  glyphs: { far: string; mid: string; near: string }
}

interface Flake {
  y: number
  cy: number
  // column the flake is drawn in, only changes with the row so flakes fall in clean lines
  cx: number
  // sideways movement that hasn't added up to a whole column yet
  lean: number
  vy: number
  layer: 0 | 1 | 2
}

interface Drift {
  depth: number
  melt: number
}

const COLORS = [hex('#6b8aab'), hex('#b9d4ef'), hex('#ffffff')]
const DRIFT_COLORS = ['', '#9fb8d1', '#dcebf8', '#ffffff'].map((c) => (c ? hex(c) : 0))
const SPEED = [0.55, 0.9, 1.3]
const MAX_DT = 0.1

export class Snow {
  private flakes: Flake[] = []
  private drifts = new Map<number, Drift>()
  private clear = new Uint8Array(0)
  private t = 0
  private gust = 0
  private cols = 0
  private rows = 0

  constructor(
    public cfg: SnowConfig,
    private rng: () => number = mulberry32(0xc0ffee),
  ) {}

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.clear = new Uint8Array(cols * rows)
    this.drifts.clear()
    this.flakes.length = 0
    this.fill(true)
  }

  // sudden breeze after a turn ends
  burst(strength = 1): void {
    this.gust = Math.min(3, this.gust + strength)
  }

  get count(): number {
    return this.flakes.length
  }

  get driftCount(): number {
    return this.drifts.size
  }

  private target(): number {
    return Math.max(6, Math.min(400, Math.round(this.cols * this.rows * this.cfg.density)))
  }

  private spawn(anywhere: boolean): Flake {
    const r = this.rng()
    const layer: 0 | 1 | 2 = r < 0.58 ? 0 : r < 0.9 ? 1 : 2
    return {
      cx: Math.floor(this.rng() * this.cols),
      lean: 0,
      y: anywhere ? this.rng() * this.rows : -this.rng() * 3,
      cy: -1,
      vy: (2.5 + this.rng() * 0.9) * SPEED[layer]!,
      layer,
    }
  }

  private fill(anywhere: boolean): void {
    const want = this.target()
    while (this.flakes.length < want) this.flakes.push(this.spawn(anywhere))
    if (this.flakes.length > want) this.flakes.length = want
  }

  update(dtRaw: number, scene: Scene): void {
    if (!this.cfg.enabled || this.cols === 0) return
    const dt = Math.min(MAX_DT, Math.max(0, dtRaw))
    this.t += dt
    this.gust *= Math.exp(-dt / 1.4)
    this.fill(false)

    // steady lean with a slow swell, so flakes drift one way and don't swing about
    const breeze = this.cfg.wind * (0.5 + 0.25 * Math.sin(this.t * 0.13)) + this.gust * 2.4
    const fall = 1 + this.gust * 0.25

    for (let n = 0; n < this.flakes.length; n++) {
      const f = this.flakes[n]!
      const k = SPEED[f.layer]!
      const speed = f.vy * fall
      f.y += speed * dt
      const cy = Math.floor(f.y)
      if (cy >= this.rows) {
        this.flakes[n] = this.spawn(false)
        continue
      }
      if (cy !== f.cy) {
        // shift a whole column at a time, and only as the flake drops a row
        f.lean += ((breeze * k) / speed) * Math.max(1, cy - f.cy)
        const shift = Math.trunc(f.lean)
        f.lean -= shift
        f.cx = (((f.cx + shift) % this.cols) + this.cols) % this.cols
        f.cy = cy
        if (this.cfg.drift && cy >= 0 && cy + 1 < this.rows) {
          const cx = f.cx
          const here = cy * this.cols + cx
          if (scene.ledge[here + this.cols] && this.clear[here]! >= 1) {
            this.land(here)
            this.flakes[n] = this.spawn(false)
          }
        }
      }
    }
  }

  private land(idx: number): void {
    const d = this.drifts.get(idx)
    if (d) {
      if (d.depth < 3) d.depth++
      d.melt = this.t + 8 + this.rng() * 10
      return
    }
    // keep drifts patchy, a ledge never fills past about a fifth of its width
    const row = Math.floor(idx / this.cols)
    let inRow = 0
    for (const k of this.drifts.keys()) if (Math.floor(k / this.cols) === row) inRow++
    if (inRow >= Math.max(3, Math.floor(this.cols * 0.2))) return
    this.drifts.set(idx, { depth: 1, melt: this.t + 8 + this.rng() * 10 })
  }

  // distance to the nearest painted cell on each row, capped at 255
  private measure(g: Grid, scene: Scene, cursor?: { x: number; y: number }): void {
    const { cols, rows } = g
    if (this.clear.length !== cols * rows) this.clear = new Uint8Array(cols * rows)
    const c = this.clear
    for (let y = 0; y < rows; y++) {
      const row = y * cols
      if (y >= scene.noSnowFromRow) {
        c.fill(0, row, row + cols)
        continue
      }
      let d = 255
      for (let x = 0; x < cols; x++) {
        d = g.isBlank(row + x) ? Math.min(255, d + 1) : 0
        c[row + x] = d
      }
      d = 255
      for (let x = cols - 1; x >= 0; x--) {
        d = g.isBlank(row + x) ? Math.min(255, d + 1) : 0
        if (d < c[row + x]!) c[row + x] = d
      }
    }
    if (cursor && g.inside(cursor.x, cursor.y)) c[cursor.y * cols + cursor.x] = 0
  }

  draw(g: Grid, scene: Scene, cursor?: { x: number; y: number }): void {
    if (!this.cfg.enabled) return
    if (g.cols !== this.cols || g.rows !== this.rows) this.resize(g.cols, g.rows)
    this.measure(g, scene, cursor)
    const { cols } = g

    for (const [idx, d] of this.drifts) {
      const ledgeBelow = idx + cols < scene.ledge.length && scene.ledge[idx + cols] === 1
      if (!ledgeBelow || this.clear[idx]! < 1) {
        // ledge moved or text covers it, drop the drift
        this.drifts.delete(idx)
        continue
      }
      if (this.t >= d.melt) {
        d.depth--
        d.melt = this.t + 6 + this.rng() * 8
        if (d.depth <= 0) {
          this.drifts.delete(idx)
          continue
        }
      }
      // snow sits on the line itself: an upper-half block, so it looks like it's resting there
      const color = DRIFT_COLORS[d.depth]!
      const rule = idx + cols
      // the smallest drifts are one quarter block so the lights still show between lumps
      g.ch[rule] = d.depth === 1 ? ((idx % cols) % 2 ? '▘' : '▝') : '▀'
      g.fg[rule] = color
      g.at[rule] = 0
    }

    const glyphs = [this.cfg.glyphs.far, this.cfg.glyphs.mid, this.cfg.glyphs.near]
    // small flakes sit high, middle or low in the cell: three steps a row instead of one
    const fine = this.cfg.glyphs.far === '·'
    for (const f of this.flakes) {
      const x = f.cx
      const y = Math.floor(f.y)
      if (y < 0 || y >= g.rows || x < 0 || x >= cols) continue
      const i = y * cols + x
      if (this.clear[i]! <= this.cfg.clearance) continue
      if (!g.isBlank(i)) continue
      const part = f.y - y
      const glyph = fine && f.layer === 0 ? (part < 0.34 ? '˙' : part < 0.67 ? '·' : '.') : glyphs[f.layer]!
      g.set(x, y, glyph, COLORS[f.layer]!)
    }
  }
}

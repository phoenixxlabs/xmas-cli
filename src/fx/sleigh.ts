// a sleigh and reindeer fly across the empty rows every few minutes, trailing sparkles and
// dropping presents. like the other effects they only paint blank cells, never text

import { A_BOLD, Color, Grid, hex, mix } from '../grid.js'
import type { Scene } from '../scene.js'
import { paintPixels } from './pixels.js'
import { mulberry32 } from './rng.js'

export interface FlybyConfig {
  enabled: boolean
  // seconds between flights, somewhere between min and max
  minGap: number
  maxGap: number
  // drop presents
  items: boolean
}

// santa is 8 pixels wide and sits above the sleigh, which starts at pixel row 8
const SANTA = ['..RRRW..', '.RRRRRR.', '.WWWWWW.', '.SSSSSS.', '.SKSSKS.', '.WWWWWW.', '.WWWWWW.', 'RRRWWRRR']

const SACK = ['.YY.', 'TTTT', 'TTTT', 'TTTT', 'TTTT']

const SLEIGH = [
  '.RRRRRRRRRRRRRRRR.',
  'RRRRRRRRRRRRRRRRRR',
  'rrrrrrrrrrrrrrrrrr',
  '..YYYYYYYYYYYYYY..',
  '...Y......Y.....YY',
  'YYYYYYYYYYYYYYYYYY',
]

// one reindeer facing right, step picks the leg pose
function deer(step: number, lead: boolean): string[] {
  const legs = step ? '..b.b..b..b...' : '.b..b...b.b...'
  return [
    '..........b..b',
    '...........bb.',
    '.BBBBBBB..BBB.',
    `BBBBBBBBBBBBB${lead ? 'N' : 'b'}`,
    '.BBBBBBBB.BBB.',
    legs,
  ]
}

const GAP = 2 // pixels of rein between neighbours
const DEER_W = 14
const SLEIGH_W = 18
const ROWS = 14 // pixel rows; the terminal rows are half of this
const HEIGHT = ROWS / 2
const REIN_ROW = 11

interface Present {
  x: number
  y: number
  vx: number
  vy: number
  color: Color
}

const PRESENTS = ['#ff6b7a', '#6cc4ff', '#46d68c', '#f2c14e', '#d58bff'].map((c) => hex(c))

const SPARKS = ['·', '.', '*']
const SPARK_COLOR = hex('#bfe3ff')
const SPARK_FADE = hex('#2c4058')

// the whole team as rows of pixel letters
function train(deerCount: number, step: number): string[] {
  const width = SLEIGH_W + deerCount * (DEER_W + GAP)
  const px = Array.from({ length: ROWS }, () => Array<string>(width).fill('.'))
  const stamp = (art: string[], x0: number, y0: number): void => {
    art.forEach((line, y) => {
      for (let x = 0; x < line.length; x++) if (line[x] !== '.') px[y0 + y]![x0 + x] = line[x]!
    })
  }
  stamp(SANTA, 5, 0)
  stamp(SACK, 14, 3)
  stamp(SLEIGH, 0, 8)
  let x = SLEIGH_W
  for (let n = 0; n < deerCount; n++) {
    for (let i = 0; i < GAP; i++) px[REIN_ROW]![x + i] = 'Y'
    stamp(deer(step, n === deerCount - 1), x + GAP, 8)
    x += DEER_W + GAP
  }
  return px.map((row) => row.join(''))
}

export class Flyby {
  private rng = mulberry32(2025)
  private clock = 0
  private nextAt: number
  private lastEnd = 0
  private active: { x: number; y: number; width: number; deer: number } | null = null
  private items: Present[] = []
  private itemTimer = 0
  private cache = new Map<string, string[]>()

  constructor(public cfg: FlybyConfig) {
    this.nextAt = this.gap()
  }

  get isFlying(): boolean {
    return this.active !== null
  }

  private gap(): number {
    const { minGap, maxGap } = this.cfg
    return minGap + this.rng() * Math.max(0, maxGap - minGap)
  }

  resize(): void {
    this.active = null
    this.items = []
  }

  trigger(delay = 0): void {
    this.nextAt = this.clock + delay
  }

  // small chance of a flight when a turn finishes
  celebrate(): void {
    if (this.active || this.clock - this.lastEnd < 60) return
    if (this.rng() < 0.3) this.nextAt = Math.min(this.nextAt, this.clock)
  }

  update(dt: number, g: Grid, scene: Scene): void {
    if (!this.cfg.enabled) {
      this.active = null
      this.items = []
      return
    }
    dt = Math.min(dt, 0.25)
    this.clock += dt

    if (!this.active) {
      if (this.clock >= this.nextAt) this.start(g, scene)
    } else {
      const f = this.active
      f.x += dt * 13
      // text showed up under us: move to the next empty stretch or give up
      if (!this.rowsFree(g, f.y)) {
        const y = this.freeRows(g, scene)[0]
        if (y === undefined) {
          this.active = null
          this.nextAt = this.clock + 20
          return
        }
        f.y = y
      }
      if (this.cfg.items) this.dropItems(dt, f)
      if (f.x > g.cols + 2) {
        this.active = null
        this.lastEnd = this.clock
        this.nextAt = this.clock + this.gap()
      }
    }
    this.fall(dt, g, scene)
  }

  // finds the highest empty stretch, or tries again in a bit
  private start(g: Grid, scene: Scene): void {
    const deer = Math.max(1, Math.min(3, Math.floor((g.cols - SLEIGH_W) / (DEER_W + GAP + 3))))
    const width = SLEIGH_W + deer * (DEER_W + GAP)
    if (g.cols < width + 8) {
      this.nextAt = this.clock + 30
      return
    }
    const free = this.freeRows(g, scene)
    if (!free.length) {
      this.nextAt = this.clock + 20
      return
    }
    // fly high: one of the top few free spots
    const y = free[Math.floor(this.rng() * Math.min(free.length, 3))]!
    this.active = { x: -width, y, width, deer }
    this.itemTimer = 1
  }

  private rowsFree(g: Grid, y: number): boolean {
    let busy = 0
    for (let r = y; r < y + HEIGHT; r++) {
      for (let x = 0; x < g.cols; x++) if (!g.isBlank(r * g.cols + x)) busy++
    }
    return busy <= g.cols * HEIGHT * 0.04
  }

  // top rows where the sleigh fits over blank cells, highest first
  private freeRows(g: Grid, scene: Scene): number[] {
    const free: number[] = []
    for (let y = 1; y <= scene.noSnowFromRow - HEIGHT; y++) if (this.rowsFree(g, y)) free.push(y)
    return free
  }

  private dropItems(dt: number, f: { x: number; y: number }): void {
    this.itemTimer -= dt
    if (this.itemTimer > 0 || this.items.length >= 8) return
    this.itemTimer = 0.9 + this.rng() * 1.2
    const color = PRESENTS[Math.floor(this.rng() * PRESENTS.length)]!
    this.items.push({
      x: f.x + 6 + this.rng() * 8,
      y: f.y + HEIGHT,
      vx: -2.5 - this.rng() * 2,
      vy: 3 + this.rng() * 1.5,
      color,
    })
  }

  private fall(dt: number, g: Grid, scene: Scene): void {
    const floor = scene.noSnowFromRow - 1
    this.items = this.items.filter((it) => {
      it.x += it.vx * dt
      it.y += it.vy * dt
      const x = Math.round(it.x)
      const y = Math.floor(it.y)
      if (x < 0 || x >= g.cols || y > floor) return false
      // a present lands on anything solid and disappears
      return y + 1 > floor || g.isBlank((y + 1) * g.cols + x) || !g.inside(x, y + 1)
    })
  }

  private frame(deerCount: number, step: number): string[] {
    const key = `${deerCount}:${step}`
    let art = this.cache.get(key)
    if (!art) this.cache.set(key, (art = train(deerCount, step)))
    return art
  }

  draw(g: Grid, scene: Scene, t: number): void {
    if (!this.cfg.enabled) return
    const f = this.active
    const floor = scene.noSnowFromRow - 1

    const put = (x: number, y: number, ch: string, fg: Color, bg = 0, at = 0): void => {
      if (x < 0 || x >= g.cols || y < 0 || y > floor) return
      const i = y * g.cols + x
      if (g.isBlank(i)) {
        g.ch[i] = ch
        g.fg[i] = fg
        g.bg[i] = bg
        g.at[i] = at
      }
    }

    if (f) {
      const x0 = Math.round(f.x)

      // sparkles go first so the sprites win any shared cell
      for (let d = 1; d <= 16; d++) {
        const x = x0 - d
        for (let r = 0; r < HEIGHT; r++) {
          const h = Math.sin(x * 12.9898 + (f.y + r) * 78.233 + Math.floor(t * 9) * 3.7) * 43758.5453
          const roll = h - Math.floor(h)
          if (roll < 0.2 * (1 - d / 17)) {
            put(
              x,
              f.y + r,
              SPARKS[Math.floor(roll * 100) % SPARKS.length]!,
              mix(SPARK_COLOR, SPARK_FADE, d / 17),
            )
          }
        }
      }

      paintPixels(g, this.frame(f.deer, Math.floor(t * 5.5) % 2), x0, f.y, floor)
    }

    for (const it of this.items) put(Math.round(it.x), Math.floor(it.y), '▣', it.color, 0, A_BOLD)
  }
}

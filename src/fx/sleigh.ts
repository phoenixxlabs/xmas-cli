// Every few minutes a sleigh and its reindeer cross the screen through whatever empty rows
// there are, trailing sparkles and dropping the odd gift, carrot and cookie. Everything is
// drawn into blank cells only, so a flight can never cover text.

import { A_BOLD, Color, Grid, hex, mix } from '../grid.js'
import type { Scene } from '../scene.js'
import { mulberry32 } from './rng.js'

export interface FlybyConfig {
  enabled: boolean
  /** seconds between flights: a random gap between these two */
  minGap: number
  maxGap: number
  /** let gifts, carrots and cookies fall off the sleigh */
  items: boolean
}

const INK: Record<string, Color> = {
  b: hex('#b07a4c'), // reindeer coat
  d: hex('#7a5233'), // antlers, legs
  n: hex('#ff3b4d'), // the red nose
  r: hex('#e0384c'), // sleigh and hat
  R: hex('#b82a3c'), // sleigh shadow
  t: hex('#d9b98a'), // sack
  g: hex('#f2c14e'), // runners, reins
  w: hex('#f4f8ff'), // trim and beard
  k: hex('#f3c9a5'), // face
}

// each sprite row is [art, ink]; ink is padded with its last letter, a space means "no paint"
type Row = [string, string]

const SLEIGH: Row[] = [
  ['    ▗▟▙▖  ▗▄▖', '    rrrr  ttt'], // hat, sack
  ['   ▐▛▀▀▜▌▐██▌', '   wwkkwwtttt'], // face between the beard
  [' ▟▇▇▇▇▇▇▇▇▇▙ ', ' rrrwwwwrrrrr '],
  [' ▜█████████▛ ', 'R'],
  ['▀▀▀▀▀▀▀▀▀▀▀▀▀', 'g'],
]

const REINS = 'g'

/** one reindeer, 11 wide and 3 tall; `step` picks one of two leg positions */
function deer(step: number, lead: boolean): Row[] {
  return [
    ['        ╲╿╱', 'd'],
    [' ▗█████▙▟▌•', `bbbbbbbbbb${lead ? 'n' : 'd'}`],
    [step ? '  ▐▌ ▐▌    ' : ' ▐▌   ▐▌   ', 'd'],
  ]
}

const GAP = 1 // cells of rein between neighbours
const DEER_W = 11
const SLEIGH_W = 13
const HEIGHT = 5

interface Item {
  x: number
  y: number
  vx: number
  vy: number
  ch: string
  color: Color
}

const ITEMS: [string, Color][] = [
  ['▣', hex('#ff6b7a')], // gift
  ['▣', hex('#6cc4ff')],
  ['▣', hex('#46d68c')],
  ['▾', hex('#ff9f43')], // carrot
  ['●', hex('#c8955a')], // cookie
]

const SPARKS = ['·', '.', '*']
const SPARK_COLOR = hex('#bfe3ff')
const SPARK_FADE = hex('#2c4058')

export class Flyby {
  private rng = mulberry32(2025)
  private clock = 0
  private nextAt: number
  private lastEnd = 0
  private active: { x: number; y: number; width: number; deer: number } | null = null
  private items: Item[] = []
  private itemTimer = 0
  private cols = 0

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

  resize(cols: number): void {
    this.cols = cols
    this.active = null
    this.items = []
  }

  /** fly as soon as there is room */
  trigger(): void {
    this.nextAt = this.clock
  }

  /** a small chance of a flight when a turn finishes, as long as one hasn't just gone by */
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
    this.cols = g.cols

    if (!this.active) {
      if (this.clock >= this.nextAt) this.start(g, scene)
    } else {
      const f = this.active
      f.x += dt * 13
      if (this.cfg.items) this.dropItems(dt, f)
      if (f.x > g.cols + 2) {
        this.active = null
        this.lastEnd = this.clock
        this.nextAt = this.clock + this.gap()
      }
    }
    this.fall(dt, g, scene)
  }

  /** looks for a stretch of rows that is empty right now; tries again soon if there is none */
  private start(g: Grid, scene: Scene): void {
    const deer = Math.max(1, Math.min(3, Math.floor((g.cols - SLEIGH_W) / (DEER_W + GAP + 3))))
    const width = SLEIGH_W + deer * (DEER_W + GAP)
    if (g.cols < width + 8) {
      this.nextAt = this.clock + 30
      return
    }
    const lowest = scene.noSnowFromRow - HEIGHT
    const free: number[] = []
    for (let y = 1; y <= lowest; y++) {
      let busy = 0
      for (let r = y; r < y + HEIGHT; r++) {
        for (let x = 0; x < g.cols; x++) if (!g.isBlank(r * g.cols + x)) busy++
      }
      if (busy <= g.cols * HEIGHT * 0.04) free.push(y)
    }
    if (!free.length) {
      this.nextAt = this.clock + 20
      return
    }
    const y = free[Math.floor(this.rng() * free.length)]!
    this.active = { x: -width, y, width, deer }
    this.itemTimer = 1
  }

  private dropItems(dt: number, f: { x: number; y: number }): void {
    this.itemTimer -= dt
    if (this.itemTimer > 0 || this.items.length >= 8) return
    this.itemTimer = 0.9 + this.rng() * 1.2
    const [ch, color] = ITEMS[Math.floor(this.rng() * ITEMS.length)]!
    this.items.push({
      x: f.x + 4 + this.rng() * 6,
      y: f.y + HEIGHT,
      vx: -2.5 - this.rng() * 2,
      vy: 3 + this.rng() * 1.5,
      ch,
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
      // land (and vanish) on anything solid
      return y + 1 > floor || g.isBlank((y + 1) * g.cols + x) || !g.inside(x, y + 1)
    })
  }

  draw(g: Grid, scene: Scene, t: number): void {
    if (!this.cfg.enabled) return
    const f = this.active
    const floor = scene.noSnowFromRow - 1

    const put = (x: number, y: number, ch: string, color: Color, at = 0): void => {
      if (x < 0 || x >= g.cols || y < 0 || y > floor) return
      const i = y * g.cols + x
      if (g.isBlank(i)) {
        g.ch[i] = ch
        g.fg[i] = color
        g.at[i] = at
      }
    }

    if (f) {
      const x0 = Math.round(f.x)
      const step = Math.floor(t * 5.5) % 2
      const sprite = (rows: Row[], dx: number, dy: number): void => {
        rows.forEach(([art, ink], r) => {
          for (let c = 0; c < art.length; c++) {
            if (art[c] === ' ') continue
            const key = ink[Math.min(c, ink.length - 1)]!
            put(x0 + dx + c, f.y + dy + r, art[c]!, key === ' ' ? 0 : INK[key]!)
          }
        })
      }

      // the sparkle trail first, so the sprites win any shared cell
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

      sprite(SLEIGH, 0, 0)
      let dx = SLEIGH_W
      for (let n = 0; n < f.deer; n++) {
        put(x0 + dx - 1, f.y + 3, '─', INK[REINS]!)
        sprite(deer(step, n === f.deer - 1), dx, 2)
        dx += DEER_W + GAP
      }
    }

    for (const it of this.items) put(Math.round(it.x), Math.floor(it.y), it.ch, it.color, A_BOLD)
  }
}

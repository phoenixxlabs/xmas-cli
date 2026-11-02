// Every few minutes a sleigh and its reindeer cross the screen through whatever empty rows
// there are, trailing sparkles and dropping the odd gift, carrot and cookie. Everything is
// drawn into blank cells only, so a flight can never cover text.
//
// The art is drawn as pixels, two to a cell: a half block shows the top pixel as its
// foreground and the bottom pixel as its background.

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

const PIXEL: Record<string, Color> = {
  R: hex('#e8404f'), // coat, hat, sleigh
  r: hex('#a52a3a'), // sleigh shadow
  W: hex('#f6f9ff'), // fur, beard
  S: hex('#f3c9a5'), // face
  K: hex('#23232e'), // eyes
  Y: hex('#f2c14e'), // runners, reins, belt
  T: hex('#d9b98a'), // sack
  B: hex('#b07a4c'), // reindeer coat
  b: hex('#6e4a2e'), // antlers, legs
  N: hex('#ff3b4d'), // the red nose
}

// Santa is 8 pixels wide and sits on top of the sleigh, which starts at pixel row 8.
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

/** one reindeer facing right, 14 wide and 6 tall; `step` picks one of two leg positions */
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

/** the whole team as a grid of pixel letters ('.' is empty) */
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
  private items: Item[] = []
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

  resize(_cols: number): void {
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
      x: f.x + 6 + this.rng() * 8,
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

      const art = this.frame(f.deer, Math.floor(t * 5.5) % 2)
      for (let cy = 0; cy < HEIGHT; cy++) {
        const top = art[cy * 2]!
        const bottom = art[cy * 2 + 1]!
        for (let x = 0; x < top.length; x++) {
          const a = top[x] === '.' ? 0 : PIXEL[top[x]!]!
          const b = bottom[x] === '.' ? 0 : PIXEL[bottom[x]!]!
          if (!a && !b) continue
          if (a && b) put(x0 + x, f.y + cy, a === b ? '█' : '▀', a, a === b ? 0 : b)
          else if (a) put(x0 + x, f.y + cy, '▀', a)
          else put(x0 + x, f.y + cy, '▄', b)
        }
      }
    }

    for (const it of this.items) put(Math.round(it.x), Math.floor(it.y), it.ch, it.color, 0, A_BOLD)
  }
}

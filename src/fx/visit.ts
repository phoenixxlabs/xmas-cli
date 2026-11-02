// Now and then a small Santa walks in along the bottom of the screen to one treat left out for
// him (cookies, a glass of milk, a carrot for the reindeer or hot cocoa), finishes it, says
// thanks, leaves a present and walks off again. One treat per visit keeps the screen clear. Like
// the sleigh it only paints blank cells.

import { A_BOLD, Grid, hex } from '../grid.js'
import type { Scene } from '../scene.js'
import { paintPixels } from './pixels.js'
import { mulberry32 } from './rng.js'

export interface VisitConfig {
  enabled: boolean
  /** seconds between visits: a random gap between these two */
  minGap: number
  maxGap: number
}

const HEIGHT = 3 // terminal rows, six pixels
const WALK_SPEED = 12 // columns per second
const EAT_TIME = 1.2
const SAY_COLOR = hex('#f6f9ff')

// Santa faces right; `flip` mirrors him to walk the other way
function santa(frame: 'walk' | 'step' | 'eat' | 'chew', flip: boolean): string[] {
  const legs = frame === 'step' ? '..KK..' : '.K..K.'
  const arms = frame === 'eat' || frame === 'chew' ? 'RRRRRR' : '.RRRR.'
  const face = frame === 'chew' ? '.WSKW.' : '.WSSW.'
  const art = ['..RRW.', '.RRRR.', face, '.WWWW.', arms, legs]
  return flip ? art.map((row) => [...row].reverse().join('')) : art
}

export interface Treat {
  name: string
  /** columns wide */
  width: number
  /** how many bites, sips or nibbles it takes */
  steps: number
  say: string
  /** the treat with `left` of its steps still to go, four pixel rows tall */
  art(left: number): string[]
}

export const TREATS: Treat[] = [
  {
    name: 'cookies',
    width: 9,
    steps: 3,
    say: 'Mmm, cookies!',
    art: (left) => {
      const cookie = (n: number): [string, string] => (n < left ? ['TK', 'TT'] : ['..', '..'])
      const [a0, a1] = cookie(0)
      const [b0, b1] = cookie(1)
      const [c0, c1] = cookie(2)
      return [`${a0}.${b0}.${c0}.`, `${a1}.${b1}.${c1}.`, 'WWWWWWWWW', '.WWWWWWW.']
    },
  },
  {
    name: 'milk',
    width: 5,
    steps: 3,
    say: 'Ahh, milk!',
    art: (left) => {
      const row = (level: number): string => (left >= level ? 'gWWWg' : 'g...g')
      return ['g...g', row(3), row(2), left >= 1 ? '.WWW.' : '.ggg.']
    },
  },
  {
    name: 'carrot',
    width: 7,
    steps: 2,
    say: 'For Rudolph!',
    art: (left) => {
      const len = left * 3
      return [
        '.......',
        '.......',
        left ? `G${'O'.repeat(len)}`.padEnd(7, '.') : '.......',
        left ? `.${'O'.repeat(Math.max(0, len - 2))}`.padEnd(7, '.') : '.......',
      ]
    },
  },
  {
    name: 'cocoa',
    width: 6,
    steps: 3,
    say: 'Ahh, cocoa!',
    art: (left) => [
      left ? '.W..W.' : '......',
      left >= 2 ? 'WbbbWW' : 'W...WW',
      left >= 1 ? 'WbbbW.' : 'W...W.',
      '.WWW..',
    ],
  },
]

// a wrapped present with a gold ribbon and bow, in one of a few colours
const GIFT_COLORS = ['R', 'U', 'E', 'P']
const GIFT_W = 5
const gift = (c: string): string[] => ['.Y.Y.', `${c}${c}Y${c}${c}`, `${c}${c}Y${c}${c}`, `${c}${c}Y${c}${c}`]
const SANTA_W = 6
const LIFT = 3 // rows left between Santa's boots and the bottom of the screen area
const MARGIN = 3 // cells kept clear to the right of the table

interface Visit {
  age: number
  treat: Treat
  giftColor: string
  /** top row of the scene; Santa's feet are at the bottom of it */
  y: number
  tableX: number
  standX: number
  arrive: number
}

export class VisitingSanta {
  private rng = mulberry32(1225)
  private clock = 0
  private nextAt: number
  private active: Visit | null = null
  private last = -1

  constructor(public cfg: VisitConfig) {
    this.nextAt = this.gap()
  }

  get isVisiting(): boolean {
    return this.active !== null
  }

  private gap(): number {
    const { minGap, maxGap } = this.cfg
    return minGap + this.rng() * Math.max(0, maxGap - minGap)
  }

  resize(): void {
    this.active = null
  }

  /** visit as soon as there is room */
  trigger(delay = 0): void {
    this.nextAt = this.clock + delay
  }

  update(dt: number, g: Grid, scene: Scene): void {
    if (!this.cfg.enabled) {
      this.active = null
      return
    }
    this.clock += Math.min(dt, 0.25)
    const v = this.active
    if (!v) {
      if (this.clock >= this.nextAt) this.start(g, scene)
      return
    }
    v.age += Math.min(dt, 0.25)
    if (v.age > this.duration(v) || !this.clear(g, v.y, v.tableX, v.treat)) {
      this.active = null
      this.nextAt = this.clock + this.gap()
    }
  }

  // arrival, three cookies, the carrot, the speech, then the walk back out of the left edge
  private duration(v: Visit): number {
    return v.arrive + v.treat.steps * EAT_TIME + 0.8 + 2.4 + (v.standX + SANTA_W) / WALK_SPEED + 2
  }

  /**
   * The lowest rows above the prompt area where Santa's whole walk and the table are clear,
   * with a few cells to spare. Right-aligned notes such as a usage warning are not in the way
   * as long as the table stops short of them.
   */
  private find(g: Grid, scene: Scene, treat: Treat): { y: number; tableX: number } | null {
    const floor = Math.min(scene.noSnowFromRow, g.rows) - 1
    const xs: number[] = []
    for (let x = SANTA_W + 8; x + treat.width + GIFT_W + 1 + MARGIN <= g.cols; x += 3) xs.push(x)
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[xs[i], xs[j]] = [xs[j]!, xs[i]!]
    }
    // stand a few rows up, clear of the notes and prompt box that hug the bottom
    for (let y = floor - HEIGHT + 1 - LIFT; y >= Math.max(1, floor - 12); y--) {
      for (const tableX of xs) if (this.clear(g, y, tableX, treat)) return { y, tableX }
    }
    return null
  }

  /** nothing painted in Santa's rows from the left edge to just past the table */
  private clear(g: Grid, y: number, tableX: number, treat: Treat): boolean {
    const end = Math.min(g.cols, tableX + treat.width + GIFT_W + 1 + MARGIN)
    for (let r = y; r < y + HEIGHT; r++) {
      for (let x = 0; x < end; x++) if (!g.isBlank(r * g.cols + x)) return false
    }
    return true
  }

  private start(g: Grid, scene: Scene): void {
    if (g.cols < 60) {
      this.nextAt = this.clock + 60
      return
    }
    // a different treat each time
    let pick = Math.floor(this.rng() * TREATS.length)
    if (pick === this.last) pick = (pick + 1) % TREATS.length
    const treat = TREATS[pick]!
    const spot = this.find(g, scene, treat)
    if (!spot) {
      this.nextAt = this.clock + 25
      return
    }
    const standX = spot.tableX - SANTA_W - 1
    const arrive = (standX + SANTA_W) / WALK_SPEED + 0.8
    this.last = pick
    this.active = {
      age: 0,
      treat,
      giftColor: GIFT_COLORS[Math.floor(this.rng() * GIFT_COLORS.length)]!,
      y: spot.y,
      tableX: spot.tableX,
      standX,
      arrive,
    }
  }

  draw(g: Grid, scene: Scene): void {
    const v = this.active
    if (!this.cfg.enabled || !v) return
    const floor = Math.min(scene.noSnowFromRow, g.rows) - 1

    const { treat } = v
    const eatStart = v.arrive
    const doneEating = eatStart + treat.steps * EAT_TIME
    const eaten = Math.min(treat.steps, Math.max(0, Math.floor((v.age - eatStart) / EAT_TIME)))
    const speakFrom = doneEating + 0.4
    const leaveAt = speakFrom + 2.4
    const speaking = v.age >= speakFrom && v.age < leaveAt
    const leaving = v.age >= leaveAt

    // the treat and, once it is gone, the thank-you present
    if (v.age > 0.4) {
      paintPixels(g, treat.art(treat.steps - eaten), v.tableX, v.y, floor)
      if (v.age >= speakFrom) paintPixels(g, gift(v.giftColor), v.tableX + treat.width + 1, v.y, floor)
    }

    // Santa: in from the left, eating, then back out the way he came
    let x: number
    let frame: 'walk' | 'step' | 'eat' | 'chew'
    const stride = Math.floor(v.age * 6) % 2 ? 'step' : 'walk'
    if (v.age < eatStart) {
      x = Math.round(-SANTA_W + Math.max(0, v.age - 0.4) * WALK_SPEED)
      x = Math.min(x, v.standX)
      frame = x >= v.standX ? 'walk' : stride
    } else if (!leaving) {
      x = v.standX
      const eating = v.age < doneEating
      frame = eating ? (Math.floor(v.age * 5) % 2 ? 'chew' : 'eat') : 'walk'
    } else {
      x = Math.round(v.standX - (v.age - leaveAt) * WALK_SPEED)
      frame = stride
    }
    paintPixels(g, santa(frame, leaving), x, v.y, floor)

    if (speaking) {
      const say = treat.say
      const at = Math.max(0, Math.min(g.cols - say.length, x - 1))
      const y = v.y - 1
      if (y >= 0) {
        for (let i = 0; i < say.length; i++) {
          const k = y * g.cols + at + i
          if (g.isBlank(k)) {
            g.ch[k] = say[i]!
            g.fg[k] = SAY_COLOR
            g.at[k] = A_BOLD
          }
        }
      }
    }
  }
}

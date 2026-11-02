// Now and then a small Santa walks in along the bottom of the screen, finds a plate of cookies
// and a carrot left out for the reindeer, eats the cookies, takes the carrot, says a ho ho ho,
// leaves a present and walks off again. Like the sleigh it only paints blank cells.

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
const COOKIES = 3
const EAT_TIME = 1.2
const SAY = 'Ho ho ho!'
const SAY_COLOR = hex('#f6f9ff')

// Santa faces right; `flip` mirrors him to walk the other way
function santa(frame: 'walk' | 'step' | 'eat' | 'chew', flip: boolean): string[] {
  const legs = frame === 'step' ? '..KK..' : '.K..K.'
  const arms = frame === 'eat' || frame === 'chew' ? 'RRRRRR' : '.RRRR.'
  const face = frame === 'chew' ? '.WSKW.' : '.WSSW.'
  const art = ['..RRW.', '.RRRR.', face, '.WWWW.', arms, legs]
  return flip ? art.map((row) => [...row].reverse().join('')) : art
}

/** the plate, a glass of milk and the reindeer's carrot, 18 wide and 4 tall */
function table(cookiesLeft: number, carrot: boolean): string[] {
  const cookie = (n: number): [string, string] => (n < cookiesLeft ? ['TK', 'TT'] : ['..', '..'])
  const [a0, a1] = cookie(0)
  const [b0, b1] = cookie(1)
  const [c0, c1] = cookie(2)
  return [
    `${a0}.${b0}.${c0}..WW......`.padEnd(18, '.'),
    `${a1}.${b1}.${c1}..WW......`.padEnd(18, '.'),
    `WWWWWWWWW.WW.${carrot ? 'GOOO' : '....'}.`.padEnd(18, '.'),
    `.WWWWWWW..WW..${carrot ? 'OO' : '..'}..`.padEnd(18, '.'),
  ]
}

const GIFT = ['.YY.', 'RYYR', 'RYYR', 'RRRR']
const TABLE_W = 18
const SANTA_W = 6

interface Visit {
  age: number
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
    if (v.age > this.duration(v) || !this.roomAt(g, v.y, 0.12)) {
      this.active = null
      this.nextAt = this.clock + this.gap()
    }
  }

  // arrival, three cookies, the carrot, the speech, then the walk back out of the left edge
  private duration(v: Visit): number {
    return v.arrive + COOKIES * EAT_TIME + 0.8 + 2.4 + (v.standX + SANTA_W) / WALK_SPEED + 2
  }

  /** the lowest three rows above the prompt area that are empty right now */
  private find(g: Grid, scene: Scene): number | null {
    const floor = Math.min(scene.noSnowFromRow, g.rows) - 1
    for (let y = floor - HEIGHT + 1; y >= Math.max(1, floor - 10); y--) if (this.roomAt(g, y, 0.06)) return y
    return null
  }

  private roomAt(g: Grid, y: number, allowed: number): boolean {
    let busy = 0
    for (let r = y; r < y + HEIGHT; r++) {
      for (let x = 0; x < g.cols; x++) if (!g.isBlank(r * g.cols + x)) busy++
    }
    return busy <= g.cols * HEIGHT * allowed
  }

  private start(g: Grid, scene: Scene): void {
    if (g.cols < 60) {
      this.nextAt = this.clock + 60
      return
    }
    const y = this.find(g, scene)
    if (y === null) {
      this.nextAt = this.clock + 25
      return
    }
    const tableX = Math.floor(g.cols * (0.45 + this.rng() * 0.3))
    const standX = Math.min(tableX - SANTA_W - 1, g.cols - TABLE_W - SANTA_W - 2)
    const arrive = (standX + SANTA_W) / WALK_SPEED + 0.8
    this.active = { age: 0, y, tableX: Math.max(SANTA_W + 2, standX + SANTA_W + 1), standX, arrive }
  }

  draw(g: Grid, scene: Scene): void {
    const v = this.active
    if (!this.cfg.enabled || !v) return
    const floor = Math.min(scene.noSnowFromRow, g.rows) - 1

    const eatStart = v.arrive
    const eaten = Math.min(COOKIES, Math.max(0, Math.floor((v.age - eatStart) / EAT_TIME)))
    const doneEating = eatStart + COOKIES * EAT_TIME
    const carrot = v.age < doneEating + 0.8
    const speakFrom = doneEating + 0.8
    const leaveAt = speakFrom + 2.4
    const speaking = v.age >= speakFrom && v.age < leaveAt
    const leaving = v.age >= leaveAt

    // the table and, once he has eaten, the thank-you present
    if (v.age > 0.4) {
      paintPixels(g, table(COOKIES - eaten, carrot), v.tableX, v.y, floor)
      if (v.age >= speakFrom) paintPixels(g, GIFT, v.tableX + 12, v.y, floor)
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
      const at = Math.max(0, Math.min(g.cols - SAY.length, x - 1))
      const y = v.y - 1
      if (y >= 0) {
        for (let i = 0; i < SAY.length; i++) {
          const k = y * g.cols + at + i
          if (g.isBlank(k)) {
            g.ch[k] = SAY[i]!
            g.fg[k] = SAY_COLOR
            g.at[k] = A_BOLD
          }
        }
      }
    }
  }
}

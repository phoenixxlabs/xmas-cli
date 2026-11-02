// A string of lights along Claude's own horizontal rules. Bulbs twinkle while idle and
// chase along the wire while a turn is running.

import { A_BOLD, Color, Grid, hex, mix } from '../grid.js'
import type { Scene } from '../scene.js'

export interface LightsConfig {
  enabled: boolean
  /** cells between bulbs */
  spacing: number
}

const WIRE = hex('#3b5875')
const BULBS = [hex('#ff4d5e'), hex('#46d68c'), hex('#ffd166'), hex('#6cc4ff')]

export function drawLights(g: Grid, scene: Scene, t: number, working: boolean, cfg: LightsConfig): void {
  if (!cfg.enabled) return
  const sp = Math.max(3, Math.floor(cfg.spacing))
  for (const r of scene.rules) {
    for (let x = r.x0; x < r.x1; x++) {
      const i = r.y * g.cols + x
      const rel = x - r.x0
      const phase = rel % sp
      const isBulb = phase === Math.floor(sp / 2) || phase === Math.floor(sp / 2) + 1
      if (!isBulb) {
        g.fg[i] = WIRE
        continue
      }
      const n = Math.floor(rel / sp)
      const level = working
        ? Math.pow(Math.max(0, Math.sin(x * 0.42 - t * 7)), 2)
        : 0.5 + 0.5 * Math.sin(t * 1.5 + n * 2.3 + r.y * 0.7)
      const color: Color = mix(WIRE, BULBS[n % BULBS.length]!, 0.45 + 0.55 * level)
      g.ch[i] = '━'
      g.fg[i] = color
      g.at[i] = A_BOLD
    }
  }
}

// red coat and a santa hat for the mascot

import { Grid, hex } from '../grid.js'
import type { LogoHit } from '../scene.js'

export interface LogoConfig {
  enabled: boolean
}

const RED = hex('#d7263d')
const WHITE = hex('#f5f9ff')
const SHAPE = new Set('▐▛▜▝▘▖▗▌▀▄█▙▟▞▚')

export function drawLogo(g: Grid, logo: LogoHit | null, cfg: LogoConfig): void {
  if (!cfg.enabled || !logo) return
  for (let y = logo.y; y < logo.y + logo.h; y++) {
    for (let x = logo.x; x < logo.x + logo.w; x++) {
      const i = y * g.cols + x
      if (SHAPE.has(g.ch[i]!)) g.fg[i] = y === logo.y ? WHITE : RED // fur trim on the top row
    }
  }
  const hy = logo.y - 1
  if (hy < 0) return
  const hx = logo.topX + 1
  // the hat needs five blank cells above the head
  for (let k = 0; k < 6; k++) if (!g.isBlank(hy * g.cols + hx + k)) return
  g.set(hx, hy, '▗', RED)
  g.set(hx + 1, hy, '▄', RED)
  g.set(hx + 2, hy, '▄', RED)
  g.set(hx + 3, hy, '▄', RED)
  g.set(hx + 4, hy, '▖', RED)
  g.set(hx + 5, hy, '•', WHITE)
}

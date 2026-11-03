// the greeting band along the top row (part of the max look)

import { A_BOLD, Grid, hex, mix } from '../grid.js'

export interface BandConfig {
  enabled: boolean
  text: string
}

const WIRE = hex('#3b5875')
const BULBS = [hex('#ff4d5e'), hex('#46d68c'), hex('#ffd166'), hex('#6cc4ff')]
const LABEL = hex('#eaf6ff')

export function daysToChristmas(nowMs: number): number {
  const d = new Date(nowMs)
  let target = Date.UTC(d.getFullYear(), 11, 25)
  if (target < nowMs - 86_400_000) target = Date.UTC(d.getFullYear() + 1, 11, 25)
  return Math.ceil((target - nowMs) / 86_400_000)
}

export function bandLabel(template: string, nowMs: number): string {
  const days = daysToChristmas(nowMs)
  const when =
    days <= 0 ? 'Merry Christmas' : days === 1 ? 'Christmas is tomorrow' : `${days} days to Christmas`
  return template.replace('{countdown}', when)
}

export function drawBand(g: Grid, y: number, t: number, nowMs: number, cfg: BandConfig): void {
  if (!cfg.enabled || y < 0 || y >= g.rows) return
  const label = ` ${bandLabel(cfg.text, nowMs)} `
  const start = Math.max(1, Math.floor((g.cols - label.length) / 2))
  for (let x = 0; x < g.cols; x++) {
    const inLabel = x >= start && x < start + label.length
    if (inLabel) {
      g.set(x, y, label[x - start]!, LABEL, 0, 0)
      continue
    }
    const isBulb = x % 6 === 3
    if (isBulb) {
      const n = Math.floor(x / 6)
      const level = Math.round((0.5 + 0.5 * Math.sin((Math.floor(t * 4) / 4) * 1.5 + n * 2.3)) * 4) / 4
      g.set(x, y, '━', mix(WIRE, BULBS[n % BULBS.length]!, 0.3 + 0.7 * level), 0, A_BOLD)
    } else {
      g.set(x, y, '─', WIRE)
    }
  }
}

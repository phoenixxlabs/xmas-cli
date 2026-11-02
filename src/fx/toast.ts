import { Grid, hex } from '../grid.js'

const BG = hex('#16364f')
const FG = hex('#eaf6ff')

export class Toast {
  private text = ''
  private until = 0

  show(text: string, now: number, ms = 1600): void {
    this.text = text
    this.until = now + ms
  }

  active(now: number): boolean {
    return now < this.until
  }

  draw(g: Grid, now: number): void {
    if (now >= this.until || !this.text) return
    const s = ` ${this.text} `
    const x0 = Math.max(0, g.cols - s.length - 1)
    g.text(x0, 0, s, FG, BG)
  }
}

// Codex shows a large braille-art logo while it starts up and then wipes it. This keeps a
// copy and paints it back, dim, behind everything else for the rest of the session. It is
// drawn last and only into blank cells, so Codex's own text, the snow and the sleigh all
// pass in front of it.

import { Color, Grid, hex } from '../grid.js'

const DIM: Color = hex('#22364c')
const MIN_ROWS = 6
const MIN_DOTS = 10

const isBraille = (c: string): boolean => c >= '⠁' && c <= '⣿'

export class Watermark {
  private art: { x: number; y: number; lines: string[]; dots: number } | null = null

  get captured(): boolean {
    return this.art !== null
  }

  /** looks for the logo on the screen as the agent drew it, keeping the fullest copy seen */
  capture(g: Grid): void {
    let start = -1
    for (let y = 0; y <= g.rows; y++) {
      const text = y < g.rows ? g.rowText(y) : ''
      let dots = 0
      for (const c of text) if (isBraille(c)) dots++
      if (dots >= MIN_DOTS) {
        if (start < 0) start = y
        continue
      }
      if (start >= 0 && y - start >= MIN_ROWS) this.keep(g, start, y)
      start = -1
    }
  }

  private keep(g: Grid, y0: number, y1: number): void {
    let x0 = g.cols
    let x1 = 0
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < g.cols; x++) {
        if (isBraille(g.ch[y * g.cols + x]!)) {
          x0 = Math.min(x0, x)
          x1 = Math.max(x1, x + 1)
        }
      }
    }
    const lines: string[] = []
    for (let y = y0; y < y1; y++) {
      let line = ''
      for (let x = x0; x < x1; x++) {
        const c = g.ch[y * g.cols + x]!
        line += isBraille(c) ? c : ' '
      }
      lines.push(line)
    }
    const dots = lines.join('').replace(/[^⠁-⣿]/g, '').length
    if (!this.art || dots > this.art.dots) this.art = { x: x0, y: y0, lines, dots }
  }

  reset(): void {
    this.art = null
  }

  draw(g: Grid): void {
    const a = this.art
    if (!a) return
    a.lines.forEach((line, r) => {
      const y = a.y + r
      if (y >= g.rows) return
      for (let c = 0; c < line.length; c++) {
        const x = a.x + c
        if (x >= g.cols || line[c] === ' ') continue
        const i = y * g.cols + x
        if (g.isBlank(i)) {
          g.ch[i] = line[c]!
          g.fg[i] = DIM
          g.at[i] = 0
        }
      }
    })
  }
}

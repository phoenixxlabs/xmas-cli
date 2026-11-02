import { Emulator } from '../src/emulator.js'
import { Grid, W_LEAD, W_TAIL } from '../src/grid.js'

export function makeEmu(
  cols: number,
  rows: number,
  hooks: Partial<ConstructorParameters<typeof Emulator>[2]> = {},
) {
  return new Emulator(cols, rows, { respond: () => {}, forward: () => {}, ...hooks })
}

export async function feed(emu: Emulator, data: string): Promise<void> {
  emu.write(data)
  await new Promise<void>((r) => emu.term.write('', r))
}

/** build a grid from text lines (one char per cell, ' ' blank) */
export function gridFrom(lines: string[], cols?: number): Grid {
  const c = cols ?? Math.max(...lines.map((l) => [...l].length))
  const g = new Grid(c, lines.length)
  lines.forEach((l, y) => {
    let x = 0
    for (const ch of l) g.set(x++, y, ch)
  })
  return g
}

export function gridsEqual(a: Grid, b: Grid): string | null {
  if (a.cols !== b.cols || a.rows !== b.rows) return 'size'
  for (let i = 0; i < a.ch.length; i++) {
    if (!a.cellEquals(b, i)) {
      const x = i % a.cols
      const y = Math.floor(i / a.cols)
      return `cell (${x},${y}): ${JSON.stringify([a.ch[i], a.fg[i], a.bg[i], a.at[i], a.w[i]])} vs ${JSON.stringify([b.ch[i], b.fg[i], b.bg[i], b.at[i], b.w[i]])}`
    }
  }
  return null
}

export { W_LEAD, W_TAIL }

// Pixel art for the little scenes (sleigh, visitor). Two pixels share one terminal cell: a half
// block shows the top pixel as its foreground and the bottom pixel as its background.

import { Color, Grid, hex } from '../grid.js'

export const PIXEL: Record<string, Color> = {
  R: hex('#e8404f'), // coat, hat, sleigh
  r: hex('#a52a3a'), // sleigh shadow
  W: hex('#f6f9ff'), // fur, beard, plate, milk
  S: hex('#f3c9a5'), // face
  K: hex('#23232e'), // eyes, boots, chocolate chips
  Y: hex('#f2c14e'), // runners, reins, belt
  T: hex('#d9b98a'), // sack, cookies
  B: hex('#b07a4c'), // reindeer coat
  b: hex('#6e4a2e'), // antlers, legs, cocoa
  N: hex('#ff3b4d'), // the red nose
  O: hex('#ff9f43'), // carrot
  G: hex('#5fcf80'), // carrot top
  g: hex('#8fb8d8'), // glass
  U: hex('#4fa8e8'), // blue present
  E: hex('#3fbf78'), // green present
  P: hex('#b46be0'), // purple present
}

/**
 * Paints pixel rows ('.' is empty) with the top-left pixel at column `x`, terminal row `y`.
 * Only blank cells are touched, and nothing is drawn below `floor`.
 */
export function paintPixels(g: Grid, art: string[], x: number, y: number, floor: number): void {
  const put = (cx: number, cy: number, ch: string, fg: Color, bg: Color): void => {
    if (cx < 0 || cx >= g.cols || cy < 0 || cy > floor) return
    const i = cy * g.cols + cx
    if (!g.isBlank(i)) return
    g.ch[i] = ch
    g.fg[i] = fg
    g.bg[i] = bg
    g.at[i] = 0
  }
  for (let r = 0; r * 2 < art.length; r++) {
    const top = art[r * 2]!
    const bottom = art[r * 2 + 1] ?? ''
    for (let c = 0; c < top.length; c++) {
      const a = top[c] === '.' ? 0 : PIXEL[top[c]!]!
      const b = !bottom[c] || bottom[c] === '.' ? 0 : PIXEL[bottom[c]!]!
      if (a && b) put(x + c, y + r, a === b ? '█' : '▀', a, a === b ? 0 : b)
      else if (a) put(x + c, y + r, '▀', a, 0)
      else if (b) put(x + c, y + r, '▄', b, 0)
    }
  }
}

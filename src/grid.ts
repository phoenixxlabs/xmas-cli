// Cell grid shared by the emulator snapshot, the effects and the renderer.
//
// A colour is one uint32: top byte = mode (0 default, 1 palette, 2 rgb), low 24 bits = value.

export type Color = number

export const C_DEFAULT: Color = 0
export const pal = (i: number): Color => ((1 << 24) | (i & 0xff)) >>> 0
export const rgb = (r: number, g: number, b: number): Color =>
  ((2 << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0
export const colorMode = (c: Color): number => c >>> 24
export const colorValue = (c: Color): number => c & 0xffffff

export function hex(s: string): Color {
  const m = /^#?([0-9a-f]{6})$/i.exec(s)
  if (!m) throw new Error(`bad colour ${s}`)
  const n = parseInt(m[1]!, 16)
  return rgb((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

// Standard xterm palette for the 16 ANSI colours (used only when mixing; the terminal
// still receives the original palette index).
const ANSI16: [number, number, number][] = [
  [0, 0, 0],
  [205, 49, 49],
  [13, 188, 121],
  [229, 229, 16],
  [36, 114, 200],
  [188, 63, 188],
  [17, 168, 205],
  [229, 229, 229],
  [102, 102, 102],
  [241, 76, 76],
  [35, 209, 139],
  [245, 245, 67],
  [59, 142, 234],
  [214, 112, 214],
  [41, 184, 219],
  [255, 255, 255],
]

export function toRgb(c: Color): [number, number, number] | null {
  const m = colorMode(c)
  const v = colorValue(c)
  if (m === 2) return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  if (m === 1) {
    if (v < 16) return ANSI16[v]!
    if (v >= 232) {
      const g = 8 + (v - 232) * 10
      return [g, g, g]
    }
    const i = v - 16
    const lv = (n: number) => (n === 0 ? 0 : 55 + n * 40)
    return [lv(Math.floor(i / 36)), lv(Math.floor(i / 6) % 6), lv(i % 6)]
  }
  return null
}

export function mix(a: Color, b: Color, t: number): Color {
  const ra = toRgb(a) ?? [0, 0, 0]
  const rb = toRgb(b) ?? [0, 0, 0]
  const k = Math.max(0, Math.min(1, t))
  return rgb(
    Math.round(ra[0] + (rb[0] - ra[0]) * k),
    Math.round(ra[1] + (rb[1] - ra[1]) * k),
    Math.round(ra[2] + (rb[2] - ra[2]) * k),
  )
}

export const A_BOLD = 1
export const A_DIM = 2
export const A_ITALIC = 4
export const A_UNDERLINE = 8
export const A_BLINK = 16
export const A_INVERSE = 32
export const A_INVISIBLE = 64
export const A_STRIKE = 128
export const A_OVERLINE = 256

/** cell width marker */
export const W_NARROW = 0
export const W_LEAD = 1 // first half of a double-width character
export const W_TAIL = 2 // second half; carries no glyph

const PAINTING_ATTRS = A_INVERSE | A_UNDERLINE | A_STRIKE | A_OVERLINE

export class Grid {
  readonly cols: number
  readonly rows: number
  readonly ch: string[]
  readonly fg: Uint32Array
  readonly bg: Uint32Array
  readonly at: Uint16Array
  readonly w: Uint8Array

  constructor(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
    const n = cols * rows
    this.ch = new Array<string>(n).fill(' ')
    this.fg = new Uint32Array(n)
    this.bg = new Uint32Array(n)
    this.at = new Uint16Array(n)
    this.w = new Uint8Array(n)
  }

  idx(x: number, y: number): number {
    return y * this.cols + x
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows
  }

  clear(): void {
    this.ch.fill(' ')
    this.fg.fill(0)
    this.bg.fill(0)
    this.at.fill(0)
    this.w.fill(0)
  }

  copyFrom(o: Grid): void {
    if (o.cols !== this.cols || o.rows !== this.rows) throw new Error('grid size mismatch')
    for (let i = 0; i < this.ch.length; i++) this.ch[i] = o.ch[i]!
    this.fg.set(o.fg)
    this.bg.set(o.bg)
    this.at.set(o.at)
    this.w.set(o.w)
  }

  /** copy `src` into this grid with its top-left at (0, y0), clipped */
  blit(src: Grid, y0: number): void {
    const cols = Math.min(src.cols, this.cols)
    for (let y = 0; y < src.rows; y++) {
      const ty = y + y0
      if (ty < 0 || ty >= this.rows) continue
      for (let x = 0; x < cols; x++) {
        const s = y * src.cols + x
        const d = ty * this.cols + x
        this.ch[d] = src.ch[s]!
        this.fg[d] = src.fg[s]!
        this.bg[d] = src.bg[s]!
        this.at[d] = src.at[s]!
        this.w[d] = src.w[s]!
      }
    }
  }

  set(x: number, y: number, ch: string, fg: Color = 0, bg: Color = 0, at = 0): void {
    if (!this.inside(x, y)) return
    const i = y * this.cols + x
    this.ch[i] = ch
    this.fg[i] = fg
    this.bg[i] = bg
    this.at[i] = at
    this.w[i] = 0
  }

  /** write a string of narrow characters, returns the x after the last one */
  text(x: number, y: number, s: string, fg: Color = 0, bg: Color = 0, at = 0): number {
    for (const c of s) {
      this.set(x, y, c, fg, bg, at)
      x++
    }
    return x
  }

  /** true when nothing is painted in the cell: a plain space on the default background */
  isBlank(i: number): boolean {
    const c = this.ch[i]
    return (
      (c === ' ' || c === '\0') && this.bg[i] === 0 && (this.at[i]! & PAINTING_ATTRS) === 0 && this.w[i] === 0
    )
  }

  rowText(y: number, x0 = 0, x1 = this.cols): string {
    let s = ''
    for (let x = x0; x < x1; x++) {
      const i = y * this.cols + x
      if (this.w[i] === W_TAIL) continue
      s += this.ch[i] || ' '
    }
    return s
  }

  toText(): string {
    const lines: string[] = []
    for (let y = 0; y < this.rows; y++) lines.push(this.rowText(y).replace(/\s+$/, ''))
    return lines.join('\n')
  }

  cellEquals(o: Grid, i: number): boolean {
    return (
      this.ch[i] === o.ch[i] &&
      this.fg[i] === o.fg[i] &&
      this.bg[i] === o.bg[i] &&
      this.at[i] === o.at[i] &&
      this.w[i] === o.w[i]
    )
  }
}

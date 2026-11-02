// grid to ansi. remembers what the terminal shows and writes only the difference, inside
// synchronized-output markers so a frame lands in one go

import {
  A_BLINK,
  A_BOLD,
  A_DIM,
  A_INVERSE,
  A_INVISIBLE,
  A_ITALIC,
  A_OVERLINE,
  A_STRIKE,
  A_UNDERLINE,
  Grid,
  W_TAIL,
  colorMode,
  colorValue,
} from './grid.js'
import { linkUri } from './links.js'

export interface CursorState {
  x: number
  y: number
  visible: boolean
  shape: number
}

const ESC = '\x1b['
const OSC = '\x1b]'
const ST = '\x1b\\'
// unchanged cells we'd rather rewrite than pay for a cursor jump
const GAP = 4

function colorSgr(c: number, fg: boolean): string {
  const m = colorMode(c)
  const v = colorValue(c)
  if (m === 1) {
    if (v < 8) return String((fg ? 30 : 40) + v)
    if (v < 16) return String((fg ? 90 : 100) + v - 8)
    return `${fg ? 38 : 48};5;${v}`
  }
  if (m === 2) return `${fg ? 38 : 48};2;${(v >> 16) & 255};${(v >> 8) & 255};${v & 255}`
  return ''
}

const styleCache = new Map<string, string>()

export function sgr(fg: number, bg: number, at: number): string {
  const key = `${fg}.${bg}.${at}`
  let s = styleCache.get(key)
  if (s !== undefined) return s
  const parts: string[] = ['0']
  if (at & A_BOLD) parts.push('1')
  if (at & A_DIM) parts.push('2')
  if (at & A_ITALIC) parts.push('3')
  if (at & A_UNDERLINE) parts.push('4')
  if (at & A_BLINK) parts.push('5')
  if (at & A_INVERSE) parts.push('7')
  if (at & A_INVISIBLE) parts.push('8')
  if (at & A_STRIKE) parts.push('9')
  if (at & A_OVERLINE) parts.push('53')
  const f = colorSgr(fg, true)
  if (f) parts.push(f)
  const b = colorSgr(bg, false)
  if (b) parts.push(b)
  s = `${ESC}${parts.join(';')}m`
  if (styleCache.size > 4096) styleCache.clear()
  styleCache.set(key, s)
  return s
}

export class Renderer {
  private prev: Grid | null = null
  private lastCursor: CursorState | null = null
  private lastShape = -1

  // forget what's on screen, the next frame repaints all of it
  invalidate(): void {
    this.prev = null
    this.lastCursor = null
    this.lastShape = -1
  }

  // the bytes to write, or '' if nothing changed
  frame(next: Grid, cursor: CursorState | null): string {
    const full = !this.prev || this.prev.cols !== next.cols || this.prev.rows !== next.rows
    const prev = full ? null : this.prev!
    let body = ''
    let curX = -1
    let curY = -1
    let styleKey = ''
    let link = 0

    const cols = next.cols
    for (let y = 0; y < next.rows; y++) {
      let x = 0
      while (x < cols) {
        // next changed cell
        let start = -1
        for (; x < cols; x++) {
          const i = y * cols + x
          if (!prev || !next.cellEquals(prev, i)) {
            start = x
            break
          }
        }
        if (start < 0) break
        if (next.w[y * cols + start] === W_TAIL && start > 0) start--
        // run over the changes, bridging short unchanged gaps
        let end = start
        let probe = start
        while (probe < cols) {
          const i = y * cols + probe
          if (!prev || !next.cellEquals(prev, i)) {
            end = probe
            probe++
            continue
          }
          let gap = 0
          while (probe + gap < cols && gap <= GAP && prev && next.cellEquals(prev, y * cols + probe + gap))
            gap++
          if (gap > GAP || probe + gap >= cols) break
          probe += gap
        }
        if (next.w[y * cols + end] === 1 && end + 1 < cols) end++ // lead cell: include its tail
        if (curY !== y || curX !== start) body += `${ESC}${y + 1};${start + 1}H`
        curY = y
        curX = start
        for (let cx = start; cx <= end; cx++) {
          const i = y * cols + cx
          if (next.w[i] === W_TAIL) continue
          const key = `${next.fg[i]}.${next.bg[i]}.${next.at[i]}`
          if (key !== styleKey) {
            body += sgr(next.fg[i]!, next.bg[i]!, next.at[i]!)
            styleKey = key
          }
          const lk = next.lk[i]!
          if (lk !== link) {
            const uri = lk ? linkUri(lk) : undefined
            body += uri ? `${OSC}8;id=x${lk};${uri}${ST}` : `${OSC}8;;${ST}`
            link = uri ? lk : 0
          }
          const c = next.ch[i]
          body += c === '' || c === undefined || c === '\0' ? ' ' : c
          curX += next.w[i] === 1 ? 2 : 1
        }
        if (curX >= cols) {
          curX = -1 // autowrap is off: the cursor rests on the last column, so re-address
          curY = -1
        }
        x = end + 1
      }
    }

    if (link) body += `${OSC}8;;${ST}`
    if (body) body += `${ESC}0m`

    // cursor
    let tail = ''
    const c = cursor
    const lc = this.lastCursor
    const cursorChanged =
      (c === null) !== (lc === null) ||
      (c !== null && lc !== null && (c.x !== lc.x || c.y !== lc.y || c.visible !== lc.visible)) ||
      (body !== '' && c !== null)
    if (cursorChanged) {
      if (c && c.visible) {
        if (c.shape !== this.lastShape) {
          tail += `${ESC}${c.shape} q`
          this.lastShape = c.shape
        }
        tail += `${ESC}${c.y + 1};${c.x + 1}H${ESC}?25h`
      } else {
        tail += `${ESC}?25l`
      }
    }

    this.prev = this.prev && !full ? this.prev : new Grid(next.cols, next.rows)
    if (body || full) this.prev.copyFrom(next)
    this.lastCursor = c ? { ...c } : null

    if (!body && !tail) return ''
    return `${ESC}?2026h${body ? `${ESC}?25l` : ''}${body}${tail}${ESC}?2026l`
  }
}

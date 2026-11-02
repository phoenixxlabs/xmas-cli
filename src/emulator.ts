// wraps @xterm/headless: parses the child's output, answers its terminal queries and keeps track
// of the input modes we have to pass on to the real terminal

import os from 'node:os'
import xterm from '@xterm/headless'
import unicode11 from '@xterm/addon-unicode11'
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
  W_LEAD,
  W_TAIL,
  pal,
} from './grid.js'
import { linkId } from './links.js'

const { Terminal } = xterm
type XTerminal = InstanceType<typeof Terminal>

// what we answer when the child asks for the terminal colours (osc 10/11/12)
const REPORT_COLORS: Record<number, string> = {
  10: 'rgb:eaea/f6f6/ffff',
  11: 'rgb:0b0b/1414/2020',
  12: 'rgb:eaea/f6f6/ffff',
}

export interface EmulatorHooks {
  // what a terminal would answer (da, dsr, colour reports), goes to the child's stdin
  respond(data: string): void
  // raw sequences for the real terminal: clipboard, notifications, title, bell
  forward(data: string): void
  log?(msg: string): void
}

export interface CursorInfo {
  x: number
  y: number
  visible: boolean
  shape: number
}

export class Emulator {
  readonly term: XTerminal
  // goes up whenever parsed output changed the screen
  version = 0
  readonly modes = new Map<number, boolean>()
  cursorVisible = true
  cursorShape = 0
  // the child asked for a synchronized update, don't snapshot until this passes
  syncUntil = 0
  titlePrefix = ''
  // xterm's link ids to ours
  private links = new Map<number, number>()

  constructor(
    cols: number,
    rows: number,
    private hooks: EmulatorHooks,
  ) {
    this.term = new Terminal({
      cols,
      rows,
      scrollback: 200,
      allowProposedApi: true,
      windowsPty:
        process.platform === 'win32'
          ? { backend: 'conpty', buildNumber: Number(os.release().split('.')[2]) || 22000 }
          : undefined,
    })
    try {
      this.term.loadAddon(new unicode11.Unicode11Addon() as never)
      this.term.unicode.activeVersion = '11'
    } catch (e) {
      hooks.log?.(`unicode11 unavailable: ${String(e)}`)
    }
    this.term.onData((d) => hooks.respond(d))
    this.term.onBell(() => hooks.forward('\x07'))
    this.installHandlers()
  }

  private installHandlers(): void {
    const p = this.term.parser
    const setModes = (params: (number | number[])[], on: boolean) => {
      for (const raw of params) {
        const m = Array.isArray(raw) ? raw[0]! : raw
        this.modes.set(m, on)
        if (m === 25) this.cursorVisible = on
        if (m === 2026) this.syncUntil = on ? Date.now() + 150 : 0
      }
      return false // let xterm apply it too
    }
    p.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => setModes(params as never, true))
    p.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => setModes(params as never, false))
    p.registerCsiHandler({ intermediates: ' ', final: 'q' }, (params) => {
      const v = params[0]
      this.cursorShape = typeof v === 'number' ? v : 0
      return false
    })

    // clipboard, notifications and progress go straight to the real terminal
    for (const id of [9, 99, 777, 52, 7]) {
      p.registerOscHandler(id, (data) => {
        this.hooks.forward(`\x1b]${id};${data}\x1b\\`)
        return true
      })
    }
    for (const id of [0, 1, 2]) {
      p.registerOscHandler(id, (data) => {
        this.hooks.forward(`\x1b]${id};${id === 1 ? data : this.titlePrefix + data}\x1b\\`)
        return true
      })
    }
    // answer colour queries ourselves, ignore attempts to set them
    for (const id of [10, 11, 12]) {
      p.registerOscHandler(id, (data) => {
        if (data === '?') this.hooks.respond(`\x1b]${id};${REPORT_COLORS[id]}\x1b\\`)
        return true
      })
    }
  }

  write(data: string): void {
    this.term.write(data, () => {
      this.version++
    })
  }

  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows)
    this.version++
  }

  get cols(): number {
    return this.term.cols
  }
  get rows(): number {
    return this.term.rows
  }

  get isSynchronizing(): boolean {
    return this.syncUntil > Date.now()
  }

  cursor(): CursorInfo {
    const b = this.term.buffer.active
    return { x: b.cursorX, y: b.cursorY, visible: this.cursorVisible, shape: this.cursorShape }
  }

  snapshot(g: Grid): void {
    const buf = this.term.buffer.active
    const cell = buf.getNullCell()
    const top = buf.viewportY
    const cols = Math.min(g.cols, this.term.cols)
    for (let y = 0; y < g.rows; y++) {
      const line = buf.getLine(top + y)
      for (let x = 0; x < g.cols; x++) {
        const i = y * g.cols + x
        if (!line || x >= cols) {
          g.ch[i] = ' '
          g.fg[i] = 0
          g.bg[i] = 0
          g.at[i] = 0
          g.w[i] = 0
          g.lk[i] = 0
          continue
        }
        line.getCell(x, cell)
        const width = cell.getWidth()
        g.fg[i] = cell.isFgDefault()
          ? 0
          : cell.isFgRGB()
            ? ((2 << 24) | cell.getFgColor()) >>> 0
            : pal(cell.getFgColor())
        g.bg[i] = cell.isBgDefault()
          ? 0
          : cell.isBgRGB()
            ? ((2 << 24) | cell.getBgColor()) >>> 0
            : pal(cell.getBgColor())
        let at = 0
        if (cell.isBold()) at |= A_BOLD
        if (cell.isDim()) at |= A_DIM
        if (cell.isItalic()) at |= A_ITALIC
        if (cell.isUnderline()) at |= A_UNDERLINE
        if (cell.isBlink()) at |= A_BLINK
        if (cell.isInverse()) at |= A_INVERSE
        if (cell.isInvisible()) at |= A_INVISIBLE
        if (cell.isStrikethrough()) at |= A_STRIKE
        if (cell.isOverline()) at |= A_OVERLINE
        g.at[i] = at
        g.lk[i] = this.linkAt(cell)
        if (width === 0) {
          g.ch[i] = ''
          g.w[i] = W_TAIL
        } else {
          g.ch[i] = cell.getChars() || ' '
          g.w[i] = width === 2 ? W_LEAD : 0
        }
      }
    }
  }

  // osc 8 links are kept by xterm, we only need their uri
  private linkAt(cell: unknown): number {
    // the cell object is reused, so stale extended attrs hang around unless the flag is checked
    const c = cell as { hasExtendedAttrs?: () => number; extended?: { urlId: number } }
    if (!c.hasExtendedAttrs?.()) return 0
    const urlId = c.extended?.urlId
    if (!urlId) return 0
    let id = this.links.get(urlId)
    if (id === undefined) {
      const core = (
        this.term as unknown as {
          _core?: { _oscLinkService?: { getLinkData(n: number): { uri?: string } | undefined } }
        }
      )._core
      const uri = core?._oscLinkService?.getLinkData(urlId)?.uri
      id = uri ? linkId(uri) : 0
      this.links.set(urlId, id)
    }
    return id
  }

  dispose(): void {
    this.term.dispose()
  }
}

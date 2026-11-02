// stdin to the child. nearly everything is forwarded untouched. we only look for our hotkeys,
// focus reports, mouse reports (rows get shifted when we reserve some above the child) and
// bracketed paste (never looked inside). a lone esc is held back a few ms in case it starts a
// sequence

export interface InputHooks {
  hotkey(name: string): void
  focus(isFocused: boolean): void
  childWantsFocus(): boolean
  // rows we reserve above the child, mouse rows are shifted by this
  topOffset(): number
  // rows the child occupies, mouse events below them are dropped
  childRows(): number
}

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/

// turns something like ctrl+alt+s into the bytes a terminal sends for it
export function hotkeyBytes(spec: string): string | null {
  const parts = spec
    .toLowerCase()
    .split('+')
    .map((s) => s.trim())
  const key = parts.pop()
  if (!key || key.length !== 1) return null
  const ctrl = parts.includes('ctrl')
  const alt = parts.includes('alt')
  if (!alt) return null // plain ctrl keys belong to Claude
  const code = key.charCodeAt(0)
  const body = ctrl ? String.fromCharCode(code & 0x1f) : key
  return `\x1b${body}`
}

export class InputRouter {
  private pending = ''
  private inPaste = false
  private timer: NodeJS.Timeout | null = null
  private hotkeys = new Map<string, string>()

  constructor(
    private hooks: InputHooks,
    private send: (s: string) => void,
    private escDelayMs = 15,
  ) {}

  setHotkeys(map: Record<string, string>): void {
    this.hotkeys.clear()
    for (const [name, spec] of Object.entries(map)) {
      const bytes = hotkeyBytes(spec)
      if (bytes) this.hotkeys.set(bytes, name)
    }
  }

  feed(chunk: string): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const buf = this.pending + chunk
    this.pending = ''
    let out = ''
    let i = 0
    const n = buf.length

    while (i < n) {
      if (this.inPaste) {
        const end = buf.indexOf(PASTE_END, i)
        if (end >= 0) {
          out += buf.slice(i, end + PASTE_END.length)
          i = end + PASTE_END.length
          this.inPaste = false
          continue
        }
        // might be the start of the end marker, hold it back
        let keep = 0
        for (let k = Math.min(PASTE_END.length - 1, n - i); k > 0; k--) {
          if (PASTE_END.startsWith(buf.slice(n - k))) {
            keep = k
            break
          }
        }
        out += buf.slice(i, n - keep)
        this.pending = buf.slice(n - keep)
        i = n
        break
      }

      const esc = buf.indexOf('\x1b', i)
      if (esc < 0) {
        out += buf.slice(i)
        i = n
        break
      }
      out += buf.slice(i, esc)
      i = esc

      if (i === n - 1) {
        this.pending = '\x1b'
        break
      }
      const c1 = buf[i + 1]!
      let seq: string
      if (c1 === '[') {
        let j = i + 2
        while (j < n && buf.charCodeAt(j) >= 0x20 && buf.charCodeAt(j) <= 0x3f) j++
        if (j >= n) {
          this.pending = buf.slice(i)
          break
        }
        seq = buf.slice(i, j + 1)
      } else if (c1 === 'O') {
        if (i + 2 >= n) {
          this.pending = buf.slice(i)
          break
        }
        seq = buf.slice(i, i + 3)
      } else {
        seq = buf.slice(i, i + 2)
      }
      i += seq.length
      out += this.handle(seq)
    }

    if (out) this.send(out)
    if (this.pending) {
      this.timer = setTimeout(() => this.flush(), this.escDelayMs)
    }
  }

  // let go of anything waiting: a lone esc, or a sequence that never finished
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.pending) {
      const p = this.pending
      this.pending = ''
      this.send(p)
    }
  }

  private handle(seq: string): string {
    if (seq === PASTE_START) {
      this.inPaste = true
      return seq
    }
    if (seq === '\x1b[I' || seq === '\x1b[O') {
      this.hooks.focus(seq === '\x1b[I')
      return this.hooks.childWantsFocus() ? seq : ''
    }
    const name = this.hotkeys.get(seq)
    if (name) {
      this.hooks.hotkey(name)
      return ''
    }
    const m = MOUSE.exec(seq)
    if (m) {
      const top = this.hooks.topOffset()
      if (top === 0) return seq
      const y = Number(m[3]) - top
      if (y < 1 || y > this.hooks.childRows()) return '' // over our own band
      return `\x1b[<${m[1]};${m[2]};${y}${m[4]}`
    }
    return seq
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

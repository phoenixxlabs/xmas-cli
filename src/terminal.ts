// The real terminal: enter/leave the alternate screen, own raw input, mirror the modes
// the child asked for so mouse / paste / cursor-key input actually arrives.

const ESC = '\x1b['

/** DEC private modes that change what *input* the terminal sends; the child decides them. */
export const MIRRORED_MODES = [1, 1000, 1002, 1003, 1005, 1006, 1015, 1016, 2004] as const

export class OuterTerminal {
  private applied = new Map<number, boolean>()
  private entered = false
  private rawWas = false

  constructor(
    private out: NodeJS.WriteStream = process.stdout,
    private inp: NodeJS.ReadStream = process.stdin,
  ) {}

  get cols(): number {
    return this.out.columns || 80
  }
  get rows(): number {
    return this.out.rows || 24
  }

  enter(): void {
    if (this.entered) return
    this.entered = true
    if (this.inp.isTTY) {
      this.rawWas = this.inp.isRaw
      this.inp.setRawMode(true)
    }
    this.inp.resume()
    // alternate screen, hide cursor, no autowrap (we address every cell), focus reports
    this.out.write(`${ESC}?1049h${ESC}?25l${ESC}?7l${ESC}?1004h${ESC}0m${ESC}2J${ESC}H`)
  }

  /** Apply the child's wanted input modes (diffed against what we already set). */
  mirror(modes: ReadonlyMap<number, boolean>): void {
    let s = ''
    for (const m of MIRRORED_MODES) {
      const want = modes.get(m) ?? false
      if ((this.applied.get(m) ?? false) !== want) {
        s += `${ESC}?${m}${want ? 'h' : 'l'}`
        this.applied.set(m, want)
      }
    }
    if (s) this.out.write(s)
  }

  write(s: string, cb?: () => void): boolean {
    return this.out.write(s, cb)
  }

  get writableLength(): number {
    return this.out.writableLength
  }

  leave(): void {
    if (!this.entered) return
    this.entered = false
    let s = ''
    for (const m of MIRRORED_MODES) if (this.applied.get(m)) s += `${ESC}?${m}l`
    this.applied.clear()
    s += `${ESC}?1004l${ESC}?7h${ESC}0m${ESC}0 q${ESC}?25h${ESC}?1049l`
    this.out.write(s)
    if (this.inp.isTTY) {
      try {
        this.inp.setRawMode(this.rawWas)
      } catch {
        /* stream already closed */
      }
    }
    this.inp.pause()
  }
}

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import nodePty from 'node-pty'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Grid } from '../src/grid.js'
import { PAST_TENSE } from '../src/fx/words.js'
import { makeEmu } from './helpers.js'

const root = path.resolve(import.meta.dirname, '..')
const FAKE = path.join(root, 'test', 'fixtures', 'fake-claude.mjs')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xmas-e2e-'))

class Session {
  readonly pty: nodePty.IPty
  readonly screen
  raw = ''
  exitCode: number | null = null
  private exited: Promise<number>

  constructor(
    args: string[] = [],
    opts: { cols?: number; rows?: number; env?: Record<string, string>; config?: object } = {},
  ) {
    const cols = opts.cols ?? 100
    const rows = opts.rows ?? 30
    const home = fs.mkdtempSync(path.join(tmp, 'home-'))
    // the fake claude knows no permission flags, and the suite was written against the festive look
    fs.writeFileSync(
      path.join(home, 'config.json'),
      JSON.stringify({ preset: 'festive', yolo: false, ...opts.config }),
    )
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
    Object.assign(env, {
      XMAS_CLAUDE_BIN: FAKE,
      XMAS_HOME: home,
      CLAUDE_CONFIG_DIR: path.join(home, 'claude'),
      ...opts.env,
    })
    this.pty = nodePty.spawn(process.execPath, [path.join(root, 'dist', 'bin.js'), ...args], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: root,
      env,
    })
    this.screen = makeEmu(cols, rows, { respond: (d) => this.pty.write(d) })
    this.pty.onData((d) => {
      this.raw += d
      this.screen.write(d)
    })
    this.exited = new Promise((r) =>
      this.pty.onExit((e) => {
        this.exitCode = e.exitCode
        r(e.exitCode)
      }),
    )
  }

  send(s: string): void {
    this.pty.write(s)
  }

  grid(): Grid {
    const g = new Grid(this.screen.cols, this.screen.rows)
    this.screen.snapshot(g)
    return g
  }

  text(): string {
    return this.grid().toText()
  }

  async waitFor(pred: () => boolean, label: string, ms = 8000): Promise<void> {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (pred()) return
      await new Promise((r) => setTimeout(r, 40))
    }
    throw new Error(`timed out waiting for ${label}\n--- screen ---\n${this.text()}\n--- end ---`)
  }

  async waitText(s: string | RegExp, ms?: number): Promise<void> {
    await this.waitFor(
      () => (typeof s === 'string' ? this.text().includes(s) : s.test(this.text())),
      String(s),
      ms,
    )
  }

  waitExit(ms = 8000): Promise<number> {
    return Promise.race([
      this.exited,
      new Promise<number>((_, rej) => setTimeout(() => rej(new Error(`no exit\n${this.text()}`)), ms)),
    ])
  }

  kill(): void {
    if (this.exitCode !== null) return
    try {
      this.pty.kill()
    } catch {
      /* gone */
    }
  }
}

const live: Session[] = []
const start = (...a: ConstructorParameters<typeof Session>) => {
  const s = new Session(...a)
  live.push(s)
  return s
}

beforeAll(() => {
  execSync('npx tsc -p tsconfig.json', { cwd: root, stdio: 'pipe' })
}, 120000)
afterEach(() => {
  while (live.length) live.pop()!.kill()
})
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

const FLAKES = /[·*✶]/

describe('xmas around a fake claude (nested ConPTY)', () => {
  it('shows the child, mirrors input modes, and enters the alt screen', async () => {
    const s = start()
    await s.waitText('Claude Code v0.0.0-fake')
    expect(s.text()).toContain('❯ Try "write a test"')
    expect(s.screen.term.buffer.active.type).toBe('alternate')
    await s.waitFor(
      () =>
        s.screen.modes.get(1003) === true &&
        s.screen.modes.get(1006) === true &&
        s.screen.modes.get(2004) === true,
      'mouse+paste mirrored',
    )
  })

  it('injects the winter settings into claude', async () => {
    const s = start()
    // the temp path is long on CI and gets cut off, so only the flag is checked
    await s.waitText(/args: --settings /)
  })

  it('--xmas-no-settings leaves claude alone', async () => {
    const s = start(['--xmas-no-settings'])
    await s.waitText('args:')
    expect(s.text()).not.toContain('--settings')
  })

  it('forwards typing, backspace and Enter', async () => {
    const s = start()
    await s.waitText('Claude Code')
    s.send('helloo')
    await s.waitText('❯ helloo')
    s.send('\x7f')
    await s.waitText(/❯ hello(?!o)/)
    s.send('\r')
    await s.waitText('submitted:hello')
  })

  it('forwards a bracketed paste intact (newlines included)', async () => {
    const s = start()
    await s.waitText('Claude Code')
    s.send('\x1b[200~line1\nline2\x1b[201~')
    await s.waitText('paste:11:"line1\\nline2"')
  })

  it('does not treat our hotkey bytes inside a paste as hotkeys', async () => {
    const s = start()
    await s.waitText('Claude Code')
    s.send('\x1b[200~a\x1b\x13b\x1b[201~')
    await s.waitText(/paste:4:/)
  })

  it('forwards mouse reports unshifted when no band is reserved', async () => {
    const s = start(['--calm'])
    await s.waitText('Claude Code')
    s.send('\x1b[<0;10;5M')
    await s.waitText('mouse 0;10;5M')
  })

  it('shifts mouse rows when the header band reserves a row', async () => {
    const s = start(['--max'])
    await s.waitText('Claude Code')
    s.send('\x1b[<0;10;6M')
    await s.waitText('mouse 0;10;5M')
    expect(s.text().split('\n')[0]).toContain('Christmas')
  })

  it('tracks resizes (child sees the new size)', async () => {
    const s = start(['--calm'])
    await s.waitText('size 100x30')
    s.pty.resize(120, 40)
    s.screen.resize(120, 40)
    await s.waitText('size 120x40')
    await s.waitFor(() => /^[─━]{100}/.test(s.grid().rowText(36)), 'prompt box relaid out')
    expect(s.text()).toContain('❯')
  })

  it('reserves exactly one row for the band and the child gets the rest', async () => {
    const s = start(['--max'])
    await s.waitText('size 100x29')
  })

  it('forwards focus reports the child asked for', async () => {
    const s = start()
    await s.waitText('Claude Code')
    s.send('\x1b[O')
    await s.waitText('focus out')
    s.send('\x1b[I')
    await s.waitText('focus in')
  })

  it('lets Esc and arrow keys through', async () => {
    const s = start()
    await s.waitText('Claude Code')
    s.send('\x1b[A')
    await s.waitText('key "\\u001b[A"')
    s.send('\x1b')
    await s.waitText('status: esc')
  })

  it('forwards the child title (with our prefix) to the real terminal', async () => {
    const s = start()
    await s.waitText('Claude Code')
    await s.waitFor(() => /\]0;❄ fake claude/.test(s.raw), 'title forwarded')
  })

  it('propagates the exit code and restores the terminal', async () => {
    const s = start()
    await s.waitText('Claude Code')
    s.send('/exit\r')
    expect(await s.waitExit()).toBe(7)
    expect(s.raw).toMatch(/\x1b\[\?1049l/)
    expect(s.screen.term.buffer.active.type).toBe('normal')
  })

  it('Ctrl+C reaches the child', async () => {
    const s = start()
    await s.waitText('Claude Code')
    s.send('\x03')
    expect(await s.waitExit()).toBe(130)
  })

  it('draws snow in empty space but never in the prompt box, footer or text', async () => {
    const s = start()
    await s.waitText('Claude Code')
    await s.waitFor(() => {
      const g = s.grid()
      let n = 0
      for (let y = 0; y < g.rows; y++)
        if (FLAKES.test(g.rowText(y).replace(/[·˙.]/g, '').replace(/Try.*/, ''))) n++
      return n > 0
    }, 'some snow')
    for (let k = 0; k < 20; k++) {
      await new Promise((r) => setTimeout(r, 100))
      const lines = s.text().split('\n')
      const box = lines.findIndex((l) => /^[─━]{20}/.test(l))
      for (let y = box + 1; y < lines.length; y++) {
        expect(lines[y]!.replace(/\s+$/, '')).toMatch(
          /^([─━]+|❯ .*|\s*⏵⏵ auto mode on \(shift\+tab to cycle\))$/,
        )
      }
      const text = 'The quick brown fox jumps over the lazy dog. 好 世界 ✻ é'
      const row = lines.find((l) => l.startsWith('The quick brown'))!
      expect(row.startsWith(text)).toBe(true)
      expect(row.slice(text.length)).toMatch(/^[ ·˙.*✶]*$/) // only flakes may share the row, in the margin
    }
  })

  it('lights the rules with bulbs', async () => {
    const s = start()
    await s.waitText('Claude Code')
    await s.waitFor(() => s.text().includes('━'), 'bulbs')
  })

  it('--no-snow and --no-lights turn those off', async () => {
    const s = start(['--no-snow', '--no-lights', '--no-logo'])
    await s.waitText('Claude Code')
    await new Promise((r) => setTimeout(r, 800))
    const t = s.text()
    expect(t).not.toContain('━')
    expect(t.split('\n').slice(0, 25).join('\n')).not.toMatch(/[*✶]/)
  })

  it('the snow hotkey toggles snow and shows a toast', async () => {
    const s = start()
    await s.waitText('Claude Code')
    await new Promise((r) => setTimeout(r, 500))
    s.send('\x1b\x13')
    await s.waitText('snow off')
    await s.waitFor(
      () => !/[*✶]/.test(s.text().split('\n').slice(0, 24).join('\n').replace(/Try.*/, '')),
      'snow gone',
    )
    s.send('\x1b\x13')
    await s.waitText('snow on')
  })

  it('keeps showing the child when it is working (spinner line, chase)', async () => {
    const s = start()
    await s.waitText('Claude Code')
    s.send('/work\r')
    await s.waitText('esc to interrupt')
    await s.waitText(/✻ \w+ for 1s/, 6000)
    const word = /✻ (\w+) for 1s/.exec(s.text())![1]!
    expect(PAST_TENSE).toContain(word) // Claude's own word was swapped for a winter one
  })

  it('loads its look from the config file', async () => {
    const s = start([], { config: { preset: 'calm', lights: { enabled: false } } })
    await s.waitText('Claude Code')
    await new Promise((r) => setTimeout(r, 400))
    expect(s.text()).not.toContain('━')
  })

  it('survives a garbage config file', async () => {
    const s = start([], { config: { snow: 'nope', fps: 'fast' } })
    await s.waitText('Claude Code')
  })

  it('--xmas-plain mirrors the child with no effects', async () => {
    const s = start(['--xmas-plain'])
    await s.waitText('Claude Code')
    await new Promise((r) => setTimeout(r, 600))
    const t = s.text()
    expect(t).not.toContain('━')
    expect(t).toContain('❯ Try "write a test"')
  })

  it('print mode and pipes run claude directly', async () => {
    const s = start(['-p', 'hello'])
    await s.waitText('PRINT hello')
    expect(await s.waitExit()).toBe(0)
    expect(s.raw).not.toMatch(/\x1b\[\?1049h/)
  })

  it('keeps animating while the terminal is blurred', async () => {
    const s = start()
    await s.waitText('Claude Code')
    await new Promise((r) => setTimeout(r, 600))
    s.send('[O') // focus lost
    await s.waitText('focus out')
    await new Promise((r) => setTimeout(r, 300))
    const a = s.text()
    await s.waitFor(() => s.text() !== a, 'animation continues while blurred')
  })

  it('reloads the config file while running', async () => {
    const home = fs.mkdtempSync(path.join(tmp, 'live-'))
    const base = { preset: 'festive', yolo: false }
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(base))
    const s = start([], { env: { XMAS_HOME: home } })
    await s.waitText('Claude Code')
    await s.waitFor(() => s.text().includes('━'), 'bulbs at first')
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ ...base, lights: { enabled: false } }))
    await s.waitFor(() => !s.text().includes('━'), 'bulbs gone after config edit')
    expect(s.text()).toContain('❯ Try')
  })

  it('falls back to a plain mirror if the effects keep failing', async () => {
    const s = start([], { env: { XMAS_FAULT_INJECT: '1' } })
    await s.waitText('Claude Code')
    s.send('abc')
    await s.waitText('❯ abc')
    await new Promise((r) => setTimeout(r, 500))
    const t = s.text()
    expect(t).not.toContain('━')
    expect(t).toContain('❯ abc')
    s.send('\x7f\x7f\x7f/exit\r')
    expect(await s.waitExit()).toBe(7)
  })

  it('copes with a small terminal and with growing back', async () => {
    const s = start([], { cols: 28, rows: 12 })
    await s.waitText('size 28x12')
    s.pty.resize(100, 30)
    s.screen.resize(100, 30)
    await s.waitText('size 100x30')
  })

  it('survives an absurdly small terminal without crashing', async () => {
    const s = start([], { cols: 10, rows: 4 })
    await new Promise((r) => setTimeout(r, 1200))
    expect(s.exitCode).toBeNull()
    s.pty.resize(80, 24)
    s.screen.resize(80, 24)
    await s.waitText('size 80x24')
  })

  it('forwards clipboard (OSC 52) writes from the child', async () => {
    const s = start()
    await s.waitText('Claude Code')
    s.send('')
    await s.waitFor(() => s.raw.includes(']52;c;aGVsbG8='), 'osc52')
  })

  it('adds little latency to a keystroke', async () => {
    const s = start()
    await s.waitText('Claude Code')
    await new Promise((r) => setTimeout(r, 500))
    const times: number[] = []
    for (const ch of 'abcdefgh') {
      const t0 = performance.now()
      s.send(ch)
      await s.waitFor(() => s.text().includes(`❯ ${'abcdefgh'.slice(0, times.length + 1)}`), `echo ${ch}`)
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    const median = times[Math.floor(times.length / 2)]!
    console.log(
      `keystroke→screen median ${median.toFixed(0)}ms, worst ${times[times.length - 1]!.toFixed(0)}ms`,
    )
    expect(median).toBeLessThan(250)
  })
})

import fs from 'node:fs'
import path from 'node:path'
import nodePty from 'node-pty'

export interface ChildSpec {
  bin: string
  args: string[]
  cols: number
  rows: number
  cwd?: string
  env?: Record<string, string | undefined>
}

export class ChildPty {
  private proc: nodePty.IPty
  readonly pid: number

  constructor(spec: ChildSpec) {
    let file = spec.bin
    let args = spec.args
    if (/\.(mjs|cjs|js)$/i.test(file)) {
      // lets tests (and curious people) point XMAS_CLAUDE_BIN at a node script
      args = [file, ...args]
      file = process.execPath
    }
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
      args = ['/d', '/c', file, ...args]
      file = process.env.ComSpec || 'cmd.exe'
    }
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries({ ...process.env, ...spec.env })) if (v !== undefined) env[k] = v
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    env.XMAS = '1'
    this.proc = nodePty.spawn(file, args, {
      name: 'xterm-256color',
      cols: Math.max(1, spec.cols),
      rows: Math.max(1, spec.rows),
      cwd: spec.cwd ?? process.cwd(),
      env,
    })
    this.pid = this.proc.pid
  }

  onData(cb: (d: string) => void): void {
    this.proc.onData(cb)
  }

  onExit(cb: (code: number) => void): void {
    this.proc.onExit((e) => cb(e.exitCode))
  }

  write(d: string): void {
    try {
      this.proc.write(d)
    } catch {
      /* child already gone */
    }
  }

  resize(cols: number, rows: number): void {
    try {
      this.proc.resize(Math.max(1, cols), Math.max(1, rows))
    } catch {
      /* child already gone */
    }
  }

  kill(): void {
    try {
      this.proc.kill()
    } catch {
      /* already dead */
    }
  }
}

/** Finds the claude executable: explicit path → PATH (.exe preferred) → npm global install. */
export function resolveClaude(explicit?: string | null): string | null {
  // an explicit choice (env var, then config) wins whatever it is, as long as it exists
  for (const c of [process.env.XMAS_CLAUDE_BIN, explicit]) {
    if (c && isFile(c)) return c
  }
  const candidates: string[] = []
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of exts) candidates.push(path.join(dir, `claude${ext}`))
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(
      path.join(
        process.env.APPDATA,
        'npm',
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'bin',
        'claude.exe',
      ),
    )
  }
  let shim: string | null = null
  for (const c of candidates) {
    if (!isFile(c)) continue
    if (/\.exe$/i.test(c) || process.platform !== 'win32') return c
    // npm's claude.cmd just launches the native exe next to node_modules; prefer that
    const native = path.join(
      path.dirname(c),
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude.exe',
    )
    if (isFile(native)) return native
    shim ??= c
  }
  return shim
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

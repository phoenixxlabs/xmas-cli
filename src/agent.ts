// Which CLI xmas wraps (claude or codex) and how xmas-level flags map onto each one.

import fs from 'node:fs'
import path from 'node:path'

export type AgentName = 'claude' | 'codex'

export const CLAUDE_SUBCOMMANDS = new Set([
  'agents',
  'attach',
  'auth',
  'auto-mode',
  'doctor',
  'gateway',
  'import',
  'install',
  'logs',
  'mcp',
  'plugin',
  'plugins',
  'purge',
  'respawn',
  'rm',
  'setup-token',
  'stop',
  'kill',
  'ultrareview',
  'update',
  'upgrade',
])

// codex subcommands that are not the interactive TUI (resume and fork are, so they stay out)
export const CODEX_SUBCOMMANDS = new Set([
  'agents',
  'exec',
  'e',
  'review',
  'login',
  'logout',
  'mcp',
  'plugin',
  'app-server',
  'remote-control',
  'app',
  'completion',
  'update',
  'doctor',
  'sandbox',
  'debug',
  'apply',
  'a',
  'queue',
  'archive',
  'delete',
  'migrate-rollouts',
  'migrate-nfs-db',
  'unarchive',
  'cloud',
  'exec-server',
  'features',
  'help',
])

export interface AgentFlags {
  agent: AgentName
  yolo: boolean
  /** undefined = not asked, true = resume (picker), string = a session id/name */
  resume?: true | string
  /** continue the most recent session */
  last: boolean
}

export interface BuildInput extends AgentFlags {
  rest: string[]
  /** claude only: --settings <file> to inject, or null */
  settingsPath?: string | null
}

const CODEX_SUBS_INTERACTIVE = new Set(['resume', 'fork'])

/** Builds the argv handed to the agent. Pure, so it can be tested. */
export function buildAgentArgs(i: BuildInput): string[] {
  const rest = [...i.rest]
  if (i.agent === 'claude') {
    const out: string[] = []
    if (i.settingsPath && !rest.includes('--settings')) out.push('--settings', i.settingsPath)
    if (i.yolo && !rest.some((a) => a === '--dangerously-skip-permissions' || a === '--permission-mode')) {
      out.push('--dangerously-skip-permissions')
    }
    if (i.last) out.push('--continue')
    else if (i.resume === true) out.push('--resume')
    else if (typeof i.resume === 'string') out.push('--resume', i.resume)
    return [...out, ...rest]
  }

  // codex: global options first, then an optional `resume` subcommand, then the rest
  const out: string[] = []
  if (
    i.yolo &&
    !rest.some(
      (a) =>
        a === '--dangerously-bypass-approvals-and-sandbox' ||
        a === '--yolo' ||
        a === '-a' ||
        a === '--ask-for-approval' ||
        a === '-s' ||
        a === '--sandbox',
    )
  ) {
    out.push('--dangerously-bypass-approvals-and-sandbox')
  }
  // the compositor only works on a full-screen viewport; inline mode scrolls history away
  if (!rest.includes('--no-alt-screen') && !rest.some((a) => a.startsWith('tui.alternate_screen'))) {
    out.push('-c', 'tui.alternate_screen="always"')
  }
  const first = rest.find((a) => !a.startsWith('-'))
  const hasSub = first !== undefined && CODEX_SUBS_INTERACTIVE.has(first)
  if (!hasSub && (i.last || i.resume !== undefined)) {
    out.push('resume')
    if (i.last) out.push('--last')
    else if (typeof i.resume === 'string') out.push(i.resume)
  }
  return [...out, ...rest]
}

export function isAgentInteractive(agent: AgentName, rest: string[], tty: boolean): boolean {
  if (!tty) return false
  if (
    rest.some(
      (a) =>
        ['-p', '--print', '-v', '--version', '-V', '-h', '--help'].includes(a) &&
        (agent === 'claude' || a !== '-p'),
    )
  )
    return false
  const first = rest.find((a) => !a.startsWith('-'))
  const set = agent === 'claude' ? CLAUDE_SUBCOMMANDS : CODEX_SUBCOMMANDS
  if (first && rest.indexOf(first) === 0 && set.has(first)) return false
  return true
}

const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** Finds the codex executable: env → config → PATH → the desktop app's bundled copy. */
export function resolveCodex(explicit?: string | null): string | null {
  for (const c of [process.env.XMAS_CODEX_BIN, explicit]) if (c && isFile(c)) return c
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  const cands: string[] = []
  for (const dir of (process.env.PATH ?? '').split(path.delimiter))
    for (const e of exts) cands.push(path.join(dir, `codex${e}`))
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    cands.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'))
  }
  let shim: string | null = null
  for (const c of cands) {
    if (!isFile(c)) continue
    if (/\.exe$/i.test(c) || process.platform !== 'win32') return c
    shim ??= c
  }
  return shim
}

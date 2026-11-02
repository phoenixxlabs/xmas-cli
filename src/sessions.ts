// reads claude's and codex's saved sessions for `xmas sessions` and the exit hint

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentName } from './agent.js'
import { frost, ice, snow } from './style.js'

export interface SessionInfo {
  agent: AgentName
  id: string
  cwd: string
  updated: number
  title: string
}

const claudeHome = (): string => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const codexHome = (): string => process.env.CODEX_HOME || path.join(os.homedir(), '.codex')

const norm = (p: string): string =>
  p
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase()
const encodeClaudeDir = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-')

function head(file: string, bytes = 96 * 1024): string {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(bytes)
    const n = fs.readSync(fd, buf, 0, bytes, 0)
    return buf.toString('utf8', 0, n)
  } catch {
    return ''
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

const clip = (s: string, n = 70): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function claudeMeta(file: string): { cwd: string; title: string } {
  let cwd = ''
  let title = ''
  let firstUser = ''
  for (const line of head(file).split('\n')) {
    if (!line.startsWith('{')) continue
    let o: Record<string, any>
    try {
      o = JSON.parse(line)
    } catch {
      continue // the head cut can end mid-line
    }
    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd
    const t = o.customTitle ?? o.aiTitle ?? o.title
    if (!title && typeof t === 'string') title = t
    if (!firstUser && o.type === 'user' && !o.isMeta) {
      const c = o.message?.content
      const text =
        typeof c === 'string' ? c : Array.isArray(c) ? c.find((x: any) => x?.type === 'text')?.text : ''
      if (typeof text === 'string' && text && !text.startsWith('<')) firstUser = text
    }
  }
  return { cwd, title: clip(title || firstUser) }
}

// title holds the file path until the row is filled in
function listClaude(): SessionInfo[] {
  const root = path.join(claudeHome(), 'projects')
  const out: SessionInfo[] = []
  let dirs: string[] = []
  try {
    dirs = fs.readdirSync(root)
  } catch {
    return out
  }
  for (const d of dirs) {
    let files: string[] = []
    try {
      files = fs.readdirSync(path.join(root, d))
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const full = path.join(root, d, f)
      try {
        out.push({
          agent: 'claude',
          id: f.slice(0, -6),
          cwd: d,
          updated: fs.statSync(full).mtimeMs,
          title: full,
        })
      } catch {
        /* vanished */
      }
    }
  }
  return out
}

function codexIndex(): Map<string, string> {
  const m = new Map<string, string>()
  try {
    for (const line of fs.readFileSync(path.join(codexHome(), 'session_index.jsonl'), 'utf8').split('\n')) {
      if (!line.startsWith('{')) continue
      try {
        const o = JSON.parse(line)
        if (o.id && o.thread_name) m.set(o.id, o.thread_name)
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no index */
  }
  return m
}

function listCodex(): SessionInfo[] {
  const root = path.join(codexHome(), 'sessions')
  const out: SessionInfo[] = []
  const walk = (dir: string): void => {
    let ents: fs.Dirent[] = []
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/^rollout-.*\.jsonl$/.test(e.name)) {
        const id = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(e.name)?.[1]
        if (!id) continue
        try {
          out.push({ agent: 'codex', id, cwd: '', updated: fs.statSync(full).mtimeMs, title: full })
        } catch {
          /* vanished */
        }
      }
    }
  }
  walk(root)
  return out
}

function fill(s: SessionInfo, idx: Map<string, string>): SessionInfo {
  if (s.agent === 'claude') {
    const m = claudeMeta(s.title)
    return { ...s, cwd: m.cwd || s.cwd, title: m.title }
  }
  // the meta line is huge (it carries the base instructions), so pull the cwd out with a regex
  const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head(s.title, 64 * 1024))
  let cwd = ''
  if (m) {
    try {
      cwd = JSON.parse(`"${m[1]}"`)
    } catch {
      cwd = m[1]!
    }
  }
  return { ...s, cwd, title: clip(idx.get(s.id) ?? '') }
}

export interface ListOpts {
  agent: AgentName
  // only sessions started in this directory
  cwd?: string
  limit?: number
  // only sessions touched at or after this time (ms)
  since?: number
}

export function listSessions(o: ListOpts): SessionInfo[] {
  const limit = o.limit ?? 20
  const raw = (o.agent === 'claude' ? listClaude() : listCodex())
    .filter((s) => !o.since || s.updated >= o.since)
    .sort((a, b) => b.updated - a.updated)
  const idx = o.agent === 'codex' ? codexIndex() : new Map<string, string>()
  const out: SessionInfo[] = []
  const want = o.cwd ? norm(o.cwd) : null
  for (const s of raw) {
    if (out.length >= limit) break
    if (want && o.agent === 'claude' && !s.cwd.startsWith(encodeClaudeDir(o.cwd!))) continue // cheap pre-filter
    const f = fill(s, idx)
    if (want && norm(f.cwd) !== want) continue
    out.push(f)
  }
  return out
}

const ago = (ms: number): string => {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 129600) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function formatSessions(rows: SessionInfo[], showCwd: boolean): string {
  if (!rows.length) return `  ${frost('(no sessions)')}`
  return rows
    .map((r) => {
      const where = showCwd && r.cwd ? `  ${frost(r.cwd)}` : ''
      return `  ${ice(r.id)}  ${frost(ago(r.updated).padEnd(8))} ${r.title ? snow(r.title) : frost('(untitled)')}${where}`
    })
    .join('\n')
}

// newest session of this agent in cwd that was touched since `since`
export function sessionSince(agent: AgentName, cwd: string, since: number): SessionInfo | null {
  return listSessions({ agent, cwd, since, limit: 1 })[0] ?? null
}

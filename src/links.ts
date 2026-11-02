// hyperlinks: a registry so cells can carry a small id, a scan that links plain urls and file
// paths the agent printed without osc 8, and a helper to open a link ourselves

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Grid, W_LEAD, W_TAIL } from './grid.js'

const byUri = new Map<string, number>()
const byId = new Map<number, string>()
let nextId = 1

export function linkId(uri: string): number {
  let id = byUri.get(uri)
  if (id) return id
  if (byUri.size > 20000) {
    byUri.clear()
    byId.clear()
  }
  id = nextId++
  byUri.set(uri, id)
  byId.set(id, uri)
  return id
}

export function linkUri(id: number): string | undefined {
  return byId.get(id)
}

export interface LinkSpan {
  y: number
  x0: number
  x1: number
  id: number
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/g
const WIN_PATH_RE = /(?<![\w/\\])[A-Za-z]:[\\/][^\s<>"'`|*?]+/g
const POSIX_PATH_RE = /(?<![\w./~-])(?:~|\.{1,2})?\/[\w.@+~-]+(?:\/[\w.@+~-]+)*(?::\d+){0,2}/g
const REL_PATH_RE = /(?<![\w./~-])[\w@+-][\w.@+-]*(?:\/[\w.@+-]+)*\.\w{1,8}(?::\d+){0,2}(?![\w/-])/g
const LINE_SUFFIX = /(?::\d+){1,2}$/

// closing brackets and punctuation that belong to the sentence, not the link
function trimEnd(s: string): string {
  for (;;) {
    const c = s[s.length - 1]
    if (!c) return s
    if (/[.,;:!?'"]/.test(c)) s = s.slice(0, -1)
    else if (c === ')' && count(s, '(') < count(s, ')')) s = s.slice(0, -1)
    else if (c === ']' && count(s, '[') < count(s, ']')) s = s.slice(0, -1)
    else if (c === '}' || c === '>') s = s.slice(0, -1)
    else return s
  }
}

function count(s: string, c: string): number {
  let n = 0
  for (const x of s) if (x === c) n++
  return n
}

const exists = new Map<string, { ok: boolean; at: number }>()

function pathExists(p: string): boolean {
  const now = Date.now()
  const hit = exists.get(p)
  if (hit && now - hit.at < 4000) return hit.ok
  if (exists.size > 500) exists.clear()
  let ok = false
  try {
    ok = fs.existsSync(p)
  } catch {
    // unreadable counts as missing
  }
  exists.set(p, { ok, at: now })
  return ok
}

function toFileUri(abs: string): string {
  const distro = process.env.WSL_DISTRO_NAME
  if (distro && abs.startsWith('/')) return `file://wsl.localhost/${distro}${encodeURI(abs)}`
  return pathToFileURL(abs).href
}

// a printed path as a file uri, or null if nothing is there
function pathUri(raw: string, cwd: string): string | null {
  let p = raw.replace(LINE_SUFFIX, '')
  if (p.startsWith('~/')) p = path.join(os.homedir(), p.slice(2))
  const abs = path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p) ? p : path.resolve(cwd, p)
  return pathExists(abs) ? toFileUri(abs) : null
}

// finds urls and existing file paths in cells that don't already carry a link
export function scanLinks(g: Grid, cwd = process.cwd()): LinkSpan[] {
  const spans: LinkSpan[] = []
  const cols = g.cols
  const rowStrings: { s: string; at: number[] }[] = []
  for (let y = 0; y < g.rows; y++) {
    let s = ''
    const at: number[] = []
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      if (g.w[i] === W_TAIL) continue
      // a linked or empty cell breaks the text so matches can't run into it
      const c = g.lk[i] ? ' ' : g.ch[i] || ' '
      for (let k = 0; k < c.length; k++) at.push(x)
      s += c
    }
    rowStrings.push({ s, at })
  }

  const span = (y: number, a: number, b: number, id: number): void => {
    const { at } = rowStrings[y]!
    const x0 = at[a]!
    let x1 = at[b]!
    if (g.w[y * cols + x1] === W_LEAD) x1++
    spans.push({ y, x0, x1, id })
  }

  for (let y = 0; y < g.rows; y++) {
    const { s } = rowStrings[y]!
    const taken: [number, number][] = []
    const free = (a: number, b: number): boolean => !taken.some(([p, q]) => a < q && b > p)

    for (const m of s.matchAll(URL_RE)) {
      let url = trimEnd(m[0])
      const a = m.index!
      const b = a + url.length
      if (url.length < 10) continue
      const { at } = rowStrings[y]!
      // a url that runs to the right edge usually carries on in the next row
      const next = y + 1 < g.rows && at[b - 1]! >= cols - 2 ? /^\s*(\S+)/.exec(rowStrings[y + 1]!.s) : null
      if (next && /^[\w%./?&=#~:@+,;-]+$/.test(next[1]!) && !/^https?:/.test(next[1]!)) {
        const more = trimEnd(next[1]!)
        const start = next[0].length - next[1]!.length
        url += more
        const id = linkId(url)
        span(y, a, b - 1, id)
        span(y + 1, start, start + more.length - 1, id)
      } else {
        span(y, a, b - 1, linkId(url))
      }
      taken.push([a, b])
    }

    for (const re of [WIN_PATH_RE, POSIX_PATH_RE, REL_PATH_RE]) {
      for (const m of s.matchAll(re)) {
        const text = trimEnd(m[0])
        const a = m.index!
        const b = a + text.length
        if (!free(a, b)) continue
        const bare = text.replace(LINE_SUFFIX, '')
        // a lone "/word" is a slash command, not a path
        if (re === POSIX_PATH_RE && /^\/[\w.@+~-]+$/.test(bare)) continue
        const uri = pathUri(text, cwd)
        if (!uri) continue
        span(y, a, b - 1, linkId(uri))
        taken.push([a, b])
      }
    }
  }
  return spans
}

export function applyLinks(g: Grid, spans: LinkSpan[]): void {
  for (const sp of spans) {
    if (sp.y >= g.rows) continue
    for (let x = sp.x0; x <= sp.x1 && x < g.cols; x++) {
      const i = sp.y * g.cols + x
      if (!g.lk[i]) g.lk[i] = sp.id
    }
  }
}

// opens a link the way a double click would, without going through a shell
export function openTarget(uri: string): void {
  try {
    let target = uri
    if (uri.startsWith('file:')) {
      const m = /^file:\/\/wsl\.localhost\/[^/]+(\/.*)$/.exec(uri)
      target = m ? decodeURI(m[1]!) : fileURLToPath(uri)
    }
    const run = (cmd: string, args: string[]): void => {
      const c = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true })
      c.on('error', () => {})
      c.unref()
    }
    if (process.platform === 'win32') {
      run('rundll32', ['url.dll,FileProtocolHandler', target])
    } else if (process.platform === 'darwin') {
      run('open', [target])
    } else if (process.env.WSL_DISTRO_NAME) {
      // hand the windows side a windows path or the url itself
      if (target.startsWith('/')) {
        const w = spawn('wslpath', ['-w', target], { stdio: ['ignore', 'pipe', 'ignore'] })
        let out = ''
        w.stdout.on('data', (d) => (out += d))
        w.on('error', () => {})
        w.on('close', () => run('explorer.exe', [out.trim() || target]))
      } else {
        run('cmd.exe', ['/c', 'start', '', target.replace(/&/g, '^&')])
      }
    } else {
      run('xdg-open', [target])
    }
  } catch {
    // nothing sensible to do if the opener is missing
  }
}

// keeps claude and codex current. we look up the newest published version once a day, and if the
// installed one is behind we ask before touching anything

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { configDir } from './config.js'
import { Fetcher, getJson, isNewer } from './update.js'

export type Tool = 'claude' | 'codex'

const PACKAGES: Record<Tool, string> = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex' }
const EVERY = 24 * 60 * 60 * 1000

interface Entry {
  checkedAt: number
  latest: string
  installed: string
  // a version the user already said no to
  declined?: string
}

type Cache = Partial<Record<Tool, Entry>>

function cacheFile(): string {
  return path.join(configDir(), 'agents.json')
}

function readCache(): Cache {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as Cache
  } catch {
    return {}
  }
}

function writeCache(c: Cache): void {
  try {
    fs.mkdirSync(configDir(), { recursive: true })
    fs.writeFileSync(cacheFile(), JSON.stringify(c))
  } catch {
    // a read-only home just means we ask again next time
  }
}

export function versionOf(text: string): string | null {
  return /\d+\.\d+\.\d+/.exec(text)?.[0] ?? null
}

function installedVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const cmd = /\.(mjs|cjs|js)$/i.test(bin) ? process.execPath : bin
    const args = cmd === bin ? ['--version'] : [bin, '--version']
    const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
    let out = ''
    try {
      const c = spawn(cmd, args, { shell, windowsHide: true })
      const timer = setTimeout(() => c.kill(), 8000)
      c.stdout.on('data', (d) => (out += d))
      c.on('error', () => resolve(null))
      c.on('close', () => {
        clearTimeout(timer)
        resolve(versionOf(out))
      })
    } catch {
      resolve(null)
    }
  })
}

async function newestVersion(tool: Tool, fetcher: Fetcher): Promise<string | null> {
  const data = (await fetcher(`https://registry.npmjs.org/${PACKAGES[tool]}/latest`)) as {
    version?: unknown
  } | null
  return versionOf(String(data?.version ?? ''))
}

// looks up the versions if the cache is a day old. never throws
export async function refreshAgent(
  tool: Tool,
  bin: string,
  opts: { force?: boolean; fetcher?: Fetcher; installed?: (bin: string) => Promise<string | null> } = {},
): Promise<void> {
  const cache = readCache()
  const old = cache[tool]
  if (!opts.force && old && Date.now() - old.checkedAt < EVERY) return
  const [latest, installed] = await Promise.all([
    newestVersion(tool, opts.fetcher ?? getJson),
    (opts.installed ?? installedVersion)(bin),
  ])
  if (!latest || !installed) return
  cache[tool] = { checkedAt: Date.now(), latest, installed, declined: old?.declined }
  writeCache(cache)
}

// the version worth offering, or null if we're current or the user already declined it
export function pendingAgent(tool: Tool): { latest: string; installed: string } | null {
  const e = readCache()[tool]
  if (!e || !isNewer(e.latest, e.installed) || e.declined === e.latest) return null
  return { latest: e.latest, installed: e.installed }
}

export function decline(tool: Tool): void {
  const cache = readCache()
  const e = cache[tool]
  if (!e) return
  e.declined = e.latest
  writeCache(cache)
}

// how to update, or null when we don't know how this copy was installed
export function updateCommand(tool: Tool, bin: string): { cmd: string; args: string[] } | null {
  if (tool === 'claude') return { cmd: bin, args: ['update'] }
  // codex has no updater of its own, so only touch copies that came from npm
  if (/node_modules[\\/]@openai[\\/]codex|[\\/]npm[\\/]codex(\.cmd)?$/i.test(bin)) {
    return { cmd: 'npm', args: ['install', '-g', `${PACKAGES.codex}@latest`] }
  }
  return null
}

// one key answer on a terminal, anything but y means no
function askKey(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const stdin = process.stdin
    process.stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.once('data', (d) => {
      stdin.setRawMode(false)
      stdin.pause()
      const yes = /^[yY]/.test(d.toString())
      process.stdout.write(`${yes ? 'y' : 'n'}\n`)
      resolve(yes)
    })
  })
}

// asks, and runs the update if the user agrees. true when something was updated
export async function offerUpdate(
  tool: Tool,
  bin: string,
  say: (s: string) => string = (s) => s,
): Promise<boolean> {
  const p = pendingAgent(tool)
  if (!p || !process.stdin.isTTY || !process.stdout.isTTY) return false
  const how = updateCommand(tool, bin)
  if (!how) {
    process.stdout.write(
      say(`${tool} ${p.latest} is out (you have ${p.installed}). update it the way you installed it.\n`),
    )
    decline(tool)
    return false
  }
  const yes = await askKey(say(`${tool} ${p.latest} is out (you have ${p.installed}). update now? [y/N] `))
  if (!yes) {
    decline(tool)
    return false
  }
  const shell = process.platform === 'win32' && !/\.exe$/i.test(how.cmd)
  const r = spawnSync(how.cmd, how.args, { stdio: 'inherit', shell })
  if (r.status !== 0) {
    process.stderr.write(`xmas: updating ${tool} failed, carrying on with ${p.installed}\n`)
    return false
  }
  await refreshAgent(tool, bin, { force: true })
  return true
}

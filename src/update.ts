// looks for a newer xmas on github, at most once a day, and remembers what it found

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configDir } from './config.js'

const SOURCE = 'https://raw.githubusercontent.com/phoenixxlabs/xmas-cli/main/package.json'
const EVERY = 24 * 60 * 60 * 1000

// parsed json from a url, or null on any failure. a throwaway agent so no socket outlives the call
export type Fetcher = (url: string) => Promise<unknown>

export const getJson: Fetcher = (url) =>
  new Promise((resolve) => {
    const req = https.get(
      url,
      { agent: false, timeout: 4000, headers: { 'user-agent': 'xmas-cli' } },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (d) => (body += d))
        res.on('end', () => {
          try {
            resolve(res.statusCode === 200 ? JSON.parse(body) : null)
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
  })

interface Cache {
  checkedAt: number
  latest: string
}

function cacheFile(): string {
  return path.join(configDir(), 'update.json')
}

function readCache(): Cache | null {
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as Partial<Cache>
    if (typeof c.checkedAt === 'number' && typeof c.latest === 'string') return c as Cache
  } catch {
    // no cache yet
  }
  return null
}

function parse(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function isNewer(latest: string, current: string): boolean {
  const a = parse(latest)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

// switched off in the config, by env, or on a machine nobody is sitting at
export function checksAllowed(enabled: boolean): boolean {
  if (!enabled) return false
  return !process.env.XMAS_NO_UPDATE_CHECK && !process.env.CI
}

// the newer version we already know about, without touching the network
export function knownUpdate(current: string): string | null {
  const c = readCache()
  return c && isNewer(c.latest, current) ? c.latest : null
}

// asks github if the cache is stale. never throws, an offline machine just keeps the old answer
export async function refresh(force = false, fetcher: Fetcher = getJson): Promise<string | null> {
  const c = readCache()
  if (!force && c && Date.now() - c.checkedAt < EVERY) return c.latest
  try {
    const data = (await fetcher(SOURCE)) as { version?: unknown } | null
    const latest = String(data?.version ?? '')
    if (!parse(latest)) return c?.latest ?? null
    fs.mkdirSync(configDir(), { recursive: true })
    fs.writeFileSync(cacheFile(), JSON.stringify({ checkedAt: Date.now(), latest }))
    return latest
  } catch {
    return c?.latest ?? null
  }
}

// where the installed copy lives and whether it came from a git clone
export function installRoot(): { dir: string; git: boolean } {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  return { dir, git: fs.existsSync(path.join(dir, '.git')) }
}

// --xmas-update. a clone gets pulled and rebuilt, anything else is told what to run
export function selfUpdate(): number {
  const { dir, git } = installRoot()
  if (!git) {
    process.stdout.write(
      'xmas was not installed from a git clone. update it with:\n  npm install -g xmas-cli\n',
    )
    return 0
  }
  const run = (cmd: string, args: string[]): boolean => {
    const r = spawnSync(cmd, args, { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' })
    return r.status === 0
  }
  const steps: [string, string[]][] = [
    ['git', ['pull', '--ff-only']],
    ['npm', ['install', '--no-audit', '--no-fund']],
    ['npm', ['run', 'build']],
  ]
  for (const [cmd, args] of steps) {
    if (!run(cmd, args)) {
      process.stderr.write(`xmas: "${cmd} ${args.join(' ')}" failed, update stopped\n`)
      return 1
    }
  }
  return 0
}

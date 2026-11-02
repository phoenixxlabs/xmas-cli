#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Config,
  PRESET_ORDER,
  PresetName,
  configDir,
  configPath,
  readConfigFile,
  resolveConfig,
} from './config.js'
import { runHost } from './host.js'
import { createLogger } from './log.js'
import { resolveClaude } from './pty.js'
import { berry, brand, frost, ice, pine, rule, snow } from './style.js'
import { formatSessions, listSessions, sessionSince } from './sessions.js'
import { AgentName, buildAgentArgs, isAgentInteractive, resolveCodex } from './agent.js'
import { installWinter } from './settings.js'

function helpText(): string {
  const row = (cmd: string, what: string): string => `  ${ice(cmd.padEnd(26))}${frost(what)}`
  return [
    `${brand()}  ${frost('winter wrapper for Claude Code and Codex')}`,
    rule(),
    row('xmas', 'Claude, max look, permission prompts skipped'),
    row('xmas --codex', 'Codex instead (--claude to switch back)'),
    row('xmas --resume [id]', 'resume a session (--continue: latest)'),
    row('xmas sessions [--all]', 'list saved sessions and their ids'),
    '',
    row('--safe', "keep the agent's permission prompts"),
    row('--calm --festive --max', 'pick a look'),
    row('--no-snow --no-lights', 'switch single effects off'),
    row('--no-logo --band', 'hat off / greeting band on'),
    row('--sleigh', 'send the sleigh across right away'),
    row('--xmas-doctor', 'check the install (also --xmas-config, --xmas-version)'),
    rule(),
    frost(`Anything else goes to the agent; its own flags: ${ice('xmas --claude --help')}`),
    frost(`Hotkeys  ${snow('Ctrl+Alt+S')} snow · ${snow('Ctrl+Alt+L')} lights · ${snow('Ctrl+Alt+P')} look`),
    frost(`Config   ${configPath()}`),
  ].join('\n')
}

interface Parsed {
  preset?: PresetName
  agent?: AgentName
  yolo?: boolean
  resume?: true | string
  last: boolean
  sleigh: boolean
  noSnow: boolean
  noLights: boolean
  noLogo: boolean
  band: boolean
  plain: boolean
  noSettings: boolean
  logFile: string | null
  doctor: boolean
  help: boolean
  version: boolean
  showConfig: boolean
  rest: string[]
}

export function parseArgs(argv: string[]): Parsed {
  const p: Parsed = {
    sleigh: false,
    last: false,
    noSnow: false,
    noLights: false,
    noLogo: false,
    band: false,
    plain: false,
    noSettings: false,
    logFile: null,
    doctor: false,
    help: false,
    version: false,
    showConfig: false,
    rest: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--') {
      p.rest.push(...argv.slice(i + 1))
      break
    }
    if ((PRESET_ORDER as string[]).includes(a.replace(/^--/, '')) && a.startsWith('--'))
      p.preset = a.slice(2) as PresetName
    else if (a === '--claude' || a === '--codex') p.agent = a.slice(2) as AgentName
    else if (a === '--safe') p.yolo = false
    else if (a === '--yolo') p.yolo = true
    else if (a === '--continue' || a === '--last') p.last = true
    else if (a === '--resume' || a === '-r') {
      const nxt = argv[i + 1]
      if (nxt !== undefined && !nxt.startsWith('-')) ((p.resume = nxt), i++)
      else p.resume = true
    } else if (a === '--no-snow') p.noSnow = true
    else if (a === '--no-lights') p.noLights = true
    else if (a === '--no-logo') p.noLogo = true
    else if (a === '--band') p.band = true
    else if (a === '--sleigh') p.sleigh = true
    else if (a === '--xmas-plain') p.plain = true
    else if (a === '--xmas-no-settings') p.noSettings = true
    else if (a === '--xmas-doctor') p.doctor = true
    else if (a === '--xmas-config') p.showConfig = true
    else if (a === '--xmas-version') p.version = true
    else if (a === '--xmas-help') p.help = true
    else if (a === '--xmas-log') p.logFile = path.join(configDir(), 'xmas.log')
    else if (a.startsWith('--xmas-log=')) p.logFile = a.slice('--xmas-log='.length)
    else p.rest.push(a)
  }
  return p
}

export function isInteractive(rest: string[], tty: boolean, agent: AgentName = 'claude'): boolean {
  return isAgentInteractive(agent, rest, tty)
}

function pkgVersion(): string {
  try {
    const p = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    return JSON.parse(fs.readFileSync(p, 'utf8')).version as string
  } catch {
    return 'unknown'
  }
}

async function doctor(cfg: Config): Promise<number> {
  const lines: string[] = []
  const ok = (label: string, good: boolean, detail = '') =>
    lines.push(`${good ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
  ok('node', Number(process.versions.node.split('.')[0]) >= 20, process.version)
  ok('platform', true, `${process.platform} ${process.arch}`)
  try {
    await import('node-pty')
    ok('node-pty', true)
  } catch (e) {
    ok('node-pty', false, String(e))
  }
  const bin = resolveClaude(cfg.claude.bin)
  ok('claude', !!bin, bin ?? 'not found (set claude.bin in the config or XMAS_CLAUDE_BIN)')
  if (bin) {
    const v = spawnSync(bin, ['--version'], { encoding: 'utf8' })
    ok('claude --version', v.status === 0, (v.stdout || v.stderr || '').trim())
  }
  const codex = resolveCodex(cfg.codex.bin)
  ok('codex', !!codex, codex ?? 'not found (only needed for xmas --codex; set codex.bin or XMAS_CODEX_BIN)')
  if (codex) {
    const v = spawnSync(codex, ['--version'], { encoding: 'utf8' })
    ok('codex --version', v.status === 0, (v.stdout || v.stderr || '').trim())
  }
  if (process.stdout.isTTY) {
    ok(
      'terminal',
      true,
      `${process.stdout.columns}x${process.stdout.rows} TERM=${process.env.TERM ?? ''} WT_SESSION=${process.env.WT_SESSION ? 'yes' : 'no'} COLORTERM=${process.env.COLORTERM ?? ''}`,
    )
  } else {
    ok(
      'terminal',
      true,
      'not a TTY here (xmas runs claude directly when piped; run it from a terminal to see the effects)',
    )
  }
  try {
    const r = installWinter(cfg)
    ok('winter settings', true, r.settingsPath)
    ok('winter theme', fs.existsSync(r.themePath), r.themePath)
  } catch (e) {
    ok('winter settings', false, String(e))
  }
  ok(
    'config',
    true,
    fs.existsSync(configPath()) ? configPath() : `${configPath()} (not created; defaults in use)`,
  )
  process.stdout.write(`${lines.join('\n')}\n`)
  return lines.some((l) => l.startsWith('FAIL')) ? 1 : 0
}

function direct(bin: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
    const script = /\.(mjs|cjs|js)$/i.test(bin)
    const child = spawn(script ? process.execPath : bin, script ? [bin, ...args] : args, {
      stdio: 'inherit',
      shell: useShell,
    })
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
    child.on('error', (e) => {
      process.stderr.write(`xmas: cannot run ${bin}: ${e.message}\n`)
      resolve(127)
    })
  })
}

export async function main(): Promise<number> {
  const p = parseArgs(process.argv.slice(2))
  const bare =
    p.rest.length === 1 && (p.rest[0] === '--help' || p.rest[0] === '-h' || p.rest[0] === 'help') && !p.agent
  if (p.help || bare) return (process.stdout.write(`${helpText()}\n`), 0)
  if (p.version) return (process.stdout.write(`xmas ${pkgVersion()}\n`), 0)
  if (p.showConfig) return (process.stdout.write(`${configPath()}\n`), 0)

  const log = createLogger(p.logFile ?? process.env.XMAS_LOG ?? null)
  const warn = (m: string) => log(`config: ${m}`)
  const tweak = (cfg: Config): void => {
    if (p.noSnow) cfg.snow.enabled = false
    if (p.noLights) cfg.lights.enabled = false
    if (p.noLogo) cfg.logo.enabled = false
    if (p.band) cfg.band.enabled = true
    if (p.sleigh) cfg.flyby.enabled = true
  }
  const file = readConfigFile(undefined, warn)
  const filePreset = typeof (file as { preset?: unknown })?.preset === 'string'
  // xmas is festive-and-then-some by default: --max unless a flag or the config says otherwise
  const cfg = resolveConfig(file, { preset: p.preset ?? (filePreset ? undefined : 'max'), warn })
  tweak(cfg)

  if (p.doctor) return await doctor(cfg)

  const agent: AgentName = p.agent ?? cfg.agent
  if (p.rest[0] === 'sessions') {
    const all = p.rest.includes('--all')
    const ni = p.rest.findIndex((a) => a === '-n' || a === '--limit')
    const limit = ni >= 0 ? Math.max(1, Number(p.rest[ni + 1]) || 20) : 20
    for (const a of p.agent ? [p.agent] : (['claude', 'codex'] as AgentName[])) {
      const rows = listSessions({ agent: a, cwd: all ? undefined : process.cwd(), limit })
      const where = all ? 'sessions, all folders' : `sessions in ${process.cwd()}`
      process.stdout.write(
        `${brand()} ${(a === 'claude' ? berry : pine)(a)} ${frost(where)}\n${rule(60)}\n${formatSessions(rows, all)}\n` +
          `${frost(`resume with  xmas --${a} --resume <id>`)}\n\n`,
      )
    }
    if (!all) process.stdout.write(`${frost('--all for every folder, -n <count> for more')}\n`)
    return 0
  }
  const bin = agent === 'codex' ? resolveCodex(cfg.codex.bin) : resolveClaude(cfg.claude.bin)
  if (!bin) {
    process.stderr.write(
      agent === 'codex'
        ? 'xmas: could not find codex. Install Codex or set XMAS_CODEX_BIN.\n'
        : 'xmas: could not find claude. Install Claude Code or set XMAS_CLAUDE_BIN.\n',
    )
    return 127
  }

  const tty = !!(process.stdin.isTTY && process.stdout.isTTY)
  if (!isAgentInteractive(agent, p.rest, tty)) return direct(bin, p.rest)

  let settingsPath: string | null = null
  if (agent === 'claude' && cfg.claude.injectSettings && !p.noSettings) {
    try {
      settingsPath = installWinter(cfg).settingsPath
    } catch (e) {
      log(`could not install winter settings: ${String(e)}`)
    }
  }
  const args = buildAgentArgs({
    agent,
    yolo: p.yolo ?? cfg.yolo,
    resume: p.resume,
    last: p.last,
    rest: p.rest,
    settingsPath,
  })
  const started = Date.now()
  const code = await runHost({
    bin,
    args,
    cfg,
    preset: p.preset,
    tweak,
    log,
    plain: p.plain,
    agent,
    sleigh: p.sleigh,
  })
  if (tty && !p.plain) {
    try {
      const s = sessionSince(agent, process.cwd(), started - 2000)
      if (s) {
        const lab = (t: string): string => frost(t.padEnd(7))
        const title = s.title ? `${snow(s.title)}\n  ` : ''
        process.stdout.write(
          `\n${brand()} ${frost(`· ${agent} session`)}\n  ${title}${ice(s.id)}\n\n` +
            `  ${lab('resume')}${ice(`xmas --${agent} --resume ${s.id}`)}\n` +
            `  ${lab('latest')}${ice(`xmas --${agent} --continue`)}\n` +
            `  ${lab('list')}${ice(`xmas --${agent} sessions`)}\n\n`,
        )
      } else {
        // an empty session is never saved by either agent
        process.stdout.write(`\n${brand()} ${frost('· nothing to resume (no messages sent)')}\n\n`)
      }
    } catch (e) {
      log(`resume hint failed: ${String(e)}`)
    }
  }
  return code
}

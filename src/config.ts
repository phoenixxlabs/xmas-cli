import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SnowConfig } from './fx/snow.js'
import type { LightsConfig } from './fx/lights.js'
import type { LogoConfig } from './fx/logo.js'
import type { BandConfig } from './fx/frame.js'
import type { WordsConfig } from './fx/words.js'
import type { FlybyConfig } from './fx/sleigh.js'
import type { VisitConfig } from './fx/visit.js'

export type PresetName = 'calm' | 'festive' | 'max'
export const PRESET_ORDER: PresetName[] = ['calm', 'festive', 'max']

export interface Config {
  preset: PresetName
  fps: number
  snow: SnowConfig
  lights: LightsConfig
  logo: LogoConfig
  band: BandConfig
  words: WordsConfig
  flyby: FlybyConfig
  visit: VisitConfig
  // gust of snow when a turn ends
  burst: boolean
  toast: boolean
  // look for a newer xmas now and then
  updateCheck: boolean
  titlePrefix: string
  // used when neither --claude nor --codex is passed
  agent: 'claude' | 'codex'
  // skip permission prompts
  yolo: boolean
  // logo keeps codex's startup logo as a dim backdrop
  codex: { bin: string | null; logo: boolean }
  claude: {
    bin: string | null
    injectSettings: boolean
    // merged over the winter defaults
    settings: Record<string, unknown>
  }
  hotkeys: { snow: string; lights: string; preset: string; flyby: string; visit: string }
}

export const DEFAULTS: Config = {
  preset: 'festive',
  fps: 60,
  snow: {
    enabled: true,
    density: 0.011,
    wind: 1,
    clearance: 2,
    drift: true,
    glyphs: { far: '·', mid: '*', near: '✶' },
  },
  lights: { enabled: true, spacing: 7 },
  logo: { enabled: true },
  band: { enabled: false, text: 'Merry Christmas · {countdown}' },
  words: { enabled: true },
  flyby: { enabled: true, minGap: 120, maxGap: 360, items: true },
  visit: { enabled: true, minGap: 240, maxGap: 600 },
  burst: true,
  toast: true,
  updateCheck: true,
  titlePrefix: '❄ ',
  agent: 'claude',
  yolo: true,
  codex: { bin: null, logo: true },
  claude: { bin: null, injectSettings: true, settings: {} },
  hotkeys: {
    snow: 'ctrl+alt+s',
    lights: 'ctrl+alt+l',
    preset: 'ctrl+alt+p',
    flyby: 'ctrl+alt+r',
    visit: 'ctrl+alt+v',
  },
}

type Deep<T> = { [K in keyof T]?: T[K] extends object ? Deep<T[K]> : T[K] }

export const PRESETS: Record<PresetName, Deep<Config>> = {
  calm: {
    fps: 30,
    snow: { density: 0.006, wind: 0.4, drift: false },
    lights: { spacing: 9 },
    burst: false,
    flyby: { enabled: false },
    visit: { enabled: false },
  },
  festive: {},
  max: {
    fps: 60,
    snow: { density: 0.022, wind: 1.5 },
    band: { enabled: true },
  },
}

export function configDir(): string {
  return process.env.XMAS_HOME || path.join(os.homedir(), '.xmas')
}

export function configPath(): string {
  return path.join(configDir(), 'config.json')
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// copies values from src onto base, skipping keys base doesn't have and values of the wrong type
export function overlay<T>(base: T, src: unknown, warn: (m: string) => void, where = ''): T {
  if (!isObj(base) || !isObj(src)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(src)) {
    if (!(k in out)) {
      warn(`unknown option ${where}${k}`)
      continue
    }
    const cur = out[k]
    if (k === 'settings' && isObj(v))
      out[k] = v // free-form passthrough
    else if (isObj(cur) && isObj(v)) out[k] = overlay(cur, v, warn, `${where}${k}.`)
    else if (cur === null ? typeof v === 'string' || v === null : typeof v === typeof cur) out[k] = v
    else warn(`option ${where}${k} should be ${cur === null ? 'string|null' : typeof cur}`)
  }
  return out as T
}

export function resolveConfig(
  file: unknown,
  opts: { preset?: PresetName; warn?: (m: string) => void } = {},
): Config {
  const warn = opts.warn ?? (() => {})
  const filePreset = isObj(file) && typeof file.preset === 'string' ? file.preset : undefined
  const name = (opts.preset ??
    (PRESET_ORDER.includes(filePreset as PresetName) ? (filePreset as PresetName) : undefined) ??
    DEFAULTS.preset) as PresetName
  let cfg = overlay(DEFAULTS, PRESETS[name], warn)
  const rest = isObj(file) ? { ...file } : {}
  delete rest.preset
  cfg = overlay(cfg, rest, warn)
  cfg.preset = name
  if (cfg.agent !== 'claude' && cfg.agent !== 'codex') cfg.agent = 'claude'
  cfg.fps = Math.max(1, Math.min(60, Math.round(cfg.fps)))
  cfg.snow.density = Math.max(0, Math.min(0.1, cfg.snow.density))
  cfg.snow.clearance = Math.max(0, Math.min(6, Math.round(cfg.snow.clearance)))
  cfg.flyby.minGap = Math.max(10, cfg.flyby.minGap)
  cfg.flyby.maxGap = Math.max(cfg.flyby.minGap, cfg.flyby.maxGap)
  cfg.visit.minGap = Math.max(10, cfg.visit.minGap)
  cfg.visit.maxGap = Math.max(cfg.visit.minGap, cfg.visit.maxGap)
  cfg.lights.spacing = Math.max(3, Math.min(30, Math.round(cfg.lights.spacing)))
  for (const k of ['far', 'mid', 'near'] as const) {
    // has to be exactly one cell wide
    if ([...cfg.snow.glyphs[k]].length !== 1) cfg.snow.glyphs[k] = DEFAULTS.snow.glyphs[k]
  }
  return cfg
}

export function readConfigFile(file = configPath(), warn: (m: string) => void = () => {}): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warn(`config unreadable: ${String(e)}`)
    return {}
  }
}

// debounced
export function watchConfig(onChange: () => void, file = configPath()): () => void {
  let timer: NodeJS.Timeout | null = null
  let watcher: fs.FSWatcher | null = null
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    watcher = fs.watch(path.dirname(file), (_e, name) => {
      if (name && name !== path.basename(file)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(onChange, 150)
    })
  } catch {
    /* no live reload */
  }
  return () => {
    if (timer) clearTimeout(timer)
    watcher?.close()
  }
}

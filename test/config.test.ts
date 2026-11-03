import { describe, expect, it } from 'vitest'
import { DEFAULTS, resolveConfig } from '../src/config.js'
import { isInteractive, parseArgs } from '../src/cli.js'
import { buildAgentArgs } from '../src/agent.js'

describe('resolveConfig', () => {
  it('gives the festive defaults', () => {
    const c = resolveConfig({})
    expect(c.preset).toBe('festive')
    expect(c.snow.enabled).toBe(true)
    expect(c.band.enabled).toBe(false)
  })

  it('applies presets, then the user file on top', () => {
    expect(resolveConfig({ preset: 'max' }).band.enabled).toBe(true)
    expect(resolveConfig({ preset: 'calm' }).snow.drift).toBe(false)
    const c = resolveConfig({ preset: 'max', band: { enabled: false } })
    expect(c.band.enabled).toBe(false)
    expect(c.snow.density).toBeGreaterThan(DEFAULTS.snow.density)
  })

  it('lets a CLI preset beat the file preset', () => {
    expect(resolveConfig({ preset: 'max' }, { preset: 'calm' }).preset).toBe('calm')
  })

  it('warns about unknown or mistyped options and keeps defaults', () => {
    const warnings: string[] = []
    const c = resolveConfig(
      { snow: { density: 'lots', bogus: 1 }, nonsense: true },
      { warn: (m) => warnings.push(m) },
    )
    expect(c.snow.density).toBe(DEFAULTS.snow.density)
    expect(warnings.length).toBe(3)
  })

  it('clamps numbers and rejects glyphs that are not one cell', () => {
    const c = resolveConfig({ fps: 9999, snow: { density: 5, glyphs: { far: 'ab', mid: '*', near: '' } } })
    expect(c.fps).toBe(60)
    expect(c.snow.density).toBe(0.1)
    expect(c.snow.glyphs.far).toBe(DEFAULTS.snow.glyphs.far)
    expect(c.snow.glyphs.near).toBe(DEFAULTS.snow.glyphs.near)
  })

  it('does not mutate the defaults', () => {
    resolveConfig({ snow: { density: 0.05 } })
    expect(DEFAULTS.snow.density).toBe(0.011)
  })

  it('passes free-form claude settings through', () => {
    const c = resolveConfig({ claude: { settings: { editorMode: 'vim' } } })
    expect(c.claude.settings).toEqual({ editorMode: 'vim' })
  })
})

describe('cli parsing', () => {
  it('separates xmas options from claude args', () => {
    const p = parseArgs(['--calm', '--no-snow', '--model', 'opus'])
    expect(p.preset).toBe('calm')
    expect(p.noSnow).toBe(true)
    expect(p.rest).toEqual(['--model', 'opus'])
  })

  it('reads agent, yolo and resume flags', () => {
    expect(parseArgs(['--codex']).agent).toBe('codex')
    expect(parseArgs(['--claude', '--safe']).yolo).toBe(false)
    expect(parseArgs(['--resume', 'abc', '--model', 'x'])).toMatchObject({
      resume: 'abc',
      rest: ['--model', 'x'],
    })
    expect(parseArgs(['-r', '--calm']).resume).toBe(true)
    expect(parseArgs(['--continue']).last).toBe(true)
    expect(parseArgs(['--sleigh', '--calm'])).toMatchObject({ sleigh: true, rest: [] })
  })

  it('passes everything after -- to claude untouched', () => {
    expect(parseArgs(['--', '--calm']).rest).toEqual(['--calm'])
  })

  it('runs claude directly for print mode, pipes and subcommands', () => {
    expect(isInteractive([], true)).toBe(true)
    expect(isInteractive(['fix the bug'], true)).toBe(true)
    expect(isInteractive(['--resume'], true)).toBe(true)
    expect(isInteractive(['-p', 'hi'], true)).toBe(false)
    expect(isInteractive(['--version'], true)).toBe(false)
    expect(isInteractive(['mcp', 'list'], true)).toBe(false)
    expect(isInteractive(['update'], true)).toBe(false)
    expect(isInteractive([], false)).toBe(false)
  })
})

describe('agent argv', () => {
  const base = { yolo: true, last: false, rest: [] as string[] }
  it('claude: yolo, settings and resume', () => {
    expect(buildAgentArgs({ ...base, agent: 'claude', settingsPath: 'S.json', resume: 'abc' })).toEqual([
      '--settings',
      'S.json',
      '--dangerously-skip-permissions',
      '--resume',
      'abc',
    ])
    expect(buildAgentArgs({ ...base, agent: 'claude', yolo: false, last: true, rest: ['hi'] })).toEqual([
      '--continue',
      'hi',
    ])
  })
  it('codex: bypass, alt screen and the resume subcommand', () => {
    const pre = ['--dangerously-bypass-approvals-and-sandbox', '-c', 'tui.alternate_screen="always"']
    expect(buildAgentArgs({ ...base, agent: 'codex' })).toEqual(pre)
    expect(buildAgentArgs({ ...base, agent: 'codex', last: true })).toEqual([...pre, 'resume', '--last'])
    expect(buildAgentArgs({ ...base, agent: 'codex', resume: true })).toEqual([...pre, 'resume'])
    expect(buildAgentArgs({ ...base, agent: 'codex', resume: 'abc' })).toEqual([...pre, 'resume', 'abc'])
    expect(buildAgentArgs({ ...base, agent: 'codex', yolo: false, rest: ['fix it'] })[0]).toBe('-c')
  })
  it('knows which codex subcommands are not the TUI', () => {
    expect(isInteractive(['exec', 'x'], true, 'codex')).toBe(false)
    expect(isInteractive(['resume'], true, 'codex')).toBe(true)
    expect(isInteractive(['fix it'], true, 'codex')).toBe(true)
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decline, pendingAgent, refreshAgent, updateCommand, versionOf } from '../src/agentupdate.js'
import { isNewer, knownUpdate, refresh } from '../src/update.js'

let home = ''

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'xmas-upd-'))
  process.env.XMAS_HOME = home
})

afterEach(() => {
  delete process.env.XMAS_HOME
  fs.rmSync(home, { recursive: true, force: true })
})

const reply = (version: string) => async () => ({ version })

describe('xmas update check', () => {
  it('compares versions numerically', () => {
    expect(isNewer('0.10.0', '0.9.3')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('0.1.9', '0.2.0')).toBe(false)
    expect(isNewer('nonsense', '0.2.0')).toBe(false)
  })

  it('remembers the answer and reuses it for a day', async () => {
    expect(await refresh(false, reply('0.3.0'))).toBe('0.3.0')
    expect(knownUpdate('0.2.0')).toBe('0.3.0')
    expect(knownUpdate('0.3.0')).toBeNull()
    // a fresh cache means no second request
    expect(await refresh(false, reply('9.9.9'))).toBe('0.3.0')
  })

  it('keeps quiet when the network is down', async () => {
    const down = async () => null
    expect(await refresh(true, down)).toBeNull()
    expect(knownUpdate('0.2.0')).toBeNull()
  })
})

describe('agent updates', () => {
  it('reads a version out of --version output', () => {
    expect(versionOf('2.1.299 (Claude Code)')).toBe('2.1.299')
    expect(versionOf('codex-cli 0.46.0')).toBe('0.46.0')
    expect(versionOf('nothing')).toBeNull()
  })

  it('offers a newer version once, then stays quiet after a no', async () => {
    await refreshAgent('claude', 'claude', {
      force: true,
      fetcher: reply('2.2.0'),
      installed: async () => '2.1.0',
    })
    expect(pendingAgent('claude')).toEqual({ latest: '2.2.0', installed: '2.1.0' })
    decline('claude')
    expect(pendingAgent('claude')).toBeNull()
    // a later release is offered again
    await refreshAgent('claude', 'claude', {
      force: true,
      fetcher: reply('2.3.0'),
      installed: async () => '2.1.0',
    })
    expect(pendingAgent('claude')?.latest).toBe('2.3.0')
  })

  it('offers nothing when already current', async () => {
    await refreshAgent('codex', 'codex', {
      force: true,
      fetcher: reply('0.46.0'),
      installed: async () => '0.46.0',
    })
    expect(pendingAgent('codex')).toBeNull()
  })

  it('only knows how to update codex when it came from npm', () => {
    expect(updateCommand('claude', '/usr/bin/claude')?.args).toEqual(['update'])
    expect(updateCommand('codex', '/usr/lib/node_modules/@openai/codex/bin/codex.js')?.cmd).toBe('npm')
    expect(updateCommand('codex', '/opt/homebrew/bin/codex')).toBeNull()
  })
})

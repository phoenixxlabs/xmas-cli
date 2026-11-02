import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatSessions, listSessions, sessionSince } from '../src/sessions.js'

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xmas-sess-'))
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude')
  process.env.CODEX_HOME = path.join(tmp, 'codex')
})
afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  delete process.env.CODEX_HOME
  fs.rmSync(tmp, { recursive: true, force: true })
})

const write = (f: string, body: string): void => {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, body)
}

describe('sessions', () => {
  it('lists claude sessions for a directory with a title from the first prompt', () => {
    const cwd = 'C:/Work/app'
    const dir = path.join(tmp, 'claude', 'projects', 'C--Work-app')
    write(
      path.join(dir, 'aaaa.jsonl'),
      JSON.stringify({ type: 'user', cwd, message: { content: 'fix the login bug' } }) + '\n',
    )
    write(
      path.join(tmp, 'claude', 'projects', 'C--Other', 'bbbb.jsonl'),
      JSON.stringify({ type: 'user', cwd: 'C:/Other', message: { content: 'x' } }) + '\n',
    )
    const here = listSessions({ agent: 'claude', cwd })
    expect(here.map((s) => s.id)).toEqual(['aaaa'])
    expect(here[0]!.title).toBe('fix the login bug')
    expect(listSessions({ agent: 'claude' }).length).toBe(2)
    expect(formatSessions(here, false)).toContain('aaaa')
  })

  it('lists codex sessions with the index name and finds the newest since a time', () => {
    const id = '01a19643-08b8-7f80-8baf-7e7c2c713344'
    write(
      path.join(tmp, 'codex', 'sessions', '2026', '11', '01', `rollout-2026-11-01T08-38-58-${id}.jsonl`),
      JSON.stringify({
        type: 'session_meta',
        payload: { id, cwd: 'C:/Work/app', base_instructions: { text: 'x'.repeat(5000) } },
      }) + '\n',
    )
    write(
      path.join(tmp, 'codex', 'session_index.jsonl'),
      JSON.stringify({ id, thread_name: 'Add dark mode' }) + '\n',
    )
    const s = sessionSince('codex', 'c:/work/app/', Date.now() - 60000)
    expect(s).toMatchObject({ id, title: 'Add dark mode' })
    expect(sessionSince('codex', 'C:/Elsewhere', 0)).toBeNull()
    expect(sessionSince('codex', 'C:/Work/app', Date.now() + 60000)).toBeNull()
  })
})

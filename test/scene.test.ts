import { describe, expect, it } from 'vitest'
import { scanScene } from '../src/scene.js'
import { gridFrom } from './helpers.js'

const RULE = '─'.repeat(60)

describe('scanScene', () => {
  const screen = [
    ' ▐▛███▛█   Claude Code v2.1.299',
    '▝▜██████▀  Sonnet 5.5',
    ' ▝▝   ▝▝   ~/dev',
    '',
    '',
    '                             ◐ medium · /effort',
    RULE,
    '❯ Try "write a test"',
    RULE,
    '  ⏵⏵ auto mode on',
  ]

  it('finds the mascot', () => {
    const s = scanScene(gridFrom(screen, 60))
    expect(s.logo).toMatchObject({ topX: 1, y: 0, x: 0, h: 3 })
  })

  it('finds the rules and the prompt box', () => {
    const s = scanScene(gridFrom(screen, 60))
    expect(s.rules.map((r) => r.y)).toEqual([6, 8])
    expect(s.promptTop).toBe(6)
    expect(s.noSnowFromRow).toBe(7)
    expect(s.ledge[6 * 60 + 10]).toBe(1)
    expect(s.ledge[5 * 60 + 10]).toBe(0)
  })

  it('ignores short runs of box-drawing characters', () => {
    const s = scanScene(gridFrom(['──── tiny ────', ''], 60))
    expect(s.rules).toHaveLength(0)
    expect(s.noSnowFromRow).toBe(2)
  })

  it('knows when a turn is running', () => {
    const working = [
      ...screen.slice(0, 3),
      '',
      '✻ Caroling… (12s · ↑ 300 tokens · esc to interrupt)',
      ...screen.slice(5),
    ]
    expect(scanScene(gridFrom(working, 80)).working).toBe(true)
    const thinking = [...screen.slice(0, 3), '', '✶ Sleighing… (thinking)', ...screen.slice(5)]
    expect(scanScene(gridFrom(thinking, 80)).working).toBe(true)
    expect(scanScene(gridFrom(screen, 60)).working).toBe(false)
  })

  it('recognises the finished-turn line', () => {
    const done = [...screen.slice(0, 3), '', '✻ Tinseled for 19s', ...screen.slice(5)]
    const s = scanScene(gridFrom(done, 80))
    expect(s.doneLine).toBe(true)
    expect(s.working).toBe(false)
  })

  it('is empty-safe on a blank screen', () => {
    const s = scanScene(gridFrom(['', '', ''], 20))
    expect(s.logo).toBeNull()
    expect(s.promptTop).toBe(-1)
  })
})

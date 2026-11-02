import { describe, expect, it } from 'vitest'
import { DEFAULTS } from '../src/config.js'
import { Grid } from '../src/grid.js'
import { Snow } from '../src/fx/snow.js'
import { mulberry32 } from '../src/fx/rng.js'
import { scanScene } from '../src/scene.js'
import { gridFrom } from './helpers.js'

const RULE = '─'.repeat(60)
const SCREEN = [
  ' ▐▛███▛█   Claude Code v2.1.299',
  '▝▜██████▀  Sonnet 5.5',
  ' ▝▝   ▝▝   ~/dev',
  '',
  'some transcript text here that should never be touched by snow',
  '',
  '',
  '',
  '',
  RULE,
  '❯ Try something',
  RULE,
  '  footer',
]

function make(seed = 1, patch: Partial<typeof DEFAULTS.snow> = {}) {
  const base = gridFrom(SCREEN, 62)
  const scene = scanScene(base)
  const snow = new Snow({ ...DEFAULTS.snow, density: 0.03, ...patch }, mulberry32(seed))
  snow.resize(base.cols, base.rows)
  return { base, scene, snow }
}

function step(env: ReturnType<typeof make>, seconds: number, fps = 24): Grid {
  const out = new Grid(env.base.cols, env.base.rows)
  for (let t = 0; t < seconds * fps; t++) {
    out.copyFrom(env.base)
    env.snow.update(1 / fps, env.scene)
    env.snow.draw(out, env.scene)
  }
  return out
}

describe('Snow', () => {
  it('is deterministic for a seed', () => {
    const a = step(make(7), 3)
    const b = step(make(7), 3)
    expect(a.toText()).toBe(b.toText())
  })

  it('never changes a painted cell or one next to text', () => {
    const env = make(3)
    for (let n = 0; n < 200; n++) {
      const out = new Grid(env.base.cols, env.base.rows)
      out.copyFrom(env.base)
      env.snow.update(1 / 24, env.scene)
      env.snow.draw(out, env.scene)
      for (let y = 0; y < out.rows; y++) {
        for (let x = 0; x < out.cols; x++) {
          const i = y * out.cols + x
          if (out.ch[i] === env.base.ch[i]) continue
          if (env.scene.ledge[i] && '▀▘▝'.includes(out.ch[i]!)) continue // snow resting on a rule
          // any other changed cell must have been blank
          expect(env.base.isBlank(i), `(${x},${y}) overwritten`).toBe(true)
          if (out.ch[i] !== '▄') {
            // flakes keep their distance from text
            for (let d = -DEFAULTS.snow.clearance; d <= DEFAULTS.snow.clearance; d++) {
              const nx = x + d
              if (nx < 0 || nx >= out.cols) continue
              expect(env.base.isBlank(y * out.cols + nx), `flake at (${x},${y}) beside text at ${nx}`).toBe(
                true,
              )
            }
          }
        }
      }
    }
  })

  it('keeps the prompt box and footer free of flakes', () => {
    const env = make(5)
    const out = step(env, 10)
    for (let y = env.scene.noSnowFromRow; y < out.rows; y++) {
      expect(out.rowText(y)).toBe(env.base.rowText(y))
    }
  })

  it('piles drift on the ledge above the prompt and melts it later', () => {
    const env = make(11, { density: 0.05 })
    const out = step(env, 40)
    expect(env.snow.driftCount).toBeGreaterThan(0)
    const rule = out.rowText(env.scene.promptTop)
    expect(/[▀▘▝]/.test(rule)).toBe(true)
    expect(rule.replace(/[─▀▘▝]/g, '').trim()).toBe('')
    // with the sky switched off the drifts must disappear
    env.snow.cfg = { ...env.snow.cfg, drift: false }
    step(env, 120)
    expect(env.snow.driftCount).toBe(0)
  })

  it('drift only ever replaces rule cells', () => {
    const env = make(2, { density: 0.05 })
    const out = step(env, 30)
    for (let y = 0; y < out.rows; y++) {
      for (let x = 0; x < out.cols; x++) {
        const ch = out.ch[y * out.cols + x]
        if (ch === env.base.ch[y * out.cols + x]) continue // not ours
        if (ch === '▀' || ch === '▘' || ch === '▝') expect(env.scene.ledge[y * out.cols + x]).toBe(1)
        if (ch === '▄') expect(env.scene.ledge[(y + 1) * out.cols + x]).toBe(1)
      }
    }
  })

  it('draws nothing when disabled and honours density', () => {
    const off = make(1, { enabled: false })
    expect(step(off, 2).toText()).toBe(off.base.toText())
    const sparse = make(1, { density: 0.002 })
    const dense = make(1, { density: 0.04 })
    expect(dense.snow.count).toBeGreaterThan(sparse.snow.count)
  })

  it('survives a resize', () => {
    const env = make(4)
    step(env, 1)
    env.snow.resize(20, 8)
    const small = new Grid(20, 8)
    env.snow.update(0.04, scanScene(small))
    expect(() => env.snow.draw(small, scanScene(small))).not.toThrow()
  })

  it('a burst adds motion without breaking invariants', () => {
    const env = make(9)
    env.snow.burst(2)
    expect(() => step(env, 3)).not.toThrow()
  })
})

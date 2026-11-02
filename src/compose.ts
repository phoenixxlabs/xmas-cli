// Builds one output frame: child screen → (band) → skin → snow → toast.

import type { Config } from './config.js'
import type { Emulator } from './emulator.js'
import { Grid } from './grid.js'
import { drawBand } from './fx/frame.js'
import { drawLights } from './fx/lights.js'
import { drawLogo } from './fx/logo.js'
import { drawWords } from './fx/words.js'
import { Flyby } from './fx/sleigh.js'
import { Snow } from './fx/snow.js'
import { Toast } from './fx/toast.js'
import { Watermark } from './fx/watermark.js'
import type { CursorState } from './render.js'
import { Scene, emptyScene, scanScene } from './scene.js'

export interface FrameResult {
  grid: Grid
  cursor: CursorState | null
}

export class Compositor {
  readonly snow: Snow
  readonly flyby: Flyby
  readonly toast = new Toast()
  private readonly watermark = new Watermark()
  /** which CLI is being drawn; the Codex logo backdrop only applies to codex */
  agent: 'claude' | 'codex' = 'claude'
  private base = new Grid(1, 1)
  private out = new Grid(1, 1)
  private scene: Scene = emptyScene(this.out)
  private sceneVersion = -1
  private top = 0
  private t = 0
  private lastNow = 0
  private wasWorking = false
  private idleSince = 0
  /** set when a turn just finished (consumed by the host for logging/tests) */
  turnsFinished = 0
  onEvent?: (msg: string) => void

  constructor(public cfg: Config) {
    this.snow = new Snow(cfg.snow)
    this.flyby = new Flyby(cfg.flyby)
  }

  setConfig(cfg: Config): void {
    this.cfg = cfg
    this.snow.cfg = cfg.snow
    this.flyby.cfg = cfg.flyby
  }

  resize(cols: number, rows: number, top: number, childRows: number): void {
    this.top = top
    this.out = new Grid(cols, rows)
    this.base = new Grid(cols, childRows)
    this.scene = emptyScene(this.out)
    this.sceneVersion = -1
    this.snow.resize(cols, rows)
    this.flyby.resize(cols)
  }

  get currentScene(): Scene {
    return this.scene
  }

  /**
   * @param animate false freezes time (terminal blurred / safe mode)
   * @param safe true shows the child's screen untouched
   */
  render(emu: Emulator, nowMs: number, opts: { animate: boolean; safe: boolean }): FrameResult {
    const { base, out } = this
    emu.snapshot(base)
    out.clear()
    out.blit(base, this.top)
    if (this.agent === 'codex' && this.cfg.codex.logo) this.watermark.capture(out)

    const dt = this.lastNow ? (nowMs - this.lastNow) / 1000 : 0
    this.lastNow = nowMs
    if (opts.animate) this.t += dt

    const c = emu.cursor()
    const cursor: CursorState = { x: c.x, y: c.y + this.top, visible: c.visible, shape: c.shape }

    if (!opts.safe) {
      if (emu.version !== this.sceneVersion) {
        this.scene = scanScene(out)
        this.sceneVersion = emu.version
      }
      const scene = this.scene
      this.trackTurn(scene, nowMs)

      if (process.env.XMAS_FAULT_INJECT) throw new Error('injected fault')
      drawLogo(out, scene.logo, this.cfg.logo)
      drawWords(out, this.cfg.words)
      drawLights(out, scene, this.t, scene.working, this.cfg.lights)
      if (opts.animate) {
        this.flyby.update(dt, out, scene)
        this.snow.update(dt, scene)
      }
      this.flyby.draw(out, scene, this.t)
      this.snow.draw(out, scene, cursor.visible ? cursor : undefined)
      drawBand(out, 0, this.t, nowMs, this.cfg.band)
      if (this.cfg.toast) this.toast.draw(out, nowMs)
      if (this.agent === 'codex' && this.cfg.codex.logo) this.watermark.draw(out)
    }
    return { grid: out, cursor }
  }

  private trackTurn(scene: Scene, nowMs: number): void {
    if (scene.working) {
      if (!this.wasWorking) this.onEvent?.('turn started')
      this.wasWorking = true
      this.idleSince = 0
      return
    }
    if (!this.wasWorking) return
    if (!this.idleSince) this.idleSince = nowMs
    if (nowMs - this.idleSince > 400) {
      this.wasWorking = false
      this.idleSince = 0
      this.turnsFinished++
      this.onEvent?.(`turn finished (#${this.turnsFinished})`)
      if (this.cfg.burst) this.snow.burst(1.2)
      this.flyby.celebrate()
    }
  }

  /** true while something on screen keeps changing by itself */
  get isAnimated(): boolean {
    return this.cfg.snow.enabled || this.cfg.lights.enabled || this.cfg.band.enabled || this.cfg.flyby.enabled
  }
}

// ties it together: the real terminal, the compositor and the pty running the agent

import { StringDecoder } from 'node:string_decoder'
import { Compositor } from './compose.js'
import { Config, PRESET_ORDER, PresetName, readConfigFile, resolveConfig, watchConfig } from './config.js'
import { Emulator } from './emulator.js'
import type { Grid } from './grid.js'
import { InputRouter } from './input.js'
import { linkUri, openTarget } from './links.js'
import type { Logger } from './log.js'
import { ChildPty } from './pty.js'
import { Renderer } from './render.js'
import { OuterTerminal } from './terminal.js'

export interface HostOptions {
  bin: string
  args: string[]
  cfg: Config
  // preset from the command line, survives config reloads
  preset?: PresetName
  // command line toggles, applied again after every config reload
  tweak?: (cfg: Config) => void
  log: Logger
  // draw the child with no effects at all (for debugging)
  plain?: boolean
  agent?: 'claude' | 'codex'
  // fly the sleigh as soon as there's room
  sleigh?: boolean
  // have the little santa visit as soon as there's room
  visit?: boolean
  // a newer version to mention once the screen is up
  update?: string
}

const MIN_FRAME_MS = 8
const MAX_FAULTS = 3

export function runHost(opts: HostOptions): Promise<number> {
  return new Promise((resolve) => {
    const { log } = opts
    let cfg = opts.cfg
    const term = new OuterTerminal()
    const renderer = new Renderer()
    const comp = new Compositor(cfg)
    let preset: PresetName = cfg.preset
    comp.onEvent = (m) => log(m)
    comp.agent = opts.agent ?? 'claude'
    if (opts.sleigh) comp.flyby.trigger(1.5)
    if (opts.visit) comp.visit.trigger(1.5)
    if (opts.update)
      comp.toast.show(`xmas ${opts.update} is out, run xmas --xmas-update`, Date.now() + 2000, 8000)

    let finished = false
    let busy = false
    let lastGrid: Grid | null = null
    let again = false
    let faults = 0
    let safe = !!opts.plain
    let top = 0
    let frameTimer: NodeJS.Timeout | null = null
    let lastFrameAt = 0
    let frames = 0
    let frameMs = 0
    let bytesOut = 0
    let writes = 0
    let writeLagMs = 0
    let writeLagMax = 0
    let cpuMark = process.cpuUsage()
    let wallMark = Date.now()

    const layout = (): { cols: number; rows: number; top: number; childRows: number } => {
      const cols = term.cols
      const rows = term.rows
      const tiny = cols < 30 || rows < 8
      const t = !tiny && !safe && cfg.band.enabled ? 1 : 0
      return { cols, rows, top: t, childRows: Math.max(1, rows - t) }
    }

    const first = layout()
    top = first.top

    const emu = new Emulator(first.cols, first.childRows, {
      respond: (d) => pty.write(d),
      forward: (d) => term.write(d),
      log,
    })
    emu.titlePrefix = cfg.titlePrefix

    const pty = new ChildPty({ bin: opts.bin, args: opts.args, cols: first.cols, rows: first.childRows })
    log(`spawned pid ${pty.pid}: ${opts.bin} ${opts.args.join(' ')} (${first.cols}x${first.childRows})`)

    const router = new InputRouter(
      {
        hotkey: (name) => hotkey(name),
        focus: (f) => {
          // redraw straight away when the window comes back
          if (f) request()
        },
        childWantsFocus: () => emu.modes.get(1004) === true,
        linkAt: (x, y) => {
          const g = lastGrid
          if (!g || x < 0 || y < 0 || x >= g.cols || y >= g.rows) return null
          return linkUri(g.lk[y * g.cols + x]!) ?? null
        },
        open: openTarget,
        topOffset: () => top,
        childRows: () => emu.rows,
      },
      (s) => pty.write(s),
    )
    router.setHotkeys(cfg.hotkeys)

    const apply = (): void => {
      const l = layout()
      top = l.top
      if (emu.cols !== l.cols || emu.rows !== l.childRows) {
        emu.resize(l.cols, l.childRows)
        pty.resize(l.cols, l.childRows)
      }
      comp.setConfig(cfg)
      comp.resize(l.cols, l.rows, l.top, l.childRows)
      emu.titlePrefix = cfg.titlePrefix
      router.setHotkeys(cfg.hotkeys)
      renderer.invalidate()
      request()
    }

    const reloadConfig = (): void => {
      const warn = (m: string) => log(`config: ${m}`)
      cfg = resolveConfig(readConfigFile(undefined, warn), { preset: opts.preset ?? preset, warn })
      opts.tweak?.(cfg)
      preset = cfg.preset
      apply()
      log('config reloaded')
    }

    const hotkey = (name: string): void => {
      const now = Date.now()
      if (name === 'snow') {
        cfg.snow.enabled = !cfg.snow.enabled
        comp.toast.show(`snow ${cfg.snow.enabled ? 'on' : 'off'}`, now)
      } else if (name === 'lights') {
        cfg.lights.enabled = !cfg.lights.enabled
        comp.toast.show(`lights ${cfg.lights.enabled ? 'on' : 'off'}`, now)
      } else if (name === 'flyby') {
        comp.flyby.trigger()
        comp.toast.show('here they come', now)
      } else if (name === 'visit') {
        comp.visit.trigger()
        comp.toast.show('someone is at the door', now)
      } else if (name === 'preset') {
        preset = PRESET_ORDER[(PRESET_ORDER.indexOf(preset) + 1) % PRESET_ORDER.length]!
        const warn = (m: string) => log(`config: ${m}`)
        cfg = resolveConfig(readConfigFile(undefined, warn), { preset, warn })
        opts.tweak?.(cfg)
        comp.toast.show(`${preset}`, now)
        apply()
        return
      }
      comp.setConfig(cfg)
      request()
    }

    const doFrame = (): void => {
      frameTimer = null
      if (finished) return
      if (busy) {
        again = true
        return
      }
      if (emu.isSynchronizing) {
        frameTimer = setTimeout(doFrame, 16)
        return
      }
      try {
        const now = Date.now()
        const animate = !safe && (comp.isAnimated || comp.toast.active(now))
        const { grid, cursor } = comp.render(emu, now, { animate, safe })
        term.mirror(emu.modes)
        lastGrid = grid
        const bytes = renderer.frame(grid, cursor)
        lastFrameAt = now
        frames++
        frameMs += Date.now() - now
        if (bytes) {
          bytesOut += bytes.length
          busy = true
          const sentAt = Date.now()
          term.write(bytes, () => {
            busy = false
            const lag = Date.now() - sentAt
            writeLagMs += lag
            writeLagMax = Math.max(writeLagMax, lag)
            writes++
            if (again) {
              again = false
              request()
            }
          })
        }
        faults = 0
      } catch (e) {
        faults++
        log(`frame error (${faults}): ${(e as Error).stack ?? e}`)
        busy = false
        renderer.invalidate()
        if (faults >= MAX_FAULTS && !safe) {
          safe = true
          log('too many faults: effects disabled, showing plain mirror')
          apply()
        } else if (faults >= MAX_FAULTS * 3) {
          finish(1)
        }
      }
    }

    function request(): void {
      if (frameTimer || finished) return
      const wait = Math.max(0, MIN_FRAME_MS - (Date.now() - lastFrameAt))
      frameTimer = setTimeout(doFrame, wait)
    }

    const animTimer = setInterval(
      () => {
        const now = Date.now()
        if (safe) return
        if (comp.isAnimated || comp.toast.active(now)) request()
      },
      // windows timers tick about every 15.6ms, so ask for a bit under the frame time or 60fps quietly turns into 32
      Math.max(1, Math.floor(1000 / cfg.fps) - 2),
    )

    // perf line every 10s, only when logging
    const perfTimer = setInterval(() => {
      const wall = Date.now() - wallMark
      const cpu = process.cpuUsage(cpuMark)
      log(
        `perf: ${frames} frames, avg ${(frameMs / Math.max(1, frames)).toFixed(2)}ms, ${(bytesOut / 1024).toFixed(0)}KB out, ${writes} writes (lag avg ${(writeLagMs / Math.max(1, writes)).toFixed(1)}ms, max ${writeLagMax}ms), cpu ${(((cpu.user + cpu.system) / 1000 / wall) * 100).toFixed(1)}%`,
      )
      frames = 0
      frameMs = 0
      bytesOut = 0
      writes = 0
      writeLagMs = 0
      writeLagMax = 0
      cpuMark = process.cpuUsage()
      wallMark = Date.now()
    }, 10_000)
    perfTimer.unref()

    pty.onData((d) => {
      emu.write(d)
      // wait for the parser to finish this chunk
      emu.term.write('', request)
    })

    pty.onExit((code) => finish(code))

    const decoder = new StringDecoder('utf8')
    const onStdin = (b: Buffer): void => router.feed(decoder.write(b))
    process.stdin.on('data', onStdin)

    const onResize = (): void => apply()
    process.stdout.on('resize', onResize)

    const stopWatching = watchConfig(reloadConfig)

    const onSignal = (): void => finish(143)
    process.on('SIGTERM', onSignal)
    process.on('SIGHUP', onSignal)

    function finish(code: number): void {
      if (finished) return
      finished = true
      if (frameTimer) clearTimeout(frameTimer)
      clearInterval(animTimer)
      clearInterval(perfTimer)
      stopWatching()
      router.dispose()
      process.stdin.off('data', onStdin)
      process.stdout.off('resize', onResize)
      process.off('SIGTERM', onSignal)
      process.off('SIGHUP', onSignal)
      pty.kill()
      term.leave()
      emu.dispose()
      log(`exit ${code}`)
      resolve(code)
    }

    process.once('uncaughtException', (e) => {
      log(`uncaught: ${e.stack ?? e}`)
      finish(1)
      process.stderr.write(`xmas: ${e.stack ?? e}\n`)
    })

    term.enter()
    apply()
  })
}

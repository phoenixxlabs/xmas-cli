// Screenshot tool: runs xmas around a command (the real claude by default), reads the
// composed screen from a second emulator and paints it to a PNG with a monospace font.
//
//   node scripts/shot.mjs --out shots/idle.png [--args "--max"] [--cols 130] [--rows 38]
//        [--bin path] [--wait 3500] [--type "hello"] [--then 1500] [--out2 shots/after.png]
//        [--theme-home]   use the real ~/.claude (logged in) instead of an empty one

import fs from 'node:fs'
import path from 'node:path'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import nodePty from 'node-pty'
import { Emulator } from '../dist/emulator.js'
import { Grid, colorMode, colorValue, toRgb, W_TAIL } from '../dist/grid.js'

const argv = process.argv.slice(2)
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const flag = (k) => argv.includes(`--${k}`)
const root = path.resolve(import.meta.dirname, '..')
const cols = Number(opt('cols', 130))
const rows = Number(opt('rows', 38))
const out = opt('out', 'shots/shot.png')
const wait = Number(opt('wait', 4000))
const extra = (opt('args', '') || '').split(' ').filter(Boolean)

const env = { ...process.env }
for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_')) delete env[k]
if (opt('bin')) env.XMAS_CLAUDE_BIN = path.resolve(opt('bin'))
if (!flag('theme-home')) {
  env.XMAS_HOME = path.join(root, 'shots', 'home')
  env.CLAUDE_CONFIG_DIR = path.join(root, 'shots', 'home', 'claude')
}

const screen = new Emulator(cols, rows, { respond: (d) => p.write(d), forward: () => {} })
const p = nodePty.spawn(process.execPath, [path.join(root, 'dist', 'bin.js'), ...extra], {
  name: 'xterm-256color',
  cols,
  rows,
  cwd: opt('cwd', root),
  env,
})
p.onData((d) => screen.write(d))

GlobalFonts.registerFromPath('C:/Windows/Fonts/CascadiaMono.ttf', 'Cascadia Mono')
GlobalFonts.registerFromPath('C:/Windows/Fonts/seguisym.ttf', 'Segoe UI Symbol')

const CW = 11
const CH = 22
const DEF_FG = [216, 230, 242]
const DEF_BG = [11, 20, 32]

function paint(file) {
  const g = new Grid(cols, rows)
  screen.snapshot(g)
  const cv = createCanvas(cols * CW, rows * CH)
  const c = cv.getContext('2d')
  c.fillStyle = `rgb(${DEF_BG})`
  c.fillRect(0, 0, cv.width, cv.height)
  c.textBaseline = 'middle'
  const css = (rgb) => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      if (g.w[i] === W_TAIL) continue
      let fg = toRgb(g.fg[i]) ?? DEF_FG
      let bg = toRgb(g.bg[i]) ?? null
      if (g.at[i] & 32) [fg, bg] = [bg ?? DEF_BG, fg]
      const wide = g.w[i] === 1
      if (bg) {
        c.fillStyle = css(bg)
        c.fillRect(x * CW, y * CH, CW * (wide ? 2 : 1), CH)
      }
      const ch = g.ch[i]
      if (!ch || ch === ' ') continue
      c.font = `${g.at[i] & 1 ? 'bold ' : ''}${g.at[i] & 4 ? 'italic ' : ''}18px "Cascadia Mono", "Segoe UI Symbol"`
      c.globalAlpha = g.at[i] & 2 ? 0.6 : 1
      c.fillStyle = css(fg)
      c.fillText(ch, x * CW, y * CH + CH / 2 + 1)
      if (g.at[i] & 8) c.fillRect(x * CW, y * CH + CH - 3, CW, 1)
      c.globalAlpha = 1
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, cv.toBuffer('image/png'))
  console.log(`wrote ${file} (${cv.width}x${cv.height})`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(wait)
paint(out)
if (opt('type')) {
  p.write(opt('type'))
  await sleep(Number(opt('then', 1500)))
  paint(opt('out2', out.replace(/\.png$/, '-2.png')))
  if (opt('then2')) {
    await sleep(Number(opt('then2')))
    paint(opt('out3', out.replace(/\.png$/, '-3.png')))
  }
}
if (flag('dump'))
  console.log(
    new Grid(cols, rows) &&
      (() => {
        const g = new Grid(cols, rows)
        screen.snapshot(g)
        return g.toText()
      })(),
  )
try {
  p.kill()
} catch {}
process.exit(0)

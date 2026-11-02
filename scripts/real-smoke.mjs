// Real claude under xmas: reaches the prompt, accepts typing, /exit returns 0, terminal restored.
import path from 'node:path'
import nodePty from 'node-pty'
import { Emulator } from '../dist/emulator.js'
import { Grid } from '../dist/grid.js'

const root = path.resolve(import.meta.dirname, '..')
const env = { ...process.env }
for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_')) delete env[k]
const cols = 120,
  rows = 36
let raw = ''
let code = null
const screen = new Emulator(cols, rows, { respond: (d) => p.write(d), forward: () => {} })
const p = nodePty.spawn(process.execPath, [path.join(root, 'dist', 'bin.js')], {
  name: 'xterm-256color',
  cols,
  rows,
  cwd: path.join(root),
  env,
})
p.onData((d) => {
  raw += d
  screen.write(d)
})
p.onExit((e) => {
  code = e.exitCode
})
const text = () => {
  const g = new Grid(cols, rows)
  screen.snapshot(g)
  return g.toText()
}
const until = async (f, label, ms = 15000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (f()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`timeout: ${label}\n${text()}`)
}
const results = []
const check = (name, ok) => {
  results.push([name, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}
try {
  await until(() => /Try "|❯/.test(text()), 'prompt')
  check('real claude reaches its prompt under xmas', true)
  check('alternate screen active', screen.term.buffer.active.type === 'alternate')
  check('mouse tracking mirrored to the real terminal', screen.modes.get(1006) === true)
  p.write('/he')
  await until(() => text().includes('/help'), 'slash menu')
  check("typing opens claude's slash menu", true)
  p.write('\x1b') // Esc closes it
  await new Promise((r) => setTimeout(r, 400))
  p.write('\x15') // Ctrl+U clears the line
  await new Promise((r) => setTimeout(r, 200))
  p.write('/exit\r')
  await until(() => code !== null, 'exit', 20000)
  check('/exit returns exit code 0', code === 0)
  check('terminal restored (left alt screen)', screen.term.buffer.active.type === 'normal')
  check(
    'mouse modes switched off on exit',
    screen.modes.get(1006) === false || !raw.includes('?1006h') || /\x1b\[\?1006l/.test(raw),
  )
} catch (e) {
  console.log(String(e))
  check('smoke run', false)
}
try {
  p.kill()
} catch {}
process.exit(results.every(([, ok]) => ok) ? 0 : 1)

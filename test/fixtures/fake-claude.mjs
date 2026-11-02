// stand-in for claude's fullscreen ui so the wrapper can be tested without the real thing: alt
// screen, mouse, bracketed paste, focus events, a prompt box between two rules, osc 52, title and
// exit codes

const args = process.argv.slice(2)
if (args.includes('-p') || args.includes('--print')) {
  process.stdout.write(`PRINT ${args.filter((a) => a !== '-p' && a !== '--print').join(' ')}\n`)
  process.exit(0)
}

const out = (s) => process.stdout.write(s)
let typed = ''
let status = 'ready'
let working = false
let workStart = 0
let doneText = ''
const log = []

const cols = () => process.stdout.columns || 80
const rows = () => process.stdout.rows || 24

function draw() {
  const c = cols()
  const r = rows()
  const rule = '─'.repeat(c)
  let s = '\x1b[?2026h\x1b[H\x1b[2J'
  const put = (y, text) => {
    s += `\x1b[${y + 1};1H${text}`
  }
  put(0, ' \x1b[38;2;217;119;87m▐▛███▛█\x1b[0m   Claude Code v0.0.0-fake')
  put(1, '\x1b[38;2;217;119;87m▝▜██████▀\x1b[0m  Fake 1.0')
  put(2, ' \x1b[38;2;217;119;87m▝▝   ▝▝\x1b[0m   ~\\fixtures')
  put(4, `status: ${status}`)
  put(5, `args: ${args.join(' ')}`)
  put(6, `size ${c}x${r}`)
  put(8, 'The quick brown fox jumps over the lazy dog. 好 世界 ✻ é')
  if (working) put(10, `✻ Caroling… (${Math.floor((Date.now() - workStart) / 1000)}s · esc to interrupt)`)
  else if (doneText) put(10, doneText)
  const boxTop = r - 4
  put(boxTop - 1, `${' '.repeat(Math.max(0, c - 22))}◐ medium · /effort`)
  put(boxTop, rule)
  put(boxTop + 1, `❯ ${typed || 'Try "write a test"'}`)
  put(boxTop + 2, rule)
  put(boxTop + 3, '  ⏵⏵ auto mode on (shift+tab to cycle)')
  s += `\x1b[${boxTop + 2};${3 + [...typed].length}H\x1b[?2026l`
  out(s)
}

// ConPTY only forwards mouse/cursor-key modes once stdin is raw, so do that first (as claude does)
process.stdin.setRawMode?.(true)
process.stdin.resume()
out('\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?2004h\x1b[?1004h\x1b]0;fake claude\x07')
draw()

function quit(code) {
  out('\x1b[?1004l\x1b[?2004l\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1049l')
  process.exit(code)
}

process.stdout.on('resize', draw)
process.stdin.setEncoding('utf8')

setInterval(() => {
  if (!working) return
  if (Date.now() - workStart > 1800) {
    working = false
    doneText = '✻ Baked for 1s'
  }
  draw()
}, 200)

let pasting = false
let pasteBuf = ''
process.stdin.on('data', (d) => {
  for (let i = 0; i < d.length;) {
    if (d.startsWith('\x1b[200~', i)) {
      pasting = true
      pasteBuf = ''
      i += 6
      continue
    }
    if (pasting) {
      const end = d.indexOf('\x1b[201~', i)
      if (end < 0) {
        pasteBuf += d.slice(i)
        i = d.length
      } else {
        pasteBuf += d.slice(i, end)
        pasting = false
        status = `paste:${pasteBuf.length}:${JSON.stringify(pasteBuf)}`
        i = end + 6
      }
      continue
    }
    const m = /^\x1b\[<(\d+;\d+;\d+[Mm])/.exec(d.slice(i))
    if (m) {
      status = `mouse ${m[1]}`
      i += m[0].length
      continue
    }
    if (d.startsWith('\x1b[I', i)) {
      status = 'focus in'
      i += 3
      continue
    }
    if (d.startsWith('\x1b[O', i)) {
      status = 'focus out'
      i += 3
      continue
    }
    if (d.startsWith('\x1b[', i)) {
      const mm = /^\x1b\[[0-9;]*[A-Za-z~]/.exec(d.slice(i))
      status = `key ${JSON.stringify(mm ? mm[0] : '\x1b[')}`
      i += mm ? mm[0].length : 2
      continue
    }
    const ch = d[i]
    i++
    if (ch === '\x03') quit(130)
    else if (ch === '\x19') out('\x1b]52;c;aGVsbG8=\x07')
    else if (ch === '\x1b') status = 'esc'
    else if (ch === '\r') {
      if (typed === '/exit') quit(7)
      if (typed === '/work') {
        working = true
        doneText = ''
        workStart = Date.now()
      }
      status = `submitted:${typed}`
      typed = ''
    } else if (ch === '\x7f') typed = typed.slice(0, -1)
    else typed += ch
  }
  draw()
})

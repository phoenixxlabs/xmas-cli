// claude's finished-turn line ("✻ Churned for 2s · done 10:37") takes its word from a list that no
// setting reaches, so we swap in the winter word on screen

import { Grid } from '../grid.js'

export interface WordsConfig {
  enabled: boolean
}

export const PAST_TENSE = [
  'Sleighed',
  'Caroled',
  'Wrapped',
  'Frosted',
  'Tinseled',
  'Mulled',
  'Trimmed',
  'Toasted',
  'Gingerbreaded',
  'Snowed',
]

const GLYPHS = new Set('✻✽✶✳✢✺·*')
const isLetter = (c: string) => /^\p{L}$/u.test(c)

function hash(s: string): number {
  let n = 0
  for (const ch of s) n = (n * 31 + ch.charCodeAt(0)) >>> 0
  return n
}

// returns how many rows changed
export function drawWords(g: Grid, cfg: WordsConfig): number {
  if (!cfg.enabled) return 0
  let changed = 0
  for (let y = 0; y < g.rows; y++) {
    const row = y * g.cols
    let x = 0
    while (x < g.cols && g.ch[row + x] === ' ') x++
    if (x >= g.cols || !GLYPHS.has(g.ch[row + x]!)) continue
    x++
    if (g.ch[row + x] !== ' ') continue
    while (x < g.cols && g.ch[row + x] === ' ') x++
    const start = x
    while (x < g.cols && isLetter(g.ch[row + x]!)) x++
    const end = x
    if (end - start < 3) continue
    // the verb has to be followed by ' for <duration>'
    let tail = ''
    for (let k = end; k < g.cols; k++) tail += g.ch[row + k] || ' '
    if (!/^ for \d+(?:h \d+m|m \d+s|s)\b/.test(tail)) continue
    const old = Array.from({ length: end - start }, (_, k) => g.ch[row + start + k]).join('')
    if (!/^\p{Lu}/u.test(old)) continue

    const word = PAST_TENSE[hash(tail) % PAST_TENSE.length]!
    const delta = word.length - (end - start)
    const rest = {
      ch: g.ch.slice(row + end, row + g.cols),
      fg: g.fg.slice(row + end, row + g.cols),
      bg: g.bg.slice(row + end, row + g.cols),
      at: g.at.slice(row + end, row + g.cols),
    }
    const fg = g.fg[row + start]!
    const bg = g.bg[row + start]!
    const at = g.at[row + start]!
    for (let k = 0; k < word.length && start + k < g.cols; k++) g.set(start + k, y, word[k]!, fg, bg, at)
    for (let k = 0; k < rest.ch.length; k++) {
      const nx = end + delta + k
      if (nx >= g.cols) break
      g.set(nx, y, rest.ch[k]!, rest.fg[k]!, rest.bg[k]!, rest.at[k]!)
    }
    for (let nx = g.cols - Math.max(0, -delta); delta < 0 && nx < g.cols; nx++) g.set(nx, y, ' ')
    changed++
  }
  return changed
}

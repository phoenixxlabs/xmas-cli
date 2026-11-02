// Reads Claude's screen for the few landmarks the effects care about. Everything here is
// advisory: if Claude's UI changes and a landmark isn't found, that effect simply idles.

import { Grid } from './grid.js'

export interface Rule {
  y: number
  x0: number
  x1: number // exclusive
}

export interface LogoHit {
  /** column of the mascot's top row start */
  topX: number
  y: number
  x: number
  w: number
  h: number
}

export interface Scene {
  rules: Rule[]
  /** 1 on every cell of a horizontal rule (snow settles on the row above) */
  ledge: Uint8Array
  /** row of the prompt box's upper rule, or -1 */
  promptTop: number
  /** rows at or below this are kept free of snow (the prompt box and footer) */
  noSnowFromRow: number
  logo: LogoHit | null
  working: boolean
  doneLine: boolean
}

export interface SceneConfig {
  logoRows: string[]
  minRule: number
}

export const DEFAULT_SCENE_CONFIG: SceneConfig = {
  logoRows: ['▐▛███▛█', '▝▜██████▀', '▝▝   ▝▝'],
  minRule: 20,
}

const SPINNER_GLYPHS = '✻✽✶✳✢✺·*'
const WORKING_LINE = new RegExp(`^\\s*[${SPINNER_GLYPHS}]\\s+\\S[^\\n]*…`)
const DONE_LINE = new RegExp(`^\\s*[${SPINNER_GLYPHS}]\\s+\\S.*\\bfor \\d+(?:h \\d+m|m \\d+s|s)\\b`)

export function emptyScene(g: Grid): Scene {
  return {
    rules: [],
    ledge: new Uint8Array(g.cols * g.rows),
    promptTop: -1,
    noSnowFromRow: g.rows,
    logo: null,
    working: false,
    doneLine: false,
  }
}

export function scanScene(g: Grid, cfg: SceneConfig = DEFAULT_SCENE_CONFIG): Scene {
  const scene = emptyScene(g)
  const { cols, rows } = g

  // horizontal rules
  for (let y = 0; y < rows; y++) {
    let x = 0
    while (x < cols) {
      if (g.ch[y * cols + x] !== '─') {
        x++
        continue
      }
      const x0 = x
      while (x < cols && g.ch[y * cols + x] === '─') x++
      if (x - x0 >= cfg.minRule) {
        scene.rules.push({ y, x0, x1: x })
        for (let k = x0; k < x; k++) scene.ledge[y * cols + k] = 1
      }
    }
  }

  // prompt box = the last one or two near-full-width rules
  const wide = scene.rules.filter((r) => r.x1 - r.x0 >= cols * 0.9)
  if (wide.length >= 2) {
    const bottom = wide[wide.length - 1]!
    const top = wide[wide.length - 2]!
    scene.promptTop = bottom.y - top.y <= 14 ? top.y : bottom.y
  } else if (wide.length === 1) {
    const only = wide[0]!
    scene.promptTop = rows - only.y <= 4 ? only.y - 2 : only.y
    if (scene.promptTop < 0) scene.promptTop = only.y
  }
  if (scene.promptTop < 0) {
    // codex has no rules: its composer is the bottom-most line that starts with a '›' prompt
    for (let y = rows - 1; y >= Math.max(0, rows - 12); y--) {
      if (g.rowText(y).trimStart().startsWith('›')) {
        scene.promptTop = Math.max(0, y - 1)
        break
      }
    }
  }
  scene.noSnowFromRow = scene.promptTop >= 0 ? scene.promptTop + 1 : rows

  // text landmarks
  const [r0, r1] = cfg.logoRows
  for (let y = 0; y < rows; y++) {
    const text = g.rowText(y)
    if (!scene.logo && r0 && r1 && y + 1 < rows) {
      const t = text.indexOf(r0)
      if (t >= 0) {
        const next = g.rowText(y + 1)
        const m = next.indexOf(r1)
        if (m >= 0 && Math.abs(m - t) <= 2) {
          const x = Math.min(t, m)
          scene.logo = {
            topX: t,
            y,
            x,
            w: Math.max(t + r0.length, m + r1.length) - x,
            h: cfg.logoRows.length,
          }
        }
      }
    }
    if (text.includes('esc to interrupt') || WORKING_LINE.test(text)) scene.working = true
    else if (DONE_LINE.test(text)) scene.doneLine = true
  }
  return scene
}

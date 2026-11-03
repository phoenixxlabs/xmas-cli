import { describe, expect, it } from 'vitest'
import { Emulator } from '../src/emulator.js'
import { Grid } from '../src/grid.js'
import { InputRouter } from '../src/input.js'
import { applyLinks, linkId, linkUri, scanLinks } from '../src/links.js'
import { Renderer } from '../src/render.js'

const ST = '\x1b\\'

function linked(g: Grid, y: number, x: number): string | undefined {
  return linkUri(g.lk[y * g.cols + x]!)
}

describe('link scan', () => {
  it('links urls and drops trailing punctuation', () => {
    const g = new Grid(80, 4)
    g.text(2, 1, 'see https://example.com/docs/page. for more')
    applyLinks(g, scanLinks(g))
    expect(linked(g, 1, 8)).toBe('https://example.com/docs/page')
    expect(linked(g, 1, 2)).toBeUndefined()
    expect(g.lk[1 * 80 + 8 + 29]).toBe(0)
  })

  it('joins a url that wraps onto the next row', () => {
    const g2 = new Grid(34, 3)
    g2.text(0, 0, 'go to https://example.com/very/lo')
    g2.text(2, 1, 'ng/path?x=1 and back')
    applyLinks(g2, scanLinks(g2))
    expect(linked(g2, 0, 10)).toBe('https://example.com/very/long/path?x=1')
    expect(linked(g2, 1, 3)).toBe('https://example.com/very/long/path?x=1')
    expect(linked(g2, 1, 20)).toBeUndefined()
  })

  it('links files that exist and ignores slash commands and missing paths', () => {
    const g = new Grid(80, 4)
    g.text(0, 0, 'edited package.json:12 and /model plus src/nothing/here.ts')
    applyLinks(g, scanLinks(g, process.cwd()))
    expect(linked(g, 0, 10)?.startsWith('file:')).toBe(true)
    expect(linked(g, 0, 10)?.endsWith('/package.json')).toBe(true)
    expect(linked(g, 0, 31)).toBeUndefined()
    expect(linked(g, 0, 50)).toBeUndefined()
  })

  it('leaves cells that already carry a link alone', () => {
    const g = new Grid(60, 2)
    g.text(0, 0, 'https://example.com/original')
    const own = linkId('https://other.example/own')
    for (let x = 0; x < 28; x++) g.lk[x] = own
    applyLinks(g, scanLinks(g))
    expect(linked(g, 0, 5)).toBe('https://other.example/own')
  })
})

describe('renderer links', () => {
  it('wraps linked cells in osc 8 and closes the link', () => {
    const g = new Grid(20, 2)
    g.text(0, 0, 'abc')
    const id = linkId('https://example.com/x')
    for (let x = 0; x < 3; x++) g.lk[x] = id
    const out = new Renderer().frame(g, null)
    expect(out).toContain(`\x1b]8;id=x${id};https://example.com/x\x1b\\abc`)
    expect(out).toContain('\x1b]8;;\x1b\\')
  })
})

describe('ctrl+click', () => {
  function router(uri: string | null) {
    const sent: string[] = []
    const opened: string[] = []
    const r = new InputRouter(
      {
        hotkey: () => {},
        focus: () => {},
        childWantsFocus: () => false,
        topOffset: () => 0,
        childRows: () => 30,
        linkAt: () => uri,
        open: (u) => opened.push(u),
      },
      (s) => sent.push(s),
      10,
    )
    return { r, sent, opened }
  }

  it('opens the link and hides the click from the agent', () => {
    const { r, sent, opened } = router('https://example.com')
    r.feed('\x1b[<16;5;3M\x1b[<16;5;3m')
    expect(opened).toEqual(['https://example.com'])
    expect(sent.join('')).toBe('')
  })

  it('passes ordinary clicks and ctrl+clicks off a link through', () => {
    const a = router('https://example.com')
    a.r.feed('\x1b[<0;5;3M\x1b[<0;5;3m')
    expect(a.opened).toEqual([])
    expect(a.sent.join('')).toBe('\x1b[<0;5;3M\x1b[<0;5;3m')
    const b = router(null)
    b.r.feed('\x1b[<16;5;3M')
    expect(b.sent.join('')).toBe('\x1b[<16;5;3M')
  })
})

describe('emulator links', () => {
  it('keeps osc 8 links from the agent', async () => {
    const emu = new Emulator(40, 3, { respond: () => {}, forward: () => {} })
    await new Promise<void>((done) => {
      emu.term.write(`\x1b]8;;https://example.com/a${ST}click\x1b]8;;${ST} here`, done)
    })
    const g = new Grid(40, 3)
    emu.snapshot(g)
    expect(linked(g, 0, 0)).toBe('https://example.com/a')
    expect(linked(g, 0, 4)).toBe('https://example.com/a')
    expect(linked(g, 0, 6)).toBeUndefined()
    emu.dispose()
  })
})

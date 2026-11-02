# How xmas works

xmas sits between your terminal and the agent. It never patches or forks Claude Code or Codex (Claude
is a closed native binary that updates itself); it owns every cell that reaches the glass instead.

```
 keyboard / mouse ─▶ input router ────────────────▶ pty ▶ claude / codex
                          │ hotkeys, mouse row shift        │ VT output
                          ▼                                 ▼
                    toast / config                  headless xterm
                                                            │ cell grid + modes
                                                            ▼
 real terminal ◀─ renderer (cell diff) ◀─ compositor (skin, snow, lights)
```

## The loop

1. The agent writes escape sequences into a ConPTY (`node-pty`).
2. `@xterm/headless` parses them into a grid of cells, and tracks the terminal modes the agent asks for.
3. The compositor copies the grid and draws the winter layer on the copy.
4. The renderer diffs the copy against what the terminal already shows and writes only the changes,
   wrapped in synchronized-output markers so a frame lands atomically.

Child output renders on the leading edge (so typing never waits on the animation timer); the timer only
adds frames while something is actually moving.

## Source layout

| File          | Job                                                                            |
| ------------- | ------------------------------------------------------------------------------ |
| `cli.ts`      | argument parsing, passthrough decisions, `sessions`, `--xmas-doctor`           |
| `agent.ts`    | claude vs codex: argv building (yolo, resume), binary lookup                   |
| `host.ts`     | the orchestrator: outer tty, pty, frame loop, resize, shutdown, fault fallback |
| `pty.ts`      | thin node-pty wrapper and the claude lookup                                    |
| `emulator.ts` | headless xterm: grid snapshots, mode tracking, OSC forwarding, query replies   |
| `grid.ts`     | typed-array cell grid and colour packing                                       |
| `render.ts`   | grid diff to minimal ANSI                                                      |
| `terminal.ts` | entering/leaving the alternate screen, mirroring input modes                   |
| `input.ts`    | stdin tokenizer: hotkeys, paste, focus, mouse row shifting                     |
| `scene.ts`    | finds the landmarks on screen (rules, prompt box, logo, working/idle)          |
| `compose.ts`  | builds one frame from the pieces above                                         |
| `fx/*`        | the effects: snow, lights, logo, words, band, toast                            |
| `sessions.ts` | reads both agents' session stores for `xmas sessions` and the exit hint        |
| `config.ts`   | defaults, presets, validation, hot reload                                      |
| `settings.ts` | the `--settings` file that gives Claude the winter theme                       |

## Decisions worth knowing

- **Re-render instead of forwarding.** The agent's escape output is not passed through; the grid is
  redrawn. That is the only way to be sure our layer is on top and nothing tears.
- **Fullscreen only.** The compositor sees one viewport, so Claude is told `tui: fullscreen` (and Codex
  is kept on its alternate screen) so the agent owns scrolling and nothing is lost to scrollback.
- **Scene detection is advisory.** If a landmark isn't found the matching effect just idles. A UI
  change in the agent can cost a flourish, never break the session.
- **Snow respects the screen.** Flakes only land in blank cells with horizontal clearance, and the
  prompt box and footer stay still. Flakes that reach a rule settle as drifts drawn _on_ the rule, since
  a glyph in the row above floats half a cell off the line.
- **Effects are pure** functions of the scene, the clock and a seeded RNG, which keeps tests exact.
- **Settings come from a file.** `--settings <file>` avoids Windows JSON quoting problems, and only
  sessions started through xmas see the winter theme.
- **Failure degrades to a mirror.** After three faults in the effect layer the host stops drawing it and
  mirrors the agent plainly. Print mode, pipes and agent subcommands skip the wrapper entirely.

## Gotchas found along the way

- ConPTY ignores mouse and cursor-key mode requests until the program's stdin is raw, so xmas enters
  raw mode before it mirrors any mode.
- Claude's finished-turn word ("Churned") is not covered by `spinnerVerbs`; xmas swaps it on screen.
- Emulator and terminal can disagree about the width of emoji and CJK, so snow never overlaps a
  non-blank cell and wide characters are handled as a pair in the renderer.
- Codex does not save a session until a message is sent, so quitting an empty one leaves nothing to
  resume.

## Tests

- `grid` and `render`: randomized round trips (grid to ANSI to xterm to grid), wide chars and colours.
- `input`: split sequences, paste isolation, hotkeys, mouse shifting, a lone ESC.
- `scene`, `snow`, `words`, `config`, `sessions`: unit tests on fixtures.
- `e2e`: xmas inside a nested ConPTY around `test/fixtures/fake-claude.mjs`, with assertions made on the
  outer screen. These need Windows.
- `scripts/real-smoke.mjs` runs the real `claude` under xmas; `scripts/shot.mjs` renders a PNG of the
  composed screen, which is the way to judge how a change looks.

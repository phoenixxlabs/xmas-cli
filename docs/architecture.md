# How xmas works

xmas sits between your terminal and Claude Code or Codex. It doesn't patch either of them (Claude
is a closed native binary that updates itself). Instead it runs the real thing in a pseudo-terminal
and draws every cell that reaches your screen.

```
 keyboard / mouse -> input router ----------------> pty -> claude / codex
                          |                                   |
                     hotkeys, mouse                     VT output
                                                              |
                                                       headless xterm
                                                              |
 real terminal <- renderer (cell diff) <- compositor <- cell grid
```

Output from the agent goes through `node-pty` (ConPTY on Windows) into `@xterm/headless`, which gives
us a grid of cells and the terminal modes the agent switched on. The compositor copies that grid and
draws the winter bits on the copy. The renderer then compares the copy with what the terminal already
shows and writes only the cells that changed, wrapped in synchronized-output markers so a frame lands
in one piece.

Output from the agent is drawn right away, so typing never waits on the animation timer. The timer
only adds frames while something is moving.

## Source

- `cli.ts` parses arguments, decides when to skip the wrapper, and handles `sessions` and `--xmas-doctor`.
- `agent.ts` knows the difference between claude and codex: building the argv (yolo, resume) and finding the binary.
- `host.ts` ties everything together: the terminal, the pty, the frame loop, resizing and shutdown.
- `pty.ts`, `emulator.ts`, `grid.ts`, `render.ts`, `terminal.ts` and `input.ts` are the terminal plumbing.
- `scene.ts` finds the landmarks on screen (rules, prompt box, logo, working or idle).
- `compose.ts` builds a frame, and `fx/` has the effects: snow, lights, logo, words, band, toast, the sleigh, the visitor and the Codex logo backdrop.
- `sessions.ts` reads both agents' saved sessions for `xmas sessions` and the exit hint.
- `config.ts` and `settings.ts` cover the config file and the settings file handed to Claude.

## Choices that aren't obvious

The agent's own escape output is never passed through. The grid is redrawn instead, because that's the
only way to be sure our layer is on top and nothing tears.

We only ever see one viewport, so Claude is started with `tui: fullscreen` and Codex is kept on its
alternate screen. That way the agent handles scrolling and nothing is lost to scrollback.

Finding things on screen is best effort. If the agent's UI changes and a landmark goes missing, that
effect goes quiet. It should never break the session.

Snow only lands in blank cells with some room either side, and the prompt box and footer stay still.
Flakes that reach one of Claude's rules settle as drifts drawn on the rule itself, because a glyph in
the row above floats half a cell off the line. The sleigh, the visitor and the Codex logo follow the
same rule of only touching blank cells.

The effects are plain functions of the scene, the clock and a seeded random generator, which keeps the
tests exact.

The settings for Claude go in through `--settings <file>`. A file avoids the quoting problems JSON has
on Windows, and only sessions started through xmas get the winter theme.

If the effect layer fails three times in a row, the host stops drawing it and mirrors the agent as is.
Print mode, pipes and the agent's own subcommands never go through the wrapper.

## Things we ran into

- ConPTY ignores mouse and cursor-key mode requests until the program's stdin is raw, so xmas goes raw before it mirrors any mode.
- Claude's finished-turn word ("Churned") isn't covered by `spinnerVerbs`, so it's swapped on screen.
- The emulator and the terminal can disagree on how wide emoji and CJK are. Snow never overlaps a non-blank cell, and wide characters are written as a pair.
- Windows timers tick about every 15.6 ms, so a 17 ms interval fires every 31 ms. The frame timer asks for a little less than the frame time.
- A stream of colour changes slows terminals down, so the light bulbs change in a few coarse steps instead of fading.
- Codex doesn't save a session until you send a message, so quitting an empty one leaves nothing to resume.

## Tests

`npm test` runs unit tests for the grid and renderer (a random round trip through xterm), the input
parser, the scene scan, the snow, the words, the config, sessions, the sleigh, the visitor and the
logo backdrop. The end-to-end tests run xmas inside a nested ConPTY around `test/fixtures/fake-claude.mjs`
and check the outer screen, so they need Windows.

`scripts/real-smoke.mjs` runs the real `claude` under xmas, and `scripts/shot.mjs` writes a PNG of the
composed screen, which is the easiest way to judge how a change looks.

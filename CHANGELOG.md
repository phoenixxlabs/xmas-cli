# Changelog

## Unreleased

- A sleigh and reindeer fly across the screen now and then (`flyby` in the config, `Ctrl+Alt+R` to call them).

## 0.2.0

- Codex support: `xmas --codex`, with `--claude` to switch back and an `agent` config key for the default.
- The default look is now `--max`.
- Permission prompts are skipped by default (`--safe` or `"yolo": false` turns it off).
- `--resume [id]`, `--continue` and `--last` work for both agents.
- `xmas sessions [--all] [-n N]` lists saved sessions with their ids.
- On exit, xmas prints the session id and the commands to resume it.
- A shorter, coloured `--help`.
- Animation keeps running while the window is unfocused.

## 0.1.0

- First version: Claude Code inside a pseudo-terminal with snow, lights, a Santa-hat mascot, winter
  words and an optional top band.

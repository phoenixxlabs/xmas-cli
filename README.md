# xmas

Snow, lights and a Santa hat for [Claude Code](https://claude.com/claude-code) and
[Codex](https://github.com/openai/codex).

`xmas` runs the real CLI inside a pseudo-terminal, reads its screen, paints a winter layer on top and
writes the result to your terminal. Neither tool is modified, so updates keep working and plain
`claude` / `codex` are untouched.

```
xmas                  # Claude Code
xmas --codex          # Codex
xmas --resume         # pick a session to resume
xmas sessions         # list sessions and their ids
```

## Install

Needs Node 20+ and the CLI you want to wrap. Windows is the tested platform (ConPTY); the code is
portable but unverified elsewhere.

```
git clone https://github.com/phoenixxlabs/xmas-cli.git && cd xmas-cli
npm install
npm link
xmas --xmas-doctor
```

`--xmas-doctor` checks node-pty, finds both CLIs and reports what it would run.

## Usage

| Command                 | What it does                                           |
| ----------------------- | ------------------------------------------------------ |
| `xmas`                  | Claude Code, max look, permission prompts skipped      |
| `xmas --codex`          | Codex instead (`--claude` switches back)               |
| `xmas --resume [id]`    | Resume a session, with a picker when no id is given    |
| `xmas --continue`       | Continue the most recent session (`--last` also works) |
| `xmas sessions [--all]` | List saved sessions; `--all` covers every folder       |
| `xmas --safe`           | Keep the agent's own permission prompts                |
| `xmas --calm`           | A quieter look (`--festive` sits in between)           |

"Skipping permission prompts" means `claude --dangerously-skip-permissions` and
`codex --dangerously-bypass-approvals-and-sandbox`. That is a real trade-off: use `--safe`, or set
`"yolo": false` in the config, if you want the prompts back.

Anything xmas doesn't recognise is passed to the agent, so `xmas --model opus "fix the tests"` works.
Print mode (`-p`), pipes and the agent's own subcommands (`mcp`, `exec`, `update`, ...) run the agent
directly with no wrapper. When a session ends, xmas prints its id and the commands to resume it.

## What you get

- **Snow** falls in empty space only: never over text, never in the prompt box. Flakes that reach one of
  Claude's rules settle into small drifts and melt.
- **Lights** string along Claude's rules and chase while a turn is running.
- **Mascot** gets a red coat and a Santa hat.
- **Words**: spinner verbs, tips and the finished-turn line are swapped for winter ones.
- **Sleigh**: every few minutes (and sometimes when a turn finishes) a sleigh and reindeer fly through empty rows, dropping the odd gift, carrot and cookie. They only use blank cells, so they never cover text. Off in the `--calm` look.
- **Band** (the `--max` look): a greeting and countdown across the top row.

Hotkeys while running: `Ctrl+Alt+S` snow, `Ctrl+Alt+L` lights, `Ctrl+Alt+P` cycle the look, `Ctrl+Alt+R` call the sleigh now.

## Config

`~/.xmas/config.json`, reloaded while xmas is running. Unknown keys are ignored and logged.

```json
{
  "preset": "max",
  "agent": "claude",
  "yolo": true,
  "snow": { "enabled": true, "density": 0.011, "wind": 1 },
  "lights": { "enabled": true, "spacing": 7 },
  "claude": { "bin": null, "settings": {} },
  "codex": { "bin": null }
}
```

`claude.settings` is merged over the winter settings xmas hands to Claude, for example
`{ "editorMode": "vim" }`. `XMAS_CLAUDE_BIN` and `XMAS_CODEX_BIN` override which binary is run.
`xmas --xmas-config` prints the file path.

## Known limits

- OSC 8 hyperlinks are not re-emitted, so file links in Claude are not clickable inside xmas.
- Kitty keyboard and graphics protocols are not passed through.
- Codex has no horizontal rules or mascot, so it gets snow and the band but no lights or hat.
- Hotkeys are Alt-based; rebind them in the config if your terminal claims them.

## Development

```
npm run build        # tsc -> dist/
npm test             # unit tests plus end-to-end runs through nested ConPTYs
npm run typecheck
npm run format
node scripts/real-smoke.mjs                              # the real claude under xmas
node scripts/shot.mjs --out shots/a.png --args "--calm"  # PNG of the composed screen
```

How it works is written up in [docs/architecture.md](docs/architecture.md); contributing notes are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

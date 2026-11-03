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
| `xmas --sleigh`         | Send the sleigh across right away                      |
| `xmas --santa`          | Have the little Santa visit right away                 |
| `xmas --calm`           | A quieter look (`--festive` sits in between)           |

"Skipping permission prompts" means `claude --dangerously-skip-permissions` and
`codex --dangerously-bypass-approvals-and-sandbox`. That is a real trade-off: use `--safe`, or set
`"yolo": false` in the config, if you want the prompts back.

Anything xmas doesn't recognise is passed to the agent, so `xmas --model opus "fix the tests"` works.
Print mode (`-p`), pipes and the agent's own subcommands (`mcp`, `exec`, `update`, ...) run the agent
directly with no wrapper. When a session ends, xmas prints its id and the commands to resume it.

## What you get

Snow falls in empty space only, never over text and never in the prompt box. Flakes that reach one of
Claude's rules settle into small drifts and melt. Lights run along the same rules and chase while a
turn is running. The mascot gets a red coat and a Santa hat, and the spinner verbs, tips and the
finished-turn line are swapped for winter ones. The `--max` look adds a greeting and countdown across
the top row.

A few things happen now and then:

- A sleigh and reindeer fly through the highest empty rows, dropping presents. This happens every few
  minutes and sometimes when a turn finishes. It's off in the `--calm` look.
- A small Santa walks along the bottom to one treat left out for him (cookies, milk, cocoa or the
  reindeer's carrot), finishes it, says thanks and leaves a present. It's a different treat each time.
  `xmas --santa` calls him straight away.
- Codex wipes its startup logo after a couple of seconds. xmas keeps a dim copy behind everything, so
  the snow and the sleigh pass in front of it. Set `"codex": { "logo": false }` to turn that off.

Everything here only paints blank cells, so none of it covers text.

Hotkeys while running: `Ctrl+Alt+S` snow, `Ctrl+Alt+L` lights, `Ctrl+Alt+P` cycle the look, `Ctrl+Alt+R` call the sleigh now, `Ctrl+Alt+V` call the visitor.

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
  "codex": { "bin": null, "logo": true }
}
```

`claude.settings` is merged over the winter settings xmas hands to Claude, for example
`{ "editorMode": "vim" }`. `XMAS_CLAUDE_BIN` and `XMAS_CODEX_BIN` override which binary is run.
`xmas --xmas-config` prints the file path.

## Updates

Once a day xmas looks up the newest versions of itself, Claude Code and Codex. When one is behind you
get a note in the corner of the screen and again when you quit, and `xmas --xmas-update` pulls the
latest xmas and rebuilds it. If Claude or Codex is behind, xmas asks `update now? [y/N]` before it
starts the agent. Nothing is installed without a yes, and a no is remembered until the next release.
Codex is only updated when it came from npm; other installs just get a reminder.

Turn it off with `"updateCheck": false` in the config, or set `XMAS_NO_UPDATE_CHECK=1`. It is also off
when `CI` is set.

Links in the agent's output (and plain URLs and file paths that exist) can be opened with Ctrl+click.

## Known limits

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

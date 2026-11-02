// The winter look inside Claude Code itself (theme, spinner words, tips) is delivered with
// --settings so it only applies to sessions started through xmas.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config, configDir } from './config.js'

export const THEME_SLUG = 'xmas-winter'

export const SPINNER_VERBS = [
  'Caroling',
  'Sleighing',
  'Wrapping presents',
  'Trimming the tree',
  'Decking the halls',
  'Stirring the cocoa',
  'Roasting chestnuts',
  'Hanging stockings',
  'Baking gingerbread',
  'Checking the list twice',
  'Stringing lights',
  'Building a snowman',
  'Brewing mulled cider',
  'Frosting cookies',
  'Feeding the reindeer',
  'Shaking the snow globe',
]

export const TIPS = [
  'Bundle up: cocoa tastes better while the tests run.',
  'Santa checks the list twice. So should you, with /code-review.',
  'Every snowflake is unique, and so is every bug.',
  'Keep your commits small, like stocking stuffers.',
  'Naughty or nice? Run the tests to find out.',
]

export function winterSettings(cfg: Config): Record<string, unknown> {
  return {
    theme: `custom:${THEME_SLUG}`,
    // the compositor can only show a viewport, so Claude must own scrolling
    tui: 'fullscreen',
    spinnerVerbs: { mode: 'replace', verbs: SPINNER_VERBS },
    spinnerTipsOverride: { excludeDefault: true, label: 'Winter tip', tips: TIPS },
    ...cfg.claude.settings,
  }
}

function assetPath(name: string): string {
  return fileURLToPath(new URL(`../assets/${name}`, import.meta.url))
}

/** Writes the settings file and makes sure the theme exists. Returns the settings path. */
export function installWinter(cfg: Config): { settingsPath: string; themePath: string } {
  const dir = configDir()
  fs.mkdirSync(dir, { recursive: true })
  const settingsPath = path.join(dir, 'claude-settings.json')
  const body = JSON.stringify(winterSettings(cfg), null, 2)
  if (!fs.existsSync(settingsPath) || fs.readFileSync(settingsPath, 'utf8') !== body)
    fs.writeFileSync(settingsPath, body)

  const themesDir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'themes')
  const themePath = path.join(themesDir, `${THEME_SLUG}.json`)
  const wanted = fs.readFileSync(assetPath(`${THEME_SLUG}.json`), 'utf8')
  fs.mkdirSync(themesDir, { recursive: true })
  if (!fs.existsSync(themePath) || fs.readFileSync(themePath, 'utf8') !== wanted)
    fs.writeFileSync(themePath, wanted)
  return { settingsPath, themePath }
}

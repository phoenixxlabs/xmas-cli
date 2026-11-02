#!/usr/bin/env node
import { main } from './cli.js'

main().then(
  (code) => process.stdout.write('', () => process.exit(code)),
  (e) => {
    process.stderr.write(`xmas: ${(e as Error).stack ?? e}\n`)
    process.exit(1)
  },
)

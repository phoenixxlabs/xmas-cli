import fs from 'node:fs'

export type Logger = (msg: string) => void

// stdout belongs to the terminal, so logs go to a file (or nowhere)
export function createLogger(file: string | null): Logger {
  if (!file) return () => {}
  const fd = fs.openSync(file, 'a')
  return (msg) => {
    try {
      fs.writeSync(fd, `${new Date().toISOString()} ${msg}\n`)
    } catch {
      /* ignore */
    }
  }
}

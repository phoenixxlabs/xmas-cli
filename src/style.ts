// small winter palette for xmas's own output (help, session list, exit hint). no colour when
// stdout isn't a terminal or NO_COLOR is set

const on = (): boolean => !!process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb'

const rgb =
  (r: number, g: number, b: number, bold = false) =>
  (s: string): string =>
    on() ? `\x1b[${bold ? '1;' : ''}38;2;${r};${g};${b}m${s}\x1b[0m` : s

export const ice = rgb(150, 205, 255)
export const snow = rgb(238, 245, 252, true)
export const frost = rgb(112, 140, 170)
export const berry = rgb(232, 90, 104, true)
export const pine = rgb(126, 200, 150)

export const brand = (): string => `${ice('❄')} ${snow('xmas')}`

export const rule = (n = 44): string => frost('─'.repeat(n))

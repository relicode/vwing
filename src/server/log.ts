// Tiny leveled logger for the game server: one line per lifecycle event, state TRANSITIONS
// instead of repeated warnings, and throttles for anything that could fire per tick — so the
// labeled vwing:srv pane in `bun run dev:all` stays scannable. Dependency-free; each createLog
// closure owns its own transition/throttle memory (no module-level mutable state). The level is
// gated by $VWING_LOG (debug | info | warn; default info) — successful persists are silent at
// info and visible at debug.

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
}

const LEVEL_RANK: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
}

const pad = (value: number): string => String(value).padStart(2, '0')

// 'HH:MM:SS LEVEL [scope] msg' — `at` is injectable so tests can pin the clock.
export const formatLine = (level: LogLevel, scope: string, msg: string, at = new Date()): string =>
  `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`

export type Log = {
  debug: (msg: string) => void
  info: (msg: string) => void
  warn: (msg: string) => void
  // A two-state alarm keyed by `key`: entering warns ONCE (per flip, not per call), leaving
  // logs the recovery once. The repeated-failure spam of a long outage collapses to two lines.
  transition: (key: string, entered: boolean, enterMsg: string, exitMsg?: string) => void
  // At most one warning per `seconds` window per key — for conditions checked every tick.
  throttle: (key: string, seconds: number, msg: string) => void
}

export type LogOptions = {
  level?: LogLevel // overrides $VWING_LOG
  now?: () => number // injectable clock (throttle windows + line timestamps)
  sink?: (level: LogLevel, line: string) => void // overrides console (tests capture here)
}

const envLevel = (): LogLevel => {
  const raw = process.env.VWING_LOG
  return raw === LogLevel.DEBUG || raw === LogLevel.WARN ? raw : LogLevel.INFO
}

export const createLog = (scope: string, options?: LogOptions): Log => {
  const min = LEVEL_RANK[options?.level ?? envLevel()]
  const now = options?.now ?? Date.now
  const sink =
    options?.sink ??
    ((level: LogLevel, line: string): void => {
      if (level === LogLevel.WARN) console.warn(line)
      else console.log(line)
    })
  const flips = new Map<string, boolean>()
  const lastWarnAt = new Map<string, number>()

  const emit = (level: LogLevel, msg: string): void => {
    if (LEVEL_RANK[level] < min) return
    sink(level, formatLine(level, scope, msg, new Date(now())))
  }

  const transition = (key: string, entered: boolean, enterMsg: string, exitMsg?: string): void => {
    const was = flips.get(key) ?? false
    if (entered === was) return
    flips.set(key, entered)
    if (entered) emit(LogLevel.WARN, enterMsg)
    else if (exitMsg !== undefined) emit(LogLevel.INFO, exitMsg)
  }

  const throttle = (key: string, seconds: number, msg: string): void => {
    const at = now()
    const last = lastWarnAt.get(key)
    if (last !== undefined && at - last < seconds * 1000) return
    lastWarnAt.set(key, at)
    emit(LogLevel.WARN, msg)
  }

  return {
    debug: (msg) => emit(LogLevel.DEBUG, msg),
    info: (msg) => emit(LogLevel.INFO, msg),
    warn: (msg) => emit(LogLevel.WARN, msg),
    transition,
    throttle,
  }
}

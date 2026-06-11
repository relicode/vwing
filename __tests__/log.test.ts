import { describe, expect, test } from 'bun:test'

import { createLog, formatLine, LogLevel } from '$/server/log'

const capture = (): { lines: { level: LogLevel; line: string }[]; sink: (level: LogLevel, line: string) => void } => {
  const lines: { level: LogLevel; line: string }[] = []
  return { lines, sink: (level, line) => void lines.push({ level, line }) }
}

describe('formatLine', () => {
  test('formats HH:MM:SS LEVEL [scope] msg with a pinned clock', () => {
    const at = new Date(2026, 5, 11, 9, 5, 3)
    expect(formatLine(LogLevel.INFO, 'server', 'room created', at)).toBe('09:05:03 INFO  [server] room created')
    expect(formatLine(LogLevel.WARN, 'store', 'Redis lost', at)).toBe('09:05:03 WARN  [store] Redis lost')
    expect(formatLine(LogLevel.DEBUG, 's', 'm', at)).toBe('09:05:03 DEBUG [s] m')
  })
})

describe('createLog', () => {
  test('level gating: warn hides info and debug', () => {
    const { lines, sink } = capture()
    const log = createLog('t', { level: LogLevel.WARN, sink, now: () => 0 })
    log.debug('a')
    log.info('b')
    log.warn('c')
    expect(lines).toHaveLength(1)
    expect(lines[0].level).toBe(LogLevel.WARN)
  })

  test('debug level lets everything through', () => {
    const { lines, sink } = capture()
    const log = createLog('t', { level: LogLevel.DEBUG, sink, now: () => 0 })
    log.debug('a')
    log.info('b')
    expect(lines).toHaveLength(2)
  })

  test('transition emits once per flip: lost → recovered → lost = 3 lines', () => {
    const { lines, sink } = capture()
    const log = createLog('t', { sink, now: () => 0 })
    log.transition('redis', true, 'lost')
    log.transition('redis', true, 'lost') // still down — suppressed
    log.transition('redis', false, 'lost', 'recovered')
    log.transition('redis', false, 'lost', 'recovered') // still up — suppressed
    log.transition('redis', true, 'lost')
    expect(lines.map((entry) => entry.level)).toEqual([LogLevel.WARN, LogLevel.INFO, LogLevel.WARN])
  })

  test('a first success emits no recovery line (absent = healthy)', () => {
    const { lines, sink } = capture()
    const log = createLog('t', { sink, now: () => 0 })
    log.transition('redis', false, 'lost', 'recovered')
    expect(lines).toHaveLength(0)
  })

  test('throttle emits at most once per window', () => {
    const { lines, sink } = capture()
    let at = 0
    const log = createLog('t', { sink, now: () => at })
    log.throttle('slow', 10, 'slow tick')
    at = 5000
    log.throttle('slow', 10, 'slow tick') // inside the window — suppressed
    expect(lines).toHaveLength(1)
    at = 10001
    log.throttle('slow', 10, 'slow tick')
    expect(lines).toHaveLength(2)
  })
})

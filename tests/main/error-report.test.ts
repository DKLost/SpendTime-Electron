import { describe, expect, it } from 'vitest'
import type { Logger } from '@application/ports'
import { createErrorReporter } from '../../src/main/runtime/error-report'

function createLogger(): Logger & { readonly errors: { message: string; details?: unknown }[] } {
  const errors: { message: string; details?: unknown }[] = []
  return {
    errors,
    info: (): void => undefined,
    error: (message, details) => {
      errors.push({ message, details })
    },
  }
}

function withNow(initial: number): { now: () => number; advance(ms: number): void } {
  let current = initial
  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    },
  }
}

describe('渲染层错误上报限流', () => {
  it('首次记录，窗口期内相同消息被限流', () => {
    const logger = createLogger()
    const time = withNow(1_000)
    const report = createErrorReporter({ logger, now: time.now })

    expect(report({ message: 'boom', source: 'error' })).toEqual({ reported: true, throttled: false })
    expect(report({ message: 'boom', source: 'error' })).toEqual({ reported: false, throttled: true })
    expect(logger.errors).toHaveLength(1)
    expect(logger.errors[0]?.message).toContain('error')
    expect(logger.errors[0]?.message).toContain('boom')
  })

  it('窗口期结束后重新记录', () => {
    const logger = createLogger()
    const time = withNow(1_000)
    const report = createErrorReporter({ logger, now: time.now, windowMs: 60_000 })

    report({ message: 'boom' })
    time.advance(59_999)
    expect(report({ message: 'boom' })).toEqual({ reported: false, throttled: true })
    time.advance(1)
    expect(report({ message: 'boom' })).toEqual({ reported: true, throttled: false })
    expect(logger.errors).toHaveLength(2)
  })

  it('不同消息互不影响，堆栈原样写入日志', () => {
    const logger = createLogger()
    const time = withNow(1_000)
    const report = createErrorReporter({ logger, now: time.now })

    report({ message: 'a', stack: 'at a', source: 'unhandledrejection' })
    report({ message: 'b', stack: 'at b' })
    expect(logger.errors.map((entry) => entry.details)).toEqual(['at a', 'at b'])
    expect(logger.errors[0]?.message).toContain('unhandledrejection')
    expect(logger.errors[1]?.message).toContain('error')
  })
})

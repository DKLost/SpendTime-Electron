import { describe, expect, it } from 'vitest'
import { createSystemClock, resolveTestClockNow } from '../../src/main/runtime/clock'

const FIXTURE_NOW = Date.UTC(2026, 10, 13, 2, 0)

describe('测试时钟门禁', () => {
  it('未打开测试钩子时不生效', () => {
    expect(resolveTestClockNow({ SPENDTIME_TEST_CLOCK: String(FIXTURE_NOW) }, true)).toBeNull()
  })

  it('打包态（isDev=false）即使打开钩子也不生效', () => {
    expect(
      resolveTestClockNow(
        { SPENDTIME_TEST_HOOKS: '1', SPENDTIME_TEST_CLOCK: String(FIXTURE_NOW) },
        false,
      ),
    ).toBeNull()
  })

  it('开发态且钩子开启时采用固定时刻', () => {
    expect(
      resolveTestClockNow(
        { SPENDTIME_TEST_HOOKS: '1', SPENDTIME_TEST_CLOCK: String(FIXTURE_NOW) },
        true,
      ),
    ).toBe(FIXTURE_NOW)
  })

  it('非法值回落为真实时间', () => {
    expect(
      resolveTestClockNow({ SPENDTIME_TEST_HOOKS: '1', SPENDTIME_TEST_CLOCK: 'yesterday' }, true),
    ).toBeNull()
    expect(
      resolveTestClockNow({ SPENDTIME_TEST_HOOKS: '1', SPENDTIME_TEST_CLOCK: '-1' }, true),
    ).toBeNull()
  })
})

describe('系统时钟', () => {
  it('固定时刻下 now 稳定，时区偏移为正东', () => {
    const clock = createSystemClock({ testNowMs: FIXTURE_NOW })
    expect(clock.now()).toBe(FIXTURE_NOW)
    expect(clock.now()).toBe(FIXTURE_NOW)
    const offset = clock.offsetMinutes()
    expect(Number.isInteger(offset)).toBe(true)
    expect(offset).toBe(-new Date(FIXTURE_NOW).getTimezoneOffset())
  })

  it('未注入固定时刻时跟随系统时间', () => {
    const before = Date.now()
    const now = createSystemClock().now()
    const after = Date.now()
    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(after)
  })
})

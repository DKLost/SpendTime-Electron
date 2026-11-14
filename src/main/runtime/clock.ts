import type { Clock } from '@application/ports'
import type { EpochMs, OffsetMinutes } from '@core/types'

// 测试时钟只在开发态且显式打开测试钩子时生效，打包版永远读系统时间
export function resolveTestClockNow(
  env: Readonly<Record<string, string | undefined>>,
  isDev: boolean,
): number | null {
  if (!isDev || env['SPENDTIME_TEST_HOOKS'] !== '1') {
    return null
  }
  const raw = env['SPENDTIME_TEST_CLOCK']
  if (raw === undefined) {
    return null
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function createSystemClock(options: { readonly testNowMs?: number | null } = {}): Clock {
  const fixedNow = options.testNowMs ?? null

  function now(): EpochMs {
    // 固定时刻用于让 E2E 断言确定的时间点；正常启动始终走真实时间
    return fixedNow ?? Date.now()
  }

  // Date#getTimezoneOffset 的符号与直觉相反（东八区返回 -480），这里统一为「东为正」
  function offsetMinutes(): OffsetMinutes {
    return -new Date(now()).getTimezoneOffset()
  }

  return { now, offsetMinutes }
}

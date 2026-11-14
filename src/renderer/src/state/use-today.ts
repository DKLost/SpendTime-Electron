import { useEffect, useState } from 'react'
import { toLocalDate } from '@core/time'
import type { LocalDate } from '@core/types'

function readToday(): LocalDate {
  return toLocalDate(Date.now(), -new Date().getTimezoneOffset())
}

// 只用于界面筛选；记录归属日期由主进程写入时决定
export function useTodayLocalDate(): LocalDate {
  const [today, setToday] = useState<LocalDate>(readToday)

  useEffect(function scheduleDayRefresh() {
    const timer = setInterval(() => setToday(readToday()), 60_000)
    return function clearTimer(): void {
      clearInterval(timer)
    }
  }, [])

  return today
}

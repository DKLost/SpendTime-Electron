import { useEffect, useState } from 'react'

// 每秒刷新一次本地时间，界面时钟与倒计时共用同一份 now
export function useClock(): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(function tick() {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return function stop(): void {
      window.clearInterval(timer)
    }
  }, [])

  return now
}

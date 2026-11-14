import type { Logger } from '@application/ports'

// 渲染层主动上报的错误；主进程只负责落日志与限流
export type RendererErrorReport = {
  readonly message: string
  readonly stack?: string
  readonly source?: string
}

export type ErrorReportOutcome = {
  readonly reported: boolean
  readonly throttled: boolean
}

export const ERROR_REPORT_WINDOW_MS = 60_000

// 相同消息在窗口期内只记录一次，避免渲染层异常循环刷屏
export function createErrorReporter(input: {
  readonly logger: Logger
  readonly now: () => number
  readonly windowMs?: number
}): (report: RendererErrorReport) => ErrorReportOutcome {
  const windowMs = input.windowMs ?? ERROR_REPORT_WINDOW_MS
  const lastReportedAt = new Map<string, number>()

  function pruneExpired(current: number): void {
    for (const [message, reportedAt] of lastReportedAt) {
      if (current - reportedAt >= windowMs) {
        lastReportedAt.delete(message)
      }
    }
  }

  function report(report: RendererErrorReport): ErrorReportOutcome {
    const current = input.now()
    const previous = lastReportedAt.get(report.message)
    if (previous !== undefined && current - previous < windowMs) {
      return { reported: false, throttled: true }
    }

    pruneExpired(current)
    lastReportedAt.set(report.message, current)
    const source = report.source ?? 'error'
    input.logger.error(`渲染层错误（${source}）：${report.message}`, report.stack)
    return { reported: true, throttled: false }
  }

  return report
}

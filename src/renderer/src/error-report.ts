import type { SpendTimeApi } from '@shared/contracts'

type ErrorSource = 'error' | 'unhandledrejection' | 'manual'

export type ErrorReport = {
  readonly message: string
  readonly stack?: string
  readonly source: ErrorSource
}

export function normalizeError(error: unknown): { readonly message: string; readonly stack?: string } {
  if (error instanceof Error) {
    return { message: error.message === '' ? error.name : error.message, stack: error.stack }
  }
  if (typeof error === 'string' && error !== '') {
    return { message: error }
  }
  try {
    return { message: JSON.stringify(error) ?? String(error) }
  } catch {
    return { message: String(error) }
  }
}

// 上报失败不能反过来影响界面，全部吞掉
export function reportError(api: Pick<SpendTimeApi, 'invoke'>, report: ErrorReport): void {
  void api
    .invoke('app.reportError', {
      message: report.message.slice(0, 4000),
      stack: report.stack?.slice(0, 8000),
      source: report.source,
    })
    .catch(() => undefined)
}

// 捕获未处理的异常与 Promise 拒绝；返回卸载函数便于测试与热重载
export function installErrorReporting(api: Pick<SpendTimeApi, 'invoke'>): () => void {
  function handleError(event: ErrorEvent): void {
    const normalized = normalizeError(event.error ?? event.message)
    reportError(api, { ...normalized, source: 'error' })
  }

  function handleRejection(event: PromiseRejectionEvent): void {
    const normalized = normalizeError(event.reason)
    reportError(api, { ...normalized, source: 'unhandledrejection' })
  }

  window.addEventListener('error', handleError)
  window.addEventListener('unhandledrejection', handleRejection)

  return function uninstall(): void {
    window.removeEventListener('error', handleError)
    window.removeEventListener('unhandledrejection', handleRejection)
  }
}

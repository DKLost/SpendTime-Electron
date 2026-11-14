import type { ApiError, CommandResult } from '@shared/contracts'
import type { Result } from '@core/result'

export function fromResult<T, E extends ApiError>(result: Result<T, E>): CommandResult<T> {
  return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error }
}

export function failure(code: string, message: string): CommandResult<never> {
  return { ok: false, error: { code, message } }
}

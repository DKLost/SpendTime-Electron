import { describe, expect, it, vi } from 'vitest'
import type { SpendTimeApi } from '../../src/shared/contracts'
import { normalizeError, reportError } from '../../src/renderer/src/error-report'

type InvokeSpy = ReturnType<typeof vi.fn>

function createApi(): { api: Pick<SpendTimeApi, 'invoke'>; invoke: InvokeSpy } {
  const invoke = vi.fn(async () => ({ ok: true as const, value: { reported: true, throttled: false } }))
  return { api: { invoke } as unknown as Pick<SpendTimeApi, 'invoke'>, invoke }
}

describe('渲染层错误归一化', () => {
  it('Error 取消息与堆栈，空消息退回名称', () => {
    const error = new Error('炸了')
    expect(normalizeError(error)).toEqual({ message: '炸了', stack: error.stack })
    expect(normalizeError(Object.assign(new Error(''), { name: 'EvalError' })).message).toBe('EvalError')
  })

  it('字符串原样，对象转 JSON，循环结构退化为字符串', () => {
    expect(normalizeError('纯文本')).toEqual({ message: '纯文本' })
    expect(normalizeError({ reason: 'x' }).message).toBe('{"reason":"x"}')
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(normalizeError(circular).message).toBe('[object Object]')
  })
})

describe('渲染层错误上报', () => {
  it('按契约通道提交并截断超长内容', () => {
    const { api, invoke } = createApi()
    reportError(api, { message: 'x'.repeat(5_000), stack: 's'.repeat(9_000), source: 'error' })

    expect(invoke).toHaveBeenCalledTimes(1)
    const [channel, payload] = invoke.mock.calls[0] as [string, { message: string; stack: string; source: string }]
    expect(channel).toBe('app.reportError')
    expect(payload.message).toHaveLength(4_000)
    expect(payload.stack).toHaveLength(8_000)
    expect(payload.source).toBe('error')
  })

  it('上报失败不抛出', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('IPC 断了')
    })
    const api = { invoke } as unknown as Pick<SpendTimeApi, 'invoke'>
    expect(() => reportError(api, { message: 'boom', source: 'manual' })).not.toThrow()
    await Promise.resolve()
  })
})

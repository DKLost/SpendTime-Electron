import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { Logger } from '@application/ports'
import { commands, type CommandChannel, type CommandResponse } from '@shared/contracts'
import type { DispatchedHandler } from './handlers'
import { failure } from './result-mapping'

export type IpcContext = {
  readonly handlers: Readonly<Record<CommandChannel, DispatchedHandler>>
  readonly logger: Logger
  readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean
}

// 接线层只做三件事：来源校验、Zod 校验、错误封装；业务逻辑全部在 handlers
export function registerIpcHandlers(ctx: IpcContext): void {
  for (const channel of Object.keys(commands) as CommandChannel[]) {
    registerChannel(ctx, channel)
  }
}

function registerChannel(ctx: IpcContext, channel: CommandChannel): void {
  ipcMain.handle(channel, async (event, raw: unknown): Promise<CommandResponse<CommandChannel>> => {
    if (!ctx.isTrustedSender(event)) {
      ctx.logger.error(`拒绝来自不可信来源的 IPC 调用：${channel}`)
      return failure('UNTRUSTED_SENDER', '来源不可信')
    }

    const parsed = commands[channel].request.safeParse(raw ?? {})
    if (!parsed.success) {
      return failure('INVALID_REQUEST', describeParseError(parsed.error.issues))
    }

    try {
      // 文件选择等通道是异步的，必须 await 才能把拒绝映射成统一信封
      return await ctx.handlers[channel](parsed.data)
    } catch (error) {
      ctx.logger.error(`IPC ${channel} 执行失败`, error)
      return failure('INTERNAL_ERROR', describeError(error))
    }
  })
}

function describeParseError(issues: readonly { message: string }[]): string {
  return issues.length > 0 ? issues.map((issue) => issue.message).join('; ') : '参数不合法'
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

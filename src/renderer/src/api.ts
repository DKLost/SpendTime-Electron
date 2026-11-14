import type {
  CommandChannel,
  CommandRequest,
  CommandResponse,
  EventChannel,
  EventPayload,
} from '@shared/contracts'

// 渲染层访问主进程的唯一入口；通道名与载荷由契约类型推导
export function invokeCommand<C extends CommandChannel>(
  channel: C,
  request: CommandRequest<C>,
): Promise<CommandResponse<C>> {
  return window.spendTime.invoke(channel, request)
}

export function subscribeEvent<E extends EventChannel>(
  channel: E,
  listener: (payload: EventPayload<E>) => void,
): () => void {
  return window.spendTime.on(channel, listener)
}

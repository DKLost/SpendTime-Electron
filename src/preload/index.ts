import { contextBridge, ipcRenderer } from 'electron'
import type {
  CommandChannel,
  CommandRequest,
  CommandResponse,
  EventChannel,
  EventPayload,
  SpendTimeApi,
} from '../shared/contracts'

// 只暴露窄接口：拿不到 ipcRenderer 本体，也无法枚举其它通道
function invoke<C extends CommandChannel>(
  channel: C,
  payload: CommandRequest<C>,
): Promise<CommandResponse<C>> {
  return ipcRenderer.invoke(channel, payload)
}

function on<E extends EventChannel>(channel: E, listener: (payload: EventPayload<E>) => void): () => void {
  function forward(_event: Electron.IpcRendererEvent, payload: EventPayload<E>): void {
    listener(payload)
  }
  ipcRenderer.on(channel, forward)
  return function unsubscribe(): void {
    ipcRenderer.removeListener(channel, forward)
  }
}

const api: SpendTimeApi = { invoke, on }

contextBridge.exposeInMainWorld('spendTime', api)

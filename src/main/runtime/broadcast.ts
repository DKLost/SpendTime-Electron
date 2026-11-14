import { BrowserWindow } from 'electron'
import type { EventChannel, EventPayload } from '@shared/contracts'

export function broadcast<E extends EventChannel>(channel: E, payload: EventPayload<E>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

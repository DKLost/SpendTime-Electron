import { globalShortcut } from 'electron'
import type { Logger } from '@application/ports'

export const TOGGLE_TIMER_ACCELERATOR = 'Ctrl+Alt+S'

export type ShortcutController = {
  // null / 空串表示禁用；返回 false 时保留上一次可用组合
  apply(accelerator: string | null): boolean
  dispose(): void
}

// 注册失败不阻塞启动：由设置页展示错误并保留旧组合
export function createShortcutController(
  handler: () => void,
  logger: Logger,
): ShortcutController {
  let current: string | null = null

  function apply(accelerator: string | null): boolean {
    const next = accelerator === null || accelerator.trim() === '' ? null : accelerator.trim()
    if (next === current) {
      return true
    }
    const previous = current
    if (previous !== null) {
      globalShortcut.unregister(previous)
    }
    if (next === null) {
      current = null
      return true
    }
    if (globalShortcut.register(next, handler)) {
      current = next
      return true
    }
    logger.error(`全局快捷键注册失败：${next}`)
    if (previous !== null && globalShortcut.register(previous, handler)) {
      current = previous
    } else {
      current = null
    }
    return false
  }

  function dispose(): void {
    if (current !== null) {
      globalShortcut.unregister(current)
      current = null
    }
  }

  return { apply, dispose }
}

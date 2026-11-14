import { app } from 'electron'
import { err, ok, type Result } from '@core/result'
import type { AppSettings } from '@core/settings'
import type { SettingsEffects } from '@application/ports'
import type { ShortcutController } from './global-shortcut'

export type SettingsEffectsDeps = {
  readonly shortcuts: ShortcutController
}

// 桌面副作用集中在这里：设置落库前先执行，失败则不改变持久化值
export function createSettingsEffects(deps: SettingsEffectsDeps): SettingsEffects {
  return {
    apply(next: AppSettings, previous: AppSettings): Result<void, { code: string; message: string }> {
      if (next.startAtLogin !== previous.startAtLogin) {
        app.setLoginItemSettings({ openAtLogin: next.startAtLogin, args: ['--hidden'] })
      }
      if (next.shortcut !== previous.shortcut) {
        if (!deps.shortcuts.apply(next.shortcut)) {
          const label = next.shortcut ?? '（禁用）'
          return err({
            code: 'SHORTCUT_UNAVAILABLE',
            message: `全局快捷键 ${label} 注册失败，可能与系统或其他应用冲突`,
          })
        }
      }
      return ok(undefined)
    },
  }
}

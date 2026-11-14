import type { TranslationKey } from '../translation'

// 主题注册表：id 与 theme/*.css 的 [data-theme='...'] 一一对应
export type ThemeId =
  | 'celadon'
  | 'github'
  | 'steam'
  | 'nvidia-light'
  | 'nvidia-dark'
  | 'playstation-light'
  | 'playstation-dark'

export type ThemeOption = {
  readonly id: ThemeId
  readonly labelKey: TranslationKey
}

export const THEMES: readonly ThemeOption[] = [
  { id: 'celadon', labelKey: 'theme.celadon' },
  { id: 'github', labelKey: 'theme.github' },
  { id: 'steam', labelKey: 'theme.steam' },
  { id: 'nvidia-light', labelKey: 'theme.nvidiaLight' },
  { id: 'nvidia-dark', labelKey: 'theme.nvidiaDark' },
  { id: 'playstation-light', labelKey: 'theme.playstationLight' },
  { id: 'playstation-dark', labelKey: 'theme.playstationDark' },
]

const THEME_KEY = 'spendtime.theme'
const DEFAULT_THEME: ThemeId = 'celadon'
const LEGACY_THEME_ALIASES: Readonly<Record<string, ThemeId>> = {
  nvidia: 'nvidia-light',
  playstation: 'playstation-light',
}

export function isThemeId(value: string): value is ThemeId {
  return THEMES.some((option) => option.id === value)
}

export function loadTheme(): ThemeId {
  const stored = window.localStorage.getItem(THEME_KEY)
  if (stored === null) {
    return DEFAULT_THEME
  }
  if (isThemeId(stored)) {
    return stored
  }
  // 旧版本只存了 nvidia / playstation，升级后落到对应的浅色模式
  return LEGACY_THEME_ALIASES[stored] ?? DEFAULT_THEME
}

export function saveTheme(theme: ThemeId): void {
  window.localStorage.setItem(THEME_KEY, theme)
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme
}

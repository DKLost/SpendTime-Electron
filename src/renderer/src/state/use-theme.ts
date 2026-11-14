import { useEffect, useState } from 'react'
import { applyTheme, loadTheme, saveTheme, type ThemeId } from '../theme'

export type ThemeState = {
  readonly theme: ThemeId
  setTheme(theme: ThemeId): void
}

export function useTheme(): ThemeState {
  const [theme, setTheme] = useState<ThemeId>(loadTheme)

  useEffect(
    function syncTheme() {
      applyTheme(theme)
      saveTheme(theme)
    },
    [theme],
  )

  return { theme, setTheme }
}

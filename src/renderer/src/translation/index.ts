import type { ApiError } from '@shared/contracts'
import { zh, type TranslationKey, type TranslationParams } from './zh'
import { en } from './en'
import { ja } from './ja'

export type { TranslationKey, TranslationParams } from './zh'

export const translations = {
  zh,
  en,
  ja,
} as const

export type LocaleId = keyof typeof translations
export const DEFAULT_LOCALE: LocaleId = 'zh'
export const LOCALE_IDS: readonly LocaleId[] = ['zh', 'en', 'ja']

const MAX_NAME_LENGTH = 40

// 界面文案只在渲染前按当前语言取词；切换语言由外壳调用 setLocale 触发整树重渲染
let currentLocale: LocaleId = DEFAULT_LOCALE

export function getLocale(): LocaleId {
  return currentLocale
}

export function setLocale(locale: LocaleId): void {
  currentLocale = locale
}

export function localeTag(locale: LocaleId = currentLocale): string {
  switch (locale) {
    case 'en':
      return 'en-US'
    case 'ja':
      return 'ja-JP'
    case 'zh':
      return 'zh-CN'
  }
}

export function t(key: TranslationKey, params?: TranslationParams): string {
  const template: string = translations[currentLocale][key]
  if (params === undefined) {
    return template
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

// 主进程返回稳定错误码，渲染层负责取词，避免界面直接展示后端文案
export function apiErrorText(error: ApiError, params?: TranslationParams): string {
  const key = `error.${error.code}` as TranslationKey
  if (key in translations[currentLocale]) {
    return t(key, { max: MAX_NAME_LENGTH, ...params })
  }
  return error.message
}

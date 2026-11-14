import type { SpendTimeApi } from './contracts'

declare global {
  interface Window {
    readonly spendTime: SpendTimeApi
  }
}

export {}

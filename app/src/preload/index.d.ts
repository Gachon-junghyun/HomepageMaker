import type { HmApi } from './index'

declare global {
  interface Window {
    hm: HmApi
  }
}

export {}

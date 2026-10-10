import type { MaxiaoerApi } from '../shared/api'

declare global {
  interface Window {
    maxiaoer: MaxiaoerApi
  }
}

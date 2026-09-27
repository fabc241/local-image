import type { StudioAPI } from '../shared/types'

declare global {
  interface Window {
    studio: StudioAPI
  }
}

export {}

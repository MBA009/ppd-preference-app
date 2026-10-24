import type { PpdApi } from './types'
import { httpClient } from './httpClient'
import { mockClient } from './mockClient'

/**
 * The one place that decides where data comes from: app-api by default, or the offline mock
 * (static JSON in public/mock/, household in localStorage) when VITE_API_MODE=mock.
 */
export const apiMode: 'live' | 'mock' = import.meta.env.VITE_API_MODE === 'mock' ? 'mock' : 'live'
export const api: PpdApi = apiMode === 'mock' ? mockClient : httpClient
export { ApiError } from './httpClient'
export type * from './types'

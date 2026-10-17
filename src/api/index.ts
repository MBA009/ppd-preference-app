import type { PpdApi } from './types'
import { mockClient } from './mockClient'

/**
 * The one place that decides where data comes from.
 * Swap `mockClient` for a client that talks to the real backend when it exists.
 */
export const api: PpdApi = mockClient
export type * from './types'

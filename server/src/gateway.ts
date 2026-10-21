/**
 * The PPD gateway, as app-api sees it. For now app-api only checks that the gateway answers; reading
 * devices and publishing the household policy come next (docs/frontend-and-app-api-plan.md, steps 2-3).
 */
export interface GatewayHealth {
  url: string
  reachable: boolean
  status: number | null
  error: string | null
}

export async function checkGateway(baseUrl: string, timeoutMs = 2000): Promise<GatewayHealth> {
  try {
    const res = await fetch(`${baseUrl}/ppd/v1/health`, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } })
    return { url: baseUrl, reachable: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` }
  } catch (e) {
    const error = e instanceof Error && e.name === 'TimeoutError' ? `no answer within ${timeoutMs} ms` : 'connection failed'
    return { url: baseUrl, reachable: false, status: null, error }
  }
}

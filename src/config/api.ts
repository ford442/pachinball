/**
 * API Configuration - Backend storage manager URL
 * Uses storage.noahcohn.com as the canonical backend
 */
const DEV_API_BASE = 'http://localhost:8000/api'
const PROD_API_BASE = 'https://storage.noahcohn.com/api'
const DEV_ASSET_BASE = 'http://localhost:8000'
const PROD_ASSET_BASE = 'https://storage.noahcohn.com'

/**
 * API Base URL for backend API calls
 * Allow VITE_API_URL override, otherwise use prod/dev logic
 */
export const API_BASE = import.meta.env.VITE_API_URL as string | undefined
  || (import.meta.env.PROD ? PROD_API_BASE : DEV_API_BASE)

/**
 * Asset Base URL for static files (videos, images, shaders)
 * Allow VITE_ASSET_URL override, otherwise use prod/dev logic
 */
export const ASSET_BASE = import.meta.env.VITE_ASSET_URL as string | undefined
  || (import.meta.env.PROD ? PROD_ASSET_BASE : DEV_ASSET_BASE)

/**
 * Backbox media path: VITE_ASSET_URL override → prod CDN → dev `public/backbox/` bundle.
 */
export function resolveBackboxAssetPath(name: string, ext: string, pack?: string): string {
  const relative = pack ? `${pack}/${name}.${ext}` : `${name}.${ext}`
  if (import.meta.env.VITE_ASSET_URL) {
    return `${import.meta.env.VITE_ASSET_URL}/pachinball/backbox/${relative}`
  }
  if (import.meta.env.PROD) {
    return `${PROD_ASSET_BASE}/pachinball/backbox/${relative}`
  }
  return `/backbox/${relative}`
}

/**
 * Helper to make API calls with exponential backoff retry logic.
 */
export async function apiFetch<T>(
  endpoint = '',
  options: RequestInit = {}
): Promise<T | null> {
  const trimmedEndpoint = endpoint.trim()
  const resolvedUrl = /^https?:\/\//i.test(trimmedEndpoint)
    ? trimmedEndpoint
    : `${API_BASE}${trimmedEndpoint.startsWith('/') ? trimmedEndpoint : `/${trimmedEndpoint}`}`

  const maxAttempts = 3

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(resolvedUrl, {
        headers: {
          Accept: 'application/json',
          ...(options.headers ?? {}),
        },
        ...options,
      })

      if (!response.ok) {
        // Client errors are permanent — retrying just spams the console (e.g. /api/maps 404 on static hosts).
        if (response.status >= 400 && response.status < 500) {
          console.warn(`[apiFetch] Request failed for ${resolvedUrl}`, new Error(`HTTP ${response.status}`))
          return null
        }
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
      }

      if (response.status === 204) {
        return null
      }

      return await response.json() as T
    } catch (error) {
      if (attempt === maxAttempts) {
        console.warn(`[apiFetch] Request failed for ${resolvedUrl}`, error)
        return null
      }

      const delayMs = 250 * 2 ** (attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return null
}

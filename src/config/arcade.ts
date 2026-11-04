/**
 * Live arcade service endpoint (#444): the Supabase project behind the
 * leaderboard, replays, challenges and saves. The publishable key is public
 * by design (it only identifies the app; RLS guards the data).
 *
 * Production builds talk to it by default. Dev servers and automated
 * browsers (Playwright) stay offline unless `VITE_ARCADE_URL` points them at
 * a backend, so tests never write to the live leaderboard.
 */

const PROD_ARCADE_URL = 'https://znsioiaydrtsziwavdat.supabase.co'
const PROD_ARCADE_KEY = 'sb_publishable_XvzIEXPg7uaX4qc98YSNQQ_uOLHorJZ'

const OVERRIDE_URL = import.meta.env.VITE_ARCADE_URL as string | undefined

export const ARCADE_URL = (OVERRIDE_URL || PROD_ARCADE_URL).replace(/\/+$/, '')
export const ARCADE_KEY = (import.meta.env.VITE_ARCADE_KEY as string | undefined) || PROD_ARCADE_KEY

/** Whether this build / browser talks to the arcade service at all. */
export function arcadeEnabled(): boolean {
  if (OVERRIDE_URL) return true
  if (!import.meta.env.PROD) return false
  return !(typeof navigator !== 'undefined' && navigator.webdriver)
}

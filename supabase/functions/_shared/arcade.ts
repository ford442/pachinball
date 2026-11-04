/**
 * Shared plumbing for the arcade write paths (#444 Slice B,
 * docs/API_CONTRACT.md). Each function validates its body, then writes through
 * PostgREST *as the caller* (their anonymous-user JWT), so row-level security,
 * column grants, CHECK constraints and the rate-limit triggers in
 * supabase/migrations apply exactly as they would to a direct REST call.
 */

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function failure(status: number, message: string): Response {
  return json({ success: false, message }, status)
}

/** The CORS preflight answer, or a 405 for anything but POST; null to carry on. */
export function gate(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return failure(405, 'POST only')
  if (!req.headers.get('Authorization')?.startsWith('Bearer ')) return failure(401, 'sign in first')
  return null
}

export class BadRequest extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

/**
 * The request body as JSON, refused past `maxBytes` before it is parsed. The
 * body is always read first: answering before it is consumed leaves the
 * platform's response hanging until the client gives up.
 */
export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const text = await req.text()
  if (new TextEncoder().encode(text).length > maxBytes) throw new BadRequest(`body exceeds ${maxBytes} bytes`, 413)
  try {
    return JSON.parse(text)
  } catch {
    throw new BadRequest('body is not JSON')
  }
}

export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequest('body must be a JSON object')
  return value as Record<string, unknown>
}

export function intField(o: Record<string, unknown>, key: string, min: number, max: number, fallback?: number): number {
  const v = o[key] ?? fallback
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new BadRequest(`${key} must be an integer in [${min}, ${max}]`)
  }
  return v
}

export function textField(o: Record<string, unknown>, key: string, pattern: RegExp): string {
  const v = o[key]
  if (typeof v !== 'string' || !pattern.test(v)) throw new BadRequest(`${key} must match ${pattern}`)
  return v
}

export function optionalText(o: Record<string, unknown>, key: string, pattern: RegExp): string | null {
  return o[key] === undefined || o[key] === null ? null : textField(o, key, pattern)
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const TAG = /^[A-Z]{3}$/
export const MAP_ID = /^[A-Za-z0-9._:-]{1,64}$/

/** PostgREST, as the caller. Returns the parsed body, or throws with PostgREST's status and message. */
export async function rest<T>(req: Request, path: string, init: { method: string; body?: unknown; prefer?: string }): Promise<T> {
  const url = Deno.env.get('SUPABASE_URL')
  const apikey = Deno.env.get('SUPABASE_ANON_KEY') ?? req.headers.get('apikey') ?? ''
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: init.method,
    headers: {
      apikey,
      Authorization: req.headers.get('Authorization') ?? '',
      'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  const parsed = text ? JSON.parse(text) : null
  if (!res.ok) {
    const message = (parsed && typeof parsed === 'object' && 'message' in parsed) ? String(parsed.message) : res.statusText
    throw new BadRequest(message, res.status)
  }
  return parsed as T
}

/** Run a handler with the shared gate and error mapping. */
export function serve(handler: (req: Request) => Promise<Response>): void {
  Deno.serve(async (req) => {
    const early = gate(req)
    if (early) {
      // Drain the body first (see readJson).
      if (req.method !== 'OPTIONS') await req.arrayBuffer().catch(() => null)
      return early
    }
    try {
      return await handler(req)
    } catch (err) {
      if (err instanceof BadRequest) return failure(err.status, err.message)
      console.error(err)
      return failure(500, 'internal error')
    }
  })
}

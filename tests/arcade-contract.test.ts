/**
 * @vitest-environment happy-dom
 */
/**
 * #444 Slice B — every request src/arcade/arcade-api.ts makes must match
 * docs/api/arcade.openapi.yaml: an operation for its method + path, the
 * `apikey` header, a player bearer token on the write paths, only declared
 * query parameters (each matching its schema), and a JSON body that validates
 * against the request schema. The canned responses validate against the
 * documented response schemas too, so the mocks cannot drift from the
 * contract either. Change the client or the contract, not one of them.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv from 'ajv'
import { load } from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAP_ID, TAG, UUID } from '../supabase/functions/_shared/arcade'
import { ReplayRecorder } from '../src/replay/replay-recorder'

vi.mock('../src/config/arcade', () => ({
  ARCADE_URL: 'https://arcade.test',
  ARCADE_KEY: 'sb_publishable_test',
  arcadeEnabled: () => true,
}))

type Schema = Record<string, unknown>
type Operation = {
  security?: Array<Record<string, unknown>>
  parameters?: Array<{ name: string; in: string; required?: boolean; schema: Schema }>
  requestBody?: { content: { 'application/json': { schema: Schema } } }
  responses: Record<string, { content?: { 'application/json': { schema: Schema } }; $ref?: string }>
}
type Spec = {
  paths: Record<string, Record<string, Operation>>
  components: { schemas: Record<string, Schema> }
}

const spec = load(readFileSync(resolve(__dirname, '../docs/api/arcade.openapi.yaml'), 'utf8')) as Spec
const ajv = new Ajv({ allErrors: true })

/** Inline `#/components/schemas/*` refs so ajv sees one self-contained schema. */
function deref(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deref)
  if (!node || typeof node !== 'object') return node
  const ref = (node as { $ref?: string }).$ref
  if (ref?.startsWith('#/components/schemas/')) return deref(spec.components.schemas[ref.slice('#/components/schemas/'.length)])
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, deref(v)]))
}

function schemaErrors(schema: Schema, value: unknown): string[] {
  const validate = ajv.compile(deref(schema) as object)
  return validate(value) ? [] : (validate.errors ?? []).map((e) => `${e.dataPath} ${e.message}`)
}

interface Captured {
  method: string
  url: URL
  headers: Record<string, string>
  body: unknown
}

/** Problems with one request against the contract; empty when it conforms. */
function contractProblems(req: Captured): string[] {
  const op = spec.paths[req.url.pathname]?.[req.method.toLowerCase()]
  if (!op) return [`no operation for ${req.method} ${req.url.pathname}`]
  const problems: string[] = []
  if (!req.headers.apikey) problems.push('missing apikey header')
  const needsPlayer = op.security?.some((s) => 'player' in s) ?? false
  if (needsPlayer && !/^Bearer \S+$/.test(req.headers.Authorization ?? '')) problems.push('missing player bearer token')
  const declared = new Map((op.parameters ?? []).filter((p) => p.in === 'query').map((p) => [p.name, p]))
  for (const [name, value] of req.url.searchParams) {
    const param = declared.get(name)
    if (!param) problems.push(`undeclared query parameter ${name}`)
    else problems.push(...schemaErrors(param.schema, value).map((e) => `query ${name}:${e}`))
  }
  for (const param of declared.values()) {
    if (param.required && !req.url.searchParams.has(param.name)) problems.push(`missing query parameter ${param.name}`)
  }
  const bodySchema = op.requestBody?.content['application/json'].schema
  if (bodySchema) problems.push(...schemaErrors(bodySchema, req.body).map((e) => `body${e}`))
  else if (req.body !== undefined) problems.push('body sent to an operation that takes none')
  return problems
}

function responseSchema(path: string, method: string, status: number): Schema | undefined {
  const op = spec.paths[path]?.[method]
  return op?.responses[String(status)]?.content?.['application/json'].schema
}

const PLAYER = '2b7a8f0e-4c1d-4a5e-9f3b-1d2e3f4a5b6c'
const REPLAY_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const CHALLENGE_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const session = (token: string) => ({
  access_token: token, refresh_token: `refresh-${token}`, expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: PLAYER, is_anonymous: true },
})

/** Canned answers, each in the documented response shape. */
function answer(method: string, url: URL): { status: number; body: unknown } {
  const key = `${method} ${url.pathname}`
  switch (key) {
    case 'POST /auth/v1/signup': return { status: 200, body: session('fresh') }
    case 'POST /auth/v1/token': return { status: 200, body: session('refreshed') }
    case 'GET /rest/v1/leaderboard': return {
      status: 200,
      body: [{ rank: 1, name: 'ACE', score: 12000, map_id: 'neon-helix', adventure_level: null, balls: 1, combo_max: 4, date: '2026-10-16T02:00:00Z', replay_id: REPLAY_ID, challenge_id: null, verified: false }],
    }
    case 'POST /rest/v1/rpc/player_rank': return { status: 200, body: 3 }
    case 'GET /rest/v1/replays': return { status: 200, body: [{ payload: replayPayload() }] }
    case 'POST /functions/v1/submit-replay': return { status: 201, body: { success: true, replay_id: REPLAY_ID, frame_count: 1200 } }
    case 'POST /functions/v1/submit-score': return { status: 201, body: { success: true, score_id: 42, rank: 3, verified: false } }
    case 'POST /functions/v1/create-challenge': return { status: 201, body: { success: true, challenge_id: CHALLENGE_ID } }
    case 'GET /rest/v1/saves': return { status: 200, body: [{ slot: 'campaign', schema_version: 2, data: { version: 2 }, updated_at: '2026-10-16T02:00:00Z' }] }
    case 'POST /functions/v1/put-save': return { status: 200, body: { success: true, slot: 'campaign', schema_version: 2, updated_at: '2026-10-16T02:00:01Z' } }
    case 'POST /rest/v1/rpc/create_device_link': return { status: 200, body: [{ code: 'K7QX2MZP', expires_at: '2026-10-16T02:10:00Z' }] }
    case 'POST /rest/v1/rpc/redeem_device_link': return { status: 200, body: PLAYER }
    case 'GET /rest/v1/challenges': return { status: 200, body: [challengeRow('player')] }
    case 'POST /rest/v1/rpc/current_weekly_challenge': return { status: 200, body: [challengeRow('weekly')] }
    case 'GET /rest/v1/ghost_tracks': return { status: 200, body: [{ stride: 2, samples: 1, track: 'AQAAAAIAAAADAAAA' }] }
    default: return { status: 404, body: { message: `no canned answer for ${key}` } }
  }
}

function challengeRow(kind: 'player' | 'weekly') {
  return {
    id: CHALLENGE_ID, kind, seed: 444001, map_id: 'neon-helix', target_score: kind === 'weekly' ? 0 : 1670,
    challenger_name: kind === 'weekly' ? null : 'ACE', replay_id: kind === 'weekly' ? null : REPLAY_ID,
    cascade_seed: kind === 'weekly' ? 3282750858 : null, board: kind === 'weekly' ? 'weekly-2026-W42' : null,
    title: kind === 'weekly' ? 'Table of the week 2026-W42' : null,
    starts_at: '2026-10-12T00:00:00Z', expires_at: kind === 'weekly' ? '2026-10-19T00:00:00Z' : null,
  }
}

/** A real tape from the golden corpus, as the client uploads it. */
function replayPayload(): object {
  const tape = JSON.parse(readFileSync(resolve(__dirname, 'replays/vanilla-rally.json'), 'utf8')) as { replay: object }
  return JSON.parse(ReplayRecorder.toJSON(ReplayRecorder.fromJSON(tape.replay), true)) as object
}

let captured: Captured[] = []
let offline = false

function installFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : undefined
    captured.push({ method, url, headers: (init.headers ?? {}) as Record<string, string>, body })
    if (offline) throw new TypeError('Failed to fetch')
    const { status, body: out } = answer(method, url)
    const schema = responseSchema(url.pathname, method.toLowerCase(), status)
    if (schema) expect(schemaErrors(schema, out), `canned ${method} ${url.pathname}`).toEqual([])
    return new Response(JSON.stringify(out), { status, headers: { 'Content-Type': 'application/json' } })
  }))
}

async function arcade() {
  vi.resetModules()
  return import('../src/arcade/arcade-api')
}

function expectConformant(): void {
  expect(captured.length).toBeGreaterThan(0)
  for (const req of captured) {
    expect(contractProblems(req), `${req.method} ${req.url.pathname}${req.url.search}`).toEqual([])
  }
}

describe('arcade client ↔ docs/api/arcade.openapi.yaml (#444)', () => {
  beforeEach(() => {
    captured = []
    offline = false
    localStorage.clear()
    installFetch()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('leaderboard reads (vanilla and an adventure board) and the rank lookup', async () => {
    const api = await arcade()
    const rows = await api.fetchLeaderboard('neon-helix')
    await api.fetchLeaderboard('neon-helix', 'NEON_HELIX', 25)
    expect(await api.fetchPlayerRank('neon-helix', 5000)).toBe(3)
    expect(rows[0]?.name).toBe('ACE')
    expectConformant()
  })

  it('a finished run: anonymous sign-in, the replay, then the score citing it', async () => {
    const api = await arcade()
    const res = await api.submitRun(
      { name: 'ACE', score: 12000, map_id: 'neon-helix', balls: 1, combo_max: 4 },
      JSON.stringify(replayPayload()),
    )
    expect(res).toMatchObject({ success: true, rank: 3, score_id: 42 })
    expect(captured.map((r) => r.url.pathname)).toEqual(['/auth/v1/signup', '/functions/v1/submit-replay', '/functions/v1/submit-score'])
    expect(captured[2]?.body).toMatchObject({ replay_id: REPLAY_ID })
    expectConformant()
  })

  it('an expired session is refreshed, not replaced', async () => {
    localStorage.setItem('pachinball:arcade-session', JSON.stringify({
      access_token: 'old', refresh_token: 'refresh-old', expires_at: Math.floor(Date.now() / 1000) - 10, user_id: PLAYER,
    }))
    const api = await arcade()
    await api.createChallenge({ seed: 444001, targetScore: 50000, mapId: 'neon-helix', challengerName: 'ACE' })
    expect(captured.map((r) => r.url.pathname)).toEqual(['/auth/v1/token', '/functions/v1/create-challenge'])
    expect(captured[1]?.headers.Authorization).toBe('Bearer refreshed')
    expectConformant()
  })

  it('spectate fetches a stored payload the replay parser accepts', async () => {
    const api = await arcade()
    const raw = await api.fetchReplay(REPLAY_ID)
    expect(ReplayRecorder.fromJSON(raw!).frames.length).toBe(1200)
    expectConformant()
  })

  it('offline, a run is queued and sent later in the same shape', async () => {
    const api = await arcade()
    offline = true
    const res = await api.submitRun({ name: 'ACE', score: 9000, map_id: 'neon-helix', balls: 1, combo_max: 2 })
    expect(res).toMatchObject({ success: false, queued: true })
    expect(api.queuedRunCount()).toBe(1)

    offline = false
    captured = []
    expect(await api.flushQueuedRuns()).toBe(1)
    expect(api.queuedRunCount()).toBe(0)
    expect(captured.map((r) => r.url.pathname)).toEqual(['/auth/v1/signup', '/functions/v1/submit-score'])
    expectConformant()
  })

  it('cloud saves, device link codes, challenges v2, the table of the week and ghosts (Slice D)', async () => {
    const api = await arcade()
    expect(await api.pullSave()).toMatchObject({ slot: 'campaign', schema_version: 2 })
    await api.pushSave(2, { version: 2, progression: {} })
    expect(await api.createLinkCode()).toMatchObject({ code: 'K7QX2MZP' })
    expect(await api.redeemLinkCode('K7QX2MZP')).toBe(true)
    const challenge = await api.fetchChallenge(CHALLENGE_ID)
    expect(challenge).toMatchObject({ kind: 'player', replay_id: REPLAY_ID })
    expect(await api.fetchChallengeGhost(challenge!)).toMatchObject({ stride: 2, samples: 1 })
    const weekly = await api.fetchWeeklyChallenge()
    expect(weekly).toMatchObject({ kind: 'weekly', board: 'weekly-2026-W42' })
    // The weekly ghost is the best verified run on the week's board.
    captured = []
    await api.fetchChallengeGhost(weekly!)
    expect(captured[0]?.url.searchParams.get('verified')).toBe('is.true')
    await api.createChallenge({ seed: 444002, targetScore: 870, mapId: 'neon-helix', challengerName: 'ACE', replayId: REPLAY_ID, cascadeSeed: 20261016 })
    expect(captured.at(-1)?.body).toMatchObject({ cascadeSeed: 20261016 })
    expectConformant()
  })

  it('the checker catches drift: a renamed field, a missing token, an undeclared filter', () => {
    const base = { method: 'POST', headers: { apikey: 'k', Authorization: 'Bearer t' } }
    expect(contractProblems({ ...base, url: new URL('https://a/functions/v1/submit-score'), body: { name: 'ACE', points: 1, map_id: 'm' } })).not.toEqual([])
    expect(contractProblems({ ...base, headers: { apikey: 'k' }, url: new URL('https://a/functions/v1/submit-score'), body: { name: 'ACE', score: 1, map_id: 'm' } })).toContain('missing player bearer token')
    expect(contractProblems({ method: 'GET', headers: { apikey: 'k' }, url: new URL('https://a/rest/v1/leaderboard?select=*&map_id=eq.m&adventure_level=is.null&order=rank.asc&limit=10&score=gt.5'), body: undefined }))
      .toContain('undeclared query parameter score')
  })

  it('the Edge Functions validate with the patterns the contract publishes', () => {
    const schemas = spec.components.schemas
    expect(TAG.source).toBe((schemas.Tag as { pattern: string }).pattern)
    expect(MAP_ID.source).toBe((schemas.MapId as { pattern: string }).pattern)
    expect(UUID.source).toBe((schemas.Uuid as { pattern: string }).pattern)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiFetch, isIdempotentMethod, normalizeHeaders } from '../src/config/api'

function jsonResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: () => Promise.resolve(body),
  } as unknown as Response
}

function headersOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, string> {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit
  return init.headers as Record<string, string>
}

describe('apiFetch (#503 A4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it.each([
    ['a plain object', { 'Content-Type': 'application/json' }],
    ['a Headers instance', new Headers({ 'Content-Type': 'application/json' })],
    ['header tuples', [['Content-Type', 'application/json']] as [string, string][]],
  ])('keeps Accept when the caller passes %s', async (_label, headers) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiFetch('/x', { method: 'POST', headers, body: '{}' })).resolves.toEqual({ ok: 1 })
    const sent = headersOf(fetchMock)
    expect(sent.Accept).toBe('application/json')
    expect(sent['Content-Type'] ?? sent['content-type']).toBe('application/json')
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })

  it('never retries a POST that gets a 5xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500))
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiFetch('/x', { method: 'POST', body: '{}' })).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never retries a POST whose fetch rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiFetch('/x', { method: 'post', body: '{}' })).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a GET after a 5xx', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse(200, { n: 2 }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = apiFetch('/x')
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toEqual({ n: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('classifies methods', () => {
    expect(isIdempotentMethod(undefined)).toBe(true)
    expect(isIdempotentMethod('put')).toBe(true)
    expect(isIdempotentMethod('POST')).toBe(false)
    expect(isIdempotentMethod('PATCH')).toBe(false)
    expect(normalizeHeaders(undefined)).toEqual({})
  })
})

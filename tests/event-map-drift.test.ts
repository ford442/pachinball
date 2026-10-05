import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards `PachinballEventMap` against drift (#441): every declared key must be
 * emitted or subscribed to somewhere in `src/`. A key that is neither is dead
 * surface that readers (and the debug log) will assume is live.
 *
 * Source-scan test, like campaign-legacy-isolation.test.ts. It reads literal
 * `emit('key'` / `.on('key'` calls and the `CAMPAIGN_EVENTS` list that
 * EventBusLog subscribes through. If a call site ever builds its key
 * dynamically, add the key to `DYNAMIC_KEYS` with a comment saying where.
 */

const SRC = resolve('src')
const DYNAMIC_KEYS = new Set<string>([])

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

/** Drop comments so JSDoc examples such as `emit('x')` don't count as call sites. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

function declaredKeys(): string[] {
  const source = readFileSync(join(SRC, 'core/event-bus.ts'), 'utf8')
  const start = source.indexOf('export interface PachinballEventMap')
  const end = source.indexOf('/** Event name derived from the event map keys */')
  expect(start, 'PachinballEventMap not found').toBeGreaterThan(-1)
  expect(end, 'end marker not found').toBeGreaterThan(start)
  const body = stripComments(source.slice(start, end))
  return [...body.matchAll(/^\s{2}'([a-z0-9:-]+)'\s*:/gm)].map((m) => m[1]!)
}

function collect(pattern: RegExp): Set<string> {
  const found = new Set<string>()
  for (const file of walk(SRC)) {
    const source = stripComments(readFileSync(file, 'utf8'))
    for (const match of source.matchAll(pattern)) found.add(match[1]!)
  }
  return found
}

describe('PachinballEventMap drift', () => {
  const keys = declaredKeys()
  const emitted = collect(/\bemit\(\s*['"`]([a-z0-9:-]+)['"`]/g)
  const subscribed = collect(/\.(?:on|off)\(\s*['"`]([a-z0-9:-]+)['"`]/g)

  // EventBusLog subscribes through a list rather than literal `.on('key')` calls.
  const log = stripComments(readFileSync(join(SRC, 'game-elements/event-bus-log.ts'), 'utf8'))
  const logList = /const CAMPAIGN_EVENTS[^=]*=\s*\[([\s\S]*?)\]/.exec(log)
  const logged = new Set([...(logList?.[1] ?? '').matchAll(/'([a-z0-9:-]+)'/g)].map((m) => m[1]!))

  it('finds the map and the scan patterns', () => {
    expect(keys.length).toBeGreaterThan(50)
    expect(emitted.size).toBeGreaterThan(30)
    expect(subscribed.size).toBeGreaterThan(10)
    expect(logged.size).toBeGreaterThan(5)
  })

  it('declares no key that is neither emitted nor subscribed', () => {
    const dead = keys.filter(
      (key) => !emitted.has(key) && !subscribed.has(key) && !logged.has(key) && !DYNAMIC_KEYS.has(key),
    )
    expect(dead, `Dead PachinballEventMap keys — prune them or wire them: ${dead.join(', ')}`).toEqual([])
  })

  it('does not emit or subscribe to a key the map does not declare', () => {
    const declared = new Set(keys)
    const unknown = [...emitted, ...subscribed].filter((key) => !declared.has(key))
    expect(unknown, `Undeclared events: ${unknown.join(', ')}`).toEqual([])
  })
})

/**
 * The worker command union must not lag the embind surface again (#459).
 *
 * tests/fixtures/physics-worker-commands.json lists every `PhysicsWorld`
 * method native/src/bindings.cpp exports and the `PhysicsWorkerCommand` that
 * carries it (or an exemption with its reason), plus the union's own `type`
 * strings. Adding a binding without a command — or a command without updating
 * the manifest — fails here.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type Manifest = {
  commands: string[]
  embind: Record<string, string | { exempt: string }>
}

const root = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const manifest = JSON.parse(read('tests/fixtures/physics-worker-commands.json')) as Manifest

/** `.function("name"` entries of `class_<PhysicsWorld>`. */
function embindWorldMethods(): string[] {
  const src = read('native/src/bindings.cpp')
  const start = src.indexOf('class_<PhysicsWorld>')
  expect(start).toBeGreaterThan(-1)
  const block = src.slice(start)
  return [...block.matchAll(/\.function\("(\w+)"/g)].map((m) => m[1]!)
}

/** `type: '...'` members of the `PhysicsWorkerCommand` union. */
function workerCommandTypes(): string[] {
  const src = read('src/wasm/physics-worker-protocol.ts')
  const start = src.indexOf('export type PhysicsWorkerCommand =')
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('\nexport ', start + 1)
  const block = src.slice(start, end)
  return [...block.matchAll(/\{\s*type:\s*'(\w+)'/g)].map((m) => m[1]!)
}

describe('physics worker command manifest', () => {
  it('lists exactly the PhysicsWorkerCommand types', () => {
    expect([...workerCommandTypes()].sort()).toEqual([...manifest.commands].sort())
  })

  it('covers every embind PhysicsWorld method', () => {
    const methods = embindWorldMethods()
    expect(methods.length).toBeGreaterThan(40)
    const missing = methods.filter((m) => !(m in manifest.embind))
    expect(missing, 'add a PhysicsWorkerCommand (or an exemption) for these bindings').toEqual([])
    const stale = Object.keys(manifest.embind).filter((m) => !methods.includes(m))
    expect(stale, 'manifest names bindings that no longer exist').toEqual([])
  })

  it('maps each binding to a real command or a reasoned exemption', () => {
    const commands = new Set(manifest.commands)
    for (const [method, entry] of Object.entries(manifest.embind)) {
      if (typeof entry === 'string') {
        expect(commands.has(entry), `${method} → ${entry}`).toBe(true)
      } else {
        expect(entry.exempt.length, `${method} exemption needs a reason`).toBeGreaterThan(0)
      }
    }
  })
})

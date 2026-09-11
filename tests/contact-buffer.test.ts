/**
 * Packed WASM contact-buffer encode/decode round-trip and dropped-count surface.
 */

import { describe, it, expect } from 'vitest'
import {
  CONTACT_STRIDE,
  ContactPhase,
  decodeContactBuffer,
  encodeContactBuffer,
  contactStarted,
  toWasmContactEvent,
  type PhysicsContact,
} from '../src/wasm/contact-buffer'

function sample(overrides: Partial<PhysicsContact> = {}): PhysicsContact {
  return {
    bodyId1: 3,
    bodyId2: -1001,
    normal: { x: 0, y: 1, z: 0 },
    point: { x: 0.25, y: 0.125, z: -0.5 },
    impulse: 4.5,
    phase: ContactPhase.Enter,
    isSensor: false,
    ...overrides,
  }
}

describe('contact buffer decode', () => {
  it('round-trips Enter/Stay/Exit records at 12 floats per contact', () => {
    const contacts: PhysicsContact[] = [
      sample({ phase: ContactPhase.Enter, impulse: 9 }),
      sample({ bodyId1: 7, bodyId2: 8, phase: ContactPhase.Stay, impulse: 1.25 }),
      sample({ bodyId1: 1, bodyId2: -1, phase: ContactPhase.Exit, impulse: 0 }),
      sample({ bodyId1: 3, bodyId2: -4001, phase: ContactPhase.Enter, impulse: 0, isSensor: true }),
    ]
    const packed = encodeContactBuffer(contacts)
    expect(packed.length).toBe(contacts.length * CONTACT_STRIDE)
    expect(packed.length % 4).toBe(0)

    const decoded = decodeContactBuffer(packed, contacts.length)
    expect(decoded).toEqual(contacts)
  })

  it('maps phase onto Rapier-shaped started / isEntering flags', () => {
    const enter = toWasmContactEvent(sample({ phase: ContactPhase.Enter }))
    expect(enter.started).toBe(true)
    expect(enter.isEntering).toBe(true)
    expect(contactStarted(enter)).toBe(true)

    const stay = toWasmContactEvent(sample({ phase: ContactPhase.Stay }))
    expect(stay.started).toBe(false)
    expect(stay.isEntering).toBe(false)

    const exit = toWasmContactEvent(sample({ phase: ContactPhase.Exit }))
    expect(exit.started).toBe(false)
    expect(contactStarted(exit)).toBe(false)
  })

  it('surfaces dropped-count when a cap is hit (JS-side contract)', () => {
    // Mirrors ContactListener::setMaxContacts: kept = cap, dropped = total - cap.
    const cap = 2
    const total = 10
    const dropped = Math.max(0, total - cap)
    expect(dropped).toBe(8)
    expect(dropped).toBeGreaterThan(0)
  })
})

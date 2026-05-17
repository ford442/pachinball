import { describe, expect, test } from 'vitest'
import { CheckpointDebugController } from '../src/game/checkpoint-debug'

class MemoryStorage {
  private readonly store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

describe('CheckpointDebugController', () => {
  test('reads enabled stages from URL override', () => {
    const storage = new MemoryStorage()
    storage.setItem('pachinball.debugStages', 'settings_ui,physics')

    const controller = new CheckpointDebugController({
      search: '?debug=1&debugStages=physics,scene_rendering',
      storage,
      documentRef: null,
      historyRef: null,
      locationRef: null,
    })

    expect(controller.isEnabled()).toBe(true)
    expect(controller.isStageEnabled('physics')).toBe(true)
    expect(controller.isStageEnabled('scene_rendering')).toBe(true)
    expect(controller.isStageEnabled('settings_ui')).toBe(false)
  })

  test('falls back to local storage stage preferences', () => {
    const storage = new MemoryStorage()
    storage.setItem('pachinball.debugStages', 'settings_ui,scene_gameplay')

    const controller = new CheckpointDebugController({
      search: '',
      storage,
      documentRef: null,
      historyRef: null,
      locationRef: null,
    })

    expect(controller.isStageEnabled('settings_ui')).toBe(true)
    expect(controller.isStageEnabled('scene_gameplay')).toBe(true)
    expect(controller.isStageEnabled('physics')).toBe(false)
  })

  test('tracks stage status and timing during execution', async () => {
    const controller = new CheckpointDebugController({
      search: '',
      storage: new MemoryStorage(),
      documentRef: null,
      historyRef: null,
      locationRef: null,
    })

    await controller.runStage('physics', async () => {
      await Promise.resolve()
    })
    const snapshot = controller.getStageSnapshot('physics')
    expect(snapshot.status).toBe('success')
    expect(snapshot.durationMs).not.toBeNull()
    expect(snapshot.error).toBeNull()
  })
})

import { describe, expect, test, vi } from 'vitest'
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

describe('CheckpointDebugController.describeProgress', () => {
  const make = () =>
    new CheckpointDebugController({
      search: '',
      storage: new MemoryStorage(),
      documentRef: null,
      historyRef: null,
      locationRef: null,
    })

  test('says so before any stage has started', () => {
    expect(make().describeProgress()).toBe('no stage started')
  })

  test('names every stage still loading (what a stalled boot is waiting on)', async () => {
    const controller = make()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = controller.runStage('physics', () => gate)
    const second = controller.runStage('scene_rendering', () => gate)
    expect(controller.describeProgress()).toBe(
      'physics (Physics world init), scene_rendering (Scene rendering systems)',
    )

    release()
    await Promise.all([first, second])
  })

  test('falls back to the stage that started last once nothing is loading, including a failed one', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const controller = make()

    await controller.runStage('settings_ui', () => undefined)
    await expect(
      controller.runStage('physics', () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(controller.describeProgress()).toBe('physics (Physics world init)')
    errorSpy.mockRestore()
  })
})

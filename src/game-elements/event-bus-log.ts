/**
 * EventBus log — ring buffer of recent game events for the debug HUD.
 */

import type { EventBus, PachinballEventMap, PachinballEventName } from '../game/event-bus'

export interface EventBusLogEntry {
  timestampMs: number
  event: PachinballEventName
  summary: string
}

const CAMPAIGN_EVENTS: PachinballEventName[] = [
  'portal:open',
  'portal:entered',
  'portal:activation-failed',
  'track:goal-reached',
  'track:timeout',
  'track:completed',
  'track:unlocked',
  'goal:progress',
  'goal:completed',
  'track:progress',
  'adventure:start',
  'adventure:end',
  'state:change',
  'display:set',
  'effect:flash',
  'effect:bloom',
  'effect:shake',
]

export class EventBusLog {
  private entries: EventBusLogEntry[] = []
  private unsubscribers: Array<() => void> = []
  private enabled = false

  constructor(private readonly maxEntries = 14) {}

  wire(eventBus: EventBus, events: readonly PachinballEventName[] = CAMPAIGN_EVENTS): void {
    this.dispose()
    for (const event of events) {
      this.unsubscribers.push(
        eventBus.on(event, (payload) => {
          if (!this.enabled) return
          this.record(event, payload)
        }),
      )
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.entries = []
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  record(event: PachinballEventName, payload?: PachinballEventMap[PachinballEventName]): void {
    const summary =
      payload === undefined
        ? ''
        : typeof payload === 'object'
          ? JSON.stringify(payload).slice(0, 96)
          : String(payload).slice(0, 96)

    this.entries.push({
      timestampMs: performance.now(),
      event,
      summary,
    })

    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries)
    }
  }

  getEntries(): readonly EventBusLogEntry[] {
    return this.entries
  }

  getPanelData(): Record<string, string | number> {
    const panel: Record<string, string | number> = { count: this.entries.length }
    const recent = this.entries.slice(-6).reverse()
    for (const [index, entry] of recent.entries()) {
      panel[`${index + 1}`] = entry.summary
        ? `${entry.event} ${entry.summary}`
        : entry.event
    }
    return panel
  }

  clear(): void {
    this.entries = []
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
    this.entries = []
    this.enabled = false
  }
}
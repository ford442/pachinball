import type { EventBus } from '../game/event-bus'
import type { SoundSystem } from './sound-system'

export function bindSoundEventBindings(soundSystem: SoundSystem, eventBus: EventBus): void {
  const ss = soundSystem

  ss.addEventBusUnsubscriber(
    eventBus.on('game:start', () => {
      ss.playSample('launch', undefined, 0.8)
    }),
  )

  ss.addEventBusUnsubscriber(
    eventBus.on('game:over', () => {
      ss.playSample('drain', undefined, 0.8)
    }),
  )

  ss.addEventBusUnsubscriber(
    eventBus.on('fever:start', () => {
      ss.triggerFeverAudio()
      void ss.playMusicStem('fever')
    }),
  )

  ss.addEventBusUnsubscriber(
    eventBus.on('fever:end', () => {
      void ss.playMusicStem('attract')
    }),
  )

  ss.addEventBusUnsubscriber(
    eventBus.on('jackpot:start', () => {
      ss.triggerJackpotAudio()
    }),
  )

  ss.addEventBusUnsubscriber(
    eventBus.on('jackpot:phase', ({ phase }) => {
      ss.playJackpotPhase(phase)
    }),
  )

  ss.addEventBusUnsubscriber(
    eventBus.on('jackpot:end', () => {
      ss.resetJackpotPhaseAudio()
    }),
  )

  ss.addEventBusUnsubscriber(
    eventBus.on('adventure:end', () => {
      ss.playBeep(440)
    }),
  )

  ss.addEventBusUnsubscriber(
    eventBus.on('display:set', (state) => {
      if (state === 'fever') {
        ss.triggerFeverAudio()
      }
    }),
  )

  ss.addEventBusUnsubscriber(
    eventBus.on('slot:spin:start', () => {
      ss.playSlotSpinStart()
    }),
  )

  ss.addEventBusUnsubscriber(
    eventBus.on('slot:reel:stop', ({ reelIndex }) => {
      ss.playReelStop(reelIndex)
    }),
  )

  ss.addEventBusUnsubscriber(
    eventBus.on('slot:win', ({ multiplier }) => {
      ss.playSlotWin(multiplier)
    }),
  )

  ss.addEventBusUnsubscriber(
    eventBus.on('slot:jackpot', () => {
      ss.playSlotJackpot()
    }),
  )

  ss.addEventBusUnsubscriber(
    eventBus.on('slot:nearmiss', () => {
      ss.playNearMiss()
    }),
  )

  ss.addEventBusUnsubscriber(
    eventBus.on('sound:play', ({ soundKey, volume = 1, pitch = 1 }) => {
      const velocity = Math.max(0.5, Math.min(24, volume * pitch * 12))
      switch (soundKey) {
        case 'trap-catch':
        case 'trap-release':
          ss.playImpact('peg', velocity)
          return
        case 'trap-release-timeout':
          ss.playImpact('drain', velocity * 0.8)
          return
        case 'bump-spinner':
          ss.playImpact('bumper', velocity)
          return
        case 'launcher-fire':
        case 'launcher-trigger':
          ss.playImpact('launch', velocity * 1.2)
          return
        case 'gate-open':
          ss.playImpact('peg', velocity * 0.9)
          return
        case 'portal-open-success':
          ss.playImpact('jackpot', velocity * 1.4, { premium: true })
          return
        case 'portal-open-timeout':
          ss.playImpact('drain', velocity * 1.1)
          return
        case 'portal-enter':
          ss.playPortalEnter(true)
          return
        default:
          break
      }
    }),
  )
}

import type * as RAPIER from '@dimforge/rapier3d-compat'
import { GameState } from './types'

export class InputHandler {
  private onFlipperLeft: (pressed: boolean) => void
  private onFlipperRight: (pressed: boolean) => void
  private onPlunger: () => void
  private onNudge: (direction: RAPIER.Vector3) => void
  private onPause: () => void
  private onReset: () => void
  private onStart: () => void
  private onAdventureToggle: () => void
  private onJackpotTrigger?: () => void
  private getState: () => GameState
  private getTiltActive: () => boolean
  private rapier: typeof RAPIER | null = null

  constructor(
    handlers: {
      onFlipperLeft: (pressed: boolean) => void
      onFlipperRight: (pressed: boolean) => void
      onPlunger: () => void
      onNudge: (direction: RAPIER.Vector3) => void
      onPause: () => void
      onReset: () => void
      onStart: () => void
      onAdventureToggle: () => void
      onJackpotTrigger?: () => void
      getState: () => GameState
      getTiltActive: () => boolean
    },
    rapier: typeof RAPIER | null
  ) {
    this.onFlipperLeft = handlers.onFlipperLeft
    this.onFlipperRight = handlers.onFlipperRight
    this.onPlunger = handlers.onPlunger
    this.onNudge = handlers.onNudge
    this.onPause = handlers.onPause
    this.onReset = handlers.onReset
    this.onStart = handlers.onStart
    this.onAdventureToggle = handlers.onAdventureToggle
    this.onJackpotTrigger = handlers.onJackpotTrigger
    this.getState = handlers.getState
    this.getTiltActive = handlers.getTiltActive
    this.rapier = rapier
  }

  setRapier(rapier: typeof RAPIER): void {
    this.rapier = rapier
  }

  handleKeyDown = (event: KeyboardEvent): void => {
    // console.log('Key down:', event.code, event.key, this.getState())
    if (!this.rapier) return
    
    if (event.code === 'KeyP') {
      this.onPause()
      return
    }
    
    if (event.code === 'KeyR' && this.getState() === GameState.PLAYING) {
      this.onReset()
      return
    }
    
    if ((event.code === 'Space' || event.code === 'Enter') && this.getState() === GameState.MENU) {
      this.onStart()
      return
    }
    
    if (this.getState() !== GameState.PLAYING) return

    if (event.code === 'ArrowLeft' || event.code === 'KeyZ') {
      if (this.getTiltActive()) return
      this.onFlipperLeft(true)
    }
    
    if (event.code === 'ArrowRight' || event.code === 'Slash') {
      if (this.getTiltActive()) return
      this.onFlipperRight(true)
    }
    
    if (event.code === 'Space' || event.code === 'Enter') {
      this.onPlunger()
    }
    
    if (event.code === 'KeyQ') {
      this.onNudge(new this.rapier.Vector3(-0.6, 0, 0.3))
    }
    
    if (event.code === 'KeyE') {
      this.onNudge(new this.rapier.Vector3(0.6, 0, 0.3))
    }
    
    if (event.code === 'KeyW') {
      this.onNudge(new this.rapier.Vector3(0, 0, 0.8))
    }
    
    if (event.code === 'KeyH') {
      this.onAdventureToggle()
    }

    if (event.code === 'KeyJ' && this.onJackpotTrigger) {
      this.onJackpotTrigger()
    }
  }

  handleKeyUp = (event: KeyboardEvent): void => {
    if (!this.rapier || this.getState() !== GameState.PLAYING) return
    
    if (event.code === 'ArrowLeft' || event.code === 'KeyZ') {
      this.onFlipperLeft(false)
    }
    
    if (event.code === 'ArrowRight' || event.code === 'Slash') {
      this.onFlipperRight(false)
    }
  }

  setupTouchControls(
    leftBtn: HTMLElement | null,
    rightBtn: HTMLElement | null,
    plungerBtn: HTMLElement | null,
    nudgeBtn: HTMLElement | null
  ): void {
    if (!this.rapier) return
    
    leftBtn?.addEventListener('touchstart', (e) => {
      e.preventDefault()
      this.onFlipperLeft(true)
    })
    
    rightBtn?.addEventListener('touchstart', (e) => {
      e.preventDefault()
      this.onFlipperRight(true)
    })
    
    plungerBtn?.addEventListener('touchstart', (e) => {
      e.preventDefault()
      this.onPlunger()
    })
    
    nudgeBtn?.addEventListener('touchstart', (e) => {
      e.preventDefault()
      this.onNudge(new this.rapier!.Vector3(0, 0, 1))
    })
  }
}

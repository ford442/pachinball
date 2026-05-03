export class AudioEffects {
  private audioCtx: AudioContext | null

  constructor(audioCtx: AudioContext | null) {
    this.audioCtx = audioCtx
  }

  playBeep(freq: number): void {
    if (!this.audioCtx) return

    const o = this.audioCtx.createOscillator()
    const g = this.audioCtx.createGain()

    o.frequency.value = freq
    o.connect(g)
    g.connect(this.audioCtx.destination)
    o.start()

    g.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.1)
    o.stop(this.audioCtx.currentTime + 0.1)
  }

  playSlotSpinStart(): void {
    if (!this.audioCtx) return

    const o = this.audioCtx.createOscillator()
    const g = this.audioCtx.createGain()

    o.type = 'sawtooth'
    o.frequency.setValueAtTime(200, this.audioCtx.currentTime)
    o.frequency.exponentialRampToValueAtTime(800, this.audioCtx.currentTime + 0.3)

    g.gain.setValueAtTime(0.3, this.audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.5)

    o.connect(g)
    g.connect(this.audioCtx.destination)
    o.start()
    o.stop(this.audioCtx.currentTime + 0.5)
  }

  playReelStop(reelIndex: number): void {
    if (!this.audioCtx) return

    const baseFreq = 400 + reelIndex * 100
    const o = this.audioCtx.createOscillator()
    const g = this.audioCtx.createGain()

    o.type = 'square'
    o.frequency.setValueAtTime(baseFreq, this.audioCtx.currentTime)
    o.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, this.audioCtx.currentTime + 0.05)

    g.gain.setValueAtTime(0.2, this.audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.1)

    o.connect(g)
    g.connect(this.audioCtx.destination)
    o.start()
    o.stop(this.audioCtx.currentTime + 0.1)
  }

  playSlotWin(multiplier: number): void {
    if (!this.audioCtx) return

    const notes = [523.25, 659.25, 783.99, 1046.5]
    const duration = 0.1 * multiplier

    notes.forEach((freq, i) => {
      setTimeout(() => {
        if (!this.audioCtx) return
        const o = this.audioCtx.createOscillator()
        const g = this.audioCtx.createGain()

        o.type = 'sine'
        o.frequency.value = freq

        g.gain.setValueAtTime(0.3, this.audioCtx.currentTime)
        g.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + duration)

        o.connect(g)
        g.connect(this.audioCtx.destination)
        o.start()
        o.stop(this.audioCtx.currentTime + duration)
      }, i * 100)
    })
  }

  playSlotJackpot(): void {
    if (!this.audioCtx) return

    const now = this.audioCtx.currentTime

    for (let i = 0; i < 8; i++) {
      const o = this.audioCtx.createOscillator()
      const g = this.audioCtx.createGain()

      o.type = 'sawtooth'
      o.frequency.value = 100 + Math.random() * 50

      g.gain.setValueAtTime(0.2, now + i * 0.1)
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.1 + 0.08)

      o.connect(g)
      g.connect(this.audioCtx.destination)
      o.start(now + i * 0.1)
      o.stop(now + i * 0.1 + 0.1)
    }

    setTimeout(() => {
      if (!this.audioCtx) return
      const chord = [523.25, 659.25, 783.99, 1046.5]
      chord.forEach((freq, i) => {
        const o = this.audioCtx!.createOscillator()
        const g = this.audioCtx!.createGain()

        o.type = i === 0 ? 'sawtooth' : 'sine'
        o.frequency.value = freq * 2

        g.gain.setValueAtTime(i === 0 ? 0.4 : 0.2, this.audioCtx!.currentTime)
        g.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx!.currentTime + 1.5)

        o.connect(g)
        g.connect(this.audioCtx!.destination)
        o.start()
        o.stop(this.audioCtx!.currentTime + 1.5)
      })
    }, 800)
  }

  playNearMiss(): void {
    if (!this.audioCtx) return

    const o = this.audioCtx.createOscillator()
    const g = this.audioCtx.createGain()

    o.type = 'sine'
    o.frequency.setValueAtTime(400, this.audioCtx.currentTime)
    o.frequency.exponentialRampToValueAtTime(200, this.audioCtx.currentTime + 0.3)

    g.gain.setValueAtTime(0.3, this.audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.3)

    o.connect(g)
    g.connect(this.audioCtx.destination)
    o.start()
    o.stop(this.audioCtx.currentTime + 0.3)
  }

  dispose(): void {
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {})
    }
  }
}

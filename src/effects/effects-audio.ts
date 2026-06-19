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

  /** Mag-Spin charge: rising pitch sweep over the spin duration. */
  playMagSpinCharge(duration = 1.2): void {
    if (!this.audioCtx) return

    const now = this.audioCtx.currentTime
    const o = this.audioCtx.createOscillator()
    const g = this.audioCtx.createGain()

    o.type = 'sawtooth'
    o.frequency.setValueAtTime(280, now)
    o.frequency.exponentialRampToValueAtTime(1400, now + duration * 0.92)

    g.gain.setValueAtTime(0.22, now)
    g.gain.linearRampToValueAtTime(0.32, now + duration * 0.75)
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration)

    o.connect(g)
    g.connect(this.audioCtx.destination)
    o.start(now)
    o.stop(now + duration)
  }

  /** Mag-Spin release: short impactful burst. */
  playMagSpinRelease(): void {
    if (!this.audioCtx) return

    const now = this.audioCtx.currentTime
    const o = this.audioCtx.createOscillator()
    const g = this.audioCtx.createGain()

    o.type = 'square'
    o.frequency.setValueAtTime(900, now)
    o.frequency.exponentialRampToValueAtTime(180, now + 0.12)

    g.gain.setValueAtTime(0.35, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)

    o.connect(g)
    g.connect(this.audioCtx.destination)
    o.start(now)
    o.stop(now + 0.2)
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

  /** Phase 1: Harsh alarm siren + sub-bass drop */
  playJackpotAlarm(): void {
    if (!this.audioCtx) return
    const now = this.audioCtx.currentTime

    // Sub-bass drop
    const sub = this.audioCtx.createOscillator()
    const subG = this.audioCtx.createGain()
    sub.type = 'sine'
    sub.frequency.setValueAtTime(48, now)
    subG.gain.setValueAtTime(0.6, now)
    subG.gain.exponentialRampToValueAtTime(0.0001, now + 1.2)
    sub.connect(subG)
    subG.connect(this.audioCtx.destination)
    sub.start(now)
    sub.stop(now + 1.3)

    // Siren sweep (fast rising/falling)
    const siren = this.audioCtx.createOscillator()
    const sG = this.audioCtx.createGain()
    siren.type = 'sawtooth'
    siren.frequency.setValueAtTime(620, now)
    siren.frequency.linearRampToValueAtTime(980, now + 0.25)
    siren.frequency.linearRampToValueAtTime(620, now + 0.5)
    sG.gain.setValueAtTime(0.25, now)
    sG.gain.exponentialRampToValueAtTime(0.0001, now + 0.6)
    siren.connect(sG)
    sG.connect(this.audioCtx.destination)
    siren.start(now)
    siren.stop(now + 0.65)
  }

  /** Phase 2: Rising turbine / whine */
  playJackpotTurbine(duration = 2.8): void {
    if (!this.audioCtx) return
    const now = this.audioCtx.currentTime

    const o = this.audioCtx.createOscillator()
    const g = this.audioCtx.createGain()
    const filter = this.audioCtx.createBiquadFilter()

    o.type = 'sawtooth'
    o.frequency.setValueAtTime(140, now)
    o.frequency.exponentialRampToValueAtTime(920, now + duration)

    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(600, now)
    filter.Q.setValueAtTime(1.8, now)

    g.gain.setValueAtTime(0.0001, now)
    g.gain.linearRampToValueAtTime(0.22, now + 0.2)
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration)

    o.connect(filter)
    filter.connect(g)
    g.connect(this.audioCtx.destination)
    o.start(now)
    o.stop(now + duration + 0.05)
  }

  /** Phase 3: Explosion + heavy techno impact */
  playJackpotExplosion(): void {
    if (!this.audioCtx) return
    const now = this.audioCtx.currentTime

    // Noise burst (explosion body)
    const noise = this.audioCtx.createBufferSource()
    const buffer = this.audioCtx.createBuffer(1, this.audioCtx.sampleRate * 1.2, this.audioCtx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    noise.buffer = buffer

    const noiseFilter = this.audioCtx.createBiquadFilter()
    noiseFilter.type = 'lowpass'
    noiseFilter.frequency.setValueAtTime(1200, now)

    const nG = this.audioCtx.createGain()
    nG.gain.setValueAtTime(0.7, now)
    nG.gain.exponentialRampToValueAtTime(0.0001, now + 0.9)

    noise.connect(noiseFilter)
    noiseFilter.connect(nG)
    nG.connect(this.audioCtx.destination)
    noise.start(now)

    // Low sine punch
    const punch = this.audioCtx.createOscillator()
    const pG = this.audioCtx.createGain()
    punch.type = 'sine'
    punch.frequency.setValueAtTime(48, now)
    pG.gain.setValueAtTime(0.9, now)
    pG.gain.exponentialRampToValueAtTime(0.0001, now + 0.6)
    punch.connect(pG)
    pG.connect(this.audioCtx.destination)
    punch.start(now)
    punch.stop(now + 0.7)

    // Techno stabs (short saw chords)
    setTimeout(() => {
      if (!this.audioCtx) return
      const t = this.audioCtx.currentTime
      const notes = [110, 146.8, 220]
      notes.forEach((f, i) => {
        const o = this.audioCtx!.createOscillator()
        const g = this.audioCtx!.createGain()
        o.type = 'sawtooth'
        o.frequency.value = f * (i === 0 ? 1 : 2)
        g.gain.setValueAtTime(0.18, t + i * 0.04)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 + i * 0.04)
        o.connect(g)
        g.connect(this.audioCtx!.destination)
        o.start(t + i * 0.04)
        o.stop(t + 0.45 + i * 0.04)
      })
    }, 120)
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

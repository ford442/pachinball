export type ComboHitType = 'bumper' | 'spinner' | 'gate' | 'trap' | 'launcher'

export interface ComboNamedChain {
  name: string
  sequence: ComboHitType[]
  bonusPoints: number
  multiplierBonus: number
}

export interface ComboSystemConfig {
  expirySeconds: number
  chainWindowSeconds: number
  chainDistinctThreshold: number
  chainMultiplier: number
  chainCooldownSeconds: number
  namedChains: ComboNamedChain[]
}

interface ComboHitRecord {
  type: ComboHitType
  timeSeconds: number
}

export interface ComboChainResolution {
  triggered: boolean
  chainLength: number
  chainMultiplier: number
  namedChain: ComboNamedChain | null
  bonusPoints: number
}

export interface ComboRegisterResult {
  comboCount: number
  comboTimer: number
  event: 'started' | 'extended' | null
  chain: ComboChainResolution
  lastType: ComboHitType | null
}

export interface ComboBreakState {
  finalComboCount: number
  chainLength: number
  lastType: ComboHitType | null
}

export interface ComboSnapshot {
  comboCount: number
  comboTimer: number
  chainProgress: number
  chainTarget: number
  lastType: ComboHitType | null
}

export class ComboSystem {
  private readonly config: ComboSystemConfig
  private comboCount = 0
  private comboTimer = 0
  private chainHits: ComboHitRecord[] = []
  private lastType: ComboHitType | null = null
  private lastChainTriggerAtSeconds = Number.NEGATIVE_INFINITY
  private lastChainLength = 0

  constructor(config: ComboSystemConfig) {
    this.config = config
  }

  registerBumperHit(nowSeconds: number): ComboRegisterResult {
    const wasInactive = this.comboTimer <= 0 || this.comboCount <= 0
    this.comboCount += 1
    this.comboTimer = this.config.expirySeconds
    const chain = this.recordChainHit('bumper', nowSeconds)
    return {
      comboCount: this.comboCount,
      comboTimer: this.comboTimer,
      event: wasInactive ? 'started' : 'extended',
      chain,
      lastType: this.lastType,
    }
  }

  registerChainHit(type: ComboHitType, nowSeconds: number): ComboRegisterResult {
    if (this.comboTimer <= 0 || this.comboCount <= 0) {
      return {
        comboCount: this.comboCount,
        comboTimer: this.comboTimer,
        event: null,
        chain: {
          triggered: false,
          chainLength: this.lastChainLength,
          chainMultiplier: 1,
          namedChain: null,
          bonusPoints: 0,
        },
        lastType: this.lastType,
      }
    }

    const chain = this.recordChainHit(type, nowSeconds)
    return {
      comboCount: this.comboCount,
      comboTimer: this.comboTimer,
      event: 'extended',
      chain,
      lastType: this.lastType,
    }
  }

  update(dtSeconds: number): ComboBreakState | null {
    if (this.comboTimer <= 0) return null

    this.comboTimer = Math.max(0, this.comboTimer - dtSeconds)
    if (this.comboTimer > 0) return null
    return this.breakCombo()
  }

  breakCombo(): ComboBreakState | null {
    if (this.comboCount <= 0 && this.chainHits.length <= 0) return null
    const finalState: ComboBreakState = {
      finalComboCount: this.comboCount,
      chainLength: this.lastChainLength,
      lastType: this.lastType,
    }
    this.comboCount = 0
    this.comboTimer = 0
    this.chainHits = []
    this.lastType = null
    this.lastChainTriggerAtSeconds = Number.NEGATIVE_INFINITY
    this.lastChainLength = 0
    return finalState
  }

  getSnapshot(): ComboSnapshot {
    return {
      comboCount: this.comboCount,
      comboTimer: this.comboTimer,
      chainProgress: this.lastChainLength,
      chainTarget: this.config.chainDistinctThreshold,
      lastType: this.lastType,
    }
  }

  private recordChainHit(type: ComboHitType, nowSeconds: number): ComboChainResolution {
    this.lastType = type
    this.chainHits.push({ type, timeSeconds: nowSeconds })
    const minTime = nowSeconds - this.config.chainWindowSeconds
    this.chainHits = this.chainHits.filter((entry) => entry.timeSeconds >= minTime)

    const distinctOrdered: ComboHitType[] = []
    const seen = new Set<ComboHitType>()
    for (const entry of this.chainHits) {
      if (!seen.has(entry.type)) {
        distinctOrdered.push(entry.type)
        seen.add(entry.type)
      }
    }
    this.lastChainLength = distinctOrdered.length

    const namedChain = this.resolveNamedChain()
    const canTriggerDistinctChain = distinctOrdered.length >= this.config.chainDistinctThreshold
    const canTriggerByCooldown = nowSeconds - this.lastChainTriggerAtSeconds >= this.config.chainCooldownSeconds
    const canTrigger = canTriggerByCooldown && (canTriggerDistinctChain || namedChain !== null)
    if (!canTrigger) {
      return {
        triggered: false,
        chainLength: distinctOrdered.length,
        chainMultiplier: 1,
        namedChain: null,
        bonusPoints: 0,
      }
    }

    this.lastChainTriggerAtSeconds = nowSeconds
    const chainMultiplier = this.config.chainMultiplier + (namedChain?.multiplierBonus ?? 0)
    return {
      triggered: true,
      chainLength: distinctOrdered.length,
      chainMultiplier,
      namedChain,
      bonusPoints: namedChain?.bonusPoints ?? 0,
    }
  }

  private resolveNamedChain(): ComboNamedChain | null {
    const recentTypes = this.chainHits.map((entry) => entry.type)
    for (const chain of this.config.namedChains) {
      if (chain.sequence.length > recentTypes.length) continue
      const offset = recentTypes.length - chain.sequence.length
      let match = true
      for (let i = 0; i < chain.sequence.length; i++) {
        if (recentTypes[offset + i] !== chain.sequence[i]) {
          match = false
          break
        }
      }
      if (match) return chain
    }
    return null
  }
}

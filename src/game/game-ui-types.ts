export interface PopupConfig {
  duration?: number
  fadeIn?: number
  fadeOut?: number
}

export interface HUDData {
  score: number
  lives: number
  ballsInPlay?: number
  combo?: number
  scoreMultiplier?: number
  maxCombo?: number
  bestScore?: number
}

export interface GoldBallCounts {
  goldPlated: number
  solidGold: number
}

export interface AdventureGoal {
  description: string
  current: number
  target: number
}

export interface AdventureLevel {
  name: string
  goals: AdventureGoal[]
}

export interface ScoringBreakdownDisplayOptions {
  finalScore?: number
  bestScore?: number
  bestDelta?: number
  rewardShards?: number
  autoDismissMs?: number
}

export interface PauseMenuSettings {
  masterVolume: number
  shakeEnabled: boolean
  scanlinesEnabled: boolean
  qualityPreset: 'low' | 'medium' | 'high'
  reducedMotion: boolean
  photosensitiveMode: boolean
}

export interface PauseMenuHandlers {
  onResume: () => void
  onRestart: () => void
  onSettingsChange: (next: PauseMenuSettings) => void
}

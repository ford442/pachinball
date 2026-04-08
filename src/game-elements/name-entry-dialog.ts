/**
 * Name Entry Dialog
 * 
 * Retro arcade-style 3-letter name entry for high scores.
 * Appears on game over if score qualifies for leaderboard.
 */

export interface NameEntryResult {
  name: string
  submitted: boolean
}

export class NameEntryDialog {
  private overlay: HTMLElement | null = null
  private currentName: string[] = ['A', 'A', 'A']
  private currentPosition = 0
  private score = 0
  private rank = 0
  private resolveCallback: ((result: NameEntryResult) => void) | null = null

  /**
   * Show the name entry dialog
   */
  show(score: number, rank: number): Promise<NameEntryResult> {
    this.score = score
    this.rank = rank
    this.currentName = ['A', 'A', 'A']
    this.currentPosition = 0
    
    return new Promise((resolve) => {
      this.resolveCallback = resolve
      this.createOverlay()
      this.updateDisplay()
      this.setupInput()
    })
  }

  /**
   * Hide and cleanup
   */
  hide(): void {
    this.overlay?.remove()
    this.overlay = null
  }

  private createOverlay(): void {
    if (document.getElementById('name-entry-overlay')) return
    
    const overlay = document.createElement('div')
    overlay.id = 'name-entry-overlay'
    overlay.innerHTML = `
      <div class="name-entry-panel">
        <div class="name-entry-header">GAME OVER</div>
        <div class="name-entry-score">
          <span class="score-label">SCORE</span>
          <span class="score-value">${this.score.toLocaleString()}</span>
        </div>
        <div class="name-entry-rank">RANK #${this.rank}</div>
        <div class="name-entry-prompt">ENTER NAME</div>
        <div class="name-entry-letters">
          <span class="letter" data-pos="0">A</span>
          <span class="letter" data-pos="1">A</span>
          <span class="letter" data-pos="2">A</span>
        </div>
        <div class="name-entry-instructions">
          <span>↑↓ CHANGE LETTER</span>
          <span>←→ MOVE</span>
          <span>ENTER SUBMIT</span>
        </div>
      </div>
    `
    
    // Add styles
    const style = document.createElement('style')
    style.textContent = `
      #name-entry-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
        animation: fadeIn 0.3s ease;
      }
      
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .name-entry-panel {
        background: rgba(0, 10, 20, 0.95);
        border: 3px solid var(--map-accent, #00d9ff);
        border-radius: 8px;
        padding: 40px 60px;
        text-align: center;
        box-shadow: 
          0 0 40px rgba(0, 217, 255, 0.4),
          inset 0 0 60px rgba(0, 217, 255, 0.1);
        animation: slideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      
      @keyframes slideIn {
        from { 
          opacity: 0;
          transform: scale(0.8) translateY(20px);
        }
        to { 
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }
      
      .name-entry-header {
        font-family: 'Orbitron', sans-serif;
        font-size: 2rem;
        font-weight: 900;
        color: #ff0055;
        text-shadow: 
          0 0 10px #ff0055,
          0 0 20px #ff0055;
        margin-bottom: 20px;
        letter-spacing: 4px;
      }
      
      .name-entry-score {
        margin-bottom: 10px;
      }
      
      .score-label {
        display: block;
        font-family: 'Orbitron', sans-serif;
        font-size: 0.7rem;
        color: rgba(255, 255, 255, 0.5);
        letter-spacing: 3px;
        margin-bottom: 4px;
      }
      
      .score-value {
        font-family: 'Orbitron', monospace;
        font-size: 1.8rem;
        font-weight: 700;
        color: #fff;
        text-shadow: 0 0 10px var(--map-accent, #00d9ff);
      }
      
      .name-entry-rank {
        font-family: 'Orbitron', sans-serif;
        font-size: 1rem;
        color: #ffc800;
        text-shadow: 0 0 10px #ffc800;
        margin-bottom: 30px;
        letter-spacing: 2px;
      }
      
      .name-entry-prompt {
        font-family: 'Orbitron', sans-serif;
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.6);
        letter-spacing: 4px;
        margin-bottom: 20px;
      }
      
      .name-entry-letters {
        display: flex;
        justify-content: center;
        gap: 20px;
        margin-bottom: 30px;
      }
      
      .name-entry-letters .letter {
        width: 60px;
        height: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Orbitron', monospace;
        font-size: 3rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.3);
        background: rgba(0, 0, 0, 0.5);
        border: 2px solid rgba(0, 217, 255, 0.2);
        border-radius: 4px;
        transition: all 0.2s ease;
      }
      
      .name-entry-letters .letter.active {
        color: #fff;
        border-color: var(--map-accent, #00d9ff);
        background: rgba(0, 217, 255, 0.15);
        box-shadow: 
          0 0 20px var(--map-accent, #00d9ff),
          inset 0 0 20px rgba(0, 217, 255, 0.2);
        animation: letterPulse 0.8s ease-in-out infinite;
      }
      
      @keyframes letterPulse {
        0%, 100% { 
          box-shadow: 
            0 0 20px var(--map-accent, #00d9ff),
            inset 0 0 20px rgba(0, 217, 255, 0.2);
        }
        50% { 
          box-shadow: 
            0 0 30px var(--map-accent, #00d9ff),
            inset 0 0 30px rgba(0, 217, 255, 0.3);
        }
      }
      
      .name-entry-instructions {
        display: flex;
        justify-content: center;
        gap: 20px;
        font-family: 'Orbitron', sans-serif;
        font-size: 0.55rem;
        color: rgba(255, 255, 255, 0.4);
        letter-spacing: 1px;
      }
    `
    
    document.head.appendChild(style)
    document.body.appendChild(overlay)
    this.overlay = overlay
  }

  private setupInput(): void {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          this.changeLetter(1)
          break
        case 'ArrowDown':
          e.preventDefault()
          this.changeLetter(-1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          this.movePosition(-1)
          break
        case 'ArrowRight':
          e.preventDefault()
          this.movePosition(1)
          break
        case 'Enter':
        case ' ': // Space also submits
          e.preventDefault()
          this.submit()
          break
        case 'Escape':
          e.preventDefault()
          this.cancel()
          break
      }
    }
    
    document.addEventListener('keydown', handleKeyDown)
    
    // Store handler for cleanup
    this.overlay?.addEventListener('remove', () => {
      document.removeEventListener('keydown', handleKeyDown)
    })
  }

  private changeLetter(delta: number): void {
    const current = this.currentName[this.currentPosition]
    const currentCode = current.charCodeAt(0)
    
    // A-Z range (65-90)
    let newCode = currentCode + delta
    if (newCode > 90) newCode = 65 // Wrap A->Z
    if (newCode < 65) newCode = 90 // Wrap Z->A
    
    this.currentName[this.currentPosition] = String.fromCharCode(newCode)
    this.updateDisplay()
  }

  private movePosition(delta: number): void {
    this.currentPosition += delta
    if (this.currentPosition < 0) this.currentPosition = 2
    if (this.currentPosition > 2) this.currentPosition = 0
    this.updateDisplay()
  }

  private updateDisplay(): void {
    const letters = this.overlay?.querySelectorAll('.letter')
    letters?.forEach((el, i) => {
      el.textContent = this.currentName[i]
      el.classList.toggle('active', i === this.currentPosition)
    })
  }

  private submit(): void {
    const name = this.currentName.join('')
    if (this.resolveCallback) {
      this.resolveCallback({ name, submitted: true })
    }
    this.hide()
  }

  private cancel(): void {
    if (this.resolveCallback) {
      this.resolveCallback({ name: '', submitted: false })
    }
    this.hide()
  }
}

// Singleton
let dialogInstance: NameEntryDialog | null = null

export function getNameEntryDialog(): NameEntryDialog {
  if (!dialogInstance) {
    dialogInstance = new NameEntryDialog()
  }
  return dialogInstance
}

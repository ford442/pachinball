import { PALETTE } from './visual-language'

export function renderLevelSelectStyles(): string {
  return `
      <style>
        .level-select-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          opacity: 0;
          transition: opacity 0.3s ease;
          padding: 20px;
        }

        .level-select-overlay.visible {
          opacity: 1;
        }

        .level-select-container {
          background: linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 100%);
          border: 2px solid #00d9ff;
          border-radius: 16px;
          padding: 24px;
          max-width: 800px;
          width: 100%;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 
            0 0 40px rgba(0, 217, 255, 0.3),
            inset 0 0 60px rgba(0, 217, 255, 0.05);
        }

        .level-select-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          border-bottom: 1px solid rgba(0, 217, 255, 0.3);
          padding-bottom: 16px;
        }

        .level-select-header h2 {
          margin: 0;
          font-family: 'Orbitron', sans-serif;
          color: #00d9ff;
          text-shadow: 0 0 20px rgba(0, 217, 255, 0.5);
          letter-spacing: 4px;
        }

        .close-btn {
          background: none;
          border: none;
          color: #00d9ff;
          font-size: 28px;
          cursor: pointer;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          transition: all 0.2s;
        }

        .close-btn:hover {
          background: rgba(0, 217, 255, 0.2);
          transform: scale(1.1);
        }

        .overall-progress {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 24px;
          padding: 12px 16px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 8px;
        }

        .progress-label {
          color: #888;
          font-size: 0.85rem;
          white-space: nowrap;
        }

        .progress-bar {
          flex: 1;
          height: 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          overflow: hidden;
        }

        .overall-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #00d9ff, #ff00ff);
          border-radius: 4px;
          transition: width 0.5s ease;
        }

        .overall-progress-text {
          color: #00d9ff;
          font-weight: bold;
          font-family: 'Orbitron', sans-serif;
          min-width: 40px;
          text-align: right;
        }

        .levels-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }

        .level-card {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 16px;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
          display: flex;
          gap: 12px;
        }

        .level-card:hover:not(.locked) {
          background: rgba(0, 217, 255, 0.1);
          border-color: #00d9ff;
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(0, 217, 255, 0.2);
        }

        .level-card.current {
          border-color: #ffd700;
          box-shadow: 0 0 20px rgba(255, 215, 0, 0.3);
        }

        .level-card.completed {
          border-color: #00ff88;
        }

        .level-card.locked {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .level-number {
          width: 36px;
          height: 36px;
          background: linear-gradient(135deg, #00d9ff, #0088aa);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          color: #000;
          font-family: 'Orbitron', sans-serif;
          flex-shrink: 0;
        }

        .level-card.locked .level-number {
          background: #444;
          color: #888;
        }

        .level-card.completed .level-number {
          background: linear-gradient(135deg, #00ff88, #008844);
        }

        .level-info {
          flex: 1;
          min-width: 0;
        }

        .level-name {
          font-weight: bold;
          color: #fff;
          margin-bottom: 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .level-map {
          font-size: 0.8rem;
          color: #888;
          margin-bottom: 8px;
          text-transform: capitalize;
        }

        .level-progress {
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 2px;
          overflow: hidden;
        }

        .level-progress-bar {
          height: 100%;
          background: #00d9ff;
          border-radius: 2px;
          transition: width 0.3s ease;
        }

        .level-locked-hint {
          font-size: 0.75rem;
          color: #666;
        }

        .level-complete-badge {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 20px;
          height: 20px;
          background: #00ff88;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #000;
          font-size: 12px;
          font-weight: bold;
        }

        .level-rewards {
          display: flex;
          gap: 4px;
          margin-top: 8px;
        }

        .reward-item {
          font-size: 0.75rem;
          padding: 2px 6px;
          background: rgba(255, 215, 0, 0.2);
          border: 1px solid rgba(255, 215, 0, 0.5);
          border-radius: 4px;
          color: #ffd700;
        }

        .level-select-footer {
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding-top: 16px;
          text-align: center;
        }

        .completion-reward {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 12px 20px;
          background: rgba(255, 215, 0, 0.1);
          border: 1px solid rgba(255, 215, 0, 0.3);
          border-radius: 8px;
          opacity: 0.5;
        }

        .completion-reward.unlocked {
          opacity: 1;
          background: rgba(255, 215, 0, 0.2);
          border-color: #ffd700;
          box-shadow: 0 0 20px rgba(255, 215, 0, 0.3);
        }

        .reward-icon {
          font-size: 1.5rem;
        }

        .reward-text {
          color: #ffd700;
          font-weight: bold;
        }

        .campaign-archive {
          margin-bottom: 18px;
          padding: 12px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(0, 0, 0, 0.35);
        }

        .campaign-archive-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }

        .campaign-archive-header h3 {
          margin: 0;
          font-size: 0.95rem;
          letter-spacing: 1px;
          color: ${PALETTE.CYAN};
          font-family: 'Orbitron', sans-serif;
        }

        .campaign-shards {
          color: ${PALETTE.GOLD};
          font-family: 'Orbitron', sans-serif;
          font-size: 0.85rem;
          font-weight: 700;
        }

        .campaign-archive-items {
          display: grid;
          gap: 8px;
        }

        .campaign-archive-item {
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.04);
        }

        .campaign-archive-item.unlocked {
          border-color: rgba(0, 255, 136, 0.55);
          background: rgba(0, 255, 136, 0.08);
        }

        .campaign-archive-item.equipped {
          box-shadow: 0 0 12px rgba(255, 215, 0, 0.22);
        }

        .campaign-archive-item-title {
          color: #fff;
          font-weight: 700;
          font-size: 0.86rem;
        }

        .campaign-archive-item-meta {
          margin-top: 2px;
          display: flex;
          justify-content: space-between;
          color: #9aa0aa;
          font-size: 0.72rem;
          text-transform: uppercase;
        }

        .campaign-archive-item-desc {
          margin-top: 4px;
          color: #c0c8d2;
          font-size: 0.75rem;
        }

        .campaign-archive-item-state {
          margin-top: 6px;
          display: flex;
          justify-content: flex-end;
        }

        .campaign-state-badge {
          font-size: 0.72rem;
          color: ${PALETTE.GOLD};
          font-weight: 700;
        }

        .campaign-state-locked {
          font-size: 0.72rem;
          color: #a9b1bf;
        }

        .campaign-equip-btn {
          border: 1px solid ${PALETTE.CYAN};
          color: ${PALETTE.CYAN};
          background: rgba(0, 0, 0, 0.45);
          border-radius: 6px;
          padding: 3px 8px;
          font-size: 0.72rem;
          cursor: pointer;
        }
      </style>
  `
}

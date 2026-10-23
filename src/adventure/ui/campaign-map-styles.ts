import { PALETTE } from '../../game-elements/visual-language'

export function renderCampaignMapStyles(): string {
  return `
      <style>
        .campaign-map-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 16px;
          animation: campaign-map-in 0.25s ease;
        }

        @keyframes campaign-map-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @media (prefers-reduced-motion: reduce) {
          .campaign-map-overlay { animation: none; }
        }

        /* hud.css styles every button as a menu button; undo that in here. */
        .campaign-map-overlay button {
          margin: 0;
          text-transform: none;
          transition: none;
        }

        .campaign-map-container {
          background: linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 100%);
          border: 2px solid ${PALETTE.CYAN};
          border-radius: 16px;
          padding: 20px;
          max-width: 860px;
          width: 100%;
          max-height: 90vh;
          overflow-y: auto;
          overscroll-behavior: contain;
          box-shadow:
            0 0 40px rgba(0, 217, 255, 0.3),
            inset 0 0 60px rgba(0, 217, 255, 0.05);
          color: #fff;
        }

        .campaign-map-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 12px;
        }

        .campaign-map-header h2 {
          margin: 0;
          font-family: 'Orbitron', sans-serif;
          color: ${PALETTE.CYAN};
          text-shadow: 0 0 20px rgba(0, 217, 255, 0.5);
          letter-spacing: 4px;
        }

        .campaign-map-summary {
          margin: 4px 0 0;
          color: #9aa0aa;
          font-size: 0.85rem;
        }

        .campaign-map-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .campaign-map-continue {
          border: 1px solid ${PALETTE.GOLD};
          color: #000;
          background: ${PALETTE.GOLD};
          border-radius: 6px;
          padding: 6px 12px;
          font-family: 'Orbitron', sans-serif;
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
        }

        .campaign-map-close {
          background: none;
          border: none;
          color: ${PALETTE.CYAN};
          font-size: 28px;
          cursor: pointer;
          width: 40px;
          height: 40px;
          border-radius: 50%;
        }

        .campaign-map-continue:hover,
        .campaign-map-continue:focus-visible {
          background: #fff;
          color: #000;
        }

        .campaign-map-close:hover,
        .campaign-map-close:focus-visible {
          background: rgba(0, 217, 255, 0.2);
          color: ${PALETTE.CYAN};
        }

        .campaign-map-progress {
          height: 6px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 10px;
        }

        .campaign-map-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, ${PALETTE.CYAN}, ${PALETTE.MAGENTA});
        }

        .campaign-map-legend {
          margin: 0 0 14px;
          color: #9aa0aa;
          font-size: 0.75rem;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
        }

        .campaign-map-legend .campaign-stage-slot + .campaign-stage-slot,
        .campaign-map-legend .slot-b {
          margin-left: 10px;
        }

        .campaign-spine {
          list-style: none;
          margin: 0 0 18px;
          padding: 0 0 0 14px;
          border-left: 2px solid rgba(0, 217, 255, 0.35);
          display: grid;
          gap: 6px;
        }

        .campaign-spine-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }

        .campaign-branches {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .campaign-branch {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          padding: 4px 6px;
          border: 1px dashed rgba(255, 0, 255, 0.4);
          border-radius: 10px;
        }

        .campaign-branch.kind-post-finale {
          border-color: rgba(255, 215, 0, 0.5);
        }

        .campaign-branch-label {
          font-size: 0.65rem;
          color: #c0c8d2;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .campaign-branch-stages {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .campaign-stage {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 200px;
          padding: 6px 10px;
          text-align: left;
          color: #fff;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 10px;
          cursor: pointer;
          font: inherit;
        }

        .campaign-stage:not(:disabled):hover,
        .campaign-stage:not(:disabled):focus-visible {
          background: rgba(0, 217, 255, 0.12);
          border-color: ${PALETTE.CYAN};
          color: #fff;
          outline: none;
        }

        .campaign-stage.status-completed { border-color: rgba(0, 255, 136, 0.6); }
        .campaign-stage.status-current {
          border-color: ${PALETTE.GOLD};
          box-shadow: 0 0 14px rgba(255, 215, 0, 0.3);
        }
        .campaign-stage:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .campaign-stage:disabled:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
        }

        .campaign-stage-number {
          width: 28px;
          height: 28px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: linear-gradient(135deg, ${PALETTE.CYAN}, #0088aa);
          color: #000;
          font-family: 'Orbitron', sans-serif;
          font-weight: 700;
          font-size: 0.75rem;
        }

        .campaign-stage.status-completed .campaign-stage-number {
          background: linear-gradient(135deg, #00ff88, #008844);
        }

        .campaign-stage:disabled .campaign-stage-number {
          background: #444;
          color: #888;
        }

        .campaign-stage-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }

        .campaign-stage-name {
          font-weight: 700;
          font-size: 0.85rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .campaign-stage-meta {
          font-size: 0.7rem;
          color: #9aa0aa;
        }

        .campaign-stage-slot {
          flex-shrink: 0;
          padding: 1px 6px;
          border-radius: 4px;
          font-family: 'Orbitron', sans-serif;
          font-size: 0.65rem;
          font-weight: 700;
          color: #000;
          background: ${PALETTE.CYAN};
        }

        .campaign-stage.slot-b .campaign-stage-slot,
        .campaign-stage-slot.slot-b {
          background: ${PALETTE.MAGENTA};
        }

        .campaign-archive {
          margin-bottom: 4px;
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
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
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

        @media (max-width: 520px) {
          .campaign-stage { min-width: 0; width: 100%; }
          .campaign-spine { padding-left: 8px; }
        }
      </style>
  `
}

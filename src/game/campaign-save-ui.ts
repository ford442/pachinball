/**
 * Campaign save controls in Settings (#444 Slice D): cloud sync status, a
 * device link code, linking this device with another's code, and file
 * export / import. Starts the cloud sync. Loaded lazily after the campaign
 * manager exists.
 */

import { CampaignCloudSync, exportCampaignSave, importCampaignSave, type CloudSyncStatus } from '../adventure/campaign-cloud-sync'
import type { CampaignRewardsManager } from '../adventure/campaign-rewards-manager'

export interface CampaignSaveHost {
  readonly signal: AbortSignal
  showMessage(msg: string, duration: number): void
  /** Disposal hooks run by `Game.dispose()`. */
  onDispose(reset: () => void): void
}

const STATUS_TEXT: Record<CloudSyncStatus, string> = {
  off: 'Saved on this device',
  syncing: 'Cloud save: syncing…',
  synced: 'Cloud save: up to date',
  offline: 'Cloud save: offline — will sync when you reconnect',
  error: 'Cloud save: could not sync',
}

export async function startCampaignSave(manager: CampaignRewardsManager, host: CampaignSaveHost): Promise<CampaignCloudSync> {
  const arcade = await import('../arcade/arcade-api')
  const sync = new CampaignCloudSync(manager, arcade)
  host.onDispose(() => sync.dispose())

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null
  const status = $('campaign-save-status')
  sync.onStatus = (s) => { if (status) status.textContent = STATUS_TEXT[s] }
  const { signal } = host

  $('campaign-link-code-btn')?.addEventListener('click', () => {
    void (async () => {
      const codeEl = $('campaign-link-code')
      try {
        // The other device pulls this save, so it goes up first.
        await sync.start(true)
        const { code } = await arcade.createLinkCode()
        if (codeEl) codeEl.textContent = code
        host.showMessage(`Enter ${code} on your other device within 10 minutes`, 6000)
      } catch (err) {
        host.showMessage(`No link code: ${err instanceof Error ? err.message : String(err)}`, 4000)
      }
    })()
  }, { signal })

  $('campaign-link-btn')?.addEventListener('click', () => {
    const input = $<HTMLInputElement>('campaign-link-input')
    const code = input?.value.trim().toUpperCase() ?? ''
    if (!/^[A-Z0-9]{8}$/.test(code)) {
      host.showMessage('A link code is 8 letters and digits', 3000)
      return
    }
    void (async () => {
      try {
        const linked = await sync.linkDevice(code)
        host.showMessage(linked ? 'Linked: this device now shares that campaign' : 'That code is unknown, used or expired', 4000)
        if (linked && input) input.value = ''
      } catch (err) {
        host.showMessage(`Could not link: ${err instanceof Error ? err.message : String(err)}`, 4000)
      }
    })()
  }, { signal })

  $('campaign-export-btn')?.addEventListener('click', () => {
    const blob = new Blob([exportCampaignSave(manager)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'pachinball-campaign.json'
    a.click()
    URL.revokeObjectURL(url)
  }, { signal })

  const fileInput = $<HTMLInputElement>('campaign-import-file')
  $('campaign-import-btn')?.addEventListener('click', () => fileInput?.click(), { signal })
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (!file) return
    void file.text().then((text) => {
      const ok = importCampaignSave(manager, text)
      host.showMessage(ok ? 'Campaign imported' : 'That file is not a campaign save', 3500)
      fileInput.value = ''
    })
  }, { signal })

  void sync.start()
  return sync
}

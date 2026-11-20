/**
 * Profile export / import in Settings (#506 slice 1): one JSON file holding the
 * settings, bindings, campaign, bests, achievements and editor drafts, for a
 * backup or another device. Loaded lazily after boot; the file I/O module
 * (`profile-file.ts`, with the machine schema) loads on the first click.
 *
 * Strings are literals until the i18n catalog lands (#506 slice 2); they are
 * all in {@link TEXT} so that change is one place.
 */

import { formatSchemaIssues } from '../schemas/schema-kit'

export interface ProfileSaveHost {
  readonly signal: AbortSignal
  showMessage(msg: string, duration: number): void
}

const TEXT = {
  imported: 'Profile imported: reloading to apply it',
  importedNoDrafts: 'Profile imported, but this browser cannot store editor drafts',
  refused: (why: string) => `That file is not a profile: ${why}`,
  confirm: 'Replace your settings, campaign progress, bests and drafts with this file?',
  exportFailed: 'Could not export the profile',
} as const

const EXPORT_FILE_NAME = 'pachinball-profile.json'
/** How long the "imported" message shows before the page reloads to apply the new settings. */
const RELOAD_DELAY_MS = 1200

export function bindProfileSaveUI(host: ProfileSaveHost): void {
  const { signal } = host
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null
  const loadFile = () => import('../profile/profile-file')

  $('profile-export-btn')?.addEventListener('click', () => {
    void loadFile()
      .then((m) => m.exportProfile())
      .then((text) => {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
        const a = document.createElement('a')
        a.href = url
        a.download = EXPORT_FILE_NAME
        a.click()
        URL.revokeObjectURL(url)
      })
      .catch(() => host.showMessage(TEXT.exportFailed, 3500))
  }, { signal })

  const fileInput = $<HTMLInputElement>('profile-import-file')
  $('profile-import-btn')?.addEventListener('click', () => fileInput?.click(), { signal })
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    fileInput.value = ''
    if (!file) return
    void (async () => {
      const text = await file.text()
      if (signal.aborted) return
      // The import replaces what the player has: ask once, after reading, so a wrong file costs nothing.
      if (!window.confirm(TEXT.confirm)) return
      const { importProfile } = await loadFile()
      const result = await importProfile(text)
      if (signal.aborted) return
      if (!result.ok) {
        host.showMessage(TEXT.refused(formatSchemaIssues(result.errors.slice(0, 2))), 5000)
        return
      }
      host.showMessage(result.draftsKept ? TEXT.imported : TEXT.importedNoDrafts, 4000)
      // Settings are read once at boot; a reload applies the imported ones everywhere.
      // eslint-disable-next-line no-restricted-syntax -- the page is about to reload; nothing outlives it
      window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS)
    })()
  }, { signal })
}

/** Stand-in for vite-plugin-pwa's `virtual:pwa-register` (vitest.config.ts alias); tests vi.mock it. */
export function registerSW(_options: unknown = {}): (reloadPage?: boolean) => Promise<void> {
  return () => Promise.resolve()
}

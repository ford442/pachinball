/**
 * Console output that survives the production build (#449). The build strips every literal
 * `console.*()` call (esbuild `drop: ['console']`, which keeps the entry chunk inside its
 * budget), so a boot failure would leave DevTools empty. These reach `globalThis.console`,
 * which the strip does not match. Use them only for boot-critical diagnostics.
 */
export const bootWarn = (...args: unknown[]): void => globalThis.console.warn(...args)
export const bootError = (...args: unknown[]): void => globalThis.console.error(...args)

// resolveAssetUrl / resolveVideoUrl moved to src/core/asset-urls.ts (#322) so
// game-elements can use them without importing from the game layer. Re-exported
// here for the game-layer call sites that already reference them.
export { resolveAssetUrl, resolveVideoUrl } from '../core/asset-urls'


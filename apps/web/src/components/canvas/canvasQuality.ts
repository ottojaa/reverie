/**
 * Device-class quality caps for the canvas scene, computed once at load.
 * Coarse-pointer devices (phones/tablets) get reduced GPU cost and a denser
 * layout; desktop is unchanged. Three-free and a plain object (not a hook) so
 * scene/ modules, dive/, hooks and the texture cache can all read it without
 * React — per-frame code reads it directly, and tests can override fields.
 */
const isCoarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

export const canvasQuality = {
    isCoarse,
    /** Upper devicePixelRatio clamp for <Canvas dpr>. */
    dprMax: isCoarse ? 1.5 : 2,
    /** MSAA is expensive on mobile tile GPUs. gl create-time only — must be decided before first mount. */
    antialias: !isCoarse,
    /** Texture anisotropy cap, applied against the GPU's own maximum. */
    anisotropy: isCoarse ? 4 : 8,
    /** How many unused thumbnail textures the LRU keeps alive. */
    idleTextureBudget: isCoarse ? 48 : 128,
    /** Concurrent thumbnail decodes — phone CPUs choke on parallel createImageBitmap. */
    maxInflightTextures: isCoarse ? 3 : 5,
    /** Switch to frameloop="demand" after the init grace period (mobile battery/thermals). */
    demandFrameloop: isCoarse,
    /** Per-card date <Text> under fanned cards — dropping it halves fan text meshes. */
    cardDateLabels: !isCoarse,
    /** Max documents fanned out at once (desktop matches the API page size). */
    fanPageLimit: isCoarse ? 12 : 24,
    /** Tap-vs-drag threshold; fingers jitter more than mice. */
    clickThresholdPx: isCoarse ? 12 : 7,
};

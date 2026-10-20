export const COC_OWNER = "CP-F18";
export const COC_SETTINGS_KEY = "CP-F18";
export const COC_BINDINGS_KEY = "CP-F18.bindings";
export const COC_RESOURCES = Object.freeze({
  fullResolution: "CP-F18.coc",
  parameters: "CP-F18.parameters",
  reducedRadii: "CP-F18.reducedRadii",
  nearColor: "CP-F18.nearColor",
  farColor: "CP-F18.farColor",
  reducedInfo: "CP-F18.reducedInfo",
  tiles: "CP-F18.tiles",
  dilatedTiles: "CP-F18.dilatedTiles"
});
export const COC_FLAGS = Object.freeze({ focus: 1, small: 2, large: 4, near: 8, far: 16, sky: 32, invalid: 64 });
export const COC_SAMPLE_STATUS = Object.freeze({ invalid: 0, surface: 1, sky: 2, excluded: 3 });
export const COC_LIMITS = Object.freeze({ maxRadiusOutputPixels: 128, maxDilationTiles: 32, maxViews: 4 });
export const COC_ENCODINGS = Object.freeze({
  fullResolution: "signed-coc-render-radius-xy-coverage-status-v1",
  reducedRadii: "coc-near-min-xy-far-max-xy-render-pixels-v1",
  reducedInfo: "coc-flags-coverage-near-weight-far-weight-v1",
  tiles: "coc-tile-near-far-radius-flags-coverage-v1"
});

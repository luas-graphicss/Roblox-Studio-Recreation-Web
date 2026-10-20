export const OUTPUT_OWNER = "CP-F28";
export const OUTPUT_SETTINGS_KEY = "CP-F28.settings";
export const OUTPUT_COLOR = "CP-F28.color";
export const OUTPUT_LINEAR_COLOR = "CP-F28.linearColor";
export const OUTPUT_INPUT_STATE = "CP-F28.inputState";
export const OUTPUT_STATE = "CP-F28.outputState";
export const OUTPUT_PROFILE = "independent-display-transform-v1";
export const OUTPUT_MODES = Object.freeze({
  srgb: Object.freeze({ gamut: "rec709", transfer: "srgb", encoding: "display-srgb", format: "rgba8", hdr: false }),
  rec709: Object.freeze({ gamut: "rec709", transfer: "rec709", encoding: "display-rec709", format: "rgba8", hdr: false }),
  "display-p3": Object.freeze({ gamut: "display-p3", transfer: "srgb", encoding: "display-p3", format: "rgba8", hdr: false }),
  "hdr-pq": Object.freeze({ gamut: "rec2020", transfer: "pq", encoding: "display-pq-rec2020", format: "rgba16f", hdr: true }),
  scrgb: Object.freeze({ gamut: "rec709", transfer: "linear", encoding: "display-scrgb", format: "rgba16f", hdr: true }),
  linear: Object.freeze({ gamut: "rec709", transfer: "linear", encoding: "display-linear-rec709", format: "rgba16f", hdr: false })
});
export const OUTPUT_WHITE_POINTS = Object.freeze({ D65: Object.freeze([0.3127, 0.3290]), D50: Object.freeze([0.3457, 0.3585]) });

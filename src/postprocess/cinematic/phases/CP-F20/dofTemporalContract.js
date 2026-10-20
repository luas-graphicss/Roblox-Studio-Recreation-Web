export const DOF_TEMPORAL_OWNER = "CP-F20";
export const DOF_TEMPORAL_SETTINGS = "CP-F20.settings";
export const DOF_TEMPORAL_BINDINGS = "CP-F20.bindings";
export const DOF_CAPTURE_SETTING = "CP-F20.capture";
export const DOF_TEMPORAL_RESOURCES = Object.freeze({
  guide: "CP-F20.stabilizedGuide",
  session: "CP-F20.frameSession",
  color: "CP-F20.resolvedColor",
  rejection: "CP-F20.historyRejection",
  diagnostics: "CP-F20.diagnostics",
  compositedColor: "CP-F20.compositedColor",
  compositionRange: "CP-F20.compositionRange"
});
export const DOF_GUIDE_ENCODING = "CP-F20.log-depth-coc-coverage-validity-v1";
export const DOF_HISTORY_ENCODING = "CP-F20.preexposed-color-v1";
export const DOF_REJECTION_ENCODING = "CP-F20.samples-weight-reason-validity-v1";
export const DOF_INPUT_ENCODINGS = Object.freeze({
  circleOfConfusion: "signed-coc-radius-output-pixels",
  linearDepth: "linear-depth-meters",
  velocity: "uv-current-minus-previous",
  coverage: "coverage",
  reactiveMask: "reactive-mask"
});
export const DOF_REJECTION_REASONS = Object.freeze({
  accepted: 0, reset: 1, motion: 2, geometry: 3, reactive: 4,
  invalidInput: 5, clipped: 6, disabled: 7
});

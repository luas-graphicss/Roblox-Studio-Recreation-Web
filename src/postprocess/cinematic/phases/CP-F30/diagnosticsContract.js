export const DIAGNOSTICS_PHASE = "CP-F30";
export const DIAGNOSTICS_VERSION = "1.0.0";
export const DIAGNOSTICS_SETTING = "CP-F30";
export const DIAGNOSTICS_SESSION = "CP-F30.session";
export const DIAGNOSTICS_RESOURCE = "CP-F30.inspection";
export const DIAGNOSTIC_KINDS = Object.freeze(["color", "depth", "normal", "motion", "coc", "rejection", "histogram", "gain", "bloom", "scalar"]);
export const DEFAULT_DIAGNOSTIC_BINDINGS = Object.freeze([
  Object.freeze({ id: "color", label: "Current color", resource: "$color", kind: "color" })
]);
export const DIAGNOSTIC_LIMITS = Object.freeze({ maxPixels: 2097152, maxSnapshotBytes: 67108864, maxBindings: 32 });

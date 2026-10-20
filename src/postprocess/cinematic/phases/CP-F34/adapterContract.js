export const ADAPTER_VERSION = "1.0.0";
export const ADAPTER_OWNER = "CP-F34";
export const HOST_ROUTE_RESOURCE = "CP-F34.hostRoute";
export const HOST_BINDING_SETTING = "CP-F34.hostBinding";
export const OWNERSHIP_ROLES = Object.freeze([
  "sceneCapture", "lighting", "depth", "exposure", "jitter", "toneMapping",
  "bloom", "depthOfField", "grain", "outputTransfer", "presentation"
]);
export const DEFAULT_OWNERSHIP = Object.freeze({
  sceneCapture: "host", lighting: "host", depth: "host", exposure: "package",
  jitter: "package", toneMapping: "package", bloom: "package",
  depthOfField: "package", grain: "package", outputTransfer: "package",
  presentation: "host"
});
export const AUDITED_GETTERS = Object.freeze([
  "getGrade", "getSunInfo", "getShadowTemporal", "getMegaLights",
  "getVolumetricFog", "getSsr", "getAoState", "getLocalLightPatchRegistry",
  "getPostfxDiet", "getHdrPipeline", "getUpscaleSharpen", "getAutoExposure",
  "getLocalExposure", "getLensFlare", "getSmLiteFx", "getFilmFx",
  "getTsrState", "getMotionVectors", "getPassTiming"
]);

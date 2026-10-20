export const REFERENCE_SCHEMA_VERSION = "1.0.0";
export const REFERENCE_PHASE_ID = "CP-F01";
export const REQUESTED_ENGINE_VERSION = "5.9";
export const REFERENCE_SESSION_SETTING = "CP-F01.referenceSession";
export const REFERENCE_CLAIM_SETTING = "CP-F01.requestedClaim";
export const REFERENCE_STATE_RESOURCE = "CP-F01.referenceState";
export const BUILD_FIELDS = Object.freeze(["version", "buildId", "branch", "changelist", "platform", "licenseAuthorization"]);
export const PROPERTY_FIELDS = Object.freeze(["originalPath", "originalName", "type", "engineDefault", "editorOverride", "range", "unit", "clamp", "overrideSemantics", "blendRule", "colorDomain", "graphPosition", "qualityPermutation", "positiveTest", "negativeTest"]);
export const PASS_FIELDS = Object.freeze(["originalPath", "inputDomain", "outputDomain", "dependencies", "qualityPermutation", "positiveTest", "negativeTest"]);
export const PROFILE_FIELDS = Object.freeze(["originalPath", "quality", "rhi", "passOrder", "sceneIds", "outputTransform"]);
export const FROZEN_CAPTURE_FIELDS = Object.freeze(["hardware", "rhi", "buildId", "plugins", "renderSize", "outputSize", "cvars", "postVolumes", "camera", "seed", "timestepSeconds", "antiAliasing", "jitter", "exposureWarmupFrames", "temporalWarmupFrames", "outputTransform"]);
export const REQUIRED_SCENE_IDS = Object.freeze(Array.from({ length: 12 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`));
export const QUALITY_REQUIREMENTS = Object.freeze(["diagnostic", "low", "medium", "high", "cinematic"]);
export const CAPTURE_FORMATS = Object.freeze({
  "rgba16float-le": Object.freeze({ bytesPerPixel: 8, channelBytes: 2, floating: true }),
  "rgba32float-le": Object.freeze({ bytesPerPixel: 16, channelBytes: 4, floating: true }),
  "rg16float-le": Object.freeze({ bytesPerPixel: 4, channelBytes: 2, floating: true }),
  "r32float-le": Object.freeze({ bytesPerPixel: 4, channelBytes: 4, floating: true }),
  "rgba8unorm": Object.freeze({ bytesPerPixel: 4, channelBytes: 1, floating: false })
});

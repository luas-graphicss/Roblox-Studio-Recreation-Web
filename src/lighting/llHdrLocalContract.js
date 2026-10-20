export const LOCAL_HDR_PHASE_ID = "LL-F9";
export const LOCAL_HDR_FLAG_ID = "LlLocalLightHdr";
export const LOCAL_HDR_PATCH_ID = "ll-f9-hdr-local";
export const LOCAL_HDR_ANCHOR = "lightsFragmentBegin";
export const LIGHTS_FRAGMENT_CHUNK = "lights_fragment_begin";


export const BASELINE_FREEZE_FLAG_ID = "LlBaseline";


export const LOCAL_HDR_UNIFORMS = Object.freeze({
	enabled: "uLlF9Enabled",
	clampKnee: "uLlF9ClampKnee",
	clampCeiling: "uLlF9ClampCeiling",
	specularAaVariance: "uLlF9SpecularAaVariance",
	specularAaThreshold: "uLlF9SpecularAaThreshold",
});

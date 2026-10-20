import { MSM_SKY_DEPTH_RATIO } from "./msmNormalFromDepthCore.js";


export const MSM_NORMAL_FROM_DEPTH_UNIFORMS = Object.freeze([
	Object.freeze({ name: "tMsmSceneDepth", glslType: "sampler2D", carries: "the shared scene depth, RGBA-packed" }),
	Object.freeze({ name: "uMsmSceneDepthTexel", glslType: "vec2", carries: "one texel of the reduced grid, in uv" }),
	Object.freeze({ name: "uMsmInverseProjection", glslType: "vec2", carries: "inverse projection scale, x and y" }),
	Object.freeze({ name: "uMsmCameraNear", glslType: "float", carries: "camera near plane" }),
	Object.freeze({ name: "uMsmCameraFar", glslType: "float", carries: "camera far plane" }),
]);


export const MSM_NORMAL_FROM_DEPTH_REQUIRED_INCLUDES = Object.freeze(["packing"]);


export const MSM_NORMAL_FROM_DEPTH_FUNCTIONS = Object.freeze([
	"msmViewDepthAt",
	"msmViewPositionAt",
	"msmStepSign",
	"msmIsSkyViewDepth",
	"msmViewNormalFromDepth",
]);


export function toGlslFloatLiteral(value) {
	const numericValue = Number.isFinite(value) ? value : 0;
	const text = String(numericValue);
	return text.includes(".") || text.includes("e") || text.includes("E") ? text : text + ".0";
}


export function buildNormalFromDepthGlsl() {
	return `
                                                                              
float msmViewDepthAt(const in vec2 uv) {
  float packedDepth = unpackRGBAToDepth(texture2D(tMsmSceneDepth, uv));
  return -perspectiveDepthToViewZ(packedDepth, uMsmCameraNear, uMsmCameraFar);
}

vec3 msmViewPositionAt(const in vec2 uv) {
  float viewDepth = msmViewDepthAt(uv);
  vec2 normalizedDeviceCoordinates = uv * 2.0 - 1.0;
  return vec3(normalizedDeviceCoordinates * uMsmInverseProjection * viewDepth, -viewDepth);
}

                                                                                
                                                                      
float msmStepSign(const in float uvComponent, const in float texelSize) {
  return uvComponent + texelSize <= 1.0 ? 1.0 : -1.0;
}

bool msmIsSkyViewDepth(const in float viewDepth) {
  return viewDepth >= uMsmCameraFar * ${toGlslFloatLiteral(MSM_SKY_DEPTH_RATIO)};
}

                                                                            
vec3 msmViewNormalFromDepth(const in vec2 uv, const in vec3 centerViewPosition) {
  float horizontalStepSign = msmStepSign(uv.x, uMsmSceneDepthTexel.x);
  float verticalStepSign = msmStepSign(uv.y, uMsmSceneDepthTexel.y);
  vec2 horizontalUv = uv + vec2(uMsmSceneDepthTexel.x * horizontalStepSign, 0.0);
  vec2 verticalUv = uv + vec2(0.0, uMsmSceneDepthTexel.y * verticalStepSign);
  vec3 horizontalDelta = (msmViewPositionAt(horizontalUv) - centerViewPosition) * horizontalStepSign;
  vec3 verticalDelta = (msmViewPositionAt(verticalUv) - centerViewPosition) * verticalStepSign;
  vec3 viewNormal = cross(verticalDelta, horizontalDelta);
  float normalLength = length(viewNormal);
  if (normalLength <= ${toGlslFloatLiteral(1e-8)}) return vec3(0.0, 0.0, 1.0);
  viewNormal /= normalLength;
  return viewNormal.z < 0.0 ? -viewNormal : viewNormal;
}
`;
}

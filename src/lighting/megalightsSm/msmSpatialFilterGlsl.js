import { toGlslFloatLiteral } from "./msmNormalFromDepthGlsl.js";
import { MSM_SPATIAL_DEPTH_REJECTION_RATIO, MSM_SPATIAL_FILTER_OFFSETS, MSM_SPATIAL_NORMAL_REJECTION_TANGENT } from "./msmSpatialFilterCore.js";

export const MSM_SPATIAL_FILTER_GLSL_OWNER = "MSM-F28";

export const MSM_SPATIAL_SOURCE_SAMPLER = "tMsmSpatialSource";
export const MSM_VARIANCE_MOMENTS_SAMPLER = "tMsmVarianceMoments";
export const MSM_SPATIAL_TEXEL_UNIFORM = "uMsmSpatialTexel";
export const MSM_RELATIVE_VARIANCE_THRESHOLD_UNIFORM = "uMsmRelativeVarianceThreshold";
export const MSM_SPATIAL_DEPTH_TOLERANCE_UNIFORM = "uMsmSpatialDepthTolerance";


export const MSM_SPATIAL_FILTER_SAMPLER_COUNT = 2;


export const MSM_SPATIAL_TOLERANCE_FLOOR = 1e-20;

export const MSM_SPATIAL_FILTER_UNIFORMS = Object.freeze([
	Object.freeze({
		name: MSM_SPATIAL_TEXEL_UNIFORM,
		glslType: "vec2",
		carries: "one texel of the reduced resolution target, so the four offsets cost no arithmetic per pixel",
	}),
	Object.freeze({
		name: MSM_RELATIVE_VARIANCE_THRESHOLD_UNIFORM,
		glslType: "float",
		carries: "MSM_RELATIVE_VARIANCE_THRESHOLD for the tier in use; OFF sends an infinite value and the gate simply never opens",
	}),
	Object.freeze({
		name: MSM_SPATIAL_DEPTH_TOLERANCE_UNIFORM,
		glslType: "float",
		carries: "MSM_SPATIAL_DEPTH_TOLERANCE_RATIO, recomputed by the host when the field of view or the target height changes",
	}),
]);




export const MSM_SPATIAL_FILTER_REQUIRED_FUNCTIONS = Object.freeze(["msmViewPositionAt", "msmIsSkyViewDepth", "msmDecodeStoredIrradiance"]);

export const MSM_SPATIAL_FILTER_FUNCTIONS = Object.freeze(["msmSpatialGateOpen", "msmSpatialTapWeight", "msmSpatialAccumulateTap", "msmSpatialFilterPixel"]);

export const MSM_SPATIAL_FILTER_GLUE_CONTRACT = Object.freeze({
	centreViewNormal: "the host reconstructs it once with msmViewNormalFromDepth (MSM-F5) and passes it in; this chunk never fetches a neighbour normal",
	storageChunk: "buildStorageGlsl (MSM-F26) must come first, and the host encodes the result again with msmEncodeStoredIrradiance before writing it back",
	momentsProducer: "see MSM_VARIANCE_MOMENTS_PRODUCER in msmVarianceCore.js: P3 only reads tMsmVarianceMoments",
	threshold: "uMsmRelativeVarianceThreshold is MSM_RELATIVE_VARIANCE_THRESHOLD[spatial filter state of the tier]; the text never bakes it",
});


export const MSM_SPATIAL_FILTER_FETCH_COUNT_WHEN_OPEN = 10;
export const MSM_SPATIAL_FILTER_FETCH_COUNT_WHEN_CLOSED = 2;

function buildUniformsGlsl() {
	return [
		`uniform sampler2D ${MSM_SPATIAL_SOURCE_SAMPLER};`,
		`uniform sampler2D ${MSM_VARIANCE_MOMENTS_SAMPLER};`,
		`uniform vec2 ${MSM_SPATIAL_TEXEL_UNIFORM};`,
		`uniform float ${MSM_RELATIVE_VARIANCE_THRESHOLD_UNIFORM};`,
		`uniform float ${MSM_SPATIAL_DEPTH_TOLERANCE_UNIFORM};`,
	].join("\n");
}

function buildGateGlsl() {
	return [
		"// Golden rule 14: RELATIVE variance. The product form is the division free",
		"// way of writing variance / mean^2 > threshold, so there is no epsilon, no",
		"// 0/0 on a black pixel, and scaling the whole scene by s multiplies both",
		"// sides by exactly s^2 - the gate cannot tell bright from noisy.",
		"bool msmSpatialGateOpen(const in vec2 moments) {",
		"\tfloat meanLuminance = moments.x;",
		"\tfloat squaredMean = meanLuminance * meanLuminance;",
		"\tfloat variance = max(0.0, moments.y - squaredMean);",
		`\treturn variance > ${MSM_RELATIVE_VARIANCE_THRESHOLD_UNIFORM} * squaredMean;`,
		"}",
	].join("\n");
}

function buildTapWeightGlsl() {
	const rejectionRatio = toGlslFloatLiteral(MSM_SPATIAL_DEPTH_REJECTION_RATIO);
	const tiltTangent = toGlslFloatLiteral(MSM_SPATIAL_NORMAL_REJECTION_TANGENT);
	const toleranceFloor = toGlslFloatLiteral(MSM_SPATIAL_TOLERANCE_FLOOR);
	return [
		"// Mirror of computeTapWeight in msmSpatialFilterCore.js. Every refusal is a",
		"// step() factor, so a refused neighbour is multiplied by exactly 0.0 - which",
		"// is the only thing zero leakage can honestly mean at a silhouette.",
		"float msmSpatialTapWeight(const in vec3 centreViewPosition, const in vec3 centreViewNormal, const in vec3 tapViewPosition) {",
		"\tvec3 centreToTap = tapViewPosition - centreViewPosition;",
		"\tfloat centreViewDepth = abs(centreViewPosition.z);",
		"\tfloat planeDistance = abs(dot(centreToTap, centreViewNormal));",
		"\tfloat inPlaneDistance = sqrt(max(0.0, dot(centreToTap, centreToTap) - planeDistance * planeDistance));",
		"\tfloat depthDifference = abs(abs(tapViewPosition.z) - centreViewDepth);",
		`\tfloat rejectionDistance = centreViewDepth * ${rejectionRatio};`,
		`\tfloat planeTolerance = centreViewDepth * ${MSM_SPATIAL_DEPTH_TOLERANCE_UNIFORM};`,
		"\tfloat accepted = step(planeDistance, rejectionDistance)",
		"\t\t* step(depthDifference, rejectionDistance)",
		`\t\t* step(planeDistance, inPlaneDistance * ${tiltTangent})`,
		`\t\t* step(${toleranceFloor}, planeTolerance);`,
		`\treturn accepted * exp(-planeDistance / max(planeTolerance, ${toleranceFloor}));`,
		"}",
	].join("\n");
}

function buildAccumulateTapGlsl(options) {
	if (options.storedSampleDepth) return `
void msmSpatialAccumulateTap(const in vec2 tapUv, const in vec3 centreViewPosition, const in vec3 centreViewNormal, inout vec3 accumulatedIrradiance, inout float weightSum) {
  vec4 tapSignal = texture2D(tMsmSpatialSource, tapUv);
  vec3 tapViewPosition = msmSamplePositionFromDepth(tapUv, tapSignal.a);
  float tapWeight = msmSpatialTapWeight(centreViewPosition, centreViewNormal, tapViewPosition);
  accumulatedIrradiance += tapWeight * msmDecodeStoredIrradiance(tapSignal.rgb);
  weightSum += tapWeight;
}`;
	return [
		"// One neighbour folded into the running sums. inout instead of a return",
		"// value so each of the four unrolled calls below stays a single line.",
		"void msmSpatialAccumulateTap(const in vec2 tapUv, const in vec3 centreViewPosition, const in vec3 centreViewNormal, inout vec3 accumulatedIrradiance, inout float weightSum) {",
		"\tvec3 tapViewPosition = msmViewPositionAt(tapUv);",
		"\tfloat tapWeight = msmSpatialTapWeight(centreViewPosition, centreViewNormal, tapViewPosition);",
		`\taccumulatedIrradiance += tapWeight * msmDecodeStoredIrradiance(texture2D(${MSM_SPATIAL_SOURCE_SAMPLER}, tapUv).rgb);`,
		"\tweightSum += tapWeight;",
		"}",
	].join("\n");
}

function buildFilterPixelGlsl(options) {
	const unrolledTaps = MSM_SPATIAL_FILTER_OFFSETS.map(
		([offsetX, offsetY]) =>
			`\tmsmSpatialAccumulateTap(uv + vec2(${toGlslFloatLiteral(offsetX)}, ${toGlslFloatLiteral(offsetY)}) * ${MSM_SPATIAL_TEXEL_UNIFORM}, centreViewPosition, centreViewNormal, accumulatedIrradiance, weightSum);`,
	);
	return [
		"// The pass, for one pixel. The centre keeps weight 1.0, so a pixel whose",
		"// four neighbours are all refused returns bit for bit what it read.",
		"vec3 msmSpatialFilterPixel(const in vec2 uv, const in vec3 centreViewPosition, const in vec3 centreViewNormal) {",
		`\tvec2 moments = ${options.logMoments ? 'msmDecodeMoments(' : ''}texture2D(${MSM_VARIANCE_MOMENTS_SAMPLER}, uv).rg${options.logMoments ? ')' : ''};`,
		`\tvec3 centreIrradiance = msmDecodeStoredIrradiance(texture2D(${MSM_SPATIAL_SOURCE_SAMPLER}, uv).rgb);`,
		"",
		"\t// The one and only branch of this chunk, and a coherent one: the pixels of",
		"\t// a noisy region answer it together, so the warp stays whole.",
		"\tif (!msmSpatialGateOpen(moments) || msmIsSkyViewDepth(abs(centreViewPosition.z))) {",
		"\t\treturn centreIrradiance;",
		"\t}",
		"",
		"\tvec3 accumulatedIrradiance = centreIrradiance;",
		"\tfloat weightSum = 1.0;",
		...unrolledTaps,
		"\treturn accumulatedIrradiance / weightSum;",
		"}",
	].join("\n");
}



export function buildSpatialFilterGlsl(options = {}) {
	return `${[buildUniformsGlsl(), buildGateGlsl(), buildTapWeightGlsl(), buildAccumulateTapGlsl(options), buildFilterPixelGlsl(options)].join("\n\n")}\n`;
}

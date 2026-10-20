import { MSM_SKY_DEPTH_RATIO, isSkyViewDepth } from "./msmNormalFromDepthCore.js";

export const MSM_UPSAMPLE_OWNER = "MSM-F23";


export const MSM_UPSAMPLE_BILINEAR_TAP_COUNT = 1;
export const MSM_UPSAMPLE_BILATERAL_TAP_COUNT = 4;


export const MSM_UPSAMPLE_RUNGS = Object.freeze({
	BILINEAR: "bilinear",
	BILATERAL: "bilateral",
});


export const MSM_UPSAMPLE_TAP_OFFSETS = Object.freeze([
	Object.freeze([0, 0]),
	Object.freeze([1, 0]),
	Object.freeze([0, 1]),
	Object.freeze([1, 1]),
]);


export const MSM_UPSAMPLE_RELATIVE_DEPTH_TOLERANCE = 0.02;


export const MSM_UPSAMPLE_MINIMUM_ACCEPTED_WEIGHT = 1e-4;


export const MSM_UPSAMPLE_MINIMUM_VIEW_DEPTH = 1e-4;


export const MSM_UPSAMPLE_REFUSALS = Object.freeze({
	NONE: "none",
	EVERY_TAP_REJECTED: "everyTapRejected",
	UNUSABLE_DESTINATION_DEPTH: "unusableDestinationDepth",
	UNUSABLE_SOURCE_RESOLUTION: "unusableSourceResolution",
	MISSING_SOURCE_SAMPLER: "missingSourceSampler",
});


export const MSM_UPSAMPLE_MIRROR_ARGUMENT_ORDER = Object.freeze({
	tapUvAt: Object.freeze({
		glslCounterpart: "msmUpsampleTapUv",
		glslArguments: Object.freeze(["baseTexel", "tapOffset"]),
		jsArguments: Object.freeze([
			"baseTexelX",
			"baseTexelY",
			"tapOffsetX",
			"tapOffsetY",
			"sourceTexelWidth",
			"sourceTexelHeight",
		]),
		uniformsInGlsl: Object.freeze(["sourceTexelWidth", "sourceTexelHeight"]),
		note: "the shader packs each pair into a vec2 and reads the texel size from uMsmUpsampleSourceTexel",
	}),
	depthSimilarityWeight: Object.freeze({
		glslCounterpart: "msmUpsampleDepthWeight",
		glslArguments: Object.freeze(["destinationViewDepth", "tapViewDepth"]),
		jsArguments: Object.freeze(["destinationViewDepth", "tapViewDepth", "relativeDepthTolerance", "cameraFar"]),
		uniformsInGlsl: Object.freeze(["relativeDepthTolerance", "cameraFar"]),
		note: "tolerance is uMsmUpsampleRelativeDepthTolerance and the far plane arrives inside msmIsSkyViewDepth of MSM-F5",
	}),
	upsampleIrradiance: Object.freeze({
		glslCounterpart: "msmUpsampleIrradiance",
		glslArguments: Object.freeze(["uv", "destinationViewDepth", "historyIrradiance"]),
		jsArguments: Object.freeze(["uv", "destinationViewDepth", "historyIrradiance"]),
		uniformsInGlsl: Object.freeze([]),
		note: "JS receives one request object whose fields carry these names, in this order",
	}),
});


export const MSM_UPSAMPLE_SKY_DEPTH_RATIO = MSM_SKY_DEPTH_RATIO;

function readFiniteNumber(value, fallback) {
	const numericValue = Number(value);
	return Number.isFinite(numericValue) ? numericValue : fallback;
}

function readPositiveInteger(value) {
	const integerValue = Math.floor(Number(value));
	return Number.isFinite(integerValue) && integerValue >= 1 ? integerValue : 0;
}

function readIrradiance(value) {
	if (!Array.isArray(value)) return [0, 0, 0];
	return [readFiniteNumber(value[0], 0), readFiniteNumber(value[1], 0), readFiniteNumber(value[2], 0)];
}


export function clampUvComponentToTexelCenter(uvComponent, texelSize) {
	const halfTexel = texelSize * 0.5;
	const lastTexelCenter = 1 - halfTexel;
	if (halfTexel > uvComponent) return halfTexel;
	return uvComponent > lastTexelCenter ? lastTexelCenter : uvComponent;
}


export function relativeDepthDifference(destinationViewDepth, tapViewDepth) {
	const destination = readFiniteNumber(destinationViewDepth, 0);
	const tap = readFiniteNumber(tapViewDepth, 0);
	const scale = destination > MSM_UPSAMPLE_MINIMUM_VIEW_DEPTH ? destination : MSM_UPSAMPLE_MINIMUM_VIEW_DEPTH;
	return Math.abs(destination - tap) / scale;
}


export function depthSimilarityWeight(destinationViewDepth, tapViewDepth, relativeDepthTolerance, cameraFar) {
	if (isSkyViewDepth(tapViewDepth, cameraFar)) return 0;
	if (!(relativeDepthTolerance > 0)) return 0;
	const weight = 1 - relativeDepthDifference(destinationViewDepth, tapViewDepth) / relativeDepthTolerance;
	if (!(weight > 0)) return 0;
	return weight > 1 ? 1 : weight;
}


export function bilinearFootprintAt(uvX, uvY, sourceWidth, sourceHeight) {
	const sourceTexelX = readFiniteNumber(uvX, 0) * sourceWidth - 0.5;
	const sourceTexelY = readFiniteNumber(uvY, 0) * sourceHeight - 0.5;
	const baseTexelX = Math.floor(sourceTexelX);
	const baseTexelY = Math.floor(sourceTexelY);
	return {
		baseTexelX,
		baseTexelY,
		fractionX: sourceTexelX - baseTexelX,
		fractionY: sourceTexelY - baseTexelY,
	};
}


export function bilinearWeightAt(fractionX, fractionY, tapIndex) {
	const offset = MSM_UPSAMPLE_TAP_OFFSETS[tapIndex] || MSM_UPSAMPLE_TAP_OFFSETS[0];
	const horizontalWeight = offset[0] === 1 ? fractionX : 1 - fractionX;
	const verticalWeight = offset[1] === 1 ? fractionY : 1 - fractionY;
	return horizontalWeight * verticalWeight;
}


export function tapUvAt(baseTexelX, baseTexelY, tapOffsetX, tapOffsetY, sourceTexelWidth, sourceTexelHeight) {
	const tapUvX = (baseTexelX + tapOffsetX + 0.5) * sourceTexelWidth;
	const tapUvY = (baseTexelY + tapOffsetY + 0.5) * sourceTexelHeight;
	return [
		clampUvComponentToTexelCenter(tapUvX, sourceTexelWidth),
		clampUvComponentToTexelCenter(tapUvY, sourceTexelHeight),
	];
}

function buildResult(fields) {
	return {
		owner: MSM_UPSAMPLE_OWNER,
		irradiance: [0, 0, 0],
		rung: MSM_UPSAMPLE_RUNGS.BILATERAL,
		tapCount: 0,
		acceptedTapCount: 0,
		rejectedTapCount: 0,
		totalWeight: 0,
		hardwareFetchCount: 0,
		sampledTexelCount: 0,
		depthFetchCount: 0,
		holeCount: 0,
		usedHistoryFallback: false,
		destinationHasNoSurface: false,
		refusalReason: MSM_UPSAMPLE_REFUSALS.NONE,
		...fields,
	};
}


export function upsampleIrradiance(request) {
	const source = request && typeof request === "object" ? request : {};
	const historyIrradiance = readIrradiance(source.historyIrradiance);
	const sampleSourceIrradiance =
		typeof source.sampleSourceIrradiance === "function" ? source.sampleSourceIrradiance : null;
	const sampleSourceViewDepth =
		typeof source.sampleSourceViewDepth === "function" ? source.sampleSourceViewDepth : null;
	const sourceWidth = readPositiveInteger(source.sourceWidth);
	const sourceHeight = readPositiveInteger(source.sourceHeight);
	const cameraFar = readFiniteNumber(source.cameraFar, 0);
	const destinationViewDepth = Number(source.destinationViewDepth);
	const requestedTapCount = Math.floor(Number(source.tapCount));
	const tapCount = requestedTapCount === MSM_UPSAMPLE_BILATERAL_TAP_COUNT
		? MSM_UPSAMPLE_BILATERAL_TAP_COUNT
		: MSM_UPSAMPLE_BILINEAR_TAP_COUNT;
	const relativeDepthTolerance = readFiniteNumber(
		source.relativeDepthTolerance,
		MSM_UPSAMPLE_RELATIVE_DEPTH_TOLERANCE,
	);

	if (!sampleSourceIrradiance) {
		return buildResult({
			irradiance: historyIrradiance,
			tapCount,
			usedHistoryFallback: true,
			refusalReason: MSM_UPSAMPLE_REFUSALS.MISSING_SOURCE_SAMPLER,
		});
	}

	if (sourceWidth === 0 || sourceHeight === 0) {
		return buildResult({
			irradiance: historyIrradiance,
			tapCount,
			usedHistoryFallback: true,
			refusalReason: MSM_UPSAMPLE_REFUSALS.UNUSABLE_SOURCE_RESOLUTION,
		});
	}

	const sourceTexelWidth = 1 / sourceWidth;
	const sourceTexelHeight = 1 / sourceHeight;
	const footprint = bilinearFootprintAt(source.uvX, source.uvY, sourceWidth, sourceHeight);


	if (tapCount === MSM_UPSAMPLE_BILINEAR_TAP_COUNT) {
		const bilinearIrradiance = [0, 0, 0];
		for (let tapIndex = 0; MSM_UPSAMPLE_BILATERAL_TAP_COUNT > tapIndex; tapIndex += 1) {
			const offset = MSM_UPSAMPLE_TAP_OFFSETS[tapIndex];
			const tapUv = tapUvAt(
				footprint.baseTexelX,
				footprint.baseTexelY,
				offset[0],
				offset[1],
				sourceTexelWidth,
				sourceTexelHeight,
			);
			const weight = bilinearWeightAt(footprint.fractionX, footprint.fractionY, tapIndex);
			const tapIrradiance = readIrradiance(sampleSourceIrradiance(tapUv[0], tapUv[1]));
			bilinearIrradiance[0] += tapIrradiance[0] * weight;
			bilinearIrradiance[1] += tapIrradiance[1] * weight;
			bilinearIrradiance[2] += tapIrradiance[2] * weight;
		}
		return buildResult({
			irradiance: bilinearIrradiance,
			rung: MSM_UPSAMPLE_RUNGS.BILINEAR,
			tapCount,
			totalWeight: 1,
			hardwareFetchCount: MSM_UPSAMPLE_BILINEAR_TAP_COUNT,
			sampledTexelCount: MSM_UPSAMPLE_BILATERAL_TAP_COUNT,
			depthFetchCount: 0,
			destinationHasNoSurface: isSkyViewDepth(destinationViewDepth, cameraFar),
		});
	}

	if (!Number.isFinite(destinationViewDepth) || !sampleSourceViewDepth) {
		return buildResult({
			irradiance: historyIrradiance,
			tapCount,
			usedHistoryFallback: true,
			refusalReason: MSM_UPSAMPLE_REFUSALS.UNUSABLE_DESTINATION_DEPTH,
		});
	}


	const weightedIrradiance = [0, 0, 0];
	let totalWeight = 0;
	let acceptedTapCount = 0;
	let rejectedTapCount = 0;

	for (let tapIndex = 0; tapCount > tapIndex; tapIndex += 1) {
		const offset = MSM_UPSAMPLE_TAP_OFFSETS[tapIndex];
		const tapUv = tapUvAt(
			footprint.baseTexelX,
			footprint.baseTexelY,
			offset[0],
			offset[1],
			sourceTexelWidth,
			sourceTexelHeight,
		);
		const bilinearWeight = bilinearWeightAt(footprint.fractionX, footprint.fractionY, tapIndex);
		const tapViewDepth = readFiniteNumber(sampleSourceViewDepth(tapUv[0], tapUv[1]), cameraFar);
		const depthWeight = depthSimilarityWeight(
			destinationViewDepth,
			tapViewDepth,
			relativeDepthTolerance,
			cameraFar,
		);
		const tapWeight = bilinearWeight * depthWeight;
		const tapIrradiance = readIrradiance(sampleSourceIrradiance(tapUv[0], tapUv[1]));

		weightedIrradiance[0] += tapIrradiance[0] * tapWeight;
		weightedIrradiance[1] += tapIrradiance[1] * tapWeight;
		weightedIrradiance[2] += tapIrradiance[2] * tapWeight;
		totalWeight += tapWeight;

		if (depthWeight > 0) acceptedTapCount += 1;
		else rejectedTapCount += 1;
	}

	const destinationHasNoSurface = isSkyViewDepth(destinationViewDepth, cameraFar);


	if (!(totalWeight > MSM_UPSAMPLE_MINIMUM_ACCEPTED_WEIGHT)) {
		return buildResult({
			irradiance: historyIrradiance,
			tapCount,
			acceptedTapCount,
			rejectedTapCount,
			totalWeight,
			hardwareFetchCount: tapCount,
			sampledTexelCount: tapCount,
			depthFetchCount: tapCount,
			usedHistoryFallback: true,
			destinationHasNoSurface,
			refusalReason: MSM_UPSAMPLE_REFUSALS.EVERY_TAP_REJECTED,
		});
	}

	return buildResult({
		irradiance: [
			weightedIrradiance[0] / totalWeight,
			weightedIrradiance[1] / totalWeight,
			weightedIrradiance[2] / totalWeight,
		],
		tapCount,
		acceptedTapCount,
		rejectedTapCount,
		totalWeight,
		hardwareFetchCount: tapCount,
		sampledTexelCount: tapCount,
		depthFetchCount: tapCount,
		destinationHasNoSurface,
	});
}

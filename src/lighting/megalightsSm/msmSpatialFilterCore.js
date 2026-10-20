import { MSM_SPATIAL_FILTER_TAP_COUNT, MSM_VARIANCE_PASS, isSpatialFilterGateOpen } from "./msmVarianceCore.js";

export const MSM_SPATIAL_FILTER_OWNER = "MSM-F28";
export const MSM_SPATIAL_FILTER_PASS = MSM_VARIANCE_PASS;


export const MSM_SPATIAL_FILTER_OFFSETS = Object.freeze([
	Object.freeze([1, 0]),
	Object.freeze([-1, 0]),
	Object.freeze([0, 1]),
	Object.freeze([0, -1]),
]);


export const MSM_SPATIAL_REFERENCE_FIELD_OF_VIEW_DEGREES = 60;
export const MSM_SPATIAL_REFERENCE_TARGET_HEIGHT = 180;
export const MSM_SPATIAL_GRAZING_ANGLE_DEGREES = 75;

const degreesToRadians = (degrees) => (degrees * Math.PI) / 180;

export function computeDepthToleranceRatio(request) {
	const verticalFieldOfViewDegrees = request?.verticalFieldOfViewDegrees ?? MSM_SPATIAL_REFERENCE_FIELD_OF_VIEW_DEGREES;
	const targetHeightInTexels = request?.targetHeightInTexels ?? MSM_SPATIAL_REFERENCE_TARGET_HEIGHT;
	const grazingAngleDegrees = request?.grazingAngleDegrees ?? MSM_SPATIAL_GRAZING_ANGLE_DEGREES;
	const radiansPerTexel = degreesToRadians(verticalFieldOfViewDegrees) / targetHeightInTexels;
	return Math.tan(degreesToRadians(grazingAngleDegrees)) * radiansPerTexel;
}

export const MSM_SPATIAL_DEPTH_TOLERANCE_RATIO = computeDepthToleranceRatio({});


export const MSM_SPATIAL_SILHOUETTE_MULTIPLIER = 2;
export const MSM_SPATIAL_DEPTH_REJECTION_RATIO = MSM_SPATIAL_DEPTH_TOLERANCE_RATIO * MSM_SPATIAL_SILHOUETTE_MULTIPLIER;


export const MSM_SPATIAL_NORMAL_REJECTION_DEGREES = 45;
export const MSM_SPATIAL_NORMAL_REJECTION_TANGENT = Math.tan(degreesToRadians(MSM_SPATIAL_NORMAL_REJECTION_DEGREES));

export const MSM_SPATIAL_FILTER_REASON = Object.freeze({
	filtered: "filtered",
	gateClosed: "gateClosed",
	samplerMissing: "samplerMissing",
	skyPixel: "skyPixel",
});

export const MSM_SPATIAL_FILTER_MIRROR_ARGUMENT_ORDER = Object.freeze({
	computeTapWeight: Object.freeze({
		arguments: Object.freeze(["centreViewPosition", "centreViewNormal", "tapViewPosition", "depthToleranceRatio"]),
		glslCounterpart: "msmSpatialTapWeight",
		jsArgumentCount: 1,
	}),
	filterSpatialPixel: Object.freeze({
		arguments: Object.freeze(["uv", "texel", "centreIrradiance", "centreViewPosition", "centreViewNormal", "moments", "relativeVarianceThreshold", "depthToleranceRatio"]),
		glslCounterpart: "msmSpatialFilterPixel",
		jsArgumentCount: 1,
	}),
});


const toFloat32 = Math.fround;

function toFiniteTriple(value) {
	if (!Array.isArray(value) || value.length !== 3) {
		return null;
	}
	const triple = [toFloat32(value[0]), toFloat32(value[1]), toFloat32(value[2])];
	return triple.every((component) => Number.isFinite(component)) ? triple : null;
}


function viewDepthOf(viewPosition) {
	return Math.abs(viewPosition[2]);
}

function dotTriple(left, right) {
	return toFloat32(toFloat32(left[0] * right[0]) + toFloat32(left[1] * right[1]) + toFloat32(left[2] * right[2]));
}

function subtractTriple(left, right) {
	return [toFloat32(left[0] - right[0]), toFloat32(left[1] - right[1]), toFloat32(left[2] - right[2])];
}


export function computeTapWeight(request) {
	const centreViewPosition = toFiniteTriple(request?.centreViewPosition);
	const centreViewNormal = toFiniteTriple(request?.centreViewNormal);
	const tapViewPosition = toFiniteTriple(request?.tapViewPosition);
	if (centreViewPosition === null || centreViewNormal === null || tapViewPosition === null) {
		return 0;
	}

	const centreViewDepth = viewDepthOf(centreViewPosition);
	const depthToleranceRatio = request?.depthToleranceRatio ?? MSM_SPATIAL_DEPTH_TOLERANCE_RATIO;
	const planeTolerance = toFloat32(centreViewDepth * depthToleranceRatio);
	if (!(planeTolerance > 0)) {
		return 0;
	}

	const centreToTap = subtractTriple(tapViewPosition, centreViewPosition);
	const planeDistance = Math.abs(dotTriple(centreToTap, centreViewNormal));
	const squaredLength = dotTriple(centreToTap, centreToTap);
	const inPlaneDistance = Math.sqrt(Math.max(0, toFloat32(squaredLength - toFloat32(planeDistance * planeDistance))));
	const depthDifference = Math.abs(toFloat32(viewDepthOf(tapViewPosition) - centreViewDepth));
	const rejectionDistance = toFloat32(centreViewDepth * MSM_SPATIAL_DEPTH_REJECTION_RATIO);


	if (planeDistance > rejectionDistance || depthDifference > rejectionDistance || planeDistance > toFloat32(inPlaneDistance * MSM_SPATIAL_NORMAL_REJECTION_TANGENT)) {
		return 0;
	}


	return toFloat32(Math.exp(-planeDistance / planeTolerance));
}


export function filterSpatialPixel(request) {
	const centreIrradiance = toFiniteTriple(request?.centreIrradiance);
	const unfilteredBecause = (reason) =>
		Object.freeze({
			filtered: false,
			reason,
			irradiance: Object.freeze(centreIrradiance ?? [0, 0, 0]),
			tapCount: 0,
			acceptedTapCount: 0,
			weightSum: 0,
		});

	const centreViewPosition = toFiniteTriple(request?.centreViewPosition);
	const centreViewNormal = toFiniteTriple(request?.centreViewNormal);
	if (centreIrradiance === null || centreViewPosition === null || centreViewNormal === null || typeof request?.sampleTap !== "function") {
		return unfilteredBecause(MSM_SPATIAL_FILTER_REASON.samplerMissing);
	}


	if (request?.centreIsSky === true) {
		return unfilteredBecause(MSM_SPATIAL_FILTER_REASON.skyPixel);
	}

	const gate = isSpatialFilterGateOpen({
		firstMoment: request?.firstMoment,
		secondMoment: request?.secondMoment,
		spatialFilter: request?.spatialFilter,
	});
	if (!gate.open) {
		return unfilteredBecause(MSM_SPATIAL_FILTER_REASON.gateClosed);
	}



	const edgeStoppingEnabled = request?.edgeStoppingEnabled !== false;
	const depthToleranceRatio = request?.depthToleranceRatio ?? MSM_SPATIAL_DEPTH_TOLERANCE_RATIO;


	let weightSum = 1;
	let acceptedTapCount = 0;
	const accumulated = [centreIrradiance[0], centreIrradiance[1], centreIrradiance[2]];

	for (const [offsetX, offsetY] of MSM_SPATIAL_FILTER_OFFSETS) {
		const tap = request.sampleTap(toFloat32(request.uvX + offsetX * request.texelWidth), toFloat32(request.uvY + offsetY * request.texelHeight));
		const tapIrradiance = toFiniteTriple(tap?.irradiance);
		const tapViewPosition = toFiniteTriple(tap?.viewPosition);
		if (tapIrradiance === null || tapViewPosition === null) {
			continue;
		}
		const weight = edgeStoppingEnabled ? computeTapWeight({ centreViewPosition, centreViewNormal, tapViewPosition, depthToleranceRatio }) : 1;
		if (!(weight > 0)) {
			continue;
		}
		weightSum = toFloat32(weightSum + weight);
		accumulated[0] = toFloat32(accumulated[0] + toFloat32(weight * tapIrradiance[0]));
		accumulated[1] = toFloat32(accumulated[1] + toFloat32(weight * tapIrradiance[1]));
		accumulated[2] = toFloat32(accumulated[2] + toFloat32(weight * tapIrradiance[2]));
		acceptedTapCount += 1;
	}

	return Object.freeze({
		filtered: true,
		reason: MSM_SPATIAL_FILTER_REASON.filtered,
		irradiance: Object.freeze([toFloat32(accumulated[0] / weightSum), toFloat32(accumulated[1] / weightSum), toFloat32(accumulated[2] / weightSum)]),
		tapCount: MSM_SPATIAL_FILTER_TAP_COUNT,
		acceptedTapCount,
		weightSum,
	});
}

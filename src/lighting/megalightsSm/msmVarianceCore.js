import { MSM_DISPLAY_LEVELS, MSM_HISTORY_ROUND_TRIP_RELATIVE_LIMIT } from "./msmHistoryStorageCore.js";
import { MSM_SPATIAL_PASS_ID, MSM_TEMPORAL_PASS_ID, MSM_VARIANCE_MOMENTS_BUFFER_ID } from "./msmPipelineContract.js";
import { MSM_SPATIAL_FILTER } from "./msmTierPolicy.js";

export const MSM_VARIANCE_OWNER = "MSM-F28";
export const MSM_VARIANCE_PASS = MSM_SPATIAL_PASS_ID;
export const MSM_VARIANCE_MOMENTS_BUFFER = MSM_VARIANCE_MOMENTS_BUFFER_ID;


export const MSM_VARIANCE_MOMENT_CHANNELS = Object.freeze(["firstMomentLuminance", "secondMomentLuminance"]);


export const MSM_VARIANCE_MOMENTS_PRODUCER = Object.freeze({
	bufferId: MSM_VARIANCE_MOMENTS_BUFFER_ID,
	writtenByPassId: MSM_TEMPORAL_PASS_ID,
	ownerPhase: "MSM-F27",
	space: "linear",
	note: "the moments must ride the SAME exponential window as the irradiance; until F27 writes them, section 5.1 allows the alpha of the history as a fallback and the glue has to say so out loud",
});


export const MSM_SPATIAL_FILTER_TAP_COUNT = 5;
export const MSM_SPATIAL_FILTER_NEIGHBOUR_TAP_COUNT = MSM_SPATIAL_FILTER_TAP_COUNT - 1;


export const MSM_SPATIAL_FILTER_NOISE_GAIN = 1 - 1 / Math.sqrt(MSM_SPATIAL_FILTER_TAP_COUNT);


export const MSM_MID_GREY_FRACTION = 0.5;


export const MSM_STORAGE_NOISE_FLOOR = MSM_HISTORY_ROUND_TRIP_RELATIVE_LIMIT;
export const MSM_DISPLAY_NOISE_FLOOR = 1 / MSM_DISPLAY_LEVELS / MSM_MID_GREY_FRACTION;


export const MSM_GATED_RELATIVE_DEVIATION_THRESHOLD = MSM_STORAGE_NOISE_FLOOR / MSM_SPATIAL_FILTER_NOISE_GAIN;
export const MSM_ON_RELATIVE_DEVIATION_THRESHOLD = MSM_DISPLAY_NOISE_FLOOR / MSM_SPATIAL_FILTER_NOISE_GAIN;


export const MSM_RELATIVE_VARIANCE_THRESHOLD = Object.freeze({
	[MSM_SPATIAL_FILTER.OFF]: Number.POSITIVE_INFINITY,
	[MSM_SPATIAL_FILTER.GATED]: MSM_GATED_RELATIVE_DEVIATION_THRESHOLD * MSM_GATED_RELATIVE_DEVIATION_THRESHOLD,
	[MSM_SPATIAL_FILTER.ON]: MSM_ON_RELATIVE_DEVIATION_THRESHOLD * MSM_ON_RELATIVE_DEVIATION_THRESHOLD,
});

export const MSM_VARIANCE_REASON = Object.freeze({
	gateOpen: "gateOpen",
	belowThreshold: "belowThreshold",
	filterOff: "filterOff",
	momentsMissing: "momentsMissing",
});


export const MSM_REFUSED_GATE_FORMS = Object.freeze(["absoluteVariance", "absoluteStandardDeviation", "absoluteLuminanceDifference"]);

export const MSM_VARIANCE_MIRROR_ARGUMENT_ORDER = Object.freeze({
	isSpatialFilterGateOpen: Object.freeze({
		arguments: Object.freeze(["firstMoment", "secondMoment", "relativeVarianceThreshold"]),
		glslCounterpart: "msmSpatialGateOpen",
		note: "the JS takes one request object; these are the parameters the GLSL declares, in order, with the two moments arriving as one vec2",
		jsArgumentCount: 1,
	}),
	computeRelativeVariance: Object.freeze({
		arguments: Object.freeze(["firstMoment", "secondMoment"]),
		glslCounterpart: null,
		note: "report only, and deliberately absent from the chunk: nothing on the GPU needs this number, and a shader function nobody calls is dead code the mirror would have to keep alive",
		jsArgumentCount: 1,
	}),
});


const toFloat32 = Math.fround;


function toFiniteMoment(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? toFloat32(value) : null;
}

export function isSpatialFilterState(spatialFilter) {
	return spatialFilter === MSM_SPATIAL_FILTER.OFF || spatialFilter === MSM_SPATIAL_FILTER.GATED || spatialFilter === MSM_SPATIAL_FILTER.ON;
}


export function resolveRelativeVarianceThreshold(spatialFilter) {
	return isSpatialFilterState(spatialFilter) ? MSM_RELATIVE_VARIANCE_THRESHOLD[spatialFilter] : Number.POSITIVE_INFINITY;
}


export function computeVarianceFromMoments(request) {
	const firstMoment = toFiniteMoment(request?.firstMoment);
	const secondMoment = toFiniteMoment(request?.secondMoment);
	if (firstMoment === null || secondMoment === null) {
		return Object.freeze({ valid: false, mean: 0, variance: 0 });
	}
	const mean = firstMoment;
	const variance = Math.max(0, toFloat32(secondMoment - toFloat32(mean * mean)));
	return Object.freeze({ valid: true, mean, variance });
}


export function computeRelativeVariance(request) {
	const { valid, mean, variance } = computeVarianceFromMoments(request);
	if (!valid || mean <= 0) {
		return 0;
	}
	return variance / (mean * mean);
}


export function computeRelativeDeviation(request) {
	return Math.sqrt(computeRelativeVariance(request));
}


export function isSpatialFilterGateOpen(request) {
	const spatialFilter = request?.spatialFilter;
	const threshold = resolveRelativeVarianceThreshold(spatialFilter);
	const { valid, mean, variance } = computeVarianceFromMoments(request);
	const gateClosedBecause = (reason) => Object.freeze({ open: false, reason, tapCount: 0, threshold, mean, variance });

	if (!valid) {
		return gateClosedBecause(MSM_VARIANCE_REASON.momentsMissing);
	}
	if (!isSpatialFilterState(spatialFilter) || spatialFilter === MSM_SPATIAL_FILTER.OFF) {
		return gateClosedBecause(MSM_VARIANCE_REASON.filterOff);
	}


	if (!(variance > toFloat32(threshold * toFloat32(mean * mean)))) {
		return gateClosedBecause(MSM_VARIANCE_REASON.belowThreshold);
	}

	return Object.freeze({
		open: true,
		reason: MSM_VARIANCE_REASON.gateOpen,
		tapCount: MSM_SPATIAL_FILTER_TAP_COUNT,
		threshold,
		mean,
		variance,
	});
}

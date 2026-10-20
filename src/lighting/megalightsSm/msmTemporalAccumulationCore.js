import { MSM_TEMPORAL_PASS_ID } from "./msmPipelineContract.js";
import {
	MSM_HISTORY_STORAGE_FLOAT,
	decodeStoredTriple,
	encodeStoredChannel,
	isHistoryStorageMode,
	quantizeStoredChannel,
	resolveGlobalScale,
} from "./msmHistoryStorageCore.js";
import {
	MSM_NEIGHBOURHOOD_CHANNEL_COUNT,
	MSM_NEIGHBOURHOOD_TAP_COUNT,
	clampTripleToBox,
	sampleNeighbourhoodBox,
} from "./msmNeighbourhoodClampCore.js";
import { reprojectViewPositionToPreviousUv } from "./msmTemporalReprojectionCore.js";

export const MSM_TEMPORAL_OWNER = "MSM-F26";
export const MSM_TEMPORAL_PASS = MSM_TEMPORAL_PASS_ID;


export const MSM_TEMPORAL_CURRENT_TAP_COUNT = MSM_NEIGHBOURHOOD_TAP_COUNT;
export const MSM_TEMPORAL_HISTORY_TAP_COUNT = 1;
export const MSM_TEMPORAL_FETCH_COUNT_PER_PIXEL = MSM_TEMPORAL_CURRENT_TAP_COUNT + MSM_TEMPORAL_HISTORY_TAP_COUNT;


export const MSM_TEMPORAL_DEPTH_TAP_COUNT = 0;


export const MSM_TEMPORAL_ALPHA_MEANING = "weight of the current frame: 0 freezes the history, 1 discards it";
export const MSM_TEMPORAL_FALLBACK_ALPHA = 0.1;
export const MSM_TEMPORAL_ALPHA_OWNER = "MSM-F27";


export const MSM_TEMPORAL_DECLARED_DRAG_FRAME_LIMIT = 2;

export const MSM_TEMPORAL_REASON = Object.freeze({
	accumulated: "accumulated",
	samplerMissing: "samplerMissing",
});

export const MSM_TEMPORAL_MIRROR_ARGUMENT_ORDER = Object.freeze({
	accumulateTemporalPixel: Object.freeze({
		arguments: Object.freeze(["uv", "currentViewPosition", "currentFrameAlpha"]),
		glslCounterpart: "msmTemporalAccumulate",
		note: "the JS takes one request object; these are the parameters the GLSL declares, in order",
		jsArgumentCount: 1,
	}),
});

const toFloat32 = Math.fround;


export function clampCurrentFrameAlpha(currentFrameAlpha) {
	const value = Number(currentFrameAlpha);
	if (!Number.isFinite(value)) return MSM_TEMPORAL_FALLBACK_ALPHA;
	if (value <= 0) return 0;
	return value >= 1 ? 1 : value;
}












export function accumulateTemporalPixel(request) {
	const source = request && typeof request === "object" ? request : {};
	const sampleHistoryStored = typeof source.sampleHistoryStored === "function" ? source.sampleHistoryStored : null;
	if (!sampleHistoryStored) {
		return Object.freeze({ accumulated: false, reason: MSM_TEMPORAL_REASON.samplerMissing });
	}

	const storageMode = isHistoryStorageMode(source.storageMode) ? source.storageMode : MSM_HISTORY_STORAGE_FLOAT;
	const globalScale = resolveGlobalScale(source.globalScale);

	const neighbourhood = sampleNeighbourhoodBox({
		uvX: source.uvX,
		uvY: source.uvY,
		texelWidth: source.texelWidth,
		texelHeight: source.texelHeight,
		sampleStored: source.sampleCurrentStored,
	});
	if (!neighbourhood.sampled) {
		return Object.freeze({ accumulated: false, reason: MSM_TEMPORAL_REASON.samplerMissing });
	}

	const reprojection = reprojectViewPositionToPreviousUv({
		viewPosition: source.viewPosition,
		previousClipFromCurrentViewElements: source.previousClipFromCurrentViewElements,
		cameraFar: source.cameraFar,
		currentUvX: source.uvX,
		currentUvY: source.uvY,
	});


	const storedHistory = sampleHistoryStored(reprojection.uvX, reprojection.uvY);
	const historyTapCount = 1;

	const clampEnabled = source.clampEnabled !== false;
	const unclampedHistory = [
		toFloat32(storedHistory[0]),
		toFloat32(storedHistory[1]),
		toFloat32(storedHistory[2]),
	];
	const clampResult = clampEnabled
		? clampTripleToBox(storedHistory, neighbourhood)
		: { clamped: unclampedHistory, clampedChannelCount: 0 };

	const currentIrradiance = decodeStoredTriple(neighbourhood.centreStored, storageMode, globalScale);
	const historyIrradiance = decodeStoredTriple(clampResult.clamped, storageMode, globalScale);

	const currentFrameAlpha = clampCurrentFrameAlpha(source.currentFrameAlpha);
	const historyWeight = toFloat32(reprojection.validity * (1 - currentFrameAlpha));

	const blendedIrradiance = [0, 0, 0];
	const storedResult = [0, 0, 0];
	for (let channel = 0; MSM_NEIGHBOURHOOD_CHANNEL_COUNT > channel; channel += 1) {

		const blended = toFloat32(
			toFloat32(currentIrradiance[channel] * (1 - historyWeight)) +
				toFloat32(historyIrradiance[channel] * historyWeight),
		);
		blendedIrradiance[channel] = blended;
		storedResult[channel] = quantizeStoredChannel(encodeStoredChannel(blended, storageMode, globalScale), storageMode);
	}

	return Object.freeze({
		accumulated: true,
		reason: MSM_TEMPORAL_REASON.accumulated,
		storedResult,
		blendedIrradiance,
		currentIrradiance,
		historyIrradiance,
		box: { minimum: neighbourhood.minimum, maximum: neighbourhood.maximum },
		centreStored: neighbourhood.centreStored,
		reprojection,
		clampedChannelCount: clampResult.clampedChannelCount,
		currentFrameAlpha,
		historyWeight,
		currentTapCount: neighbourhood.tapCount,
		historyTapCount,
		totalFetchCount: neighbourhood.tapCount + historyTapCount,
		storageMode,
		globalScale,
	});
}

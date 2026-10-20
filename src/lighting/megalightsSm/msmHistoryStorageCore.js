export const MSM_HISTORY_STORAGE_OWNER = "MSM-F26";


export const MSM_HISTORY_STORAGE_FLOAT = "float";
export const MSM_HISTORY_STORAGE_UNSIGNED_BYTE = "unsignedByte";
export const MSM_HISTORY_STORAGE_MODES = Object.freeze([MSM_HISTORY_STORAGE_FLOAT, MSM_HISTORY_STORAGE_UNSIGNED_BYTE]);


export const MSM_HISTORY_QUANTIZATION_LEVELS = 255;
export const MSM_HISTORY_DEFAULT_GLOBAL_SCALE = 8;


export const MSM_STORED_CHANNEL_FLOOR = 0;


export const MSM_DISPLAY_GAMMA = 2.2;
export const MSM_DISPLAY_LEVELS = 255;


export const MSM_HISTORY_BANDING_STEP_LIMIT_LSB = 2;
export const MSM_HISTORY_BANDING_STEP_ABOVE_BLACK_LIMIT_LSB = 1.75;


export const MSM_HISTORY_ROUND_TRIP_FLOOR_RATIO = 0.01;
export const MSM_HISTORY_ROUND_TRIP_RELATIVE_LIMIT = 0.05;

export const MSM_HISTORY_STORAGE_REASON = Object.freeze({
	stored: "stored",
	unknownStorageMode: "unknownStorageMode",
	decodeLevelMissing: "decodeLevelMissing",
	aboveGlobalScale: "aboveGlobalScale",
});


export const MSM_HISTORY_STORAGE_MIRROR_ARGUMENT_ORDER = Object.freeze({
	encodeStoredChannel: Object.freeze({
		arguments: Object.freeze(["linearIrradiance", "storageMode", "globalScale"]),
		glslCounterpart: "msmEncodeStoredIrradiance",
		note: "the GLSL takes a vec3 and the scale as a uniform, so its arity is one",
	}),
	decodeStoredChannel: Object.freeze({
		arguments: Object.freeze(["storedChannel", "storageMode", "globalScale"]),
		glslCounterpart: "msmDecodeStoredIrradiance",
		note: "the GLSL takes a vec3 and the scale as a uniform, so its arity is one",
	}),
});

const toFloat32 = Math.fround;

function clampUnitInterval(value) {
	if (!(value >= 0)) return 0;
	return value >= 1 ? 1 : value;
}


export function isHistoryStorageMode(value) {
	return MSM_HISTORY_STORAGE_MODES.indexOf(value) !== -1;
}


export function resolveGlobalScale(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : MSM_HISTORY_DEFAULT_GLOBAL_SCALE;
}


export function encodeStoredChannel(linearIrradiance, storageMode, globalScale) {
	const value = Number.isFinite(linearIrradiance) ? linearIrradiance : 0;
	if (storageMode === MSM_HISTORY_STORAGE_FLOAT) return toFloat32(Math.max(value, MSM_STORED_CHANNEL_FLOOR));
	const scale = resolveGlobalScale(globalScale);
	return toFloat32(Math.sqrt(clampUnitInterval(toFloat32(value / scale))));
}


export function quantizeStoredChannel(storedChannel, storageMode) {
	const value = Number.isFinite(storedChannel) ? storedChannel : 0;
	if (storageMode === MSM_HISTORY_STORAGE_FLOAT) return toFloat32(value);
	const unitValue = clampUnitInterval(value);
	return toFloat32(Math.round(unitValue * MSM_HISTORY_QUANTIZATION_LEVELS) / MSM_HISTORY_QUANTIZATION_LEVELS);
}


export function decodeStoredChannel(storedChannel, storageMode, globalScale) {
	const value = Number.isFinite(storedChannel) ? storedChannel : 0;
	if (storageMode === MSM_HISTORY_STORAGE_FLOAT) return toFloat32(value);
	const scale = resolveGlobalScale(globalScale);
	return toFloat32(toFloat32(value * value) * scale);
}


export function roundTripStoredChannel(linearIrradiance, storageMode, globalScale) {
	const stored = encodeStoredChannel(linearIrradiance, storageMode, globalScale);
	return decodeStoredChannel(quantizeStoredChannel(stored, storageMode), storageMode, globalScale);
}

export function encodeStoredTriple(linearTriple, storageMode, globalScale) {
	return [
		encodeStoredChannel(linearTriple[0], storageMode, globalScale),
		encodeStoredChannel(linearTriple[1], storageMode, globalScale),
		encodeStoredChannel(linearTriple[2], storageMode, globalScale),
	];
}

export function quantizeStoredTriple(storedTriple, storageMode) {
	return [
		quantizeStoredChannel(storedTriple[0], storageMode),
		quantizeStoredChannel(storedTriple[1], storageMode),
		quantizeStoredChannel(storedTriple[2], storageMode),
	];
}

export function decodeStoredTriple(storedTriple, storageMode, globalScale) {
	return [
		decodeStoredChannel(storedTriple[0], storageMode, globalScale),
		decodeStoredChannel(storedTriple[1], storageMode, globalScale),
		decodeStoredChannel(storedTriple[2], storageMode, globalScale),
	];
}


export function isAboveGlobalScale(linearIrradiance, globalScale) {
	return Number.isFinite(linearIrradiance) && linearIrradiance > resolveGlobalScale(globalScale);
}


export function displayValueForLinear(linearIrradiance, globalScale, displayGamma) {
	const scale = resolveGlobalScale(globalScale);
	const gamma = Number.isFinite(displayGamma) && displayGamma > 0 ? displayGamma : MSM_DISPLAY_GAMMA;
	return Math.pow(clampUnitInterval(linearIrradiance / scale), 1 / gamma);
}











export function measureQuantizationBanding(request) {
	const source = request && typeof request === "object" ? request : {};
	const decodeLevel = typeof source.decodeLevel === "function" ? source.decodeLevel : null;
	if (!decodeLevel) {
		return Object.freeze({ measured: false, reason: MSM_HISTORY_STORAGE_REASON.decodeLevelMissing });
	}
	const levelCount = Number.isFinite(source.levelCount) && source.levelCount >= 2 ? Math.floor(source.levelCount) : MSM_HISTORY_QUANTIZATION_LEVELS;
	const globalScale = resolveGlobalScale(source.globalScale);
	const displayGamma = Number.isFinite(source.displayGamma) && source.displayGamma > 0 ? source.displayGamma : MSM_DISPLAY_GAMMA;

	let worstDisplayStepLsb = 0;
	let worstDisplayStepLevelIndex = 0;
	let worstDisplayStepAboveBlackLsb = 0;
	let worstDisplayStepAboveBlackLevelIndex = 1;

	for (let levelIndex = 0; levelCount > levelIndex; levelIndex += 1) {
		const lowerDisplay = displayValueForLinear(decodeLevel(levelIndex), globalScale, displayGamma);
		const upperDisplay = displayValueForLinear(decodeLevel(levelIndex + 1), globalScale, displayGamma);
		const stepLsb = Math.abs(upperDisplay - lowerDisplay) * MSM_DISPLAY_LEVELS;
		if (stepLsb > worstDisplayStepLsb) {
			worstDisplayStepLsb = stepLsb;
			worstDisplayStepLevelIndex = levelIndex;
		}
		if (levelIndex >= 1 && stepLsb > worstDisplayStepAboveBlackLsb) {
			worstDisplayStepAboveBlackLsb = stepLsb;
			worstDisplayStepAboveBlackLevelIndex = levelIndex;
		}
	}

	return Object.freeze({
		measured: true,
		reason: MSM_HISTORY_STORAGE_REASON.stored,
		levelCount,
		globalScale,
		displayGamma,
		worstDisplayStepLsb,
		worstDisplayStepLevelIndex,
		worstDisplayStepAboveBlackLsb,
		worstDisplayStepAboveBlackLevelIndex,
		stepLimitLsb: MSM_HISTORY_BANDING_STEP_LIMIT_LSB,
		stepAboveBlackLimitLsb: MSM_HISTORY_BANDING_STEP_ABOVE_BLACK_LIMIT_LSB,
		withinStepLimit: MSM_HISTORY_BANDING_STEP_LIMIT_LSB >= worstDisplayStepLsb,
		withinStepAboveBlackLimit: MSM_HISTORY_BANDING_STEP_ABOVE_BLACK_LIMIT_LSB >= worstDisplayStepAboveBlackLsb,
	});
}


export function measureRoundTripError(request) {
	const source = request && typeof request === "object" ? request : {};
	const storageMode = isHistoryStorageMode(source.storageMode) ? source.storageMode : null;
	if (!storageMode) {
		return Object.freeze({ measured: false, reason: MSM_HISTORY_STORAGE_REASON.unknownStorageMode });
	}
	const globalScale = resolveGlobalScale(source.globalScale);
	const sampleCount = Number.isFinite(source.sampleCount) && source.sampleCount >= 2 ? Math.floor(source.sampleCount) : 4096;
	const floorRatio = Number.isFinite(source.floorRatio) && source.floorRatio >= 0 ? source.floorRatio : MSM_HISTORY_ROUND_TRIP_FLOOR_RATIO;
	const floorValue = globalScale * floorRatio;

	let worstRelativeError = 0;
	let worstRelativeErrorAt = 0;
	let worstAbsoluteError = 0;
	let judgedSampleCount = 0;

	for (let sampleIndex = 0; sampleCount >= sampleIndex; sampleIndex += 1) {
		const linearValue = (globalScale * sampleIndex) / sampleCount;
		const returnedValue = roundTripStoredChannel(linearValue, storageMode, globalScale);
		const absoluteError = Math.abs(returnedValue - linearValue);
		if (absoluteError > worstAbsoluteError) worstAbsoluteError = absoluteError;
		if (linearValue >= floorValue) {
			judgedSampleCount += 1;
			const relativeError = absoluteError / linearValue;
			if (relativeError > worstRelativeError) {
				worstRelativeError = relativeError;
				worstRelativeErrorAt = linearValue;
			}
		}
	}

	return Object.freeze({
		measured: true,
		reason: MSM_HISTORY_STORAGE_REASON.stored,
		storageMode,
		globalScale,
		sampleCount,
		judgedSampleCount,
		floorRatio,
		floorValue,
		worstRelativeError,
		worstRelativeErrorAt,
		worstAbsoluteError,
		relativeLimit: MSM_HISTORY_ROUND_TRIP_RELATIVE_LIMIT,
		withinRelativeLimit: MSM_HISTORY_ROUND_TRIP_RELATIVE_LIMIT >= worstRelativeError,
	});
}


export function proveEncodeMonotonicity(request) {
	const source = request && typeof request === "object" ? request : {};
	const storageMode = isHistoryStorageMode(source.storageMode) ? source.storageMode : null;
	if (!storageMode) {
		return Object.freeze({ measured: false, reason: MSM_HISTORY_STORAGE_REASON.unknownStorageMode });
	}
	const globalScale = resolveGlobalScale(source.globalScale);
	const sampleCount = Number.isFinite(source.sampleCount) && source.sampleCount >= 2 ? Math.floor(source.sampleCount) : 4096;

	let inversionCount = 0;
	let worstInversion = 0;
	let previousStored = encodeStoredChannel(0, storageMode, globalScale);

	for (let sampleIndex = 1; sampleCount >= sampleIndex; sampleIndex += 1) {
		const linearValue = (globalScale * sampleIndex) / sampleCount;
		const stored = encodeStoredChannel(linearValue, storageMode, globalScale);
		if (previousStored > stored) {
			inversionCount += 1;
			const inversion = previousStored - stored;
			if (inversion > worstInversion) worstInversion = inversion;
		}
		previousStored = stored;
	}

	return Object.freeze({
		measured: true,
		storageMode,
		globalScale,
		sampleCount,
		inversionCount,
		worstInversion,
		monotonic: inversionCount === 0,
	});
}


export function describeHistoryStorage(request) {
	const source = request && typeof request === "object" ? request : {};
	const storageMode = isHistoryStorageMode(source.storageMode) ? source.storageMode : MSM_HISTORY_STORAGE_FLOAT;
	const globalScale = resolveGlobalScale(source.globalScale);
	return {
		owner: MSM_HISTORY_STORAGE_OWNER,
		storageMode,
		globalScale: storageMode === MSM_HISTORY_STORAGE_FLOAT ? null : globalScale,
		quantizationLevels: storageMode === MSM_HISTORY_STORAGE_FLOAT ? null : MSM_HISTORY_QUANTIZATION_LEVELS,
		companded: storageMode === MSM_HISTORY_STORAGE_UNSIGNED_BYTE,
		storedChannelFloor: MSM_STORED_CHANNEL_FLOOR,
	};
}

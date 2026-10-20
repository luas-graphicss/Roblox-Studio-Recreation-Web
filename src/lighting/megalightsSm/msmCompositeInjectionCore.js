import {
	MSM_COMPOSITE_MODE_INJECTION,
	MSM_IRRADIANCE_HISTORY_BUFFER_ID,
	MSM_MATERIAL_TEXTURE_UNIT_LIMIT,
} from "./msmPipelineContract.js";
import { MSM_LIGHT_LUMINANCE_WEIGHTS } from "./msmLightRecordCore.js";

export const MSM_INJECTION_OWNER_PHASE = "MSM-F24";
export const MSM_INJECTION_COMPOSITE_MODE = MSM_COMPOSITE_MODE_INJECTION;
export const MSM_INJECTION_HISTORY_BUFFER_ID = MSM_IRRADIANCE_HISTORY_BUFFER_ID;


export const MSM_INJECTION_TEXTURE_UNIT_COST = MSM_MATERIAL_TEXTURE_UNIT_LIMIT;


export const MSM_INJECTION_TEXTURE_FETCHES_PER_FRAGMENT = 1;


export const MSM_INJECTION_HISTORY_LAG_FRAMES = 1;


export const MSM_INJECTION_ENERGY_TOLERANCE = 0.1;


export const MSM_INJECTION_CLIP_W_EPSILON = 1e-6;


export const MSM_INJECTION_LAMBERT_FACTOR = 1 / Math.PI;


export const MSM_INJECTION_MIRROR_ARGUMENT_ORDER = Object.freeze([
	"worldPosition",
	"previousViewProjection",
	"historyTexture",
	"diffuseColor",
	"injectionGain",
]);

export const MSM_INJECTION_APPLIED = "applied";
export const MSM_INJECTION_SKIPPED_OFF = "injection-off";
export const MSM_INJECTION_SKIPPED_OUTSIDE_HISTORY = "outside-history";
export const MSM_INJECTION_SKIPPED_MISSING_HISTORY = "missing-history-texture";

function toFloat32(value) {
	return Math.fround(typeof value === "number" && Number.isFinite(value) ? value : 0);
}

function isNumericList(value, minimumLength) {
	return Boolean(value) && typeof value.length === "number" && value.length >= minimumLength;
}

function readVec3(value) {
	if (isNumericList(value, 3)) return [toFloat32(value[0]), toFloat32(value[1]), toFloat32(value[2])];
	if (value && typeof value === "object" && "x" in value) {
		return [toFloat32(value.x), toFloat32(value.y), toFloat32(value.z)];
	}
	if (value && typeof value === "object" && "r" in value) {
		return [toFloat32(value.r), toFloat32(value.g), toFloat32(value.b)];
	}
	return null;
}


function readMatrixElements(value) {
	const source = isNumericList(value, 16)
		? value
		: value && isNumericList(value.elements, 16)
			? value.elements
			: null;
	if (!source) return null;
	const elements = new Array(16);
	for (let index = 0; index < 16; index += 1) elements[index] = toFloat32(source[index]);
	return elements;
}


function resolveLuminanceWeights() {
	const weights = MSM_LIGHT_LUMINANCE_WEIGHTS;
	const asVector = [toFloat32(weights.red), toFloat32(weights.green), toFloat32(weights.blue)];
	const sum = asVector[0] + asVector[1] + asVector[2];
	return sum > 0 ? asVector : null;
}

export function luminanceOf(rgb) {
	const color = readVec3(rgb);
	const weights = resolveLuminanceWeights();
	if (!color || !weights) return 0;
	return toFloat32(color[0] * weights[0] + color[1] * weights[1] + color[2] * weights[2]);
}


function normalizeHistoryTexture(historyTexture) {
	if (!historyTexture || typeof historyTexture !== "object") return null;
	const width = Math.floor(historyTexture.width);
	const height = Math.floor(historyTexture.height);
	const data = historyTexture.data;
	if (!(width > 0) || !(height > 0)) return null;
	if (!isNumericList(data, width * height * 3)) return null;
	return { width, height, data };
}

function clampIndex(value, maximum) {
	if (value < 0) return 0;
	if (value > maximum) return maximum;
	return value;
}

function texelAt(texture, x, y) {
	const column = clampIndex(x, texture.width - 1);
	const row = clampIndex(y, texture.height - 1);
	const offset = (row * texture.width + column) * 3;
	return [
		toFloat32(texture.data[offset]),
		toFloat32(texture.data[offset + 1]),
		toFloat32(texture.data[offset + 2]),
	];
}


export function projectWorldPositionToHistoryUv(worldPosition, previousViewProjection) {
	const position = readVec3(worldPosition);
	const elements = readMatrixElements(previousViewProjection);
	if (!position || !elements) return { u: 0, v: 0, inside: false, clipW: 0 };
	const [x, y, z] = position;
	const clipX = toFloat32(elements[0] * x + elements[4] * y + elements[8] * z + elements[12]);
	const clipY = toFloat32(elements[1] * x + elements[5] * y + elements[9] * z + elements[13]);
	const clipW = toFloat32(elements[3] * x + elements[7] * y + elements[11] * z + elements[15]);
	const safeW = Math.max(Math.abs(clipW), MSM_INJECTION_CLIP_W_EPSILON);
	const u = toFloat32(toFloat32(clipX / safeW) * 0.5 + 0.5);
	const v = toFloat32(toFloat32(clipY / safeW) * 0.5 + 0.5);
	const inside = clipW >= 0 && u >= 0 && u <= 1 && v >= 0 && v <= 1;
	return { u, v, inside, clipW };
}


export function sampleHistoryBilinear(historyTexture, u, v) {
	const texture = normalizeHistoryTexture(historyTexture);
	if (!texture) return { rgb: [0, 0, 0], textureFetchCount: 0 };
	const pixelX = toFloat32(u) * texture.width - 0.5;
	const pixelY = toFloat32(v) * texture.height - 0.5;
	const leftColumn = Math.floor(pixelX);
	const topRow = Math.floor(pixelY);
	const weightX = toFloat32(pixelX - leftColumn);
	const weightY = toFloat32(pixelY - topRow);
	const topLeft = texelAt(texture, leftColumn, topRow);
	const topRight = texelAt(texture, leftColumn + 1, topRow);
	const bottomLeft = texelAt(texture, leftColumn, topRow + 1);
	const bottomRight = texelAt(texture, leftColumn + 1, topRow + 1);
	const rgb = [0, 0, 0];
	for (let channel = 0; channel < 3; channel += 1) {
		const top = toFloat32(topLeft[channel] + (topRight[channel] - topLeft[channel]) * weightX);
		const bottom = toFloat32(bottomLeft[channel] + (bottomRight[channel] - bottomLeft[channel]) * weightX);
		rgb[channel] = toFloat32(top + (bottom - top) * weightY);
	}
	return { rgb, textureFetchCount: MSM_INJECTION_TEXTURE_FETCHES_PER_FRAGMENT };
}


export function injectIrradianceIntoForward(args = {}) {
	const injectionOn = args.injectionOn !== false;
	const injectionGain = Number.isFinite(args.injectionGain) ? toFloat32(args.injectionGain) : 1;
	const diffuseColor = readVec3(args.diffuseColor) || [1, 1, 1];
	if (!injectionOn || injectionGain === 0) {
		return {
			irradiance: [0, 0, 0],
			indirectDiffuse: [0, 0, 0],
			historyUv: { u: 0, v: 0 },
			insideHistory: false,
			textureFetchCount: 0,
			reason: MSM_INJECTION_SKIPPED_OFF,
		};
	}
	const projection = projectWorldPositionToHistoryUv(args.worldPosition, args.previousViewProjection);


	const sample = sampleHistoryBilinear(args.historyTexture, projection.u, projection.v);
	const insideFactor = projection.inside ? 1 : 0;
	const irradiance = [0, 0, 0];
	const indirectDiffuse = [0, 0, 0];
	for (let channel = 0; channel < 3; channel += 1) {
		irradiance[channel] = toFloat32(sample.rgb[channel] * injectionGain * insideFactor);
		indirectDiffuse[channel] = toFloat32(
			irradiance[channel] * diffuseColor[channel] * MSM_INJECTION_LAMBERT_FACTOR,
		);
	}
	const reason = sample.textureFetchCount === 0
		? MSM_INJECTION_SKIPPED_MISSING_HISTORY
		: projection.inside
			? MSM_INJECTION_APPLIED
			: MSM_INJECTION_SKIPPED_OUTSIDE_HISTORY;
	return {
		irradiance,
		indirectDiffuse,
		historyUv: { u: projection.u, v: projection.v },
		insideHistory: projection.inside,
		textureFetchCount: sample.textureFetchCount,
		reason,
	};
}


export function compareInjectedEnergy(args = {}) {
	const tolerance = Number.isFinite(args.tolerance) ? Math.abs(args.tolerance) : MSM_INJECTION_ENERGY_TOLERANCE;
	const referenceEnergy = luminanceOf(args.referenceRgb);
	const injectedEnergy = luminanceOf(args.injectedRgb);
	const denominator = Math.max(Math.abs(referenceEnergy), MSM_INJECTION_CLIP_W_EPSILON);
	const relativeError = Math.abs(injectedEnergy - referenceEnergy) / denominator;
	return Object.freeze({
		referenceEnergy,
		injectedEnergy,
		relativeError,
		tolerance,
		withinTolerance: relativeError <= tolerance,
	});
}

export const DIELECTRIC_SPECULAR_REFLECTANCE = 0.04;


export const LIGHT_PROXY_ROUGHNESS_CUTOFF = 0.35;
export const LIGHT_PROXY_ROUGHNESS_SOFT_EDGE = 0.15;


export const LIGHT_PROXY_REFLECTION_TOLERANCE = 0.1;

const MIN_SOFT_EDGE = 0.0001;

function readNumber(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
	return Math.min(Math.max(readNumber(value, min), min), max);
}


export function smoothstep(edge0, edge1, value) {
	const span = readNumber(edge1, 0) - readNumber(edge0, 0);
	if (!(Math.abs(span) > 0)) return readNumber(value, 0) < readNumber(edge1, 0) ? 0 : 1;
	const t = clamp((readNumber(value, 0) - readNumber(edge0, 0)) / span, 0, 1);
	return t * t * (3 - 2 * t);
}

export function proxyLuminanceNits(luminousIntensityCandela, projectedArea) {
	const area = Math.max(readNumber(projectedArea, 0), 0);
	if (!(area > 0)) return 0;
	return Math.max(readNumber(luminousIntensityCandela, 0), 0) / area;
}

export function proxyCandelaFromNits(nits, projectedArea) {
	return Math.max(readNumber(nits, 0), 0) * Math.max(readNumber(projectedArea, 0), 0);
}


export function reflectionWeightForRoughness(surfaceRoughness, options) {
	const settings = options || {};
	const cutoff = readNumber(settings.cutoff, LIGHT_PROXY_ROUGHNESS_CUTOFF);
	const softEdge = Math.max(readNumber(settings.softEdge, LIGHT_PROXY_ROUGHNESS_SOFT_EDGE), MIN_SOFT_EDGE);
	return 1 - smoothstep(cutoff - softEdge, cutoff, readNumber(surfaceRoughness, 0));
}

export function fresnelSchlick(cosIncidence, reflectanceAtNormalIncidence) {
	const cosine = clamp(cosIncidence, 0, 1);
	const f0 = clamp(reflectanceAtNormalIncidence, 0, 1);
	return f0 + (1 - f0) * Math.pow(1 - cosine, 5);
}


export function reflectedSourceLuminance(params) {
	const settings = params || {};
	const sourceNits = Math.max(readNumber(settings.sourceNits, 0), 0);
	const weight = reflectionWeightForRoughness(settings.surfaceRoughness, settings);
	const fresnel = fresnelSchlick(
		readNumber(settings.cosIncidence, 1),
		readNumber(settings.reflectanceAtNormalIncidence, DIELECTRIC_SPECULAR_REFLECTANCE),
	);
	return sourceNits * weight * fresnel;
}


export function probeRadianceForSource(sourceNits) {
	return Math.max(readNumber(sourceNits, 0), 0);
}

export function reflectionEnergyRatio(reflectedNits, sourceNits) {
	const source = Math.max(readNumber(sourceNits, 0), 0);
	if (!(source > 0)) return 0;
	return Math.max(readNumber(reflectedNits, 0), 0) / source;
}

export function isReflectionWithinTolerance(reflectedNits, sourceNits, tolerance) {
	const limit = Math.max(readNumber(tolerance, LIGHT_PROXY_REFLECTION_TOLERANCE), 0);
	return Math.abs(reflectionEnergyRatio(reflectedNits, sourceNits) - 1) <= limit;
}

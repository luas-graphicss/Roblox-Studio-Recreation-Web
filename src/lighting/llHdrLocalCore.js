export const METER_CALIBRATION_CONSTANT = 12.5;


export const SATURATION_SPEED_CONSTANT = 1.2;


export const MIDDLE_GRAY_LUMINANCE = 0.18;


export const HALF_FLOAT_CEILING = 65504;


export const DEFAULT_BUFFER_HEADROOM = 0.5;

export const DEFAULT_MINIMUM_EV100 = -4;
export const DEFAULT_MAXIMUM_EV100 = 20;


export const DEFAULT_SCENE_ALBEDO = 0.18;


export const DEFAULT_ADAPTATION_RATE_PER_SECOND = 2.5;


export const INVERSE_SQUARE_NEAR_FIELD_OFFSET = 1;


export const MINIMUM_METERED_LUMINANCE = 1e-6;

function finiteOr(value, fallback) {
	return Number.isFinite(value) ? value : fallback;
}

function positiveOr(value, fallback) {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp01(value) {
	return Math.min(Math.max(value, 0), 1);
}


export function illuminanceFromLocalLight(light) {
	const source = light || {};
	return illuminanceFromSample(source.intensityCandela, source.distance, source.incidenceCosine, source.attenuation);
}


export function illuminanceFromSample(intensityCandela, distance, incidenceCosine, attenuation) {
	const candela = Math.max(finiteOr(intensityCandela, 0), 0);
	if (candela === 0) return 0;
	const meterDistance = Math.max(finiteOr(distance, 0), 0);
	const cosine = clamp01(finiteOr(incidenceCosine, 1));
	const transmittance = clamp01(finiteOr(attenuation, 1));
	const squareDistance = meterDistance * meterDistance + INVERSE_SQUARE_NEAR_FIELD_OFFSET;
	return (candela * cosine * transmittance) / squareDistance;
}


export function meteredIlluminance(lights) {
	if (!Array.isArray(lights)) return 0;
	let total = 0;
	for (let index = 0; index < lights.length; index++) total += illuminanceFromLocalLight(lights[index]);
	return total;
}


export function peakIlluminance(lights, probeDistance) {
	if (!Array.isArray(lights)) return 0;
	const distance = Math.max(finiteOr(probeDistance, 0), 0);
	let peak = 0;
	for (let index = 0; index < lights.length; index++) {
		const light = lights[index] || {};


		peak = Math.max(peak, illuminanceFromSample(light.intensityCandela, distance, 1, 1));
	}
	return peak;
}


export function luminanceFromIlluminance(illuminanceLux, sceneAlbedo) {
	const albedo = positiveOr(sceneAlbedo, DEFAULT_SCENE_ALBEDO);
	return (Math.max(finiteOr(illuminanceLux, 0), 0) * albedo) / Math.PI;
}

export function ev100FromLuminance(luminance) {
	const safeLuminance = Math.max(finiteOr(luminance, 0), MINIMUM_METERED_LUMINANCE);
	return Math.log2((safeLuminance * 100) / METER_CALIBRATION_CONSTANT);
}

export function luminanceFromEv100(ev100) {
	return (Math.pow(2, finiteOr(ev100, 0)) * METER_CALIBRATION_CONSTANT) / 100;
}


export function exposureFromEv100(ev100) {
	return 1 / (SATURATION_SPEED_CONSTANT * Math.pow(2, finiteOr(ev100, 0)));
}

export function clampEv100(ev100, minimumEv100, maximumEv100) {
	const requested = finiteOr(ev100, 0);
	const minimum = finiteOr(minimumEv100, DEFAULT_MINIMUM_EV100);
	const maximum = finiteOr(maximumEv100, DEFAULT_MAXIMUM_EV100);
	if (maximum < minimum) return requested;
	return Math.min(Math.max(requested, minimum), maximum);
}


export function displayLuminanceOf(sceneLuminance, exposure) {
	return Math.max(finiteOr(sceneLuminance, 0), 0) * Math.max(finiteOr(exposure, 0), 0);
}


export function resolveAutoExposure(options) {
	const settings = options || {};
	const illuminanceLux = meteredIlluminance(settings.lights);
	const sceneLuminance = luminanceFromIlluminance(illuminanceLux, settings.sceneAlbedo);
	const measuredEv100 = ev100FromLuminance(sceneLuminance);
	const exposureCompensationEv = finiteOr(settings.exposureCompensationEv, 0);

	const ev100 = clampEv100(measuredEv100 - exposureCompensationEv, settings.minimumEv100, settings.maximumEv100);
	const exposure = exposureFromEv100(ev100);
	const displayLuminance = displayLuminanceOf(sceneLuminance, exposure);
	return Object.freeze({
		illuminanceLux,
		sceneLuminance,
		measuredEv100,
		ev100,
		exposure,
		displayLuminance,
		clipped: displayLuminance >= 1,
		clampedByRange: ev100 !== measuredEv100 - exposureCompensationEv,
		meteredLightCount: Array.isArray(settings.lights) ? settings.lights.length : 0,
	});
}


export function adaptExposure(previousExposure, targetExposure, adaptationRatePerSecond, deltaTimeSeconds) {
	const target = Math.max(finiteOr(targetExposure, 0), 0);
	if (!Number.isFinite(previousExposure) || previousExposure <= 0) return target;
	const deltaTime = Math.max(finiteOr(deltaTimeSeconds, 0), 0);
	if (deltaTime <= 0) return previousExposure;
	const rate = positiveOr(adaptationRatePerSecond, DEFAULT_ADAPTATION_RATE_PER_SECOND);
	const blend = 1 - Math.exp(-rate * deltaTime);
	return previousExposure + (target - previousExposure) * blend;
}


export function resolvePreExposure(options) {
	const settings = options || {};
	const bufferCeiling = positiveOr(settings.bufferCeiling, HALF_FLOAT_CEILING);
	const headroom = Math.min(positiveOr(settings.headroom, DEFAULT_BUFFER_HEADROOM), 1);
	const budget = bufferCeiling * headroom;
	const peakRadiance = Math.max(finiteOr(settings.peakRadiance, 0), 0);
	const preExposure = peakRadiance > budget ? budget / peakRadiance : 1;
	const peakAfterPreExposure = peakRadiance * preExposure;
	return Object.freeze({
		preExposure,
		toneMappingCompensation: 1 / preExposure,
		peakRadiance,
		peakAfterPreExposure,
		budget,
		bufferCeiling,
		headroom,
		fitsInBuffer: peakAfterPreExposure <= budget,
		engaged: preExposure < 1,
	});
}


export function sceneRadianceForDisplayLuminance(targetDisplayLuminance, exposure) {
	const safeExposure = positiveOr(exposure, 1);
	return Math.max(finiteOr(targetDisplayLuminance, 0), 0) / safeExposure;
}

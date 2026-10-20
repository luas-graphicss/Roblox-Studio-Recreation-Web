export const REC709_LUMINANCE_WEIGHTS = Object.freeze({ red: 0.2126, green: 0.7152, blue: 0.0722 });


export const CLAMPABLE_FEATURES = Object.freeze([
	"ll-f4-source-shape",
	"ll-f6-area-specular",
	"ll-f7-rect-extras",
	"ll-f17-volumetric-local",
	"ll-f18-gi-local",
]);


export const DEFAULT_KNEE_DISPLAY_LUMINANCE = 4;
export const DEFAULT_CEILING_DISPLAY_LUMINANCE = 16;

function finiteOr(value, fallback) {
	return Number.isFinite(value) ? value : fallback;
}

function positiveOr(value, fallback) {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}


export function relativeLuminance(radiance) {
	const color = radiance || {};
	return (
		Math.max(finiteOr(color.red, 0), 0) * REC709_LUMINANCE_WEIGHTS.red +
		Math.max(finiteOr(color.green, 0), 0) * REC709_LUMINANCE_WEIGHTS.green +
		Math.max(finiteOr(color.blue, 0), 0) * REC709_LUMINANCE_WEIGHTS.blue
	);
}

export function isClampableFeature(featureId, whitelist) {
	const allowed = Array.isArray(whitelist) ? whitelist : CLAMPABLE_FEATURES;
	if (typeof featureId !== "string" || featureId === "") return false;
	return allowed.indexOf(featureId) >= 0;
}


export function clampableFeatures(requestedFeatureIds, whitelist) {
	const requested = Array.isArray(requestedFeatureIds) ? requestedFeatureIds : [];
	return requested.filter((featureId) => isClampableFeature(featureId, whitelist));
}





export function softClampLuminance(luminance, knee, ceiling) {
	const value = finiteOr(luminance, 0);
	const kneeLuminance = Math.max(finiteOr(knee, 0), 0);
	if (!(value > kneeLuminance)) return luminance;
	const range = Math.max(finiteOr(ceiling, 0), 0) - kneeLuminance;
	if (!(range > 0)) return kneeLuminance;
	const excess = value - kneeLuminance;
	return kneeLuminance + (range * excess) / (excess + range);
}


export function softClampRadiance(radiance, options) {
	const settings = options || {};
	const color = radiance || {};
	const red = Math.max(finiteOr(color.red, 0), 0);
	const green = Math.max(finiteOr(color.green, 0), 0);
	const blue = Math.max(finiteOr(color.blue, 0), 0);
	const untouched = { radiance: { red, green, blue }, clamped: false, scale: 1, luminance: 0, clampedLuminance: 0 };
	if (settings.featureId !== undefined && !isClampableFeature(settings.featureId, settings.whitelist)) {
		untouched.luminance = relativeLuminance({ red, green, blue });
		untouched.clampedLuminance = untouched.luminance;
		untouched.reason = "feature-not-whitelisted";
		return untouched;
	}
	const luminance = relativeLuminance({ red, green, blue });
	const knee = Math.max(finiteOr(settings.knee, DEFAULT_KNEE_DISPLAY_LUMINANCE), 0);
	const ceiling = Math.max(finiteOr(settings.ceiling, DEFAULT_CEILING_DISPLAY_LUMINANCE), knee);
	if (!(luminance > knee)) {
		untouched.luminance = luminance;
		untouched.clampedLuminance = luminance;
		untouched.reason = "below-knee";
		return untouched;
	}
	const clampedLuminance = softClampLuminance(luminance, knee, ceiling);
	const scale = clampedLuminance / luminance;
	return {
		radiance: { red: red * scale, green: green * scale, blue: blue * scale },
		clamped: true,
		scale,
		luminance,
		clampedLuminance,
		reason: "soft-clamped",
	};
}


export function resolveClampWindow(options) {
	const settings = options || {};
	const exposure = positiveOr(settings.exposure, 1);
	const kneeDisplayLuminance = Math.max(finiteOr(settings.kneeDisplayLuminance, DEFAULT_KNEE_DISPLAY_LUMINANCE), 0);
	const ceilingDisplayLuminance = Math.max(
		finiteOr(settings.ceilingDisplayLuminance, DEFAULT_CEILING_DISPLAY_LUMINANCE),
		kneeDisplayLuminance,
	);
	return Object.freeze({
		exposure,
		kneeDisplayLuminance,
		ceilingDisplayLuminance,
		knee: kneeDisplayLuminance / exposure,
		ceiling: ceilingDisplayLuminance / exposure,
	});
}

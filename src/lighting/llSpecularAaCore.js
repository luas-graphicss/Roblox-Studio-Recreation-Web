export const DEFAULT_SPECULAR_AA_VARIANCE = 0.15;
export const DEFAULT_SPECULAR_AA_THRESHOLD = 0.25;
export const MAXIMUM_PERCEPTUAL_ROUGHNESS = 1;


export const LOCAL_HIGHLIGHT_VARIANCE_CEILING = 4;

function finiteOr(value, fallback) {
	return Number.isFinite(value) ? value : fallback;
}

function saturate(value) {
	return Math.min(Math.max(value, 0), 1);
}


export function filteredPerceptualRoughness(perceptualRoughness, normalDerivativeSquaredSum, options) {
	const derivativeSquaredSum = Math.max(finiteOr(normalDerivativeSquaredSum, 0), 0);


	if (derivativeSquaredSum <= 0) return perceptualRoughness;
	const settings = options || {};
	const roughness = saturate(finiteOr(perceptualRoughness, 0));
	const variance = Math.max(finiteOr(settings.variance, DEFAULT_SPECULAR_AA_VARIANCE), 0);
	const threshold = Math.max(finiteOr(settings.threshold, DEFAULT_SPECULAR_AA_THRESHOLD), 0);
	const alpha = roughness * roughness;
	const kernelRoughness = Math.min(2 * variance * derivativeSquaredSum, threshold);
	const filteredSquareAlpha = saturate(alpha * alpha + kernelRoughness);
	const filtered = Math.sqrt(Math.sqrt(filteredSquareAlpha));
	return Math.min(Math.max(filtered, roughness), MAXIMUM_PERCEPTUAL_ROUGHNESS);
}


export function localHighlightVarianceScale(options) {
	const settings = options || {};
	const radianceRatio = Math.max(finiteOr(settings.radianceRatio, 1), 1);
	const roughness = saturate(finiteOr(settings.perceptualRoughness, 0));
	const smoothness = 1 - roughness;
	const scale = 1 + smoothness * smoothness * Math.log2(radianceRatio);
	return Math.min(Math.max(scale, 1), LOCAL_HIGHLIGHT_VARIANCE_CEILING);
}


export function specularAaVarianceForLocalLight(options) {
	const settings = options || {};
	const baseVariance = Math.max(finiteOr(settings.baseVariance, DEFAULT_SPECULAR_AA_VARIANCE), 0);
	return baseVariance * localHighlightVarianceScale(settings);
}

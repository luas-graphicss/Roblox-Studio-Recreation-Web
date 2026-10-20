export const DEFAULT_COEFFICIENT_OF_VARIATION_TARGET = 0.02;


export const DEFAULT_FRAME_STEP_TARGET = 0.03;

export const MINIMUM_STABILITY_SAMPLES = 2;

function finiteSamples(samples) {
	if (!Array.isArray(samples)) return [];
	return samples.map((sample) => Number(sample)).filter((sample) => Number.isFinite(sample));
}


export function luminanceStatistics(samples) {
	const values = finiteSamples(samples);
	const count = values.length;
	if (count === 0) {
		return Object.freeze({
			count: 0,
			mean: 0,
			variance: 0,
			standardDeviation: 0,
			coefficientOfVariation: 0,
			minimum: 0,
			maximum: 0,
			peakToPeak: 0,
		});
	}
	let total = 0;
	let minimum = values[0];
	let maximum = values[0];
	for (let index = 0; index < count; index++) {
		const value = values[index];
		total += value;
		if (value < minimum) minimum = value;
		if (value > maximum) maximum = value;
	}
	const mean = total / count;
	let squaredError = 0;
	for (let index = 0; index < count; index++) {
		const error = values[index] - mean;
		squaredError += error * error;
	}
	const variance = squaredError / count;
	const standardDeviation = Math.sqrt(variance);
	return Object.freeze({
		count,
		mean,
		variance,
		standardDeviation,
		coefficientOfVariation: mean > 0 ? standardDeviation / mean : 0,
		minimum,
		maximum,
		peakToPeak: maximum - minimum,
	});
}


export function maximumFrameToFrameStep(samples) {
	const values = finiteSamples(samples);
	if (values.length < MINIMUM_STABILITY_SAMPLES) return 0;
	const statistics = luminanceStatistics(values);
	if (!(statistics.mean > 0)) return 0;
	let largestStep = 0;
	for (let index = 1; index < values.length; index++) {
		const step = Math.abs(values[index] - values[index - 1]) / statistics.mean;
		if (step > largestStep) largestStep = step;
	}
	return largestStep;
}


export function evaluateTemporalStability(samples, options) {
	const settings = options || {};
	const statistics = luminanceStatistics(samples);
	const coefficientOfVariationTarget = Number.isFinite(settings.coefficientOfVariationTarget)
		? settings.coefficientOfVariationTarget
		: DEFAULT_COEFFICIENT_OF_VARIATION_TARGET;
	const frameStepTarget = Number.isFinite(settings.frameStepTarget) ? settings.frameStepTarget : DEFAULT_FRAME_STEP_TARGET;
	const maximumStep = maximumFrameToFrameStep(samples);
	const hasEnoughSamples = statistics.count >= MINIMUM_STABILITY_SAMPLES;
	const withinVariation = statistics.coefficientOfVariation <= coefficientOfVariationTarget;
	const withinStep = maximumStep <= frameStepTarget;
	const reasons = [];
	if (!hasEnoughSamples) reasons.push("burst curto: " + statistics.count + " amostra(s)");
	if (!withinVariation) reasons.push("variacao " + statistics.coefficientOfVariation.toFixed(5) + " acima de " + coefficientOfVariationTarget);
	if (!withinStep) reasons.push("salto " + maximumStep.toFixed(5) + " acima de " + frameStepTarget);
	return Object.freeze({
		stable: hasEnoughSamples && withinVariation && withinStep,
		statistics,
		coefficientOfVariation: statistics.coefficientOfVariation,
		coefficientOfVariationTarget,
		maximumFrameStep: maximumStep,
		frameStepTarget,
		reason: reasons.join(" | "),
	});
}

import { relativeLuminance } from "../llFireflyClampCore.js";
import {
	MSM_RESERVOIR_EMPTY_PICK,
	MSM_RESERVOIR_MAX_STREAMS,
	pickedIndexForStream,
	reservoirPickProbabilities,
	resolveStreamCount,
} from "./msmReservoirCore.js";


export const MSM_ESTIMATOR_PHASE_ID = "MSM-F21";


export const MSM_ESTIMATOR_FORMULA = "totalWeight * chromaticity * visibility";


export const MSM_FULL_VISIBILITY = 1;


export const MSM_NO_VISIBILITY = 0;


export const MSM_ESTIMATOR_TEXTURE_UNIT_COST = 0;


export const MSM_ESTIMATOR_ENERGY_TOLERANCE = 0.05;


export const MSM_ESTIMATOR_CONFIGURATION_COUNT = 6;


export const MSM_ESTIMATOR_UNBIASED_TOLERANCE = 1e-12;


export const MSM_ESTIMATOR_MIRROR_ARGUMENT_ORDER = Object.freeze({
	clampVisibility: Object.freeze({
		argumentNames: Object.freeze(["visibility"]),
		glslCounterpart: "msmClampVisibility",
		glslReturnType: "float",
		sameArgumentOrder: true,
		note: "A policy that returns 1.2 must not brighten the scene, and a NaN must not poison it.",
	}),
	msmEstimatorChannel: Object.freeze({
		argumentNames: Object.freeze(["totalWeight", "chromaticityChannel", "visibility"]),
		glslCounterpart: "msmEstimatorChannel",
		glslReturnType: "float",
		sameArgumentOrder: true,
		note: "The whole estimator, as one scalar line, so both sides multiply in the same order.",
	}),
	msmSampleIrradiance: Object.freeze({
		argumentNames: Object.freeze(["totalWeight", "chromaticity", "visibility"]),
		glslCounterpart: "msmSampleIrradiance",
		glslReturnType: "vec3",
		sameArgumentOrder: true,
		note: "The three channels share ONE clamped visibility: clamping per channel would tint the shadow.",
	}),
	shadeReservoirStream: Object.freeze({
		argumentNames: Object.freeze(["totalWeight", "pickedIndex", "chromaticityForCandidate", "visibilityForCandidate"]),
		glslCounterpart: "msmShadeReservoirStream",
		glslReturnType: "vec3",
		glslArgumentNames: Object.freeze(["totalWeight", "pickedIndex"]),
		argumentsThatAreHostFunctionsInGlsl: Object.freeze(["chromaticityForCandidate", "visibilityForCandidate"]),
		sameArgumentOrder: true,
		note: "On the GPU the two readers are host functions; a pure core cannot fetch, so they are injected.",
	}),
});


export const MSM_ESTIMATOR_HOST_FUNCTIONS = Object.freeze([
	Object.freeze({
		name: "msmCandidateChromaticity",
		signature: "vec3 msmCandidateChromaticity(const in int candidateSlot)",
		owner: "pass host (MSM-F22/F24), reading the msmLightData layout owned by MSM-F6",
		carries: "unit colour of the candidate: texel 1 of MSM_LIGHT_RECORD_TEXEL_ORDER, luminance excluded",
	}),
	Object.freeze({
		name: "msmSampleVisibility",
		signature: "float msmSampleVisibility(const in int candidateSlot)",
		owner: "MSM-F20",
		carries: "the ONE visibility source the policy chose for this sample, on [0, 1]",
	}),
]);


export const MSM_ESTIMATOR_DECLARED_RESIDUALS = Object.freeze([
	Object.freeze({
		id: "colour-noise-not-energy-noise",
		says: "one draw returns the chromaticity of ONE light, so a cell mixing a red and a blue lamp flickers in HUE before it converges",
		bounded: "the total energy of the sample is W_lum * V and carries no draw noise at all; MSM-F26 filters the hue over time, which is what a temporal filter is good at",
	}),
	Object.freeze({
		id: "visibility-of-one-light-priced-for-all",
		says: "V of the picked light multiplies the energy of the WHOLE cell list, so a shadow cast on one lamp darkens the contribution of the others in that pixel and frame",
		bounded: "unbiased in expectation - that is what the estimator proves; the per frame error is the variance the temporal filter of MSM-F26 exists to spend",
	}),
	Object.freeze({
		id: "candidate-ceiling-inherited",
		says: "the estimator can only reach the candidates the draw could see, so a saturated cell reproduces the sum of the OFFERED list, not of the world",
		bounded: "residue 8 of the plan: the ceiling is owned by MSM-F13/F14 and the preterite lights are the job of MSM-F15; this phase adds no loss of its own",
	}),
	Object.freeze({
		id: "empty-pick-still-pays-its-tap",
		says: "a stream that picked nobody still asks the policy for a visibility, and the answer is multiplied by zero",
		bounded: "deliberate: skipping the query would make the cost of the pass depend on how many lights the cell holds, which is exactly what gate G1 forbids",
	}),
	Object.freeze({
		id: "nan-visibility-diverges-from-the-shader",
		says: "a NaN visibility is read as shadow in JS, while clamp(NaN) is undefined behaviour in GLSL ES and may come back as anything",
		bounded: "the mirror is measured over finite values only, and no visibility source of the plan can produce a NaN: MSM-F16 answers -1 with zero taps for a light with no atlas page, and MSM-F19 returns exactly 1 with no proxy box",
	}),
]);

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value);
}

function blackIrradiance() {
	return { red: 0, green: 0, blue: 0 };
}


export function clampVisibility(visibility) {
	if (typeof visibility !== "number" || Number.isNaN(visibility)) return MSM_NO_VISIBILITY;
	if (visibility > MSM_FULL_VISIBILITY) return MSM_FULL_VISIBILITY;
	if (MSM_NO_VISIBILITY > visibility) return MSM_NO_VISIBILITY;
	return visibility;
}


export function msmEstimatorChannel(totalWeight, chromaticityChannel, visibility) {
	return totalWeight * chromaticityChannel * visibility;
}


export function msmSampleIrradiance(totalWeight, chromaticity, visibility) {
	const colour = chromaticity && typeof chromaticity === "object" ? chromaticity : null;
	if (!colour || !isFiniteNumber(totalWeight)) return blackIrradiance();
	const clampedVisibility = clampVisibility(visibility);
	return {
		red: msmEstimatorChannel(totalWeight, colour.red, clampedVisibility),
		green: msmEstimatorChannel(totalWeight, colour.green, clampedVisibility),
		blue: msmEstimatorChannel(totalWeight, colour.blue, clampedVisibility),
	};
}


export function msmChromaticityFromRecord(lightRecord) {
	if (!lightRecord || typeof lightRecord !== "object") return blackIrradiance();
	return {
		red: lightRecord.chromaticityRed,
		green: lightRecord.chromaticityGreen,
		blue: lightRecord.chromaticityBlue,
	};
}


function streamIsShaded(pickedIndex) {
	return pickedIndex > MSM_RESERVOIR_EMPTY_PICK ? 1 : 0;
}














export function shadeReservoirStream(request) {
	const settings = request && typeof request === "object" ? request : {};
	const pickedIndex = isFiniteNumber(settings.pickedIndex) ? settings.pickedIndex : MSM_RESERVOIR_EMPTY_PICK;
	const candidateSlot = Math.max(pickedIndex, 0);
	const shaded = streamIsShaded(pickedIndex);

	const chromaticity = settings.chromaticityForCandidate(candidateSlot);
	const visibility = clampVisibility(settings.visibilityForCandidate(candidateSlot));
	const irradiance = msmSampleIrradiance(settings.totalWeight, chromaticity, visibility);

	return {
		irradiance: {
			red: irradiance.red * shaded,
			green: irradiance.green * shaded,
			blue: irradiance.blue * shaded,
		},
		shaded,
		candidateSlot,
		visibility,
	};
}

















export function shadeReservoir(request) {
	const settings = request && typeof request === "object" ? request : {};
	const reservoir = settings.reservoir && typeof settings.reservoir === "object" ? settings.reservoir : null;
	const streamCount = resolveStreamCount(
		isFiniteNumber(settings.streamCount) ? settings.streamCount : reservoir && reservoir.streamCount,
	);

	if (!reservoir) {
		return {
			irradiance: blackIrradiance(),
			energy: 0,
			shadedStreamCount: 0,
			streamCount,
			visibilityQueryCount: 0,
			chromaticityQueryCount: 0,
		};
	}

	const accumulated = blackIrradiance();
	let shadedStreamCount = 0;
	let visibilityQueryCount = 0;
	let chromaticityQueryCount = 0;

	for (let streamIndex = 0; streamCount > streamIndex; streamIndex += 1) {
		const stream = shadeReservoirStream({
			totalWeight: reservoir.totalWeight,
			pickedIndex: pickedIndexForStream(reservoir, streamIndex),
			chromaticityForCandidate: function readChromaticity(candidateSlot) {
				chromaticityQueryCount += 1;
				return settings.chromaticityForCandidate(candidateSlot);
			},
			visibilityForCandidate: function readVisibility(candidateSlot) {
				visibilityQueryCount += 1;
				return settings.visibilityForCandidate(candidateSlot);
			},
		});
		accumulated.red += stream.irradiance.red;
		accumulated.green += stream.irradiance.green;
		accumulated.blue += stream.irradiance.blue;
		shadedStreamCount += stream.shaded;
	}

	const irradiance =
		shadedStreamCount > 0
			? {
					red: accumulated.red / shadedStreamCount,
					green: accumulated.green / shadedStreamCount,
					blue: accumulated.blue / shadedStreamCount,
				}
			: blackIrradiance();

	return {
		irradiance,
		energy: irradianceEnergy(irradiance),
		shadedStreamCount,
		streamCount,
		visibilityQueryCount,
		chromaticityQueryCount,
	};
}


export function irradianceEnergy(irradiance) {
	if (!irradiance || typeof irradiance !== "object") return 0;
	return relativeLuminance(irradiance);
}


export function analyticIrradianceSum(request) {
	const settings = request && typeof request === "object" ? request : {};
	const candidateWeights = Array.isArray(settings.candidateWeights) ? settings.candidateWeights : [];
	const total = blackIrradiance();

	for (let candidateSlot = 0; candidateWeights.length > candidateSlot; candidateSlot += 1) {
		const candidateWeight = candidateWeights[candidateSlot];
		if (!(candidateWeight > 0)) continue;
		const chromaticity = settings.chromaticityForCandidate(candidateSlot);
		const visibility = clampVisibility(settings.visibilityForCandidate(candidateSlot));
		total.red += msmEstimatorChannel(candidateWeight, chromaticity.red, visibility);
		total.green += msmEstimatorChannel(candidateWeight, chromaticity.green, visibility);
		total.blue += msmEstimatorChannel(candidateWeight, chromaticity.blue, visibility);
	}
	return total;
}


export function expectedIrradianceOverAllPicks(request) {
	const settings = request && typeof request === "object" ? request : {};
	const candidateWeights = Array.isArray(settings.candidateWeights) ? settings.candidateWeights : [];
	const probabilities = reservoirPickProbabilities(candidateWeights);

	let totalWeight = 0;
	for (let candidateSlot = 0; candidateWeights.length > candidateSlot; candidateSlot += 1) {
		const candidateWeight = candidateWeights[candidateSlot];
		if (!(candidateWeight > 0)) continue;
		totalWeight += candidateWeight;
	}

	const expected = blackIrradiance();
	for (let candidateSlot = 0; probabilities.length > candidateSlot; candidateSlot += 1) {
		const pickProbability = probabilities[candidateSlot];
		if (!(pickProbability > 0)) continue;
		const chromaticity = settings.chromaticityForCandidate(candidateSlot);
		const visibility = clampVisibility(settings.visibilityForCandidate(candidateSlot));
		const sample = msmSampleIrradiance(totalWeight, chromaticity, visibility);
		expected.red += pickProbability * sample.red;
		expected.green += pickProbability * sample.green;
		expected.blue += pickProbability * sample.blue;
	}
	return expected;
}


export function relativeEnergyDeviation(measuredEnergy, referenceEnergy) {
	if (!isFiniteNumber(measuredEnergy) || !isFiniteNumber(referenceEnergy)) return Number.POSITIVE_INFINITY;
	if (referenceEnergy === 0) return measuredEnergy === 0 ? 0 : Number.POSITIVE_INFINITY;
	return Math.abs(measuredEnergy - referenceEnergy) / Math.abs(referenceEnergy);
}


export function evaluateEstimatorEnergy(measuredIrradiance, referenceIrradiance) {
	const channelDeviations = {
		red: relativeEnergyDeviation(measuredIrradiance.red, referenceIrradiance.red),
		green: relativeEnergyDeviation(measuredIrradiance.green, referenceIrradiance.green),
		blue: relativeEnergyDeviation(measuredIrradiance.blue, referenceIrradiance.blue),
	};
	const energyDeviation = relativeEnergyDeviation(
		irradianceEnergy(measuredIrradiance),
		irradianceEnergy(referenceIrradiance),
	);
	const worstDeviation = Math.max(
		energyDeviation,
		channelDeviations.red,
		channelDeviations.green,
		channelDeviations.blue,
	);
	return {
		energyDeviation,
		channelDeviations,
		worstDeviation,
		tolerance: MSM_ESTIMATOR_ENERGY_TOLERANCE,
		passed: MSM_ESTIMATOR_ENERGY_TOLERANCE >= worstDeviation,
	};
}


export function describeEstimatorContract() {
	return {
		phaseId: MSM_ESTIMATOR_PHASE_ID,
		formula: MSM_ESTIMATOR_FORMULA,
		shades: "diffuse irradiance, albedo excluded",
		energyTolerance: MSM_ESTIMATOR_ENERGY_TOLERANCE,
		unbiasedTolerance: MSM_ESTIMATOR_UNBIASED_TOLERANCE,
		configurationCount: MSM_ESTIMATOR_CONFIGURATION_COUNT,
		textureUnitCost: MSM_ESTIMATOR_TEXTURE_UNIT_COST,
		maximumStreamCount: MSM_RESERVOIR_MAX_STREAMS,
		visibilityQueriesPerPixel: "exactly the stream count of the tier, independent of the light count",
		weightOwner: "MSM-F13: the weight is read, never recomputed",
		drawOwner: "MSM-F14: the pick is read, never redrawn",
		visibilityOwner: "MSM-F20: the source is chosen there, spent here",
		colourOwner: "MSM-F6: luminance and chromaticity are split once per light, on the CPU",
	};
}

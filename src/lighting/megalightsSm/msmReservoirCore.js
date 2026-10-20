import { MSM_ACTIVE_TIERS, MSM_TIER_POLICY } from "./msmTierPolicy.js";
import { MSM_GRID_MAX_LISTS_PER_CELL } from "./msmWorldGridLayout.js";

export const MSM_RESERVOIR_PHASE_ID = "MSM-F14";


export const MSM_RESERVOIR_STREAM_OFFSET = 0.7548776662466927;


export const MSM_RESERVOIR_MAX_STREAMS = MSM_ACTIVE_TIERS.reduce(
	(largest, tier) => Math.max(largest, MSM_TIER_POLICY[tier].samplesPerPixel),
	1,
);


export const MSM_RESERVOIR_MAX_CANDIDATES = MSM_GRID_MAX_LISTS_PER_CELL;


export const MSM_RESERVOIR_EMPTY_PICK = -1;


export const MSM_RESERVOIR_PROBABILITY_TOLERANCE = 0.005;
export const MSM_RESERVOIR_PROOF_DRAW_COUNT = 1000000;


export const MSM_RESERVOIR_NOISE_FLOOR_SIGMA = 3;


export const MSM_RESERVOIR_TEXTURE_UNIT_COST = 0;


export const MSM_RESERVOIR_STRUCT_FIELDS = Object.freeze([
	"totalWeight",
	"consideredCount",
	"pickedIndexStream0",
	"pickedWeightStream0",
	"pickedIndexStream1",
	"pickedWeightStream1",
]);


export const MSM_CANDIDATE_UNIFORM_CONTRACT = Object.freeze({
	functionName: "msmCandidateUniform",
	owner: "MSM-F11",
	arguments: Object.freeze(["candidateSlot"]),
	requirements: Object.freeze([
		"returns a uniform value on the interval [0, 1)",
		"independent across candidateSlot - the WRS proof needs it, a stride does not qualify",
		"ALU only: zero texture fetches inside the candidate loop (golden rule 10)",
		"deterministic for a given pixel and frame, so the draw is reproducible",
	]),
});


export const MSM_REFUSED_UNIFORM_SOURCES = Object.freeze([
	Object.freeze({
		id: "golden-stride",
		formula: "fract(seed + candidateSlot * golden)",
		usedBy: "saReservoirK (src/lighting/shadowAtlasCore.js), the Future path",
		refusedBecause:
			"one seed drives every candidate, so the draws are not independent and P(i) misses w_i/W by far more than MSM_RESERVOIR_PROBABILITY_TOLERANCE",
	}),
	Object.freeze({
		id: "noise-fetch-per-candidate",
		formula: "texture2D(tMsmBlueNoise, uv of candidateSlot)",
		usedBy: "nobody - written down so it stays that way",
		refusedBecause:
			"a fetch inside the loop makes the cost grow with the number of lights, which golden rule 10 forbids by construction",
	}),
]);


export const MSM_RESERVOIR_DECLARED_RESIDUALS = Object.freeze([
	Object.freeze({
		id: "float-versus-double-ties",
		says: "the JS mirror runs in doubles and the shader in floats, so a candidate sitting exactly on the acceptance boundary can fall to different sides",
		bounded: "only within one float epsilon of the tie; the order of operations is identical on both sides",
	}),
	Object.freeze({
		id: "candidate-ceiling",
		says: "a cell carrying more lights than MSM_RESERVOIR_MAX_CANDIDATES leaves the extra ones outside the draw",
		bounded: "residue 8 of the plan: saturation is declared in telemetry, and MSM-F15 is the phase that keeps a preterite light from vanishing forever",
	}),
	Object.freeze({
		id: "probability-follows-the-source",
		says: "P(i) = w_i / W holds only while the injected uniform is independent per candidate",
		bounded: "MSM_CANDIDATE_UNIFORM_CONTRACT states the requirement and the spec fails any source that breaks it",
	}),
	Object.freeze({
		id: "stream-pair-is-stratified-not-independent",
		says: "the two streams share one base uniform shifted by the plastic constant, so they are not statistically independent of each other",
		bounded: "measured: they agree about 5% LESS often than independent streams would, which lowers variance instead of raising it; each stream is exact on its own, and the gate refuses the opposite case (streams that track each other)",
	}),
]);


export const MSM_MIRROR_ARGUMENT_ORDER = Object.freeze({
	reservoirStreamUniform: Object.freeze({
		arguments: Object.freeze(["baseUniform", "streamIndex"]),
		glslCounterpart: "msmReservoirStreamUniform",
	}),
	reservoirAcceptsCandidate: Object.freeze({
		arguments: Object.freeze(["streamUniform", "candidateWeight", "runningWeightSum"]),
		glslCounterpart: "msmReservoirAccepts",
	}),
	selectReservoirSamples: Object.freeze({
		arguments: Object.freeze(["candidateWeights", "streamCount", "candidateUniform"]),
		glslCounterpart: "msmSelectReservoirSamples",
	}),
});

function fractionalPart(value) {
	return value - Math.floor(value);
}


export function reservoirStreamUniform(baseUniform, streamIndex) {
	return fractionalPart(baseUniform + streamIndex * MSM_RESERVOIR_STREAM_OFFSET);
}


export function reservoirAcceptsCandidate(streamUniform, candidateWeight, runningWeightSum) {
	return candidateWeight >= streamUniform * runningWeightSum;
}


export function resolveStreamCount(samplesPerPixel) {
	const requested = Math.floor(Number(samplesPerPixel));
	if (!Number.isFinite(requested)) return 1;
	return Math.max(1, Math.min(MSM_RESERVOIR_MAX_STREAMS, requested));
}


export function selectReservoirSamples(request) {
	const { candidateWeights, streamCount, candidateUniform } = request;
	const streams = resolveStreamCount(streamCount);
	const candidateCount = Math.min(candidateWeights.length, MSM_RESERVOIR_MAX_CANDIDATES);

	const reservoir = {
		totalWeight: 0,
		consideredCount: 0,
		streamCount: streams,
		candidateCount,
		pickedIndexStream0: MSM_RESERVOIR_EMPTY_PICK,
		pickedWeightStream0: 0,
		pickedIndexStream1: MSM_RESERVOIR_EMPTY_PICK,
		pickedWeightStream1: 0,
	};

	for (let candidateSlot = 0; candidateSlot < candidateCount; candidateSlot += 1) {
		const candidateWeight = candidateWeights[candidateSlot];
		if (!(candidateWeight > 0)) continue;

		reservoir.totalWeight += candidateWeight;
		reservoir.consideredCount += 1;

		const baseUniform = candidateUniform(candidateSlot);

		if (reservoirAcceptsCandidate(reservoirStreamUniform(baseUniform, 0), candidateWeight, reservoir.totalWeight)) {
			reservoir.pickedIndexStream0 = candidateSlot;
			reservoir.pickedWeightStream0 = candidateWeight;
		}

		if (streams > 1) {
			if (reservoirAcceptsCandidate(reservoirStreamUniform(baseUniform, 1), candidateWeight, reservoir.totalWeight)) {
				reservoir.pickedIndexStream1 = candidateSlot;
				reservoir.pickedWeightStream1 = candidateWeight;
			}
		}
	}

	return reservoir;
}


export function pickedIndexForStream(reservoir, streamIndex) {
	return streamIndex === 0 ? reservoir.pickedIndexStream0 : reservoir.pickedIndexStream1;
}


export function pickedWeightForStream(reservoir, streamIndex) {
	return streamIndex === 0 ? reservoir.pickedWeightStream0 : reservoir.pickedWeightStream1;
}







export function reservoirPickProbabilities(candidateWeights) {
	const weights = Array.isArray(candidateWeights) ? candidateWeights : [];
	const candidateCount = Math.min(weights.length, MSM_RESERVOIR_MAX_CANDIDATES);
	const probabilities = new Array(candidateCount).fill(0);

	let totalWeight = 0;
	for (let candidateSlot = 0; candidateSlot < candidateCount; candidateSlot += 1) {
		const candidateWeight = weights[candidateSlot];
		if (!(candidateWeight > 0)) continue;
		totalWeight += candidateWeight;
	}
	if (!(totalWeight > 0)) return probabilities;

	for (let candidateSlot = 0; candidateSlot < candidateCount; candidateSlot += 1) {
		const candidateWeight = weights[candidateSlot];
		if (!(candidateWeight > 0)) continue;
		probabilities[candidateSlot] = candidateWeight / totalWeight;
	}
	return probabilities;
}


















export function relativeStandardError(probability, drawCount) {
	if (!(probability > 0) || !(drawCount > 0)) return 0;
	return Math.sqrt((1 - probability) / (probability * drawCount));
}

export function evaluateReservoirDrawTally(candidateWeights, drawTally, drawCount) {
	const expectedProbabilities = reservoirPickProbabilities(candidateWeights);
	const draws = Number.isFinite(drawCount) && drawCount > 0 ? drawCount : 0;
	const tally = Array.isArray(drawTally) ? drawTally : [];

	const rows = [];
	const noiseLimitedSlots = [];
	const failedSlots = [];
	let worstCandidateSlot = MSM_RESERVOIR_EMPTY_PICK;
	let worstRelativeDeviation = 0;
	let refusedCandidateDraws = 0;

	for (let candidateSlot = 0; candidateSlot < expectedProbabilities.length; candidateSlot += 1) {
		const expectedProbability = expectedProbabilities[candidateSlot];
		const observedDraws = Number(tally[candidateSlot]) || 0;
		const observedProbability = draws > 0 ? observedDraws / draws : 0;

		if (!(expectedProbability > 0)) {
			refusedCandidateDraws += observedDraws;
			rows.push({ candidateSlot, expectedProbability: 0, observedProbability, relativeDeviation: 0 });
			continue;
		}

		const relativeDeviation = Math.abs(observedProbability - expectedProbability) / expectedProbability;
		const standardError = relativeStandardError(expectedProbability, draws);
		const noiseFloor = MSM_RESERVOIR_NOISE_FLOOR_SIGMA * standardError;
		const allowedDeviation = Math.max(MSM_RESERVOIR_PROBABILITY_TOLERANCE, noiseFloor);
		const slotPassed = relativeDeviation <= allowedDeviation;

		rows.push({
			candidateSlot,
			expectedProbability,
			observedProbability,
			relativeDeviation,
			relativeStandardError: standardError,
			allowedDeviation,
			noiseLimited: noiseFloor > MSM_RESERVOIR_PROBABILITY_TOLERANCE,
			passed: slotPassed,
		});
		if (noiseFloor > MSM_RESERVOIR_PROBABILITY_TOLERANCE) noiseLimitedSlots.push(candidateSlot);
		if (!slotPassed) failedSlots.push(candidateSlot);

		if (relativeDeviation > worstRelativeDeviation) {
			worstRelativeDeviation = relativeDeviation;
			worstCandidateSlot = candidateSlot;
		}
	}

	return {
		drawCount: draws,
		tolerance: MSM_RESERVOIR_PROBABILITY_TOLERANCE,
		noiseFloorSigma: MSM_RESERVOIR_NOISE_FLOOR_SIGMA,
		rows,
		worstCandidateSlot,
		worstRelativeDeviation,
		refusedCandidateDraws,
		noiseLimitedSlots,
		failedSlots,
		passed: draws > 0 && refusedCandidateDraws === 0 && failedSlots.length === 0,
	};
}


export function expectedStreamAgreementProbability(candidateWeights) {
	return reservoirPickProbabilities(candidateWeights).reduce(
		(total, probability) => total + probability * probability,
		0,
	);
}


export function evaluateStreamDecorrelation(candidateWeights, agreementCount, drawCount) {
	const independentAgreementProbability = expectedStreamAgreementProbability(candidateWeights);
	const draws = Number.isFinite(drawCount) && drawCount > 0 ? drawCount : 0;
	const observedAgreementProbability = draws > 0 ? (Number(agreementCount) || 0) / draws : 0;
	const relativeExcess =
		independentAgreementProbability > 0
			? (observedAgreementProbability - independentAgreementProbability) / independentAgreementProbability
			: 0;

	return {
		drawCount: draws,
		tolerance: MSM_RESERVOIR_PROBABILITY_TOLERANCE,
		independentAgreementProbability,
		observedAgreementProbability,
		relativeExcess,
		stratified: relativeExcess < 0,
		passed: draws > 0 && independentAgreementProbability > 0 && relativeExcess <= MSM_RESERVOIR_PROBABILITY_TOLERANCE,
	};
}

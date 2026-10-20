import { MSM_ACTIVE_TIERS, MSM_TIER_POLICY } from "./msmTierPolicy.js";
import { MSM_GRID_MAX_LISTS_PER_CELL } from "./msmWorldGridLayout.js";

export const MSM_FAIRNESS_PHASE_ID = "MSM-F15";


export const MSM_FAIRNESS_SAMPLE_SHARE_CEILING = 0.25;


export const MSM_FAIRNESS_PERIOD_FRAMES = Math.round(1 / MSM_FAIRNESS_SAMPLE_SHARE_CEILING);


export const MSM_FAIRNESS_SAMPLE_SHARE = 1 / MSM_FAIRNESS_PERIOD_FRAMES;


export const MSM_FAIRNESS_FRESH_LIGHT_DEADLINE_FRAMES = MSM_FAIRNESS_PERIOD_FRAMES;


export const MSM_FAIRNESS_COVERAGE_BUDGET_FACTOR = 8;


export const MSM_FAIRNESS_MAX_CANDIDATES = MSM_GRID_MAX_LISTS_PER_CELL;


export const MSM_FAIRNESS_EMPTY_PICK = -1;


export const MSM_FAIRNESS_DUTY_BLOCK_SIZE = 2;


export const MSM_FAIRNESS_DUTY_ORDER = Object.freeze([0, 2, 3, 1]);


export const MSM_FAIRNESS_CELL_PHASE_STRIDE = 7;


export const MSM_FAIRNESS_STRONG_WEIGHT_SHARE = 1 / MSM_GRID_MAX_LISTS_PER_CELL;


export const MSM_FAIRNESS_TEXTURE_UNIT_COST = 0;
export const MSM_FAIRNESS_VRAM_BYTES = 0;


export const MSM_FAIRNESS_REQUESTS_WAKE = false;


export const MSM_FAIRNESS_LANES = Object.freeze({
	IMPORTANCE: "importance",
	FAIRNESS: "fairness",
});


export const MSM_FAIRNESS_PICK_REASONS = Object.freeze({
	IMPORTANCE_TURN: "importanceTurn",
	CURSOR_TURN: "cursorTurn",
	FRESH_STRONG_LIGHT: "freshStrongLight",
	CURSOR_SLOT_EMPTY: "cursorSlotEmpty",
	EMPTY_LIST: "emptyList",
	EMPTY_IMPORTANCE_PICK: "emptyImportancePick",
	FRAME_INDEX_NOT_FINITE: "frameIndexNotFinite",
	PIXEL_NOT_FINITE: "pixelNotFinite",
	WEIGHT_NOT_FINITE: "weightNotFinite",
	WEIGHT_READER_MISSING: "weightReaderMissing",
	WEIGHT_READER_THREW: "weightReaderThrew",
});


export const MSM_FAIRNESS_LADDER_LIST_SIZES = Object.freeze(
	MSM_ACTIVE_TIERS.map(function readListsPerCell(tier) {
		return MSM_TIER_POLICY[tier].worldGrid.listsPerCell;
	})
		.filter(function keepFirstOccurrence(listSize, index, listSizes) {
			return listSizes.indexOf(listSize) === index;
		})
		.sort(function ascending(left, right) {
			return left - right;
		}),
);


export const MSM_REFUSED_FAIRNESS_CURSORS = Object.freeze([
	Object.freeze({
		id: "per-frame-stride",
		formula: "(frameIndex + cellPhase) % listSize",
		refusedBecause:
			"a pixel only reads the cursor every MSM_FAIRNESS_PERIOD_FRAMES frames, so it only ever sees slots congruent modulo gcd(period, listSize) - on the ladder (6, 8, 12) that is half or a quarter of the list, forever",
	}),
	Object.freeze({
		id: "random-fairness-pick",
		formula: "floor(uniform * listSize)",
		refusedBecause:
			"it turns a promise back into a lottery: coverage becomes coupon collecting (listSize * ln(listSize) expected, unbounded worst case) and stops being provable",
	}),
	Object.freeze({
		id: "oldest-first-by-timestamp",
		formula: "argmin(lastShadedFrame[i]) over the candidates",
		refusedBecause:
			"it needs per light state inside the pixel loop, which costs a fetch per candidate and breaks golden rule 10 (cost per sample, never per light)",
	}),
]);


export const MSM_FAIRNESS_HOST_CONTRACT = Object.freeze({
	owner: MSM_FAIRNESS_PHASE_ID,
	requires: Object.freeze([
		Object.freeze({
			field: "totalWeight",
			owner: "MSM-F14",
			says: "W of the cell, already summed by the reservoir pass - never summed again here (golden rule 10)",
		}),
		Object.freeze({
			field: "importanceSlot",
			owner: "MSM-F14",
			says: "the slot the reservoir picked for this sample and this stream",
		}),
		Object.freeze({
			field: "readCandidateWeight",
			owner: "MSM-F13",
			says: "w_i of ONE slot, ALU only, called at most twice per sample",
		}),
		Object.freeze({
			field: "freshStrongSlot",
			owner: "MSM-F4 pulse plus the cell list builder",
			says: "resolved ONCE per cell per frame by resolveFreshStrongCandidate, never inside the pixel loop",
		}),
		Object.freeze({
			field: "deadTurnCount",
			owner: MSM_FAIRNESS_PHASE_ID,
			says: "how many turns of the cycle fell back to importance because the cursor landed on a dead slot; 0 while a promotion holds the lane",
		}),
	]),
});


export const MSM_FAIRNESS_MIRROR_ARGUMENT_ORDER = Object.freeze({
	fairnessDutyPhase: Object.freeze({
		arguments: Object.freeze(["pixelX", "pixelY", "frameIndex", "streamIndex"]),
		glslCounterpart: "msmFairnessDutyPhase",
	}),
	fairnessCursorSlot: Object.freeze({
		arguments: Object.freeze(["cellIndex", "listSize", "frameIndex"]),
		glslCounterpart: "msmFairnessCursorSlot",
	}),
	fairnessSlotPdf: Object.freeze({
		arguments: Object.freeze([
			"candidateWeight",
			"totalWeight",
			"listSize",
			"deadTurnCount",
			"fairnessTurnsOnSlot",
		]),
		glslCounterpart: "msmFairnessSlotPdf",
	}),
});


export const MSM_FAIRNESS_DECLARED_RESIDUALS = Object.freeze([
	Object.freeze({
		id: "pdf-must-follow-the-mixture",
		says: "an estimator that keeps dividing by w_i / W turns every fairness sample of a weak light into a firefly",
		bounded:
			"fairnessSlotPdf publishes the mixture and bounds the amplification by listSize / MSM_FAIRNESS_SAMPLE_SHARE; the spec measures the refused case",
	}),
	Object.freeze({
		id: "promotion-window-moves-the-pdf",
		says: "while a fresh strong light holds the lane, the other slots lose their fairness mass",
		bounded:
			"at most MSM_FAIRNESS_FRESH_LIGHT_DEADLINE_FRAMES frames, and the pdf is published for that regime too, so the sum over the list stays 1",
	}),
	Object.freeze({
		id: "dead-turn-falls-back-to-importance",
		says: "a cursor turn landing on an empty slot is spent by the importance lane instead of being wasted",
		bounded: "deadTurnCount / listSize of the fairness budget, declared in the decision and folded into the pdf",
	}),
	Object.freeze({
		id: "cell-saturation",
		says: "slots above MSM_FAIRNESS_MAX_CANDIDATES never get a turn",
		bounded: "residue 8 of the plan; the decision publishes saturated: true instead of hiding it",
	}),
	Object.freeze({
		id: "coverage-is-per-list-not-per-light",
		says: "a light that leaves the cell list before its turn never receives it",
		bounded:
			"this phase owns the rotation of the LIST; page rotation is MSM-F17 and sample position rotation is MSM-F12",
	}),
]);

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value);
}

function flooredModulo(value, modulus) {
	const remainder = value % modulus;
	return remainder >= 0 ? remainder : remainder + modulus;
}


export function resolveFairnessListSize(listSize) {
	const requested = Math.floor(Number(listSize));
	if (!Number.isFinite(requested) || !(requested > 0)) return 0;
	return Math.min(MSM_FAIRNESS_MAX_CANDIDATES, requested);
}


export function isSaturatedListSize(listSize) {
	const requested = Math.floor(Number(listSize));
	return Number.isFinite(requested) && requested > MSM_FAIRNESS_MAX_CANDIDATES;
}

function clampTurnCount(turnCount, slots) {
	const requested = Math.floor(Number(turnCount));
	if (!Number.isFinite(requested) || !(requested > 0)) return 0;
	return Math.min(slots, requested);
}


function readCandidateWeightOutcome(readCandidateWeight, candidateSlot) {
	if (typeof readCandidateWeight !== "function") {
		return { weight: 0, failureReason: MSM_FAIRNESS_PICK_REASONS.WEIGHT_READER_MISSING };
	}
	try {
		const weight = Number(readCandidateWeight(candidateSlot));
		if (!Number.isFinite(weight) || !(weight >= 0)) {
			return { weight: 0, failureReason: MSM_FAIRNESS_PICK_REASONS.WEIGHT_NOT_FINITE };
		}
		return { weight, failureReason: "" };
	} catch (weightReaderError) {
		return { weight: 0, failureReason: MSM_FAIRNESS_PICK_REASONS.WEIGHT_READER_THREW };
	}
}







export function fairnessDutyPhase(pixelX, pixelY, frameIndex, streamIndex) {
	if (!isFiniteNumber(pixelX) || !isFiniteNumber(pixelY)) return MSM_FAIRNESS_EMPTY_PICK;
	if (!isFiniteNumber(frameIndex)) return MSM_FAIRNESS_EMPTY_PICK;

	const stream = isFiniteNumber(streamIndex) ? Math.floor(streamIndex) : 0;
	const blockX = flooredModulo(Math.floor(pixelX), MSM_FAIRNESS_DUTY_BLOCK_SIZE);
	const blockY = flooredModulo(Math.floor(pixelY), MSM_FAIRNESS_DUTY_BLOCK_SIZE);
	const seat = MSM_FAIRNESS_DUTY_ORDER[blockY * MSM_FAIRNESS_DUTY_BLOCK_SIZE + blockX];
	return flooredModulo(seat + Math.floor(frameIndex) + stream, MSM_FAIRNESS_PERIOD_FRAMES);
}


export function isFairnessSample(pixelX, pixelY, frameIndex, streamIndex) {
	return fairnessDutyPhase(pixelX, pixelY, frameIndex, streamIndex) === 0;
}


export function fairnessTurnIndex(frameIndex) {
	if (!isFiniteNumber(frameIndex)) return 0;
	return Math.floor(Math.floor(frameIndex) / MSM_FAIRNESS_PERIOD_FRAMES);
}


export function fairnessCellPhase(cellIndex, listSize) {
	const slots = resolveFairnessListSize(listSize);
	if (!(slots > 0)) return 0;
	const cell = isFiniteNumber(cellIndex) ? Math.floor(cellIndex) : 0;
	return flooredModulo(cell * MSM_FAIRNESS_CELL_PHASE_STRIDE, slots);
}


export function fairnessCursorSlot(cellIndex, listSize, frameIndex) {
	const slots = resolveFairnessListSize(listSize);
	if (!(slots > 0)) return MSM_FAIRNESS_EMPTY_PICK;
	return flooredModulo(fairnessTurnIndex(frameIndex) + fairnessCellPhase(cellIndex, slots), slots);
}


export function fairnessSlotPdf(candidateWeight, totalWeight, listSize, deadTurnCount, fairnessTurnsOnSlot) {
	const slots = resolveFairnessListSize(listSize);
	const weight = Number(candidateWeight);
	if (!(slots > 0) || !(weight > 0)) return 0;

	const total = Number(totalWeight);
	const deadTurns = clampTurnCount(deadTurnCount, slots);
	const fairnessTurns = clampTurnCount(fairnessTurnsOnSlot, slots);
	const fairnessMass = MSM_FAIRNESS_SAMPLE_SHARE * (fairnessTurns / slots);
	const deadTurnMass = MSM_FAIRNESS_SAMPLE_SHARE * (deadTurns / slots);
	const importanceMass = 1 - MSM_FAIRNESS_SAMPLE_SHARE + deadTurnMass;

	if (!Number.isFinite(total) || !(total > 0)) return fairnessMass;
	return importanceMass * (weight / total) + fairnessMass;
}


function isPromotionActive(freshStrongSlot, freshStrongAge, slots) {
	if (!isFiniteNumber(freshStrongSlot) || !isFiniteNumber(freshStrongAge)) return false;
	const slot = Math.floor(freshStrongSlot);
	if (!(slot >= 0) || !(slots > slot)) return false;
	const age = Math.floor(freshStrongAge);
	return age >= 0 && MSM_FAIRNESS_FRESH_LIGHT_DEADLINE_FRAMES > age;
}


function countFairnessTurnsOnSlot(candidateSlot, promotedSlot, slots) {
	if (promotedSlot === MSM_FAIRNESS_EMPTY_PICK) return 1;
	return candidateSlot === promotedSlot ? slots : 0;
}

function refusedDecision(reason, turnIndex, saturated, weightReadCount) {
	return {
		lane: MSM_FAIRNESS_LANES.IMPORTANCE,
		candidateSlot: MSM_FAIRNESS_EMPTY_PICK,
		pdf: 0,
		reason,
		weightReadCount,
		dutyPhase: MSM_FAIRNESS_EMPTY_PICK,
		turnIndex,
		fairnessTurns: 0,
		saturated,
	};
}


function decideByImportanceLane(options) {
	const {
		importanceSlot,
		slots,
		totalWeight,
		readCandidateWeight,
		deadTurnCount,
		promotedSlot,
		dutyPhase,
		turnIndex,
		saturated,
		reason,
		weightReadsSoFar,
	} = options;

	const slot = Math.floor(Number(importanceSlot));
	if (!Number.isFinite(slot) || !(slot >= 0) || !(slots > slot)) {
		return {
			lane: MSM_FAIRNESS_LANES.IMPORTANCE,
			candidateSlot: MSM_FAIRNESS_EMPTY_PICK,
			pdf: 0,
			reason: MSM_FAIRNESS_PICK_REASONS.EMPTY_IMPORTANCE_PICK,
			weightReadCount: weightReadsSoFar,
			dutyPhase,
			turnIndex,
			fairnessTurns: 0,
			saturated,
		};
	}

	const outcome = readCandidateWeightOutcome(readCandidateWeight, slot);
	const weightReadCount = weightReadsSoFar + 1;
	if (!(outcome.weight > 0)) {
		return {
			lane: MSM_FAIRNESS_LANES.IMPORTANCE,
			candidateSlot: MSM_FAIRNESS_EMPTY_PICK,
			pdf: 0,
			reason: outcome.failureReason || MSM_FAIRNESS_PICK_REASONS.EMPTY_IMPORTANCE_PICK,
			weightReadCount,
			dutyPhase,
			turnIndex,
			fairnessTurns: 0,
			saturated,
		};
	}

	const fairnessTurns = countFairnessTurnsOnSlot(slot, promotedSlot, slots);
	return {
		lane: MSM_FAIRNESS_LANES.IMPORTANCE,
		candidateSlot: slot,
		pdf: fairnessSlotPdf(outcome.weight, totalWeight, slots, deadTurnCount, fairnessTurns),
		reason,
		weightReadCount,
		dutyPhase,
		turnIndex,
		fairnessTurns,
		saturated,
	};
}


export function decideSampleLane(request = {}) {
	const {
		pixelX,
		pixelY,
		frameIndex,
		streamIndex,
		cellIndex,
		listSize,
		totalWeight,
		importanceSlot,
		readCandidateWeight,
		freshStrongSlot,
		freshStrongAge,
		deadTurnCount,
	} = request;

	const slots = resolveFairnessListSize(listSize);
	const saturated = isSaturatedListSize(listSize);
	const turnIndex = fairnessTurnIndex(frameIndex);

	if (!(slots > 0)) {
		return refusedDecision(MSM_FAIRNESS_PICK_REASONS.EMPTY_LIST, turnIndex, saturated, 0);
	}
	if (!isFiniteNumber(pixelX) || !isFiniteNumber(pixelY)) {
		return refusedDecision(MSM_FAIRNESS_PICK_REASONS.PIXEL_NOT_FINITE, turnIndex, saturated, 0);
	}
	if (!isFiniteNumber(frameIndex)) {
		return refusedDecision(MSM_FAIRNESS_PICK_REASONS.FRAME_INDEX_NOT_FINITE, turnIndex, saturated, 0);
	}
	if (typeof readCandidateWeight !== "function") {
		return refusedDecision(MSM_FAIRNESS_PICK_REASONS.WEIGHT_READER_MISSING, turnIndex, saturated, 0);
	}

	const dutyPhase = fairnessDutyPhase(pixelX, pixelY, frameIndex, streamIndex);
	const promotedSlot = isPromotionActive(freshStrongSlot, freshStrongAge, slots)
		? Math.floor(freshStrongSlot)
		: MSM_FAIRNESS_EMPTY_PICK;
	const importanceLaneOptions = {
		importanceSlot,
		slots,
		totalWeight,
		readCandidateWeight,
		deadTurnCount,
		promotedSlot,
		dutyPhase,
		turnIndex,
		saturated,
		reason: MSM_FAIRNESS_PICK_REASONS.IMPORTANCE_TURN,
		weightReadsSoFar: 0,
	};

	if (dutyPhase !== 0) return decideByImportanceLane(importanceLaneOptions);

	const cursorSlot =
		promotedSlot === MSM_FAIRNESS_EMPTY_PICK ? fairnessCursorSlot(cellIndex, slots, frameIndex) : promotedSlot;
	const cursorOutcome = readCandidateWeightOutcome(readCandidateWeight, cursorSlot);

	if (cursorOutcome.weight > 0) {
		const fairnessTurns = countFairnessTurnsOnSlot(cursorSlot, promotedSlot, slots);
		return {
			lane: MSM_FAIRNESS_LANES.FAIRNESS,
			candidateSlot: cursorSlot,
			pdf: fairnessSlotPdf(cursorOutcome.weight, totalWeight, slots, deadTurnCount, fairnessTurns),
			reason:
				promotedSlot === MSM_FAIRNESS_EMPTY_PICK
					? MSM_FAIRNESS_PICK_REASONS.CURSOR_TURN
					: MSM_FAIRNESS_PICK_REASONS.FRESH_STRONG_LIGHT,
			weightReadCount: 1,
			dutyPhase,
			turnIndex,
			fairnessTurns,
			saturated,
		};
	}


	return decideByImportanceLane({
		...importanceLaneOptions,
		reason: cursorOutcome.failureReason || MSM_FAIRNESS_PICK_REASONS.CURSOR_SLOT_EMPTY,
		weightReadsSoFar: 1,
	});
}


export function resolveFreshStrongCandidate(cell = {}) {
	const { candidateWeights, candidateAges, totalWeight } = cell;
	if (!Array.isArray(candidateWeights)) return MSM_FAIRNESS_EMPTY_PICK;

	const slots = resolveFairnessListSize(candidateWeights.length);
	const total = Number(totalWeight);
	if (!(slots > 0) || !Number.isFinite(total) || !(total > 0)) return MSM_FAIRNESS_EMPTY_PICK;

	const strongWeightFloor = total * MSM_FAIRNESS_STRONG_WEIGHT_SHARE;
	let strongestFreshSlot = MSM_FAIRNESS_EMPTY_PICK;
	let strongestFreshWeight = 0;

	for (let candidateSlot = 0; slots > candidateSlot; candidateSlot += 1) {
		const weight = Number(candidateWeights[candidateSlot]);
		if (!Number.isFinite(weight) || !(weight >= strongWeightFloor)) continue;

		const age = Array.isArray(candidateAges) ? Math.floor(Number(candidateAges[candidateSlot])) : Number.NaN;
		if (!Number.isFinite(age) || !(age >= 0)) continue;
		if (!(MSM_FAIRNESS_FRESH_LIGHT_DEADLINE_FRAMES > age)) continue;

		if (weight > strongestFreshWeight) {
			strongestFreshWeight = weight;
			strongestFreshSlot = candidateSlot;
		}
	}

	return strongestFreshSlot;
}

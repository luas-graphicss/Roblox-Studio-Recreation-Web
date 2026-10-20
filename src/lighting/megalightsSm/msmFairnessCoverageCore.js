import {
	MSM_FAIRNESS_COVERAGE_BUDGET_FACTOR,
	MSM_FAIRNESS_EMPTY_PICK,
	MSM_FAIRNESS_FRESH_LIGHT_DEADLINE_FRAMES,
	MSM_FAIRNESS_LADDER_LIST_SIZES,
	MSM_FAIRNESS_LANES,
	MSM_FAIRNESS_PERIOD_FRAMES,
	MSM_FAIRNESS_PHASE_ID,
	MSM_FAIRNESS_SAMPLE_SHARE,
	decideSampleLane,
	fairnessCursorSlot,
	isFairnessSample,
	resolveFairnessListSize,
} from "./msmFairnessCursorCore.js";


export const MSM_FAIRNESS_COVERAGE_GATE_ID = "G14";


export const MSM_FAIRNESS_ROTATION_OWNERS = Object.freeze(["MSM-F12", MSM_FAIRNESS_PHASE_ID, "MSM-F17"]);

function isSlotAlwaysLive() {
	return true;
}

function countLiveSlots(slots, isSlotLive) {
	let liveSlotCount = 0;
	for (let candidateSlot = 0; slots > candidateSlot; candidateSlot += 1) {
		if (isSlotLive(candidateSlot)) liveSlotCount += 1;
	}
	return liveSlotCount;
}

function resolveFrameBudget(frameBudget, slots) {
	const requested = Math.floor(Number(frameBudget));
	if (Number.isFinite(requested) && requested > 0) return requested;
	return slots * MSM_FAIRNESS_COVERAGE_BUDGET_FACTOR;
}









export function walkFairnessCoverage(options = {}) {
	const {
		cellIndex = 0,
		listSize,
		pixelX = 0,
		pixelY = 0,
		streamIndex = 0,
		startFrame = 0,
		frameBudget,
		resolveCursorSlot = fairnessCursorSlot,
		isSlotLive = isSlotAlwaysLive,
	} = options;

	const slots = resolveFairnessListSize(listSize);
	const budget = resolveFrameBudget(frameBudget, Math.max(1, slots));
	const firstFrame = Number.isFinite(Number(startFrame)) ? Math.floor(Number(startFrame)) : 0;

	if (!(slots > 0)) {
		return {
			covered: false,
			listSize: 0,
			liveSlotCount: 0,
			visitedSlotCount: 0,
			visitedSlots: [],
			fairnessSampleCount: 0,
			framesUsed: 0,
			frameBudget: budget,
		};
	}

	const liveSlotCount = countLiveSlots(slots, isSlotLive);
	const visited = new Set();
	let fairnessSampleCount = 0;
	let framesUsed = 0;

	for (let frameOffset = 0; budget > frameOffset; frameOffset += 1) {
		framesUsed = frameOffset + 1;
		const frameIndex = firstFrame + frameOffset;
		if (!isFairnessSample(pixelX, pixelY, frameIndex, streamIndex)) continue;

		fairnessSampleCount += 1;
		const candidateSlot = resolveCursorSlot(cellIndex, slots, frameIndex);
		if (candidateSlot === MSM_FAIRNESS_EMPTY_PICK) continue;
		if (!Number.isFinite(Number(candidateSlot))) continue;
		if (!isSlotLive(candidateSlot)) continue;

		visited.add(candidateSlot);
		if (visited.size === liveSlotCount) break;
	}

	return {
		covered: liveSlotCount > 0 && visited.size === liveSlotCount,
		listSize: slots,
		liveSlotCount,
		visitedSlotCount: visited.size,
		visitedSlots: Array.from(visited).sort(function ascending(left, right) {
			return left - right;
		}),
		fairnessSampleCount,
		framesUsed,
		frameBudget: budget,
		periodFrames: MSM_FAIRNESS_PERIOD_FRAMES,
	};
}


export function measureFairnessSampleShare(options = {}) {
	const { pixelWidth = 8, pixelHeight = 8, frameCount = 16, startFrame = 0, streamCount = 1 } = options;

	const width = Math.max(1, Math.floor(Number(pixelWidth)) || 1);
	const height = Math.max(1, Math.floor(Number(pixelHeight)) || 1);
	const frames = Math.max(1, Math.floor(Number(frameCount)) || 1);
	const streams = Math.max(1, Math.floor(Number(streamCount)) || 1);
	const firstFrame = Number.isFinite(Number(startFrame)) ? Math.floor(Number(startFrame)) : 0;
	const samplesPerFrame = width * height * streams;

	const shareByFrame = [];
	let fairnessSampleCount = 0;

	for (let frameOffset = 0; frames > frameOffset; frameOffset += 1) {
		const frameIndex = firstFrame + frameOffset;
		let fairnessSamplesThisFrame = 0;

		for (let pixelY = 0; height > pixelY; pixelY += 1) {
			for (let pixelX = 0; width > pixelX; pixelX += 1) {
				for (let streamIndex = 0; streams > streamIndex; streamIndex += 1) {
					if (isFairnessSample(pixelX, pixelY, frameIndex, streamIndex)) fairnessSamplesThisFrame += 1;
				}
			}
		}

		fairnessSampleCount += fairnessSamplesThisFrame;
		shareByFrame.push(fairnessSamplesThisFrame / samplesPerFrame);
	}

	const minShare = Math.min.apply(null, shareByFrame);
	const maxShare = Math.max.apply(null, shareByFrame);

	return {
		shareByFrame,
		minShare,
		maxShare,
		share: fairnessSampleCount / (samplesPerFrame * frames),
		expectedShare: MSM_FAIRNESS_SAMPLE_SHARE,
		sampleCount: samplesPerFrame * frames,
		fairnessSampleCount,
		exact: minShare === MSM_FAIRNESS_SAMPLE_SHARE && maxShare === MSM_FAIRNESS_SAMPLE_SHARE,
	};
}


export function measureFreshLightLatency(options = {}) {
	const {
		cellIndex = 0,
		listSize,
		candidateWeights,
		targetSlot,
		pixels = [{ pixelX: 0, pixelY: 0 }],
		startFrame = 0,
		frameBudget,
		streamIndex = 0,
		importanceSlot = 0,
		promotedSlot = MSM_FAIRNESS_EMPTY_PICK,
		promotionStartFrame = 0,
		deadTurnCount = 0,
	} = options;

	const weights = Array.isArray(candidateWeights) ? candidateWeights : [];
	const slots = resolveFairnessListSize(Number.isFinite(Number(listSize)) ? listSize : weights.length);
	const totalWeight = weights.reduce(function addUsableWeight(sum, candidateWeight) {
		const weight = Number(candidateWeight);
		return Number.isFinite(weight) && weight > 0 ? sum + weight : sum;
	}, 0);
	const budget = resolveFrameBudget(frameBudget, Math.max(1, slots));
	const firstFrame = Number.isFinite(Number(startFrame)) ? Math.floor(Number(startFrame)) : 0;
	const wantedSlot = Math.floor(Number(targetSlot));

	function readCandidateWeight(candidateSlot) {
		const weight = Number(weights[candidateSlot]);
		return Number.isFinite(weight) && weight > 0 ? weight : 0;
	}

	for (let frameOffset = 0; budget > frameOffset; frameOffset += 1) {
		const frameIndex = firstFrame + frameOffset;

		for (let pixelIndex = 0; pixels.length > pixelIndex; pixelIndex += 1) {
			const decision = decideSampleLane({
				pixelX: pixels[pixelIndex].pixelX,
				pixelY: pixels[pixelIndex].pixelY,
				frameIndex,
				streamIndex,
				cellIndex,
				listSize: slots,
				totalWeight,
				importanceSlot,
				readCandidateWeight,
				freshStrongSlot: promotedSlot,
				freshStrongAge: frameIndex - promotionStartFrame,
				deadTurnCount,
			});

			if (decision.candidateSlot !== wantedSlot) continue;

			return {
				shaded: true,
				framesWaited: frameOffset,
				deadlineFrames: MSM_FAIRNESS_FRESH_LIGHT_DEADLINE_FRAMES,
				withinDeadline: MSM_FAIRNESS_FRESH_LIGHT_DEADLINE_FRAMES > frameOffset,
				lane: decision.lane,
				reason: decision.reason,
				pdf: decision.pdf,
			};
		}
	}

	return {
		shaded: false,
		framesWaited: budget,
		deadlineFrames: MSM_FAIRNESS_FRESH_LIGHT_DEADLINE_FRAMES,
		withinDeadline: false,
		lane: MSM_FAIRNESS_LANES.IMPORTANCE,
		reason: "",
		pdf: 0,
	};
}


export function proveFairnessRotation(options = {}) {
	const {
		listSizes = MSM_FAIRNESS_LADDER_LIST_SIZES,
		cellIndexes = [0, 1, 7, 13],
		pixels = [
			{ pixelX: 0, pixelY: 0 },
			{ pixelX: 1, pixelY: 0 },
			{ pixelX: 0, pixelY: 1 },
			{ pixelX: 1, pixelY: 1 },
		],
		startFrames = [0, 1, 2, 3, -9],
		resolveCursorSlot = fairnessCursorSlot,
		isSlotLive,
	} = options;

	let walkCount = 0;
	let openWalkCount = 0;
	let worstFramesUsed = 0;
	let worstListSize = 0;
	let worstFrameBudget = 0;

	listSizes.forEach(function walkOneListSize(listSize) {
		cellIndexes.forEach(function walkOneCell(cellIndex) {
			pixels.forEach(function walkOnePixel(pixel) {
				startFrames.forEach(function walkOneStartFrame(startFrame) {
					const walk = walkFairnessCoverage({
						cellIndex,
						listSize,
						pixelX: pixel.pixelX,
						pixelY: pixel.pixelY,
						startFrame,
						resolveCursorSlot,
						isSlotLive,
					});

					walkCount += 1;
					if (!walk.covered) openWalkCount += 1;
					if (walk.covered && walk.framesUsed > worstFramesUsed) {
						worstFramesUsed = walk.framesUsed;
						worstListSize = walk.listSize;
						worstFrameBudget = walk.frameBudget;
					}
				});
			});
		});
	});

	const closed = walkCount > 0 && openWalkCount === 0;

	return {
		gate: MSM_FAIRNESS_COVERAGE_GATE_ID,
		owner: MSM_FAIRNESS_PHASE_ID,
		rotationOwners: MSM_FAIRNESS_ROTATION_OWNERS,
		closedRotationCoverageProofs: closed ? 1 : 0,
		totalRotationCoverageProofs: MSM_FAIRNESS_ROTATION_OWNERS.length,
		closed,
		walkCount,
		openWalkCount,
		worstFramesUsed,
		worstFrameBudget,
		worstListSize,
		periodFrames: MSM_FAIRNESS_PERIOD_FRAMES,
		coverageBudgetFactor: MSM_FAIRNESS_COVERAGE_BUDGET_FACTOR,
	};
}

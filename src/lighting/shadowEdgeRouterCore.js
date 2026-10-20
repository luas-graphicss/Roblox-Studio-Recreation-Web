import {
	REVECTORIZED_FLAT_RAMP_CEILING_TEXELS,
	REVECTORIZED_REFUSED,
	SHADOW_EDGE_RUN_SEARCH_TEXELS,
	revectorizedCombinedAxisLight,
	revectorizedEdgeAxis,
	revectorizedNeighbourhoodIsFlat,
	revectorizedRunLengthTexels,
	revectorizedVisibility,
} from "./shadowEdgeRevectorizationCore.js";
import { TREAD_LENGTH_UNMEASURED_TEXELS } from "./shadowEdgeRunLengthCore.js";
import { straightenedShadowEdgeLight } from "./shadowEdgeStraightKernelCore.js";


import { shouldMeasureTreadPeriod } from "./shadowEdgeTreadPeriodCore.js";


import {
	AXIS_STEP_LENGTH_TEXELS,
	SHADOW_EDGE_DIAGONAL_WALK_FRAMES,
	walkFrameStepLengthTexels,
	walkFrameSubTexelPosition,
} from "./shadowEdgeWalkFrameCore.js";


export const ANSWERED_BY_FLAT_NEIGHBOURHOOD = "flat";

export const ANSWERED_BY_REVECTORIZATION = "revectorized";

export const ANSWERED_BY_STRAIGHT_KERNEL = "straight";

function isLitTexel(readOcclusionTap, texelX, texelY) {
	return readOcclusionTap(texelX, texelY) >= 0.5;
}


function walkRun({ readOcclusionTap, texel, across, along, pointSideIsLit }) {
	for (let step = 1; SHADOW_EDGE_RUN_SEARCH_TEXELS >= step; step += 1) {
		const walkX = texel.x + along.x * step;
		const walkY = texel.y + along.y * step;
		if (isLitTexel(readOcclusionTap, walkX, walkY) !== pointSideIsLit) {
			return {
				runTexels: step - 1,
				endBroke: true,
				endBrokeOnPointSide: true,
				endIsSilhouetteEnd:
					isLitTexel(readOcclusionTap, walkX - across.x, walkY - across.y) !== pointSideIsLit,
			};
		}
		if (isLitTexel(readOcclusionTap, walkX + across.x, walkY + across.y) === pointSideIsLit) {
			return {
				runTexels: step - 1,
				endBroke: true,
				endBrokeOnPointSide: false,
				endIsSilhouetteEnd:
					isLitTexel(readOcclusionTap, walkX + 2 * across.x, walkY + 2 * across.y) ===
					pointSideIsLit,
			};
		}
	}
	return {
		runTexels: SHADOW_EDGE_RUN_SEARCH_TEXELS,
		endBroke: false,
		endBrokeOnPointSide: false,
		endIsSilhouetteEnd: false,
	};
}


function neighbourTreadTexels({
	readOcclusionTap,
	texel,
	across,
	along,
	pointSideIsLit,
	jogTexels,
	jogWasOnPointSide,
}) {
	const acrossShift = jogWasOnPointSide ? -1 : 1;
	const jogTexel = {
		x: texel.x + along.x * (jogTexels + 1) + across.x * acrossShift,
		y: texel.y + along.y * (jogTexels + 1) + across.y * acrossShift,
	};
	const pastTheJog = walkRun({
		readOcclusionTap,
		texel: jogTexel,
		across,
		along,
		pointSideIsLit,
	});


	return pastTheJog.endBroke && !pastTheJog.endIsSilhouetteEnd
		? pastTheJog.runTexels + 1
		: TREAD_LENGTH_UNMEASURED_TEXELS;
}


function revectorizeInFrame({
	readOcclusionTap,
	texel,
	across,
	along,
	subTexel,
	pointSideIsLit,
	atCorner,
	widthTexels,
	acrossStepLengthTexels = AXIS_STEP_LENGTH_TEXELS,
}) {
	const positive = walkRun({ readOcclusionTap, texel, across, along, pointSideIsLit });
	const negative = walkRun({
		readOcclusionTap,
		texel,
		across,
		along: { x: -along.x, y: -along.y },
		pointSideIsLit,
	});


	const negativeEndIsJog = negative.endBroke && !negative.endIsSilhouetteEnd;
	const positiveEndIsJog = positive.endBroke && !positive.endIsSilhouetteEnd;
	const openSideIsSilhouetteEnd = negativeEndIsJog
		? positive.endIsSilhouetteEnd
		: negative.endIsSilhouetteEnd;
	const oneSideStoppedAtSilhouetteEnd =
		negativeEndIsJog !== positiveEndIsJog && openSideIsSilhouetteEnd;
	const bothSidesClosedOnAJog = negativeEndIsJog && positiveEndIsJog;
	const countedTreadTexels = negative.runTexels + positive.runTexels + 1;


	const substituteTreadTexels = oneSideStoppedAtSilhouetteEnd
		? neighbourTreadTexels({
				readOcclusionTap,
				texel,
				across,
				along: negativeEndIsJog ? { x: -along.x, y: -along.y } : along,
				pointSideIsLit,
				jogTexels: negativeEndIsJog ? negative.runTexels : positive.runTexels,
				jogWasOnPointSide: negativeEndIsJog
					? negative.endBrokeOnPointSide
					: positive.endBrokeOnPointSide,
			})
		: TREAD_LENGTH_UNMEASURED_TEXELS;


	const measuresSpacingAtBothJogs =
		bothSidesClosedOnAJog && shouldMeasureTreadPeriod(countedTreadTexels);
	const leadingNeighbourTreadTexels = measuresSpacingAtBothJogs
		? neighbourTreadTexels({
				readOcclusionTap,
				texel,
				across,
				along: { x: -along.x, y: -along.y },
				pointSideIsLit,
				jogTexels: negative.runTexels,
				jogWasOnPointSide: negative.endBrokeOnPointSide,
			})
		: TREAD_LENGTH_UNMEASURED_TEXELS;
	const trailingNeighbourTreadTexels = measuresSpacingAtBothJogs
		? neighbourTreadTexels({
				readOcclusionTap,
				texel,
				across,
				along,
				pointSideIsLit,
				jogTexels: positive.runTexels,
				jogWasOnPointSide: positive.endBrokeOnPointSide,
			})
		: TREAD_LENGTH_UNMEASURED_TEXELS;
	const pattern = {
		negativeRunTexels: negative.runTexels,
		positiveRunTexels: positive.runTexels,
		negativeEndBroke: negative.endBroke,
		positiveEndBroke: positive.endBroke,
		negativeEndBrokeOnPointSide: negative.endBrokeOnPointSide,
		positiveEndBrokeOnPointSide: positive.endBrokeOnPointSide,
		negativeEndIsSilhouetteEnd: negative.endIsSilhouetteEnd,
		positiveEndIsSilhouetteEnd: positive.endIsSilhouetteEnd,
		neighbourTreadTexels: substituteTreadTexels,
		leadingNeighbourTreadTexels,
		trailingNeighbourTreadTexels,
		alongSubTexel: subTexel.along,
		acrossSubTexel: subTexel.across,
		pointSideIsLit,
		atCorner,
		rampTexels: widthTexels,
		acrossStepLengthTexels,
	};
	return {
		visibility: revectorizedVisibility(pattern),
		runLengthTexels: revectorizedRunLengthTexels(pattern),
	};
}


function revectorizeInDiagonalFrame({
	readOcclusionTap,
	texel,
	offsetFromTexelCentre,
	pointSideIsLit,
	widthTexels,
	frame,
}) {
	const { alongStep, acrossStep } = frame;
	const nearDiffers =
		isLitTexel(readOcclusionTap, texel.x + acrossStep.x, texel.y + acrossStep.y) !==
		pointSideIsLit;
	const farDiffers =
		isLitTexel(readOcclusionTap, texel.x - acrossStep.x, texel.y - acrossStep.y) !==
		pointSideIsLit;

	if (nearDiffers === farDiffers) return null;
	const acrossSign = nearDiffers ? 1 : -1;
	const signedAcrossStep = { x: acrossStep.x * acrossSign, y: acrossStep.y * acrossSign };
	const subTexel = walkFrameSubTexelPosition({
		alongStep,
		acrossStep: signedAcrossStep,
		offsetFromTexelCentre,
	});
	const measured = revectorizeInFrame({
		readOcclusionTap,
		texel,
		across: signedAcrossStep,
		along: alongStep,
		subTexel: { along: subTexel.alongSubTexel, across: subTexel.acrossSubTexel },
		pointSideIsLit,


		atCorner: false,
		widthTexels,
		acrossStepLengthTexels: walkFrameStepLengthTexels(signedAcrossStep),
	});
	return measured.visibility === REVECTORIZED_REFUSED ? null : measured;
}


export function explainShadowEdgeRouting({
	readOcclusionTap,
	sampleX,
	sampleY,
	widthTexels,
}) {
	const texel = { x: Math.round(sampleX), y: Math.round(sampleY) };
	const inTexelX = sampleX - texel.x + 0.5;
	const inTexelY = sampleY - texel.y + 0.5;
	const pointSideIsLit = isLitTexel(readOcclusionTap, texel.x, texel.y);
	const leanX = inTexelX >= 0.5 ? 1 : -1;
	const leanY = inTexelY >= 0.5 ? 1 : -1;
	const neighbourhood = {
		pointSideIsLit,
		litNearX: isLitTexel(readOcclusionTap, texel.x + leanX, texel.y),
		litFarX: isLitTexel(readOcclusionTap, texel.x - leanX, texel.y),
		litNearY: isLitTexel(readOcclusionTap, texel.x, texel.y + leanY),
		litFarY: isLitTexel(readOcclusionTap, texel.x, texel.y - leanY),
		litNearDiagonal: isLitTexel(readOcclusionTap, texel.x + leanX, texel.y + leanY),
	};
	const axis = revectorizedEdgeAxis(neighbourhood);
	const drawByStraightKernel = () => ({
		light: straightenedShadowEdgeLight({ readOcclusionTap, sampleX, sampleY, widthTexels }),
		answeredBy: ANSWERED_BY_STRAIGHT_KERNEL,
		axis,
		runLengthTexels: 0,
	});

	if (axis === "none") {
		if (
			revectorizedNeighbourhoodIsFlat(neighbourhood) &&
			REVECTORIZED_FLAT_RAMP_CEILING_TEXELS >= widthTexels
		) {
			return {
				light: pointSideIsLit ? 1 : 0,
				answeredBy: ANSWERED_BY_FLAT_NEIGHBOURHOOD,
				axis,
				runLengthTexels: SHADOW_EDGE_RUN_SEARCH_TEXELS,
			};
		}
		return drawByStraightKernel();
	}

	let xAxisLight = REVECTORIZED_REFUSED;
	let xAxisRunTexels = 0;
	if (axis === "x" || axis === "both") {
		const acrossSign = neighbourhood.litNearX !== pointSideIsLit ? leanX : -leanX;
		const measured = revectorizeInFrame({
			readOcclusionTap,
			texel,
			across: { x: acrossSign, y: 0 },
			along: { x: 0, y: 1 },
			subTexel: { across: acrossSign * (inTexelX - 0.5), along: inTexelY },
			pointSideIsLit,
			atCorner: axis === "both",
			widthTexels,
		});
		xAxisLight = measured.visibility;
		xAxisRunTexels = measured.runLengthTexels;
	}

	let yAxisLight = REVECTORIZED_REFUSED;
	let yAxisRunTexels = 0;
	if (axis === "y" || axis === "both") {
		const acrossSign = neighbourhood.litNearY !== pointSideIsLit ? leanY : -leanY;
		const measured = revectorizeInFrame({
			readOcclusionTap,
			texel,
			across: { x: 0, y: acrossSign },
			along: { x: 1, y: 0 },
			subTexel: { across: acrossSign * (inTexelY - 0.5), along: inTexelX },
			pointSideIsLit,
			atCorner: axis === "both",
			widthTexels,
		});
		yAxisLight = measured.visibility;
		yAxisRunTexels = measured.runLengthTexels;
	}


	const combinedLight = revectorizedCombinedAxisLight({
		axis,
		pointSideIsLit,
		xAxisLight,
		yAxisLight,
	});
	if (combinedLight !== REVECTORIZED_REFUSED) {
		return {
			light: combinedLight,
			answeredBy: ANSWERED_BY_REVECTORIZATION,
			axis,
			runLengthTexels: Math.max(xAxisRunTexels, yAxisRunTexels),
		};
	}


	const offsetFromTexelCentre = { x: inTexelX - 0.5, y: inTexelY - 0.5 };
	const readableDiagonalFrames = SHADOW_EDGE_DIAGONAL_WALK_FRAMES.map((frame) =>
		revectorizeInDiagonalFrame({
			readOcclusionTap,
			texel,
			offsetFromTexelCentre,
			pointSideIsLit,
			widthTexels,
			frame,
		}),
	).filter((measured) => measured !== null);


	if (readableDiagonalFrames.length === 1) {
		return {
			light: readableDiagonalFrames[0].visibility,
			answeredBy: ANSWERED_BY_REVECTORIZATION,
			axis,
			runLengthTexels: readableDiagonalFrames[0].runLengthTexels,
		};
	}
	return drawByStraightKernel();
}


export function routedShadowEdgeLight(args) {
	return explainShadowEdgeRouting(args).light;
}

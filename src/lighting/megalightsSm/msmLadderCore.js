import { MSM_PROXY_LADDER_RUNG_REQUEST } from "./msmProxyVetoPolicyCore.js";

export const MSM_LADDER_OWNER = "MSM-F31";
export const MSM_LADDER_PLAN_SECTION = "6.3";


export const MSM_LADDER_RUNG_SOURCE = Object.freeze({
	PLAN_SECTION: "plan-section-6.3",
	PHASE_REQUEST: "phase-request",
});


export const MSM_LADDER_RUNG = Object.freeze({
	SPATIAL_FILTER_OFF: "spatial-filter-off",
	SAMPLES_PER_PIXEL_TO_ONE: "samples-per-pixel-to-one",
	SCREEN_TRACE_STEPS_DOWN: "screen-trace-steps-down",
	RESOLUTION_DIVISOR_UP: "resolution-divisor-up",
	ATLAS_PAGES_DOWN: "atlas-pages-down",
	PROXY_OCCLUSION_OFF: MSM_PROXY_LADDER_RUNG_REQUEST.id,
	FAR_LIST_OFF: "far-list-off",
	MSM_OFF: "msm-off",
});


export const MSM_LADDER_SPINE = Object.freeze([
	Object.freeze({
		id: MSM_LADDER_RUNG.SPATIAL_FILTER_OFF,
		label: "spatial filter OFF",
		sells: "the five tap spatial pass P3",
	}),
	Object.freeze({
		id: MSM_LADDER_RUNG.SAMPLES_PER_PIXEL_TO_ONE,
		label: "spp 2 -> 1",
		sells: "the second sample per pixel of the medium tier",
	}),
	Object.freeze({
		id: MSM_LADDER_RUNG.SCREEN_TRACE_STEPS_DOWN,
		label: "screen trace steps -2 (floor 3)",
		sells: "two steps of the screen space march, owned by MSM-F18",
	}),
	Object.freeze({
		id: MSM_LADDER_RUNG.RESOLUTION_DIVISOR_UP,
		label: "resolution divisor 2 -> 4",
		sells: "three quarters of the reduced pixels of the three passes",
	}),
	Object.freeze({
		id: MSM_LADDER_RUNG.ATLAS_PAGES_DOWN,
		label: "atlas pages per frame 2 -> 1",
		sells: "one atlas page re-render per frame, owned by MSM-F17",
	}),
	Object.freeze({
		id: MSM_LADDER_RUNG.FAR_LIST_OFF,
		label: "far list OFF",
		sells: "the eight strongest emitters outside the grid, owned by MSM-F10",
	}),
	Object.freeze({
		id: MSM_LADDER_RUNG.MSM_OFF,
		label: "MSM OFF",
		sells: "the whole system - the engine goes back to today, byte for byte",
	}),
]);


export const MSM_LADDER_SPINE_LENGTH = 7;


export const MSM_LADDER_EXTENSION_REQUESTS = Object.freeze([MSM_PROXY_LADDER_RUNG_REQUEST]);

function readRequestedPosition(request) {
	const parsed = Math.floor(Number(request ? request.suggestedPosition : NaN));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : MSM_LADDER_SPINE_LENGTH;
}

function buildLadderRungs() {
	const rungs = MSM_LADDER_SPINE.map((rung) => ({
		id: rung.id,
		label: rung.label,
		sells: rung.sells,
		source: MSM_LADDER_RUNG_SOURCE.PLAN_SECTION,
		declaredBy: MSM_LADDER_OWNER,
	}));

	const requests = MSM_LADDER_EXTENSION_REQUESTS.slice().sort(
		(left, right) => readRequestedPosition(left) - readRequestedPosition(right),
	);

	requests.forEach((request) => {


		const lastInsertionIndex = rungs.length - 1;
		const wantedIndex = readRequestedPosition(request) - 1;
		const insertionIndex = Math.min(Math.max(wantedIndex, 0), lastInsertionIndex);
		rungs.splice(insertionIndex, 0, {
			id: request.id,
			label: request.label,
			sells: request.note,
			source: MSM_LADDER_RUNG_SOURCE.PHASE_REQUEST,
			declaredBy: request.requestedBy,
		});
	});

	return Object.freeze(
		rungs.map((rung, index) =>
			Object.freeze({
				position: index + 1,
				id: rung.id,
				label: rung.label,
				sells: rung.sells,
				source: rung.source,
				declaredBy: rung.declaredBy,
			}),
		),
	);
}

const LADDER_RUNGS = buildLadderRungs();
const LADDER_RUNG_IDS = Object.freeze(LADDER_RUNGS.map((rung) => rung.id));


export function msmLadderRungs() {
	return LADDER_RUNGS;
}


export function msmLadderRungIds() {
	return LADDER_RUNG_IDS;
}

export function msmLadderLength() {
	return LADDER_RUNGS.length;
}

export function findMsmLadderRung(rungId) {
	const wanted = typeof rungId === "string" ? rungId.trim() : "";
	return LADDER_RUNGS.find((rung) => rung.id === wanted) || null;
}


export function clampMsmSoldRungCount(value) {
	const parsed = Math.floor(Number(value));
	if (!Number.isFinite(parsed) || 1 > parsed) return 0;
	return parsed > LADDER_RUNGS.length ? LADDER_RUNGS.length : parsed;
}


export function msmSoldRungIds(soldRungCount) {
	return Object.freeze(LADDER_RUNG_IDS.slice(0, clampMsmSoldRungCount(soldRungCount)));
}


export function nextMsmRungToSell(soldRungCount) {
	const sold = clampMsmSoldRungCount(soldRungCount);
	return sold > LADDER_RUNGS.length - 1 ? null : LADDER_RUNGS[sold];
}


export function nextMsmRungToBuyBack(soldRungCount) {
	const sold = clampMsmSoldRungCount(soldRungCount);
	return sold > 0 ? LADDER_RUNGS[sold - 1] : null;
}


export function validateMsmLadder() {
	const problems = [];

	if (MSM_LADDER_SPINE.length !== MSM_LADDER_SPINE_LENGTH) {
		problems.push(
			"section " +
				MSM_LADDER_PLAN_SECTION +
				" has " +
				MSM_LADDER_SPINE_LENGTH +
				" rungs and the spine transcribed " +
				MSM_LADDER_SPINE.length,
		);
	}

	const seenIds = new Set();
	LADDER_RUNGS.forEach((rung, index) => {
		if (seenIds.has(rung.id)) problems.push("repeated rung id: " + rung.id);
		seenIds.add(rung.id);
		if (rung.position !== index + 1) problems.push("rung " + rung.id + " carries the wrong position");
		if (!rung.label) problems.push("rung " + rung.id + " has no label");
	});


	const spineOrderInLadder = LADDER_RUNGS.filter(
		(rung) => rung.source === MSM_LADDER_RUNG_SOURCE.PLAN_SECTION,
	).map((rung) => rung.id);
	const spineOrderInPlan = MSM_LADDER_SPINE.map((rung) => rung.id);
	if (spineOrderInLadder.join(",") !== spineOrderInPlan.join(",")) {
		problems.push("the rungs of section " + MSM_LADDER_PLAN_SECTION + " left their order");
	}

	const lastRung = LADDER_RUNGS[LADDER_RUNGS.length - 1];
	if (!lastRung || lastRung.id !== MSM_LADDER_RUNG.MSM_OFF) {
		problems.push("the last rung of the ladder has to be " + MSM_LADDER_RUNG.MSM_OFF);
	}

	MSM_LADDER_EXTENSION_REQUESTS.forEach((request) => {
		const rung = findMsmLadderRung(request.id);
		if (!rung) {
			problems.push("accepted request " + request.id + " is not on the ladder");
			return;
		}
		if (rung.position !== readRequestedPosition(request)) {
			problems.push(
				"request " +
					request.id +
					" asked for position " +
					readRequestedPosition(request) +
					" and sits at " +
					rung.position,
			);
		}
		if (request.ownerPhase !== MSM_LADDER_OWNER) {
			problems.push("request " + request.id + " names " + request.ownerPhase + " as the owner of the ladder");
		}
	});

	return { ok: problems.length === 0, problems };
}


export function describeMsmLadder() {
	return {
		owner: MSM_LADDER_OWNER,
		planSection: MSM_LADDER_PLAN_SECTION,
		rungCount: LADDER_RUNGS.length,
		spineRungCount: MSM_LADDER_SPINE.length,
		rungIds: LADDER_RUNG_IDS.slice(),
		extensionRungIds: LADDER_RUNGS.filter((rung) => rung.source === MSM_LADDER_RUNG_SOURCE.PHASE_REQUEST).map(
			(rung) => rung.id,
		),
		valid: validateMsmLadder().ok,
	};
}

import { registerLocalLightFlag, resolveLocalLightFlag } from "../lighting/llFeatureFlags.js";
import { llQa } from "../lighting/llTelemetry.js";
import {
	BLIND_BALLOTS_STORAGE_KEY,
	BLIND_CABIN_ENGINE_PATH,
	BLIND_ROUND_DEFAULT_SEED,
	BLIND_ROUND_FLAG_ID,
	BLIND_ROUND_PHASE_ID,
	BLIND_ROUND_QA_ID,
} from "../lighting/llBlindRoundContract.js";
import {
	buildBlindSlidePlan,
	createBallot,
	evaluateBlindRoundGate,
	scoreBlindRound,
} from "../lighting/llBlindRoundCore.js";


export const BLIND_ROUND_FLAG_DEFAULT = Object.freeze({ fraco: false, medio: true, forte: true });

export const BLIND_ROUND_GLOBAL_NAME = "__llBlindRound";

registerLocalLightFlag({
	id: BLIND_ROUND_FLAG_ID,
	phase: BLIND_ROUND_PHASE_ID,
	description: "blind round: the cabin that shows engine and reference side by side without saying which is which",
	defaultsByTier: BLIND_ROUND_FLAG_DEFAULT,
});




export function publishLocalLightBlindRound(options) {
	const settings = options && typeof options === "object" ? options : {};
	const scope = settings.globalScope || (typeof window !== "undefined" ? window : null);
	const readTier = typeof settings.getTier === "function" ? settings.getTier : () => "";
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;

	function resolveStorage() {
		if (settings.storage) return settings.storage;
		try {
			return scope && scope.localStorage ? scope.localStorage : null;
		} catch (error) {

			reportProblem("ballot box unreachable: " + error.message);
			return null;
		}
	}

	function reportProblem(reason) {
		llQa.addError("LL-F24: " + reason, { phase: BLIND_ROUND_PHASE_ID, qa: BLIND_ROUND_QA_ID });
		if (logger) logger.warn("[Luzes locais] LL-F24: " + reason);
	}

	function readBallots() {
		const storage = resolveStorage();
		if (!storage) return [];
		try {
			const raw = storage.getItem(BLIND_BALLOTS_STORAGE_KEY);
			if (!raw) return [];
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : [];
		} catch (error) {
			reportProblem("could not read the ballot box: " + error.message);
			return [];
		}
	}

	function writeBallots(ballots) {
		const storage = resolveStorage();
		if (!storage) return false;
		try {
			storage.setItem(BLIND_BALLOTS_STORAGE_KEY, JSON.stringify(ballots));
			return true;
		} catch (error) {
			reportProblem("could not write the ballot box: " + error.message);
			return false;
		}
	}

	function plan(seed) {
		return buildBlindSlidePlan({ seed: Number.isFinite(seed) ? seed : BLIND_ROUND_DEFAULT_SEED });
	}


	function submitBallot(input) {
		const ballot = createBallot(input);
		if (!ballot) {
			reportProblem("ballot refused: scene, truth or guess missing");
			return null;
		}
		const ballots = readBallots();
		ballots.push(ballot);
		if (!writeBallots(ballots)) return null;
		publishTelemetry();
		return ballot;
	}

	function clearBallots() {
		const storage = resolveStorage();
		if (!storage) return false;
		try {
			storage.removeItem(BLIND_BALLOTS_STORAGE_KEY);
			publishTelemetry();
			return true;
		} catch (error) {
			reportProblem("could not clear the ballot box: " + error.message);
			return false;
		}
	}

	function flagState() {
		const resolved = resolveLocalLightFlag(BLIND_ROUND_FLAG_ID, { tier: readTier() });
		return { id: BLIND_ROUND_FLAG_ID, active: resolved.active === true, token: resolved.token };
	}

	function describe() {
		const ballots = readBallots();
		const gate = evaluateBlindRoundGate(ballots);
		return {
			phaseId: BLIND_ROUND_PHASE_ID,
			qaId: BLIND_ROUND_QA_ID,
			cabinPath: BLIND_CABIN_ENGINE_PATH,
			flag: flagState(),
			seed: BLIND_ROUND_DEFAULT_SEED,
			plan: plan(BLIND_ROUND_DEFAULT_SEED),
			ballots: ballots.length,
			score: scoreBlindRound(ballots),
			gate,
		};
	}

	function publishTelemetry() {
		const ballots = readBallots();
		const gate = evaluateBlindRoundGate(ballots);
		llQa.setPhase(BLIND_ROUND_PHASE_ID, {
			qa: BLIND_ROUND_QA_ID,
			flag: BLIND_ROUND_FLAG_ID,
			cabin: BLIND_CABIN_ENGINE_PATH,
			ballots: ballots.length,
			verdict: gate.verdict || gate.status || "",
			published: true,
		});
	}

	publishTelemetry();
	if (scope) scope[BLIND_ROUND_GLOBAL_NAME] = describe;

	return {
		phaseId: BLIND_ROUND_PHASE_ID,
		flagId: BLIND_ROUND_FLAG_ID,
		qaId: BLIND_ROUND_QA_ID,
		globalName: BLIND_ROUND_GLOBAL_NAME,
		plan,
		ballots: readBallots,
		submitBallot,
		clearBallots,
		score: () => scoreBlindRound(readBallots()),
		gate: (gateOptions) => evaluateBlindRoundGate(readBallots(), gateOptions),
		describe,
		status() {
			const ballots = readBallots();
			return {
				phaseId: BLIND_ROUND_PHASE_ID,
				flagId: BLIND_ROUND_FLAG_ID,
				ballots: ballots.length,
				flag: flagState(),
			};
		},
	};
}

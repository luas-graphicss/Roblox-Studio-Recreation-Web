import { llQa } from "../lighting/llTelemetry.js";
import { BATTERY_PHASE_ID, BATTERY_QA_ID, BATTERY_TIER_ORDER } from "../lighting/llBatteryContract.js";
import { buildBatteryPlan, evaluateBattery } from "../lighting/llBatteryPlanCore.js";
import { LOCAL_LIGHT_PHASE_TOTAL, summarizePhaseCoverage } from "../lighting/llPhaseInventoryCore.js";
import { BASELINE_SCENE_IDS } from "../lighting/llBaselineCore.js";

export const PROOF_BATTERY_GLOBAL_NAME = "__llBattery";


export function publishLocalLightProofBattery(options) {
	const settings = options && typeof options === "object" ? options : {};
	const scope = settings.globalScope || (typeof window !== "undefined" ? window : null);
	const readSpecSuites = typeof settings.getSpecSuites === "function" ? settings.getSpecSuites : () => [];
	const readQaEntries = typeof settings.getQaEntries === "function" ? settings.getQaEntries : () => [];
	const readSceneIds =
		typeof settings.getSceneIds === "function" ? settings.getSceneIds : () => BASELINE_SCENE_IDS.slice();
	const readTextureUnits =
		typeof settings.getTextureUnits === "function"
			? settings.getTextureUnits
			: () => (typeof llQa.texUnitsTotal === "function" ? llQa.texUnitsTotal() : null);

	function entryName(entry) {
		if (typeof entry === "string") return entry;
		if (!entry || typeof entry !== "object") return "";
		return entry.name || entry.id || entry.suiteName || entry.qaId || "";
	}

	function listNames(reader) {
		const entries = reader();
		if (!Array.isArray(entries)) return [];
		return entries.map(entryName).filter(Boolean);
	}


	function coverage() {
		return summarizePhaseCoverage({ specSuites: readSpecSuites(), qaEntries: readQaEntries() });
	}

	function plan() {
		return buildBatteryPlan({
			suiteNames: listNames(readSpecSuites),
			sceneIds: readSceneIds(),
			tiers: BATTERY_TIER_ORDER.slice(),
			qaIds: listNames(readQaEntries),
		});
	}


	function evaluate(lanes) {
		const source = lanes && typeof lanes === "object" ? lanes : {};
		return evaluateBattery({
			specLane: source.specLane,
			qaLane: source.qaLane,
			identityLane: source.identityLane,
			perfLane: source.perfLane,
			phaseCoverage: source.phaseCoverage || coverage(),
			textureUnits: Number.isFinite(source.textureUnits) ? source.textureUnits : readTextureUnits(),
		});
	}

	function describe() {
		const currentPlan = plan();
		const currentCoverage = coverage();
		return {
			phaseId: BATTERY_PHASE_ID,
			qaId: BATTERY_QA_ID,
			phaseTotal: LOCAL_LIGHT_PHASE_TOTAL,
			tiers: currentPlan.tiers,
			sceneIds: currentPlan.sceneIds,
			sequential: currentPlan.sequential,
			totals: currentPlan.totals,
			steps: currentPlan.steps,
			coverage: currentCoverage,
			textureUnits: readTextureUnits(),
		};
	}

	const publishedPlan = plan();
	llQa.setPhase(BATTERY_PHASE_ID, {
		qa: BATTERY_QA_ID,
		phaseTotal: LOCAL_LIGHT_PHASE_TOTAL,
		plannedSteps: publishedPlan.totals.steps,
		plannedScenes: publishedPlan.sceneIds.length,
		plannedTiers: publishedPlan.tiers.length,
		sequential: publishedPlan.sequential,
		published: true,
	});

	if (scope) scope[PROOF_BATTERY_GLOBAL_NAME] = describe;

	return {
		phaseId: BATTERY_PHASE_ID,
		qaId: BATTERY_QA_ID,
		globalName: PROOF_BATTERY_GLOBAL_NAME,
		plan,
		coverage,
		evaluate,
		describe,
		status() {
			const currentCoverage = coverage();
			return {
				phaseId: BATTERY_PHASE_ID,
				steps: plan().totals.steps,
				coverageComplete: currentCoverage.complete === true,
				textureUnits: readTextureUnits(),
			};
		},
	};
}

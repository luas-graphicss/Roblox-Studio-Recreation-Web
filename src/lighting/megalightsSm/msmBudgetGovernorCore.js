import {
	TIER_MIN_HOLD_MS,
	TIER_PANIC_RATIO,
	TIER_REGRET_BASE_MS,
	TIER_REGRET_MAX_MS,
	TIER_REGRET_WINDOW_MS,
	TIER_UP_HOLD_MS,
	TIER_UP_RATIO,
} from "../shadowTierCore.js";
import { findForbiddenCostSignals, readMsmMeasuredCost } from "./msmBudgetLedgerReaderCore.js";
import {
	clampMsmSoldRungCount,
	msmLadderLength,
	nextMsmRungToBuyBack,
	nextMsmRungToSell,
} from "./msmLadderCore.js";
import { resolveMsmLadderSettings } from "./msmLadderSettingsCore.js";
import { getMsmTierPolicy, isEngineTier } from "./msmTierPolicy.js";

export const MSM_GOVERNOR_OWNER = "MSM-F31";


export const MSM_GOVERNOR_MIN_HOLD_MS = TIER_MIN_HOLD_MS;
export const MSM_GOVERNOR_BUY_BACK_HOLD_MS = TIER_UP_HOLD_MS;
export const MSM_GOVERNOR_PANIC_RATIO = TIER_PANIC_RATIO;
export const MSM_GOVERNOR_BUY_BACK_RATIO = TIER_UP_RATIO;
export const MSM_GOVERNOR_REGRET_WINDOW_MS = TIER_REGRET_WINDOW_MS;
export const MSM_GOVERNOR_REGRET_BASE_MS = TIER_REGRET_BASE_MS;
export const MSM_GOVERNOR_REGRET_MAX_MS = TIER_REGRET_MAX_MS;


export const MSM_GOVERNOR_MIN_LEDGER_SAMPLES = 2;

export const MSM_GOVERNOR_ACTION = Object.freeze({
	HOLD: "hold",
	SELL: "sell",
	BUY_BACK: "buy-back",
});

export const MSM_GOVERNOR_REASON = Object.freeze({
	PANIC: "panic",
	OVER_BUDGET: "over-budget",
	SUSTAINED_HEADROOM: "sustained-headroom",
	WITHIN_BUDGET: "within-budget",
	WAITING_MIN_HOLD: "waiting-min-hold",
	WAITING_HEADROOM: "waiting-headroom",
	WAITING_REGRET: "waiting-regret",
	LADDER_EXHAUSTED: "ladder-exhausted",
	LADDER_FULLY_BOUGHT: "ladder-fully-bought",
	NOT_ENOUGH_SAMPLES: "not-enough-samples",
	MISSING_MEASUREMENT: "missing-measurement",
	FORBIDDEN_SIGNAL: "forbidden-signal",
	IDLE_FROZEN: "idle-frozen",
	HELD_BY_CALLER: "held-by-caller",
	TIER_SLEEPS: "tier-sleeps",
	UNKNOWN_TIER: "unknown-tier",
	TIER_CHANGED: "tier-changed",
});

function readFiniteNumber(value, fallback) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function readTierText(value) {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function roundToMicroseconds(value) {
	return Math.round(readFiniteNumber(value, 0) * 1000) / 1000;
}


export function classifyMsmBudgetPressure(request) {
	const source = request && typeof request === "object" ? request : {};
	const measuredMs = Math.max(0, readFiniteNumber(source.measuredMs, 0));
	const targetMs = Math.max(0, readFiniteNumber(source.targetMs, 0));
	const panicRatio = Math.max(1, readFiniteNumber(source.panicRatio, MSM_GOVERNOR_PANIC_RATIO));
	const buyBackRatio = Math.min(Math.max(readFiniteNumber(source.buyBackRatio, MSM_GOVERNOR_BUY_BACK_RATIO), 0), 1);
	const panicMs = targetMs * panicRatio;
	const buyBackMs = targetMs * buyBackRatio;

	return Object.freeze({
		measuredMs: roundToMicroseconds(measuredMs),
		targetMs: roundToMicroseconds(targetMs),
		panicMs: roundToMicroseconds(panicMs),
		buyBackMs: roundToMicroseconds(buyBackMs),
		isPanic: targetMs > 0 && measuredMs >= panicMs,
		isOverBudget: targetMs > 0 && measuredMs > targetMs,
		hasHeadroom: targetMs > 0 && buyBackMs >= measuredMs,
	});
}


export function createMsmBudgetGovernor(options) {
	const settings = options && typeof options === "object" ? options : {};
	const minHoldMs = Math.max(0, readFiniteNumber(settings.minHoldMs, MSM_GOVERNOR_MIN_HOLD_MS));
	const buyBackHoldMs = Math.max(minHoldMs, readFiniteNumber(settings.buyBackHoldMs, MSM_GOVERNOR_BUY_BACK_HOLD_MS));
	const panicRatio = Math.max(1, readFiniteNumber(settings.panicRatio, MSM_GOVERNOR_PANIC_RATIO));
	const buyBackRatio = Math.min(Math.max(readFiniteNumber(settings.buyBackRatio, MSM_GOVERNOR_BUY_BACK_RATIO), 0), 1);
	const regretWindowMs = Math.max(0, readFiniteNumber(settings.regretWindowMs, MSM_GOVERNOR_REGRET_WINDOW_MS));
	const regretBaseMs = Math.max(0, readFiniteNumber(settings.regretBaseMs, MSM_GOVERNOR_REGRET_BASE_MS));
	const regretMaxMs = Math.max(regretBaseMs, readFiniteNumber(settings.regretMaxMs, MSM_GOVERNOR_REGRET_MAX_MS));
	const minLedgerSamples = Math.max(
		1,
		Math.floor(readFiniteNumber(settings.minLedgerSamples, MSM_GOVERNOR_MIN_LEDGER_SAMPLES)),
	);
	const extraPassIds = Array.isArray(settings.extraPassIds) ? settings.extraPassIds.slice() : [];

	let currentTier = readTierText(settings.tier);
	let soldRungCount = clampMsmSoldRungCount(settings.soldRungCount);
	let lastChangeMs = -Infinity;
	let headroomSinceMs = -Infinity;
	let lastBuyBackMs = -Infinity;
	let buyBackBlockedUntilMs = -Infinity;
	let regretCount = 0;
	let lastMeasuredMs = 0;

	const totals = {
		samples: 0,
		sells: 0,
		panicSells: 0,
		buyBacks: 0,
		regrets: 0,
		holds: 0,
		refusedSignalSamples: 0,
		missingMeasurementSamples: 0,
		idleSamples: 0,
		tierChanges: 0,
	};

	function currentSettings() {
		return resolveMsmLadderSettings({ tier: currentTier, soldRungCount });
	}

	function buildResult(fields) {
		const rung = fields.rung || null;
		return Object.freeze({
			owner: MSM_GOVERNOR_OWNER,
			action: fields.action,
			reason: fields.reason,
			changed: fields.action !== MSM_GOVERNOR_ACTION.HOLD,
			tier: currentTier,
			rungId: rung ? rung.id : "",
			rungLabel: rung ? rung.label : "",
			soldRungCount,
			measuredMs: roundToMicroseconds(fields.measuredMs),
			targetMs: roundToMicroseconds(fields.targetMs),
			panicMs: roundToMicroseconds(fields.panicMs),
			buyBackMs: roundToMicroseconds(fields.buyBackMs),
			forbiddenSignals: Object.freeze(fields.forbiddenSignals ? fields.forbiddenSignals.slice() : []),
			settings: currentSettings(),
		});
	}

	function hold(reason, fields) {
		totals.holds += 1;
		return buildResult({
			action: MSM_GOVERNOR_ACTION.HOLD,
			reason,
			rung: null,
			measuredMs: fields && fields.measuredMs,
			targetMs: fields && fields.targetMs,
			panicMs: fields && fields.panicMs,
			buyBackMs: fields && fields.buyBackMs,
			forbiddenSignals: fields && fields.forbiddenSignals,
		});
	}


	function learnFromRegret(nowMs) {
		if (lastBuyBackMs === -Infinity) return;
		if (nowMs - lastBuyBackMs > regretWindowMs) return;
		regretCount += 1;
		const waitMs = Math.min(regretBaseMs * Math.pow(2, regretCount - 1), regretMaxMs);
		buyBackBlockedUntilMs = nowMs + waitMs;
		lastBuyBackMs = -Infinity;
		totals.regrets += 1;
	}

	function sellOneRung(reason, nowMs, pressure) {
		const rung = nextMsmRungToSell(soldRungCount);
		if (!rung) return hold(MSM_GOVERNOR_REASON.LADDER_EXHAUSTED, pressure);
		learnFromRegret(nowMs);
		soldRungCount += 1;
		lastChangeMs = nowMs;
		headroomSinceMs = -Infinity;
		totals.sells += 1;
		if (reason === MSM_GOVERNOR_REASON.PANIC) totals.panicSells += 1;
		return buildResult({
			action: MSM_GOVERNOR_ACTION.SELL,
			reason,
			rung,
			measuredMs: pressure.measuredMs,
			targetMs: pressure.targetMs,
			panicMs: pressure.panicMs,
			buyBackMs: pressure.buyBackMs,
		});
	}

	function buyBackOneRung(nowMs, pressure) {
		const rung = nextMsmRungToBuyBack(soldRungCount);
		if (!rung) return hold(MSM_GOVERNOR_REASON.LADDER_FULLY_BOUGHT, pressure);
		soldRungCount -= 1;
		lastChangeMs = nowMs;
		lastBuyBackMs = nowMs;

		headroomSinceMs = -Infinity;
		totals.buyBacks += 1;
		return buildResult({
			action: MSM_GOVERNOR_ACTION.BUY_BACK,
			reason: MSM_GOVERNOR_REASON.SUSTAINED_HEADROOM,
			rung,
			measuredMs: pressure.measuredMs,
			targetMs: pressure.targetMs,
			panicMs: pressure.panicMs,
			buyBackMs: pressure.buyBackMs,
		});
	}


	function sample(input) {
		const request = input && typeof input === "object" ? input : {};
		totals.samples += 1;

		const forbiddenSignals = findForbiddenCostSignals(request);
		if (forbiddenSignals.length > 0) {
			totals.refusedSignalSamples += 1;
			headroomSinceMs = -Infinity;
			return hold(MSM_GOVERNOR_REASON.FORBIDDEN_SIGNAL, { forbiddenSignals });
		}

		const nowMs = readFiniteNumber(request.nowMs, 0);

		if (request.hold === true) {
			headroomSinceMs = -Infinity;
			return hold(MSM_GOVERNOR_REASON.HELD_BY_CALLER, null);
		}

		if (request.isIdle === true) {
			totals.idleSamples += 1;
			headroomSinceMs = -Infinity;
			return hold(MSM_GOVERNOR_REASON.IDLE_FROZEN, null);
		}

		const tier = readTierText(request.tier);
		const policy = getMsmTierPolicy(tier);
		if (!policy) {
			headroomSinceMs = -Infinity;
			return hold(isEngineTier(tier) ? MSM_GOVERNOR_REASON.TIER_SLEEPS : MSM_GOVERNOR_REASON.UNKNOWN_TIER, null);
		}

		if (!currentTier) currentTier = tier;
		if (tier !== currentTier) {


			currentTier = tier;
			totals.tierChanges += 1;
			lastChangeMs = nowMs;
			headroomSinceMs = -Infinity;
			return hold(MSM_GOVERNOR_REASON.TIER_CHANGED, null);
		}

		const cost = readMsmMeasuredCost({ ledger: request.ledger, extraPassIds });
		if (!cost.ok) {
			totals.missingMeasurementSamples += 1;
			headroomSinceMs = -Infinity;
			return hold(MSM_GOVERNOR_REASON.MISSING_MEASUREMENT, null);
		}

		lastMeasuredMs = cost.measuredMs;
		const pressure = classifyMsmBudgetPressure({
			measuredMs: cost.measuredMs,
			targetMs: policy.budgetMs,
			panicRatio,
			buyBackRatio,
		});

		if (minLedgerSamples > cost.sampleCount) {
			headroomSinceMs = -Infinity;
			return hold(MSM_GOVERNOR_REASON.NOT_ENOUGH_SAMPLES, pressure);
		}


		if (lastBuyBackMs !== -Infinity && nowMs - lastBuyBackMs > regretWindowMs) {
			lastBuyBackMs = -Infinity;
			regretCount = 0;
			buyBackBlockedUntilMs = -Infinity;
		}

		if (pressure.isPanic) return sellOneRung(MSM_GOVERNOR_REASON.PANIC, nowMs, pressure);

		if (pressure.isOverBudget) {
			headroomSinceMs = -Infinity;
			if (nowMs - lastChangeMs >= minHoldMs) return sellOneRung(MSM_GOVERNOR_REASON.OVER_BUDGET, nowMs, pressure);
			return hold(MSM_GOVERNOR_REASON.WAITING_MIN_HOLD, pressure);
		}

		if (pressure.hasHeadroom) {
			if (headroomSinceMs === -Infinity) headroomSinceMs = nowMs;
			if (soldRungCount === 0) return hold(MSM_GOVERNOR_REASON.LADDER_FULLY_BOUGHT, pressure);
			if (buyBackBlockedUntilMs > nowMs) return hold(MSM_GOVERNOR_REASON.WAITING_REGRET, pressure);
			const headroomHeldMs = nowMs - headroomSinceMs;
			const sinceLastChangeMs = nowMs - lastChangeMs;
			if (headroomHeldMs >= buyBackHoldMs && sinceLastChangeMs >= buyBackHoldMs) {
				return buyBackOneRung(nowMs, pressure);
			}
			return hold(MSM_GOVERNOR_REASON.WAITING_HEADROOM, pressure);
		}


		headroomSinceMs = -Infinity;
		return hold(MSM_GOVERNOR_REASON.WITHIN_BUDGET, pressure);
	}

	function getState() {
		return Object.freeze({
			owner: MSM_GOVERNOR_OWNER,
			tier: currentTier,
			soldRungCount,
			ladderLength: msmLadderLength(),
			measuredMs: roundToMicroseconds(lastMeasuredMs),
			regretCount,
			buyBackBlockedUntilMs,
			headroomSinceMs,
			lastChangeMs,
			settings: currentSettings(),
			totals: Object.freeze(Object.assign({}, totals)),
		});
	}


	function describe() {
		return Object.freeze({
			owner: MSM_GOVERNOR_OWNER,
			minHoldMs,
			buyBackHoldMs,
			panicRatio,
			buyBackRatio,
			regretWindowMs,
			regretBaseMs,
			regretMaxMs,
			minLedgerSamples,
			extraPassIds: Object.freeze(extraPassIds.slice()),
			ladderLength: msmLadderLength(),
		});
	}


	function reset(resetOptions) {
		const source = resetOptions && typeof resetOptions === "object" ? resetOptions : {};
		currentTier = source.tier === undefined ? currentTier : readTierText(source.tier);
		soldRungCount = clampMsmSoldRungCount(source.soldRungCount);
		lastChangeMs = -Infinity;
		headroomSinceMs = -Infinity;
		lastBuyBackMs = -Infinity;
		buyBackBlockedUntilMs = -Infinity;
		regretCount = 0;
		lastMeasuredMs = 0;
		return getState();
	}

	return { sample, getState, describe, reset };
}

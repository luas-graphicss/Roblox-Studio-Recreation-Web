import { MSM_PASS_IDS } from "./msmPipelineContract.js";

export const MSM_BUDGET_LEDGER_OWNER = "MSM-F31";


export const MSM_FORBIDDEN_COST_SIGNALS = Object.freeze([
	"fps",
	"instantFps",
	"currentFps",
	"frameRate",
	"dtMs",
	"deltaMs",
	"frameMs",
	"instantMs",
	"lastMs",
]);

export const MSM_LEDGER_REFUSAL = Object.freeze({
	NONE: "none",
	MISSING_LEDGER: "missing-ledger",
	FORBIDDEN_SIGNAL: "forbidden-signal",
});

function readPositiveMs(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function readSampleCount(value) {
	const parsed = Math.floor(Number(value));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundToMicroseconds(value) {
	return Math.round(readPositiveMs(value) * 1000) / 1000;
}

function readPassIdText(value) {
	return typeof value === "string" ? value.trim() : "";
}


export function findForbiddenCostSignals(source) {
	if (!source || typeof source !== "object") return [];
	return MSM_FORBIDDEN_COST_SIGNALS.filter((signalName) => {
		const value = source[signalName];
		return value !== undefined && value !== null;
	});
}


export function msmLedgerPassIds(extraPassIds) {
	const declared = Array.isArray(extraPassIds) ? extraPassIds : [];
	const passIds = MSM_PASS_IDS.slice();
	declared.forEach((candidate) => {
		const passId = readPassIdText(candidate);
		if (passId && passIds.indexOf(passId) === -1) passIds.push(passId);
	});
	return passIds;
}

function emptyPassRows(passIds) {
	return Object.freeze(
		passIds.map((passId) =>
			Object.freeze({ passId, emaMs: 0, sampleCount: 0, measured: false, estimated: false }),
		),
	);
}

function buildRefusal(refusal, forbiddenSignals, passIds) {
	return Object.freeze({
		owner: MSM_BUDGET_LEDGER_OWNER,
		ok: false,
		refusal,
		forbiddenSignals: Object.freeze(forbiddenSignals.slice()),
		measuredMs: 0,
		estimatedMs: 0,
		sampleCount: 0,
		measuredPassCount: 0,
		passes: emptyPassRows(passIds),
	});
}


export function readMsmMeasuredCost(request) {
	const source = request && typeof request === "object" ? request : {};
	const passIds = msmLedgerPassIds(source.extraPassIds);

	const forbiddenSignals = findForbiddenCostSignals(source);
	if (forbiddenSignals.length > 0) {
		return buildRefusal(MSM_LEDGER_REFUSAL.FORBIDDEN_SIGNAL, forbiddenSignals, passIds);
	}

	const ledger = source.ledger;
	const ledgerRows = ledger && typeof ledger === "object" && Array.isArray(ledger.passes) ? ledger.passes : null;
	if (!ledgerRows) return buildRefusal(MSM_LEDGER_REFUSAL.MISSING_LEDGER, [], passIds);

	const passes = passIds.map((passId) => {
		const row = ledgerRows.find((candidate) => candidate && candidate.id === passId) || null;
		return Object.freeze({
			passId,


			emaMs: row ? roundToMicroseconds(row.emaMs) : 0,
			sampleCount: row ? readSampleCount(row.samples) : 0,
			measured: !!row,
			estimated: !!(row && row.estimated),
		});
	});

	const measuredMs = passes.reduce((total, pass) => total + pass.emaMs, 0);
	const estimatedMs = passes.reduce((total, pass) => total + (pass.estimated ? pass.emaMs : 0), 0);
	const sampleCount = passes.reduce((most, pass) => (pass.sampleCount > most ? pass.sampleCount : most), 0);

	return Object.freeze({
		owner: MSM_BUDGET_LEDGER_OWNER,
		ok: true,
		refusal: MSM_LEDGER_REFUSAL.NONE,
		forbiddenSignals: Object.freeze([]),
		measuredMs: roundToMicroseconds(measuredMs),
		estimatedMs: roundToMicroseconds(estimatedMs),
		sampleCount,
		measuredPassCount: passes.filter((pass) => pass.measured).length,
		passes: Object.freeze(passes),
	});
}

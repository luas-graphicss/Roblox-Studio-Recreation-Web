import {
	SB_MAX_CLOSURES_PER_PIXEL,
	SB_TIER_NAMES,
	tierBytesPerPixel,
	tierDefaults,
} from "./sbMaterialContract.js"
import { bsdfClosureCost, bsdfKinds } from "./sbBsdfCatalog.js"
import { closureLayoutBytes } from "./sbClosureLayouts.js"

export const DISPATCH_PHASE_ID = "SB-F9"
export const FALLBACK_TIER_NAME = "forte"
export const DEFAULT_CLOSURE_KIND = "slab"
export const DEFAULT_CLOSURE_WEIGHT = 1


export const SB_DISPATCH_DROP_REASONS = {
	unknownKind: "unknownKind",
	zeroWeight: "zeroWeight",
	tierCeiling: "tierCeiling",
}


function knownClosureKindIds() {
	const declaredKinds = bsdfKinds()
	if (!Array.isArray(declaredKinds)) return []
	return declaredKinds
		.map((declaredKind) => {
			if (typeof declaredKind === "string") return declaredKind
			return declaredKind?.id ?? declaredKind?.kind ?? ""
		})
		.filter((kindId) => kindId !== "")
}

export function isKnownClosureKind(kind) {
	return knownClosureKindIds().includes(kind)
}


export function closureKindBytes(kind) {
	const declaredBytes = closureLayoutBytes(kind)
	return Number.isFinite(declaredBytes) ? declaredBytes : 0
}


export function closureKindCost(kind) {
	const declaredCost = bsdfClosureCost(kind)
	return Number.isFinite(declaredCost) ? declaredCost : 0
}

export function resolveTierName(tierName) {
	return SB_TIER_NAMES.includes(tierName) ? tierName : FALLBACK_TIER_NAME
}

function resolvedTierDefaults(tierName) {
	return tierDefaults(resolveTierName(tierName))
}


export function tierClosureCeiling(tierName) {
	const declaredCeiling = resolvedTierDefaults(tierName).closuresPerPixel
	if (!Number.isInteger(declaredCeiling) || 1 > declaredCeiling) return 1
	return Math.min(declaredCeiling, SB_MAX_CLOSURES_PER_PIXEL)
}


export function dispatchCeilingsByTier() {
	const ceilings = {}
	for (const tierName of SB_TIER_NAMES) ceilings[tierName] = tierClosureCeiling(tierName)
	return ceilings
}

function normalizeClosure(rawClosure, sourceIndex) {
	const kind = typeof rawClosure?.kind === "string" ? rawClosure.kind : ""
	const weight = Number.isFinite(rawClosure?.weight) ? rawClosure.weight : DEFAULT_CLOSURE_WEIGHT
	const layerIndex = Number.isInteger(rawClosure?.layerIndex) ? rawClosure.layerIndex : sourceIndex
	const label = typeof rawClosure?.label === "string" && rawClosure.label !== "" ? rawClosure.label : kind + "#" + sourceIndex
	return {
		kind,
		weight,
		layerIndex,
		sourceIndex,
		label,
		bytes: closureKindBytes(kind),
		closureCost: closureKindCost(kind),
	}
}

export function normalizeClosureList(rawClosures) {
	if (!Array.isArray(rawClosures)) return []
	return rawClosures.map(normalizeClosure)
}


export function createStubClosureList(input) {
	const requestedCount = Number.isInteger(input?.closureCount) ? input.closureCount : 1
	const closureCount = Math.max(1, requestedCount)
	const kind = typeof input?.kind === "string" ? input.kind : DEFAULT_CLOSURE_KIND
	const closures = []
	for (let layerIndex = 0; closureCount > layerIndex; layerIndex += 1) {
		closures.push({
			kind,
			weight: 1 / closureCount,
			layerIndex,
			label: "stub " + kind + " " + (layerIndex + 1) + "/" + closureCount,
		})
	}
	return closures
}

function dropClosure(closure, reason) {
	return { ...closure, dropReason: reason }
}


function compareBySelectionPriority(left, right) {
	if (left.weight !== right.weight) return right.weight - left.weight
	if (left.layerIndex !== right.layerIndex) return left.layerIndex - right.layerIndex
	return left.sourceIndex - right.sourceIndex
}


function compareByLayerOrder(left, right) {
	if (left.layerIndex !== right.layerIndex) return left.layerIndex - right.layerIndex
	return left.sourceIndex - right.sourceIndex
}

function sumOf(closures, pick) {
	return closures.reduce((total, closure) => total + pick(closure), 0)
}


export function compiledProgramKey(plan) {
	return DISPATCH_PHASE_ID + "|" + plan.tier + "|limit=" + plan.closureCeiling
}


export function dispatchSignature(plan) {
	const dispatchedParts = plan.dispatched.map((closure) => closure.kind + ":" + closure.weight)
	return plan.tier + "|" + plan.closureCeiling + "|" + dispatchedParts.join("+")
}







export function buildDispatchPlan(input) {
	const tier = resolveTierName(input?.tierName)
	const closureCeiling = tierClosureCeiling(tier)
	const byteCeiling = tierBytesPerPixel(tier)
	const normalizedClosures = normalizeClosureList(input?.closures)
	const problems = []
	const dropped = []
	const candidates = []

	for (const closure of normalizedClosures) {
		if (!isKnownClosureKind(closure.kind)) {
			dropped.push(dropClosure(closure, SB_DISPATCH_DROP_REASONS.unknownKind))
			problems.push("tipo de closure desconhecido: " + (closure.kind === "" ? "(vazio)" : closure.kind))
			continue
		}
		if (0 >= closure.weight) {
			dropped.push(dropClosure(closure, SB_DISPATCH_DROP_REASONS.zeroWeight))
			continue
		}
		candidates.push(closure)
	}

	const selectedClosures = [...candidates].sort(compareBySelectionPriority).slice(0, closureCeiling)
	for (const closure of candidates) {
		if (selectedClosures.includes(closure)) continue
		dropped.push(dropClosure(closure, SB_DISPATCH_DROP_REASONS.tierCeiling))
	}

	const dispatched = [...selectedClosures]
		.sort(compareByLayerOrder)
		.map((closure, slot) => ({ ...closure, slot }))

	const bytesPerPixel = sumOf(dispatched, (closure) => closure.bytes)
	const closureCostSum = sumOf(dispatched, (closure) => closure.closureCost)
	const weightSum = sumOf(dispatched, (closure) => closure.weight)
	const withinByteCeiling = byteCeiling >= bytesPerPixel
	if (!withinByteCeiling) {
		problems.push("bytes por pixel " + bytesPerPixel + " passaram do teto " + byteCeiling + " do tier " + tier)
	}
	if (dispatched.length > closureCeiling) {
		problems.push("despacho de " + dispatched.length + " closures passou do teto " + closureCeiling)
	}

	const plan = {
		phaseId: DISPATCH_PHASE_ID,
		tier,
		closeCeilingSource: "contrato",
		closureCeiling,
		requestedCount: normalizedClosures.length,
		dispatchedCount: dispatched.length,
		droppedCount: dropped.length,
		dispatched,
		dropped,
		bytesPerPixel,
		byteCeiling,
		withinByteCeiling,
		closureCostSum,
		weightSum,
		legacyEquivalent: dispatched.length === 1 && dispatched[0].weight === DEFAULT_CLOSURE_WEIGHT,
		problems,
	}
	plan.compiledProgramKey = compiledProgramKey(plan)
	plan.dispatchSignature = dispatchSignature(plan)
	return plan
}

export function isDispatchPlanAccepted(plan) {
	return Array.isArray(plan?.problems) && plan.problems.length === 0
}


export function describeDispatchPlan(plan) {
	return {
		phaseId: plan.phaseId,
		tier: plan.tier,
		closureCeiling: plan.closureCeiling,
		requestedCount: plan.requestedCount,
		dispatchedCount: plan.dispatchedCount,
		droppedCount: plan.droppedCount,
		dropReasons: plan.dropped.map((closure) => closure.dropReason),
		bytesPerPixel: plan.bytesPerPixel,
		byteCeiling: plan.byteCeiling,
		withinByteCeiling: plan.withinByteCeiling,
		weightSum: plan.weightSum,
		legacyEquivalent: plan.legacyEquivalent,
		compiledProgramKey: plan.compiledProgramKey,
		problems: plan.problems,
	}
}


export function buildDispatchPlansByTier(input) {
	return SB_TIER_NAMES.map((tierName) => buildDispatchPlan({ closures: input?.closures, tierName }))
}

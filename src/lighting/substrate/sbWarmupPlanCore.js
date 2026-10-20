import { SB_GATES } from "./sbMaterialContract.js"

export const WARMUP_PHASE_ID = "SB-F34"


export const SB_WARMUP_SPIKE_CEILING_MILLISECONDS = SB_GATES.maxWarmupSpikeMilliseconds

export const SB_WARMUP_REFUSAL_CODES = Object.freeze({
	unmeasuredCost: "unmeasuredCost",
	duplicatePermutation: "duplicatePermutation",
	unsplittablePermutation: "unsplittablePermutation",
	sliceOverCeiling: "sliceOverCeiling",
	emptyPermutationList: "emptyPermutationList",
	permutationLeftBehind: "permutationLeftBehind",
})


export const SB_WARMUP_GATE_PERMUTATIONS = Object.freeze([
	Object.freeze({ programKey: "physical:0001", materialFamily: "physical", milliseconds: 2 }),
	Object.freeze({ programKey: "physical:0002", materialFamily: "physical", milliseconds: 6 }),
	Object.freeze({ programKey: "skinned:0001", materialFamily: "skinned", milliseconds: 3 }),
	Object.freeze({ programKey: "standard:0001", materialFamily: "standard", milliseconds: 3 }),
	Object.freeze({ programKey: "standard:0002", materialFamily: "standard", milliseconds: 4 }),
	Object.freeze({ programKey: "standard:0003", materialFamily: "standard", milliseconds: 5 }),
	Object.freeze({ programKey: "terreno:0001", materialFamily: "terreno", milliseconds: 4 }),
])

const MISSING_PROGRAM_KEY_LABEL = "(sem programKey)"
const MISSING_MATERIAL_FAMILY_LABEL = "(sem familia)"

function createRefusal(code, message) {
	return { code, message }
}

function resolveSpikeCeiling(requestedCeilingMilliseconds) {
	if (Number.isFinite(requestedCeilingMilliseconds) && requestedCeilingMilliseconds > 0) {
		return requestedCeilingMilliseconds
	}
	return SB_WARMUP_SPIKE_CEILING_MILLISECONDS
}

function normalizePermutation(rawPermutation, sourceIndex) {
	const declaredProgramKey = typeof rawPermutation?.programKey === "string" ? rawPermutation.programKey : ""
	const declaredMilliseconds = Number(rawPermutation?.milliseconds)
	const hasMeasuredCost = Number.isFinite(declaredMilliseconds) && declaredMilliseconds >= 0
	return {
		programKey: declaredProgramKey === "" ? MISSING_PROGRAM_KEY_LABEL : declaredProgramKey,
		programKeyDeclared: declaredProgramKey !== "",
		materialFamily:
			typeof rawPermutation?.materialFamily === "string" ? rawPermutation.materialFamily : MISSING_MATERIAL_FAMILY_LABEL,
		milliseconds: hasMeasuredCost ? declaredMilliseconds : null,
		hasMeasuredCost,
		sourceIndex,
	}
}


function compareByProgramKey(left, right) {
	if (left.programKey !== right.programKey) return left.programKey > right.programKey ? 1 : -1
	return left.sourceIndex - right.sourceIndex
}

export function normalizeWarmupPermutations(rawPermutations) {
	if (!Array.isArray(rawPermutations)) return []
	return rawPermutations.map(normalizePermutation).sort(compareByProgramKey)
}

function findDuplicateProgramKeys(permutations) {
	const seenKeys = new Set()
	const duplicateKeys = new Set()
	for (const permutation of permutations) {
		if (!permutation.programKeyDeclared) continue
		if (seenKeys.has(permutation.programKey)) duplicateKeys.add(permutation.programKey)
		seenKeys.add(permutation.programKey)
	}
	return Array.from(duplicateKeys).sort()
}


function groupPermutationsIntoSlices(permutations, ceilingMilliseconds) {
	const groups = []
	let currentGroup = null
	let currentMilliseconds = 0

	for (const permutation of permutations) {
		const isAtomicOverCeiling = permutation.milliseconds > ceilingMilliseconds
		const startsNewSlice =
			currentGroup === null || isAtomicOverCeiling || currentMilliseconds + permutation.milliseconds > ceilingMilliseconds
		if (startsNewSlice) {
			currentGroup = []
			currentMilliseconds = 0
			groups.push(currentGroup)
		}
		currentGroup.push(permutation)
		currentMilliseconds += permutation.milliseconds
		if (isAtomicOverCeiling) {
			currentGroup = null
			currentMilliseconds = 0
		}
	}

	return groups
}

function sumMilliseconds(permutations) {
	return permutations.reduce((total, permutation) => total + permutation.milliseconds, 0)
}

function describeSlice(permutations, sliceIndex, ceilingMilliseconds) {
	const milliseconds = sumMilliseconds(permutations)
	return {
		index: sliceIndex,
		programKeys: permutations.map((permutation) => permutation.programKey),
		permutationCount: permutations.length,
		milliseconds,
		withinCeiling: ceilingMilliseconds >= milliseconds,
		unsplittable: permutations.length === 1 && permutations[0].milliseconds > ceilingMilliseconds,
	}
}


export function buildWarmupPlan(request = {}) {
	const ceilingMilliseconds = resolveSpikeCeiling(request.spikeCeilingMilliseconds)
	const permutations = normalizeWarmupPermutations(request.permutations)
	const measuredPermutations = permutations.filter((permutation) => permutation.hasMeasuredCost)
	const unmeasuredPermutations = permutations.filter((permutation) => !permutation.hasMeasuredCost)
	const refusals = []

	if (permutations.length === 0) {
		refusals.push(
			createRefusal(SB_WARMUP_REFUSAL_CODES.emptyPermutationList, "nenhuma permutacao para aquecer: plano vazio nao prova nada"),
		)
	}
	for (const permutation of unmeasuredPermutations) {
		refusals.push(
			createRefusal(
				SB_WARMUP_REFUSAL_CODES.unmeasuredCost,
				"permutacao sem custo de compilacao medido: " + permutation.programKey + " (custo estimado nao entra neste plano)",
			),
		)
	}
	for (const duplicateKey of findDuplicateProgramKeys(permutations)) {
		refusals.push(
			createRefusal(
				SB_WARMUP_REFUSAL_CODES.duplicatePermutation,
				"permutacao repetida: " + duplicateKey + " (compilar o mesmo programa duas vezes infla o warmup)",
			),
		)
	}

	const slices = groupPermutationsIntoSlices(measuredPermutations, ceilingMilliseconds).map((groupedPermutations, sliceIndex) =>
		describeSlice(groupedPermutations, sliceIndex, ceilingMilliseconds),
	)

	for (const slice of slices) {
		if (slice.unsplittable) {
			refusals.push(
				createRefusal(
					SB_WARMUP_REFUSAL_CODES.unsplittablePermutation,
					"a permutacao " + slice.programKeys[0] + " custa " + slice.milliseconds + " ms sozinha e o teto e " + ceilingMilliseconds + " ms: compilar um programa e atomico e este pico nao pode ser fatiado",
				),
			)
			continue
		}
		if (!slice.withinCeiling) {
			refusals.push(
				createRefusal(
					SB_WARMUP_REFUSAL_CODES.sliceOverCeiling,
					"fatia " + slice.index + " fechou em " + slice.milliseconds + " ms, acima do teto " + ceilingMilliseconds + " ms",
				),
			)
		}
	}

	const slicedProgramKeys = slices.flatMap((slice) => slice.programKeys)
	const coversEveryPermutation =
		slicedProgramKeys.length === measuredPermutations.length &&
		new Set(slicedProgramKeys).size === new Set(measuredPermutations.map((permutation) => permutation.programKey)).size
	if (!coversEveryPermutation) {
		refusals.push(
			createRefusal(
				SB_WARMUP_REFUSAL_CODES.permutationLeftBehind,
				"o fatiamento cobriu " + slicedProgramKeys.length + " de " + measuredPermutations.length + " permutacoes medidas",
			),
		)
	}

	const sliceMilliseconds = slices.map((slice) => slice.milliseconds)
	const worstSliceMilliseconds = sliceMilliseconds.length === 0 ? null : Math.max(...sliceMilliseconds)
	const measured = permutations.length > 0 && unmeasuredPermutations.length === 0

	return {
		phaseId: WARMUP_PHASE_ID,
		ceilingMilliseconds,
		measured,
		permutationCount: permutations.length,
		measuredCount: measuredPermutations.length,
		unmeasuredCount: unmeasuredPermutations.length,
		sliceCount: slices.length,
		slices,
		totalMilliseconds: sumMilliseconds(measuredPermutations),
		worstSliceMilliseconds,
		withinCeiling: slices.length > 0 && slices.every((slice) => slice.withinCeiling && !slice.unsplittable),
		coversEveryPermutation,
		refusals,
		refusalCodes: refusals.map((refusal) => refusal.code),
	}
}

function describeSliceObservation(observedSlices, plan) {
	const usable = observedSlices.every(
		(slice) => slice && Array.isArray(slice.programKeys) && Number.isFinite(Number(slice.milliseconds)) && slice.programKeys.length > 0,
	)
	if (!usable) {
		return {
			measured: false,
			sliceCount: observedSlices.length,
			worstSliceMilliseconds: null,
			totalMilliseconds: null,
			withinCeiling: false,
			matchesPlan: false,
			source: "slices",
			reason: "alguma fatia observada veio sem programKeys ou sem tempo utilizavel",
		}
	}
	const milliseconds = observedSlices.map((slice) => Number(slice.milliseconds))
	const observedKeys = observedSlices.flatMap((slice) => slice.programKeys)
	const observedKeySet = new Set(observedKeys)
	const plannedKeys = plan.slices.flatMap((slice) => slice.programKeys)
	const leftBehind = plannedKeys.filter((programKey) => !observedKeySet.has(programKey))
	const unplanned = observedKeys.filter((programKey) => !plannedKeys.includes(programKey))
	const repeated = observedKeys.length !== observedKeySet.size
	const worstSliceMilliseconds = Math.max(...milliseconds)
	return {
		measured: true,
		sliceCount: observedSlices.length,
		worstSliceMilliseconds,
		totalMilliseconds: milliseconds.reduce((total, value) => total + value, 0),
		withinCeiling: plan.ceilingMilliseconds >= worstSliceMilliseconds,
		matchesPlan: leftBehind.length === 0 && unplanned.length === 0 && !repeated,
		leftBehind,
		unplanned,
		repeated,
		source: "slices",
		reason: null,
	}
}

function describeObservation(observedSliceMilliseconds, plan, observedSlices) {
	if (Array.isArray(observedSlices) && observedSlices.length > 0) return describeSliceObservation(observedSlices, plan)
	if (!Array.isArray(observedSliceMilliseconds) || observedSliceMilliseconds.length === 0) {
		return {
			measured: false,
			sliceCount: 0,
			worstSliceMilliseconds: null,
			totalMilliseconds: null,
			withinCeiling: false,
			matchesPlan: false,
			reason:
				"pico de warmup NAO medido na bancada: passe observedSliceMilliseconds com o tempo real de cada fatia (ex.: __sbLab.stepCost por fatia)",
		}
	}
	const usableMilliseconds = observedSliceMilliseconds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
	if (usableMilliseconds.length !== observedSliceMilliseconds.length) {
		return {
			measured: false,
			sliceCount: usableMilliseconds.length,
			worstSliceMilliseconds: null,
			totalMilliseconds: null,
			withinCeiling: false,
			matchesPlan: false,
			reason: "alguma fatia observada nao trouxe numero utilizavel",
		}
	}
	const worstSliceMilliseconds = Math.max(...usableMilliseconds)
	return {
		measured: true,
		sliceCount: usableMilliseconds.length,
		worstSliceMilliseconds,
		totalMilliseconds: usableMilliseconds.reduce((total, value) => total + value, 0),
		withinCeiling: plan.ceilingMilliseconds >= worstSliceMilliseconds,
		matchesPlan: usableMilliseconds.length === plan.sliceCount,
		reason: null,
	}
}


export function evaluateWarmupGate(request = {}) {
	const plan = buildWarmupPlan({
		permutations: request.permutations ?? SB_WARMUP_GATE_PERMUTATIONS,
		spikeCeilingMilliseconds: request.spikeCeilingMilliseconds,
	})
	const observed = describeObservation(request.observedSliceMilliseconds, plan, request.observedSlices)
	const problems = []

	for (const refusal of plan.refusals) problems.push(refusal.message)
	if (!plan.measured) {
		problems.push("o plano de warmup nao esta inteiramente medido: " + plan.unmeasuredCount + " permutacao(oes) sem custo")
	}
	if (!observed.measured) {
		problems.push(observed.reason)
	} else {
		if (!observed.matchesPlan && observed.source === "slices") {
			if (observed.leftBehind.length > 0) problems.push("fatias observadas deixaram permutacao para tras: " + observed.leftBehind.join(", "))
			if (observed.unplanned.length > 0) problems.push("fatias observadas compilaram permutacao fora do plano: " + observed.unplanned.join(", "))
			if (observed.repeated) problems.push("fatias observadas compilaram a mesma permutacao duas vezes")
		} else if (!observed.matchesPlan) {
			problems.push(
				"foram observadas " + observed.sliceCount + " fatias e o plano tem " + plan.sliceCount + ": a medicao nao e deste plano",
			)
		}
		if (!observed.withinCeiling) {
			problems.push(
				"pior fatia medida em " + observed.worstSliceMilliseconds + " ms, acima do teto " + plan.ceilingMilliseconds + " ms",
			)
		}
	}

	return {
		phaseId: WARMUP_PHASE_ID,
		ok: problems.length === 0,
		gate: plan.ceilingMilliseconds,
		plan,
		observed,
		problems,
	}
}


export function describeWarmupPlan(request = {}) {
	const plan = buildWarmupPlan({
		permutations: request.permutations ?? SB_WARMUP_GATE_PERMUTATIONS,
		spikeCeilingMilliseconds: request.spikeCeilingMilliseconds,
	})
	return {
		phaseId: WARMUP_PHASE_ID,
		ceilingMilliseconds: plan.ceilingMilliseconds,
		permutationCount: plan.permutationCount,
		sliceCount: plan.sliceCount,
		totalMilliseconds: plan.totalMilliseconds,
		worstSliceMilliseconds: plan.worstSliceMilliseconds,
		withinCeiling: plan.withinCeiling,
		measured: plan.measured,
		slices: plan.slices,
		refusalCodes: plan.refusalCodes,
	}
}

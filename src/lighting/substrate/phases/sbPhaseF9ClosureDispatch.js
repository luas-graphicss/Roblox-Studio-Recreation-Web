import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_MAX_CLOSURES_PER_PIXEL, SB_TIER_NAMES, tierDefaults } from "../sbMaterialContract.js"
import {
	buildDispatchPlan,
	createStubClosureList,
	describeDispatchPlan,
	dispatchCeilingsByTier,
	tierClosureCeiling,
} from "../sbClosureDispatchCore.js"
import {
	accumulateDispatchPlan,
	evaluateLegacyClosurePath,
	isBitIdenticalRadiance,
	radianceDifference,
} from "../sbClosureAccumulationCore.js"
import {
	costPerClosureFromSamples,
	dispatchPlanCost,
	emptyCostMeasurement,
} from "../sbClosureCostModelCore.js"
import {
	SB_CLOSURE_COUNT_UNIFORM_NAME,
	buildClosureDispatchGlsl,
	closureDispatchGlslProblems,
} from "../sbClosureDispatchGlsl.js"

export const PHASE_ID = "SB-F9"
export const DISPATCH_FLAG_ID = "SubstrateClosureDispatch"
export const DISPATCH_PASS_NAME = "closureDispatchPrepare"
export const DECLARATIONS_PATCH_ID = "sbClosureDispatchDeclarations"
export const LOOP_PATCH_ID = "sbClosureDispatchLoop"
export const DECLARATIONS_ANCHOR_ID = "lightsPhysicalPars"
export const LOOP_ANCHOR_ID = "lightsFragmentEnd"
export const DISPATCH_MATERIAL_PATHS = ["standard", "physical"]
export const FALLBACK_TIER_NAME = "forte"


export const IDENTITY_PROBE_RADIANCE = {
	diffuse: [0.1 + 0.2, Math.SQRT1_2, 1 / 3],
	specular: [Math.PI / 180, 2 / 7, Math.sqrt(2) / 100],
}

const MEASURE_COST_HINT = "chame __sbLab.closureDispatch.measureCost({ measureMilliseconds: () => __sbLab.stepCost() })"


function dispatchFlagDefaultsByTier() {
	const defaultsByTier = {}
	for (const tierName of SB_TIER_NAMES) {
		defaultsByTier[tierName] = tierDefaults(tierName).substrateEnabled === true
	}
	return defaultsByTier
}

function substrateEnabledOnTier(tierName) {
	return tierDefaults(tierName).substrateEnabled === true
}


export function proveLegacyIdentity() {
	const plan = buildDispatchPlan({
		closures: createStubClosureList({ closureCount: 1 }),
		tierName: FALLBACK_TIER_NAME,
	})
	const evaluateClosure = () => IDENTITY_PROBE_RADIANCE
	const accumulated = accumulateDispatchPlan({ plan, evaluateClosure })
	const legacy = evaluateLegacyClosurePath({ closure: plan.dispatched[0], evaluateClosure })
	return {
		closureCount: plan.dispatchedCount,
		closureWeight: plan.dispatched[0]?.weight ?? null,
		difference: radianceDifference(accumulated, legacy),
		bitIdentical: isBitIdenticalRadiance(accumulated, legacy),
	}
}


export function evaluateClosureDispatchGate() {
	const problems = []
	const ceilingsByTier = dispatchCeilingsByTier()
	const overflowClosures = createStubClosureList({ closureCount: SB_MAX_CLOSURES_PER_PIXEL + 2 })

	const byTier = SB_TIER_NAMES.map((tierName) => {
		const plan = buildDispatchPlan({ closures: overflowClosures, tierName })
		const glsl = buildClosureDispatchGlsl({ closureCeiling: plan.closureCeiling })
		const glslProblems = closureDispatchGlslProblems(glsl)
		const substrateEnabled = substrateEnabledOnTier(tierName)

		if (plan.dispatchedCount !== ceilingsByTier[tierName]) {
			problems.push(tierName + ": despachou " + plan.dispatchedCount + " closures para um teto de " + ceilingsByTier[tierName])
		}
		if (plan.droppedCount !== overflowClosures.length - plan.dispatchedCount) {
			problems.push(tierName + ": closure cortada sem relatorio de corte")
		}
		if (substrateEnabled && !plan.withinByteCeiling) {
			problems.push(tierName + ": " + plan.bytesPerPixel + " bytes por pixel para um teto de " + plan.byteCeiling)
		}
		for (const glslProblem of glslProblems) problems.push(tierName + ": " + glslProblem)

		return {
			tier: tierName,
			substrateEnabled,
			closureCeiling: plan.closureCeiling,
			dispatchedCount: plan.dispatchedCount,
			droppedCount: plan.droppedCount,
			bytesPerPixel: plan.bytesPerPixel,
			byteCeiling: plan.byteCeiling,
			withinByteCeiling: plan.withinByteCeiling,
			compiledProgramKey: plan.compiledProgramKey,
			glslProblems,
		}
	})

	const legacyIdentity = proveLegacyIdentity()
	if (!legacyIdentity.bitIdentical) {
		problems.push("com 1 closure o laco nao devolveu o legado byte a byte: diferenca " + legacyIdentity.difference)
	}

	const fullPlan = buildDispatchPlan({
		closures: createStubClosureList({ closureCount: SB_MAX_CLOSURES_PER_PIXEL }),
		tierName: FALLBACK_TIER_NAME,
	})

	return {
		phaseId: PHASE_ID,
		ok: problems.length === 0,
		ceilingsByTier,
		byTier,
		legacyIdentity,
		declaredCost: dispatchPlanCost(fullPlan),
		problems,
	}
}

function closureListSignature(closures) {
	return closures.map((closure) => closure?.kind + ":" + closure?.weight).join("+")
}


export function installPhase(installContext) {
	try {
		const contract = installContext?.contract ?? null
		const flags = installContext?.flags ?? null
		const patch = installContext?.patch ?? null
		const passes = installContext?.passes ?? null
		const telemetry = installContext?.telemetry ?? null
		const bench = installContext?.bench ?? null

		const gate = evaluateClosureDispatchGate()
		const refusals = []

		let compiledClosureCeiling = null
		let requestedClosureCount = null
		let lastPlan = null
		let lastPlanKey = null
		let costMeasurement = emptyCostMeasurement("custo por closure ainda nao medido: " + MEASURE_COST_HINT)

		function currentTierName() {
			const tierName = bench?.tier?.()
			return SB_TIER_NAMES.includes(tierName) ? tierName : FALLBACK_TIER_NAME
		}

		flags?.registerFlag?.({
			id: DISPATCH_FLAG_ID,
			owner: PHASE_ID,
			description: "laco de closures do pixel com teto compilado por tier",
			defaultsByTier: dispatchFlagDefaultsByTier(),
		})

		patch?.registerUniform?.(SB_CLOSURE_COUNT_UNIFORM_NAME, { owner: PHASE_ID, value: 1 })

		const patchOrder = contract?.patchOrderFor?.(PHASE_ID, 0)
		const patchOrderAccepted = Number.isInteger(patchOrder)
		if (!patchOrderAccepted) {
			refusals.push("ordem de patch fora da faixa reservada para " + PHASE_ID)
		}


		function compileForCeiling(closureCeiling) {
			if (!patchOrderAccepted || typeof patch?.registerPatch !== "function") return false
			if (compiledClosureCeiling === closureCeiling) return true

			const glsl = buildClosureDispatchGlsl({ closureCeiling })
			const glslProblems = closureDispatchGlslProblems(glsl)
			if (glslProblems.length > 0) {
				refusals.push("GLSL recusado: " + glslProblems.join(" | "))
				return false
			}

			const sharedDefinition = {
				owner: PHASE_ID,
				order: patchOrder,
				flagId: DISPATCH_FLAG_ID,
				materialPaths: DISPATCH_MATERIAL_PATHS,
				uniforms: { [SB_CLOSURE_COUNT_UNIFORM_NAME]: SB_CLOSURE_COUNT_UNIFORM_NAME },
			}
			const declarationsRegistration = patch.registerPatch({
				...sharedDefinition,
				id: DECLARATIONS_PATCH_ID,
				anchor: DECLARATIONS_ANCHOR_ID,
				declarations: glsl.declarations,
				code: "",
			})
			const loopRegistration = patch.registerPatch({
				...sharedDefinition,
				id: LOOP_PATCH_ID,
				anchor: LOOP_ANCHOR_ID,
				declarations: "",
				code: glsl.code,
			})

			if (declarationsRegistration?.accepted !== true) {
				refusals.push("patch de declaracoes recusado: " + (declarationsRegistration?.reason ?? "motivo nao informado"))
			}
			if (loopRegistration?.accepted !== true) {
				refusals.push("patch do laco recusado: " + (loopRegistration?.reason ?? "motivo nao informado"))
			}
			if (declarationsRegistration?.accepted !== true || loopRegistration?.accepted !== true) return false

			const recompiled = compiledClosureCeiling !== null
			compiledClosureCeiling = closureCeiling
			if (recompiled) patch?.healMaterials?.()
			return true
		}

		function applyClosureCount(closureCount) {
			patch?.setUniform?.(SB_CLOSURE_COUNT_UNIFORM_NAME, closureCount)
			return closureCount
		}


		function requestedClosuresFor(tierName, passContext) {
			const publishedClosures = passContext?.substrateClosures ?? passContext?.substrateTopology?.closures ?? passContext?.materialTopology?.closures
			const hasPublishedClosures = Array.isArray(publishedClosures) && publishedClosures.length > 0
			if (!Number.isInteger(requestedClosureCount)) {
				if (hasPublishedClosures) return publishedClosures
				return createStubClosureList({ closureCount: tierClosureCeiling(tierName) })
			}
			if (hasPublishedClosures) return publishedClosures.slice(0, requestedClosureCount)
			return createStubClosureList({ closureCount: requestedClosureCount })
		}


		function refreshPlan(passContext) {
			const tierName = passContext?.tier ?? currentTierName()
			const requestedClosures = requestedClosuresFor(tierName, passContext)
			const planKey = tierName + "|" + closureListSignature(requestedClosures)
			if (planKey === lastPlanKey && lastPlan !== null) return lastPlan

			const plan = buildDispatchPlan({ closures: requestedClosures, tierName })
			compileForCeiling(plan.closureCeiling)
			applyClosureCount(plan.dispatchedCount)
			telemetry?.closures?.(describeDispatchPlan(plan))
			lastPlan = plan
			lastPlanKey = planKey
			return plan
		}

		const passRegistration = passes?.registerPass?.(DISPATCH_PASS_NAME, {
			owner: PHASE_ID,
			execute(passContext) {
				const plan = refreshPlan(passContext)
				if (passContext && typeof passContext === "object") passContext.closureDispatch = plan
				return passContext
			},
		})
		if (passRegistration?.accepted === false) {
			refusals.push("passe recusado: " + (passRegistration?.reason ?? "motivo nao informado"))
		}


		telemetry?.closureBytes?.(PHASE_ID, 0)

		const installTierName = currentTierName()
		compileForCeiling(tierClosureCeiling(installTierName))
		const installPlan = buildDispatchPlan({
			closures: createStubClosureList({ closureCount: tierClosureCeiling(installTierName) }),
			tierName: installTierName,
		})
		applyClosureCount(installPlan.dispatchedCount)
		telemetry?.closures?.(describeDispatchPlan(installPlan))
		lastPlan = installPlan
		lastPlanKey = installTierName + "|" + closureListSignature(createStubClosureList({ closureCount: installPlan.dispatchedCount }))


		function measureCost(input) {
			const measureMilliseconds = input?.measureMilliseconds
			if (typeof measureMilliseconds !== "function") {
				costMeasurement = emptyCostMeasurement("sem medicao real: " + MEASURE_COST_HINT)
				return costMeasurement
			}
			const closureCeiling = compiledClosureCeiling ?? tierClosureCeiling(currentTierName())
			const previousRequest = requestedClosureCount
			const samples = []
			for (let closureCount = 1; closureCeiling >= closureCount; closureCount += 1) {
				requestedClosureCount = closureCount
				lastPlanKey = null
				applyClosureCount(closureCount)
				samples.push({ closureCount, milliseconds: Number(measureMilliseconds(closureCount)) })
			}
			requestedClosureCount = previousRequest
			lastPlanKey = null
			costMeasurement = costPerClosureFromSamples(samples)
			return costMeasurement
		}

		function setClosureCount(closureCount) {
			requestedClosureCount = Number.isInteger(closureCount) ? closureCount : null
			lastPlanKey = null
			const tierName = currentTierName()
			const plan = buildDispatchPlan({ closures: requestedClosuresFor(tierName, null), tierName })
			applyClosureCount(plan.dispatchedCount)
			lastPlan = plan
			return describeDispatchPlan(plan)
		}

		const consoleApi = {
			plan: () => describeDispatchPlan(lastPlan ?? installPlan),
			ceilings: () => dispatchCeilingsByTier(),
			compiledCeiling: () => compiledClosureCeiling,
			setClosureCount,
			gate: () => evaluateClosureDispatchGate(),
			cost: () => ({ declared: dispatchPlanCost(lastPlan ?? installPlan), measured: costMeasurement }),
			measureCost,
			glsl: () => buildClosureDispatchGlsl({ closureCeiling: compiledClosureCeiling ?? 1 }),
			refusals: () => [...refusals],
		}
		const consolePublished = publishConsoleApi(consoleApi)

		const ceilings = dispatchCeilingsByTier()
		const summaryParts = [
			PHASE_ID + " instalado",
			"tetos por tier " + SB_TIER_NAMES.map((tierName) => tierName + "=" + ceilings[tierName]).join(" "),
			"teto compilado " + (compiledClosureCeiling ?? "nenhum") + " no tier " + installTierName,
			"1 closure = legado byte a byte (diferenca " + gate.legacyIdentity.difference + ")",
			installPlan.bytesPerPixel + " de " + installPlan.byteCeiling + " bytes por pixel",
			"passe " + DISPATCH_PASS_NAME + (passRegistration?.accepted === false ? " recusado" : " registrado"),
			"custo por closure " + (costMeasurement.measured ? costMeasurement.perClosureMilliseconds + " ms" : "nao medido"),
			"console " + (consolePublished ? "publicado em __sbLab.closureDispatch" : "nao publicado"),
		]
		if (!gate.ok) summaryParts.push("portao com problemas: " + gate.problems.join(" | "))
		if (refusals.length > 0) summaryParts.push("recusas: " + refusals.join(" | "))

		return {
			summary: summaryParts.join("; "),
			gateOk: gate.ok,
			ceilings,
			compiledClosureCeiling,
			dispatchedCount: installPlan.dispatchedCount,
			bytesPerPixel: installPlan.bytesPerPixel,
			legacyIdentity: gate.legacyIdentity,
			refusals,
		}
	} catch (error) {
		return { summary: PHASE_ID + " nao instalou: " + (error?.message ?? String(error)) }
	}
}


function publishConsoleApi(consoleApi) {
	if (typeof window === "undefined") return false
	const lab = getSubstrateHostSurface()
	if (!lab || typeof lab !== "object") return false
	lab.closureDispatch = consoleApi
	return true
}

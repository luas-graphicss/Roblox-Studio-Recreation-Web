import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import {
	describeDualSpecularLobe,
	findDualSpecularLobeContractProblems,
	normalizeDualSpecularLobe,
	secondLobeUniformValue,
} from "../sbDualSpecularLobeCore.js"
import {
	certifyDualSpecularLobeEnergy,
	certifyDualSpecularLobeMixture,
	measureFullWeightParity,
	measureZeroWeightParity,
} from "../sbDualSpecularLobeEnergyCore.js"
import {
	SB_DUAL_SPECULAR_LOBE_ANCHORS,
	SB_DUAL_SPECULAR_LOBE_DECLARATIONS,
	SB_DUAL_SPECULAR_LOBE_INDIRECT_CODE,
	SB_SECOND_LOBE_UNIFORM_NAME,
} from "../sbDualSpecularLobeGlsl.js"

export const PHASE_ID = "SB-F12"

const DUAL_SPECULAR_LOBE_FLAG = Object.freeze({
	id: "SubstrateDualSpecularLobe",
	owner: PHASE_ID,
	description: "segundo lobo especular: mistura convexa de dois GGX (haziness)",
	defaultsByTier: Object.freeze({ fraco: false, medio: true, forte: true }),
})


const PATCH_MATERIAL_PATHS = Object.freeze(["standard", "physical", "terreno", "skinned"])
const REFUSED_MATERIAL_PATHS = Object.freeze(["poolPhong"])


const INSTALL_SAMPLE_COUNT = 512

const TEXTURE_UNITS_USED = 0


const CLOSURE_BYTES_USED = 0

function patchDefinitionsFor(patchOrder) {
	return [
		{
			id: "sbF12DualSpecularLobeFunctions",
			anchor: SB_DUAL_SPECULAR_LOBE_ANCHORS.functions,
			order: patchOrder,
			code: SB_DUAL_SPECULAR_LOBE_DECLARATIONS,
		},
		{
			id: "sbF12DualSpecularLobeIndirect",
			anchor: SB_DUAL_SPECULAR_LOBE_ANCHORS.indirect,
			order: patchOrder,
			code: SB_DUAL_SPECULAR_LOBE_INDIRECT_CODE,
		},
	]
}

function registerDualSpecularLobePatches(patch, patchOrder, problems) {
	const acceptedPatchIds = []
	for (const definition of patchDefinitionsFor(patchOrder)) {
		const registration = patch?.registerPatch?.({
			...definition,
			owner: PHASE_ID,
			flagId: DUAL_SPECULAR_LOBE_FLAG.id,
			materialPaths: [...PATCH_MATERIAL_PATHS],
			uniforms: { [SB_SECOND_LOBE_UNIFORM_NAME]: SB_SECOND_LOBE_UNIFORM_NAME },
		})
		if (registration?.accepted === true) {
			acceptedPatchIds.push(definition.id)
			continue
		}
		problems.push(`patch ${definition.id} recusado: ${registration?.reason ?? "harness sem registerPatch"}`)
	}
	return acceptedPatchIds
}


function createDualSpecularLobeConsole(patch, gates) {
	let lobes = normalizeDualSpecularLobe({})

	function read() {
		const described = describeDualSpecularLobe(lobes)
		return {
			uniformName: SB_SECOND_LOBE_UNIFORM_NAME,
			uniformValue: described.uniformValue,
			secondRoughness: described.secondRoughness,
			secondWeight: described.secondWeight,
			baseWeight: described.baseWeight,
			isActive: described.isActive,
			baseRoughnessSource: "material.roughness",
		}
	}

	function set(secondRoughness, secondWeight) {
		lobes = normalizeDualSpecularLobe({ secondRoughness, secondRoughnessWeight: secondWeight })
		patch?.setUniform?.(SB_SECOND_LOBE_UNIFORM_NAME, secondLobeUniformValue(lobes))
		return read()
	}

	return {
		read,
		set,
		off: () => set(lobes.secondRoughness, 0),
		certify: (sampleCount) => certifyDualSpecularLobeMixture({ sampleCount, gates }),
		energy: (sampleCount) => certifyDualSpecularLobeEnergy({ sampleCount, gates }),
		zeroWeightParity: () => measureZeroWeightParity(),
		fullWeightParity: () => measureFullWeightParity(),
		glsl: () => ({
			declarations: SB_DUAL_SPECULAR_LOBE_DECLARATIONS,
			indirect: SB_DUAL_SPECULAR_LOBE_INDIRECT_CODE,
		}),
	}
}

function publishConsole(consoleApi) {
	if (typeof window === "undefined") return false
	const lab = getSubstrateHostSurface()
	if (!lab) return false
	lab.dualSpecularLobe = consoleApi
	return true
}

export function installPhase(context) {
	const problems = []
	const contract = context?.contract ?? null
	const patch = context?.patch ?? null
	const telemetry = context?.telemetry ?? null
	const gates = contract?.SB_GATES

	try {
		context?.flags?.registerFlag?.(DUAL_SPECULAR_LOBE_FLAG)
	} catch (error) {
		problems.push(`flag nao registrada: ${error?.message ?? error}`)
	}

	for (const problem of findDualSpecularLobeContractProblems(contract?.SB_SLAB_PARAMETER_NAMES)) {
		problems.push(problem)
	}

	const reservedUniform = contract?.SB_UNIFORM_NAMES?.[SB_SECOND_LOBE_UNIFORM_NAME] ?? null
	if (reservedUniform === null) {
		problems.push(`o contrato nao reserva o uniform ${SB_SECOND_LOBE_UNIFORM_NAME}`)
	} else if (reservedUniform.owner !== PHASE_ID) {
		problems.push(`o uniform ${SB_SECOND_LOBE_UNIFORM_NAME} pertence a ${reservedUniform.owner}`)
	}

	const initialLobes = normalizeDualSpecularLobe({})
	const uniformEntry = patch?.registerUniform?.(SB_SECOND_LOBE_UNIFORM_NAME, {
		owner: PHASE_ID,
		value: secondLobeUniformValue(initialLobes),
	})
	if (uniformEntry && uniformEntry.owner !== PHASE_ID) {
		problems.push(`o uniform ${SB_SECOND_LOBE_UNIFORM_NAME} ja estava registrado por ${uniformEntry.owner}`)
	}


	const patchOrder = contract?.patchOrderFor?.(PHASE_ID) ?? null
	let acceptedPatchIds = []
	if (typeof patchOrder === "number") {
		acceptedPatchIds = registerDualSpecularLobePatches(patch, patchOrder, problems)
	} else {
		problems.push(`o contrato nao deu ordem de patch para ${PHASE_ID}`)
	}

	let certification = null
	try {
		certification = certifyDualSpecularLobeMixture({ sampleCount: INSTALL_SAMPLE_COUNT, gates })
		for (const problem of certification.problems) problems.push(problem)
	} catch (error) {
		problems.push(`certificacao da mistura falhou: ${error?.message ?? error}`)
	}

	telemetry?.closureBytes?.(PHASE_ID, CLOSURE_BYTES_USED)
	telemetry?.textureUnit?.(PHASE_ID, TEXTURE_UNITS_USED)
	for (const problem of problems) telemetry?.error?.(PHASE_ID, problem)

	const consolePublished = publishConsole(createDualSpecularLobeConsole(patch, gates))


	const headline =
		problems.length === 0
			? `${PHASE_ID} segundo lobo especular no ar`
			: `${PHASE_ID} segundo lobo especular com ${problems.length} problema(s)`
	const measurements = [
		`patches aceitos ${acceptedPatchIds.length}/2`,
		`ordem ${patchOrder ?? "ausente"} (contrato)`,
		`peso 0 identico em ${certification?.zeroWeightParity?.comparisonCount ?? 0} pares`,
		`peso 1 identico em ${certification?.fullWeightParity?.comparisonCount ?? 0} pares`,
		`linearidade pior caso ${certification?.worstLinearityDeviation ?? "nao medida"}`,
		`${CLOSURE_BYTES_USED} B de closure, ${TEXTURE_UNITS_USED} unidade de textura`,
	]

	return {
		summary: `${headline} (${measurements.join(", ")})`,
		phaseId: PHASE_ID,
		flagId: DUAL_SPECULAR_LOBE_FLAG.id,
		patchOrder,
		acceptedPatchIds,
		refusedMaterialPaths: [...REFUSED_MATERIAL_PATHS],
		certification,
		consolePublished,
		problems,
	}
}

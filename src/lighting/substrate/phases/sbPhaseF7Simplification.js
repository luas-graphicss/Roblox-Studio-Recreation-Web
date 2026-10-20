import { describeParameterBlending } from "../sbParameterBlendingCore.js"
import { describeSimplification } from "../sbSimplificationPolicyCore.js"

export const PHASE_ID = "SB-F7"


const SIMPLIFICATION_FLAG = Object.freeze({
	id: "SubstrateSimplification",
	owner: PHASE_ID,
	description: "funde closures irmas por peso de cobertura e energia para caber no teto do tier",
	defaultsByTier: Object.freeze({ fraco: false, medio: true, forte: true }),
})

const TEXTURE_UNITS_USED = 0
const CLOSURE_BYTES_ADDED = 0

export function installPhase(installContext = {}) {
	const { flags, telemetry } = installContext
	const blending = describeParameterBlending()
	const simplification = describeSimplification()
	try {
		flags?.registerFlag?.(SIMPLIFICATION_FLAG)
		telemetry?.closureBytes?.(PHASE_ID, CLOSURE_BYTES_ADDED)
		telemetry?.textureUnit?.(PHASE_ID, TEXTURE_UNITS_USED)
		simplification.problems.forEach((problem) => telemetry?.error?.(PHASE_ID, problem))
	} catch (installError) {
		telemetry?.error?.(PHASE_ID, `falha ao instalar: ${installError && installError.message}`)
	}
	return {
		summary: {
			phaseId: PHASE_ID,
			flagId: SIMPLIFICATION_FLAG.id,
			closureBytesAdded: CLOSURE_BYTES_ADDED,
			textureUnitsUsed: TEXTURE_UNITS_USED,
			blendModes: blending.modes,
			energyParameters: blending.energyParameters,
			parameterCount: blending.parameterCount,
			budgets: simplification.budgets,
			byTier: simplification.byTier,
			problems: simplification.problems,
		},
	}
}

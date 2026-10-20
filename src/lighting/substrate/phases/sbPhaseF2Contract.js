import {
	SB_CONTRACT_VERSION,
	SB_TEXTURE_UNIT_CEILING,
	contractSelfCheck,
	contractFreezeReport,
	totalReservedTextureUnits,
	textureUnitHeadroom,
	slabClosureBytes,
	describeContract,
} from "../sbMaterialContract.js"

export const PHASE_ID = "SB-F2"

export function installPhase(installContext) {
	const { telemetry } = installContext
	const selfCheck = contractSelfCheck()
	const freezeReport = contractFreezeReport()

	telemetry.contractVersion(SB_CONTRACT_VERSION)
	telemetry.textureUnit(PHASE_ID, 0)
	telemetry.closureBytes(PHASE_ID, 0)

	for (const problem of selfCheck.problems) {
		telemetry.error(PHASE_ID, problem)
	}
	for (const structureName of freezeReport.unfrozenStructures) {
		telemetry.error(PHASE_ID, "estrutura do contrato nao congelada: " + structureName)
	}

	if (!selfCheck.ok) {
		return {
			summary:
				"contrato REPROVADO na auto-checagem: " +
				selfCheck.problems.length +
				" problema(s) -- " +
				selfCheck.problems.join(" | "),
		}
	}

	if (!freezeReport.frozen) {
		return {
			summary: "contrato coerente, porem NAO congelado: " + freezeReport.unfrozenStructures.join(", "),
		}
	}

	const description = describeContract()
	return {
		summary:
			"contrato v" +
			SB_CONTRACT_VERSION +
			" congelado (" +
			freezeReport.structureCount +
			" estruturas): " +
			totalReservedTextureUnits() +
			"/" +
			SB_TEXTURE_UNIT_CEILING +
			" unidades de textura (folga " +
			textureUnitHeadroom() +
			"), slab de " +
			slabClosureBytes() +
			" bytes, " +
			Object.keys(description.patchOrder).length +
			" ordens de patch, " +
			Object.keys(description.passOwners).length +
			" passes com dono. Sem flag, sem patch e sem passe: a fase nao tem runtime.",
	}
}

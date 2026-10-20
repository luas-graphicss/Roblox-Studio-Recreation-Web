import { SB_BRANCH_SELECTOR_MACRO, SB_RENDER_BRANCH_IDS } from "./sbFutureIntegrationCore.js"

export const SB_FUTURE_INTEGRATION_MACRO = "SB_FUTURE_INTEGRATION"
export const SB_INDIVIDUAL_PIECE_MACRO = "SB_RENDER_BRANCH_INDIVIDUAL_PIECE"
export const SB_INSTANCED_POOL_MACRO = "SB_RENDER_BRANCH_INSTANCED_POOL"

export const SB_FUTURE_INTEGRATION_MACRO_NAMES = Object.freeze([
	SB_FUTURE_INTEGRATION_MACRO,
	SB_INDIVIDUAL_PIECE_MACRO,
	SB_INSTANCED_POOL_MACRO,
	SB_BRANCH_SELECTOR_MACRO,
])


export function branchMacroIndex(branchId) {
	return SB_RENDER_BRANCH_IDS.indexOf(branchId)
}

function sharedDeclarationLines() {
	return [
		"// SB-F33: identidade da ramificacao que compilou este shader.",
		"// Somente defines: zero uniform, zero textura, zero pixel de efeito.",
		"#define " + SB_FUTURE_INTEGRATION_MACRO + " 1",
		"#define " + SB_INDIVIDUAL_PIECE_MACRO + " " + branchMacroIndex("individualPiece"),
		"#define " + SB_INSTANCED_POOL_MACRO + " " + branchMacroIndex("instancedPool"),
	]
}

export function futureIntegrationDeclarationsFor(branchId) {
	const branchIndex = branchMacroIndex(branchId)
	if (0 > branchIndex) return ""
	return [...sharedDeclarationLines(), "#define " + SB_BRANCH_SELECTOR_MACRO + " " + branchIndex].join("\n")
}

export const SB_FUTURE_INTEGRATION_DECLARATIONS_BY_BRANCH = Object.freeze(
	Object.fromEntries(SB_RENDER_BRANCH_IDS.map((branchId) => [branchId, futureIntegrationDeclarationsFor(branchId)])),
)


export const SB_FUTURE_INTEGRATION_CODE = ""


export function futureIntegrationGlslProblems() {
	const problems = []

	for (const [branchId, declarations] of Object.entries(SB_FUTURE_INTEGRATION_DECLARATIONS_BY_BRANCH)) {
		if (declarations.includes("#include")) {
			problems.push("a ramificacao " + branchId + " inclui chunk do three")
		}
		if (declarations.includes("uniform ")) {
			problems.push("a ramificacao " + branchId + " declara uniform, e a SB-F33 nao reserva nenhum")
		}
		for (const macroName of SB_FUTURE_INTEGRATION_MACRO_NAMES) {
			if (!declarations.includes("#define " + macroName + " ")) {
				problems.push("a ramificacao " + branchId + " nao define " + macroName)
			}
		}
	}

	if (SB_FUTURE_INTEGRATION_CODE.length > 0) {
		problems.push("a SB-F33 nao deveria escrever dentro do main")
	}

	return problems
}

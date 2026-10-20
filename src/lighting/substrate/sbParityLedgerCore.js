import { phaseIds } from "./sbPhaseManifest.js"
import { SB_GATES } from "./sbMaterialContract.js"
import { referenceSource } from "./sbReferenceSourcesCore.js"


export const EXPECTED_PARITY_LINE_TOTAL = 44

export const LEDGER_LINE_STATES = { open: "open", closed: "closed" }


const EVERY_PHASE_ID = phaseIds()

export const SB_PARITY_LEDGER_LINES = [
	{
		id: 1,
		term: "Framework de material",
		unrealReference: "arvore de BSDFs",
		engineToday: "4 lobos por uniform",
		phases: ["SB-F3", "SB-F6"],
		gate: "arvore de 3 niveis compila, renderiza e serializa ida-e-volta sem perda",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 2,
		term: "Slab BSDF",
		unrealReference: "cerca de 18 parametros",
		engineToday: "7 parametros",
		phases: ["SB-F4"],
		gate: "os 18 parametros existem, com faixa e default provados",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 3,
		term: "Vertical layering",
		unrealReference: "coverage e thickness alimentando Beer-Lambert",
		engineToday: "nao existe",
		phases: ["SB-F18"],
		gate: "transmitancia bate com espelho JS, erro ≤ 1e-3",
		contractGates: ["maxTransmittanceAbsoluteError"],
		sources: ["unrealSubstrateDocs", "unrealSubstrateTalks"],
	},
	{
		id: 4,
		term: "Horizontal mixing",
		unrealReference: "peso e mascara",
		engineToday: "nao existe",
		phases: ["SB-F20"],
		gate: "energia da mistura dentro de 1% da soma ponderada",
		contractGates: [],
		sources: ["unrealSubstrateDocs"],
	},
	{
		id: 5,
		term: "Add e Weight",
		unrealReference: "operadores de composicao",
		engineToday: "nao existe",
		phases: ["SB-F20"],
		gate: "associatividade provada em 3 niveis",
		contractGates: [],
		sources: ["unrealSubstrateDocs"],
	},
	{
		id: 6,
		term: "Closures por pixel",
		unrealReference: "configuravel por escalabilidade",
		engineToday: "1 shading model",
		phases: ["SB-F9", "SB-F34"],
		gate: "1, 2 e 3 closures respeitadas por tier, com contador por pixel",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 7,
		term: "Bytes por pixel",
		unrealReference: "80 por padrao",
		engineToday: "uniforms por material",
		phases: ["SB-F8"],
		gate: "registro ≤ 64 B por closure e erro de quantizacao ≤ 1/255 por canal",
		contractGates: ["maxQuantizationErrorPerChannel"],
		sources: ["unrealSubstrateDocs", "unrealSubstrateTalks"],
	},
	{
		id: 8,
		term: "Simplificacao",
		unrealReference: "parameter blending",
		engineToday: "nao existe",
		phases: ["SB-F7"],
		gate: "topologia acima do teto reduz sem estourar, com deltaE76 ≤ 2",
		contractGates: ["maxSimplificationDeltaE76"],
		sources: ["unrealSubstrateDocs", "unrealSubstrateTalks"],
	},
	{
		id: 9,
		term: "Rough refraction opaca",
		unrealReference: "camada de baixo desfocada pela de cima",
		engineToday: "nao existe",
		phases: ["SB-F19"],
		gate: "o desfoque cresce monotonicamente com a rugosidade da camada de cima",
		contractGates: [],
		sources: ["unrealSubstrateDocs"],
	},
	{
		id: 10,
		term: "Coat",
		unrealReference: "camada que absorve o que vem de baixo",
		engineToday: "lobo GGX somado por uniform",
		phases: ["SB-F13", "SB-F18"],
		gate: "escurecimento sob verniz colorido medido, no minimo 5% em thickness 1",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 11,
		term: "Anisotropia",
		unrealReference: "frame tangente por tangent map",
		engineToday: "tangente derivada do up do mundo",
		phases: ["SB-F11"],
		gate: "o highlight nao gira com a orbita da camera: SSIM ≥ 0,999 entre 2 poses",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 12,
		term: "Segundo lobo especular",
		unrealReference: "second roughness com haziness",
		engineToday: "nao existe",
		phases: ["SB-F12"],
		gate: "dois lobos com peso e energia total dentro de 2%",
		contractGates: [],
		sources: ["unrealSubstrateDocs"],
	},
	{
		id: 13,
		term: "Fuzz e sheen",
		unrealReference: "LTC com qualidade por escalabilidade",
		engineToday: "sheen por uniform",
		phases: ["SB-F13"],
		gate: "energia dentro de 3% do integrador de referencia, em 2 niveis de qualidade",
		contractGates: [],
		sources: ["zeltnerSheen2022", "heitzLtc2016", "engineAudit"],
	},
	{
		id: 14,
		term: "Thin film",
		unrealReference: "interferencia de Airy por espessura em nm e IOR",
		engineToday: "nao existe",
		phases: ["SB-F14"],
		gate: "deltaE76 ≤ 3 contra espelho JS em 8 angulos",
		contractGates: ["maxThinFilmDeltaE76"],
		sources: ["belcourBarlaIridescence2017", "unrealSubstrateDocs"],
	},
	{
		id: 15,
		term: "Glints",
		unrealReference: "procedurais com LOD",
		engineToday: "nao existe",
		phases: ["SB-F15"],
		gate: "variancia temporal ≤ 2% com camera parada e sem aliasing em 4 niveis de LOD",
		contractGates: ["maxGlintTemporalVariance"],
		sources: ["heitzGlints2016", "unrealSubstrateDocs"],
	},
	{
		id: 16,
		term: "Specular profile",
		unrealReference: "resposta especular autoral por LUT",
		engineToday: "nao existe",
		phases: ["SB-F16"],
		gate: "trocar a LUT muda a imagem sem recompilar: contador de programas constante",
		contractGates: ["maxProgramsPerMaterialFamily"],
		sources: ["unrealSubstrateDocs"],
	},
	{
		id: 17,
		term: "Difusa",
		unrealReference: "difusa com rugosidade",
		engineToday: "Lambert",
		phases: ["SB-F17"],
		gate: "erro ≤ 2% contra a referencia em 3 rugosidades",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 18,
		term: "Subsurface scattering",
		unrealReference: "caminho livre medio com perfil de difusao",
		engineToday: "wrap com termo back por espessura de caixa",
		phases: ["SB-F21"],
		gate: "perfil radial dentro de 5% da referencia offline",
		contractGates: ["maxDiffusionProfileDeviation"],
		sources: ["christensenBurleySubsurface2015", "engineAudit"],
	},
	{
		id: 19,
		term: "Two-sided foliage",
		unrealReference: "thin transmission",
		engineToday: "transmissao por luz",
		phases: ["SB-F22"],
		gate: "folha com backlight: razao frente/tras medida",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 20,
		term: "Translucidez ordenada",
		unrealReference: "OIT ordenado por pixel",
		engineToday: "blend por ordem de draw call",
		phases: ["SB-F23"],
		gate: "4 vidros interpenetrados na ordem correta em qualquer angulo",
		contractGates: [],
		sources: ["mcguireBavoilOit2013", "unrealSubstrateDocs"],
	},
	{
		id: 21,
		term: "Hair BSDF",
		unrealReference: "lobos R, TT e TRT",
		engineToday: "nao existe",
		phases: ["SB-F24"],
		gate: "3 lobos separaveis e energia total ≤ 1",
		contractGates: [],
		sources: ["chiangHair2016", "unrealSubstrateDocs"],
	},
	{
		id: 22,
		term: "Eye BSDF",
		unrealReference: "cornea sobre iris com limbo",
		engineToday: "nao existe",
		phases: ["SB-F25"],
		gate: "refracao da iris visivel e estavel na orbita",
		contractGates: [],
		sources: ["unrealSubstrateDocs"],
	},
	{
		id: 23,
		term: "Single layer water",
		unrealReference: "absorcao e scattering por profundidade",
		engineToday: "Gerstner com material physical",
		phases: ["SB-F26"],
		gate: "absorcao por profundidade segue Beer-Lambert dentro de 5%",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 24,
		term: "Dominios de material",
		unrealReference: "Volume, Unlit, LightFunction e PostProcess",
		engineToday: "cobertura parcial",
		phases: ["SB-F27"],
		gate: "os 4 dominios compilam e renderizam",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 25,
		term: "Mapas por slab",
		unrealReference: "conjunto completo de mapas por camada",
		engineToday: "color, normal, ORM, height e detail",
		phases: ["SB-F28"],
		gate: "≤ 16 unidades de textura, com as 2 do LTC contadas",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "heitzLtc2016", "engineAudit"],
	},
	{
		id: 26,
		term: "Decais no buffer de material",
		unrealReference: "DBuffer escrevendo no material",
		engineToday: "decal como mesh",
		phases: ["SB-F29"],
		gate: "o decal altera roughness e normal do slab abaixo",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 27,
		term: "Conversao do legado",
		unrealReference: "materiais antigos convertidos sem retrabalho do artista",
		engineToday: "nao existe",
		phases: ["SB-F4", "SB-F30"],
		gate: "100% dos materiais atuais convertidos, com SSIM ≥ 0,99 por material",
		contractGates: ["legacyConversionMinimumSsim"],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 28,
		term: "Autoria em grafo",
		unrealReference: "Material Editor com arvore de BSDFs",
		engineToday: "painel de propriedades",
		phases: ["SB-F30"],
		gate: "arvore editavel, validada e serializada",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 29,
		term: "Iluminacao por closure",
		unrealReference: "Lumen e MegaLights avaliam cada closure",
		engineToday: "shading unico por pixel",
		phases: ["SB-F31"],
		gate: "MegaLights sombreia 2 closures com energia dentro de 3% do forward",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 30,
		term: "Roughness tracking",
		unrealReference: "rugosidade rastreada por camada",
		engineToday: "rugosidade unica",
		phases: ["SB-F32"],
		gate: "o SSR usa a rugosidade da camada correta no teste de verniz sobre metal",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 31,
		term: "Debug: contagem de material",
		unrealReference: "modo de debug dedicado",
		engineToday: "nao existe",
		phases: ["SB-F35"],
		gate: "o modo mostra a contagem de material por pixel",
		contractGates: [],
		sources: ["unrealSubstrateDocs"],
	},
	{
		id: 32,
		term: "Debug: bytes por pixel",
		unrealReference: "modo de debug dedicado",
		engineToday: "nao existe",
		phases: ["SB-F35"],
		gate: "o modo mostra bytes por pixel e o teto do orcamento",
		contractGates: [],
		sources: ["unrealSubstrateDocs"],
	},
	{
		id: 33,
		term: "Debug: propriedades avancadas",
		unrealReference: "inspetor de propriedades por pixel",
		engineToday: "nao existe",
		phases: ["SB-F35"],
		gate: "o inspetor por pixel lista as closures do pixel",
		contractGates: [],
		sources: ["unrealSubstrateDocs"],
	},
	{
		id: 34,
		term: "Custo por closure",
		unrealReference: "custo medido por closure",
		engineToday: "nao existe",
		phases: ["SB-F36"],
		gate: "de 1 a 3 closures dentro do orcamento de ms do tier",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 35,
		term: "Permutacoes de programa",
		unrealReference: "uma permutacao por topologia",
		engineToday: "1 familia de programa",
		phases: ["SB-F6", "SB-F36"],
		gate: "no maximo 8 programas a mais por familia de base",
		contractGates: ["maxProgramsPerMaterialFamily"],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 36,
		term: "Conservacao de energia",
		unrealReference: "white furnace fecha em 1",
		engineToday: "o Phong perde energia",
		phases: ["SB-F10"],
		gate: "furnace ≥ 0,98 e ≤ 1,02",
		contractGates: ["furnaceMinimum", "furnaceMaximum"],
		sources: ["fdezAgueraMultiScatter2019", "engineAudit"],
	},
	{
		id: 37,
		term: "Flag OFF volta ao legado",
		unrealReference: "nao se aplica: e regra da bancada",
		engineToday: "nao se aplica",
		phases: EVERY_PHASE_ID,
		gate: "com a flag desligada, SSIM ≥ 0,99999 contra a baseline legada",
		contractGates: ["flagOffMinimumSsim"],
		sources: ["engineAudit"],
	},
	{
		id: 38,
		term: "Tier fraco",
		unrealReference: "escalabilidade por plataforma",
		engineToday: "caminho atual da engine",
		phases: ["SB-F34"],
		gate: "GPU fraca fica byte a byte no legado",
		contractGates: ["flagOffMinimumSsim"],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
	{
		id: 39,
		term: "Warmup",
		unrealReference: "nao se aplica",
		engineToday: "warmup fatiado",
		phases: ["SB-F34"],
		gate: "pico de warmup ≤ 12 ms",
		contractGates: ["maxWarmupSpikeMilliseconds"],
		sources: ["engineAudit"],
	},
	{
		id: 40,
		term: "Rodada cega",
		unrealReference: "nao se aplica",
		engineToday: "nao existe",
		phases: ["SB-F37"],
		gate: "confusao ≥ 70% com no minimo 3 avaliadores",
		contractGates: ["blindRoundMinimumConfusionRate", "blindRoundMinimumEvaluators"],
		sources: ["engineAudit"],
	},
	{
		id: 41,
		term: "Duas ramificacoes do lightingRender",
		unrealReference: "nao se aplica",
		engineToday: "risco conhecido: peca individual e pool instanciado",
		phases: ["SB-F33"],
		gate: "peca individual e pool instanciado com SSIM ≥ 0,999 entre si",
		contractGates: ["branchParityMinimumSsim"],
		sources: ["engineAudit"],
	},
	{
		id: 42,
		term: "Fotometria e nits preservados",
		unrealReference: "emissivo em nits",
		engineToday: "fotometria da IL-F13",
		phases: ["SB-F31"],
		gate: "emissivo em nits inalterado, dentro de 1%",
		contractGates: [],
		sources: ["engineAudit"],
	},
	{
		id: 43,
		term: "Specular AA",
		unrealReference: "specular AA ativo com anisotropia",
		engineToday: "specular AA existe",
		phases: ["SB-F10", "SB-F11"],
		gate: "a anisotropia nao quebra o specular AA: sem serrilhado de highlight",
		contractGates: [],
		sources: ["engineAudit"],
	},
	{
		id: 44,
		term: "Interop e serializacao",
		unrealReference: "topologia serializada sem perda",
		engineToday: "formato rbx",
		phases: ["SB-F30"],
		gate: "round-trip de topologia sem perda",
		contractGates: [],
		sources: ["unrealSubstrateDocs", "engineAudit"],
	},
]

const lineStatesById = new Map(
	SB_PARITY_LEDGER_LINES.map((line) => [line.id, { state: LEDGER_LINE_STATES.open, measurement: null, closedBy: null }]),
)

function lineDefinition(lineId) {
	return SB_PARITY_LEDGER_LINES.find((line) => line.id === lineId) ?? null
}

function decorateLine(line) {
	const runtime = lineStatesById.get(line.id)
	return {
		...line,
		phases: [...line.phases],
		contractGates: [...line.contractGates],
		sources: [...line.sources],
		state: runtime.state,
		measurement: runtime.measurement,
		closedBy: runtime.closedBy,
	}
}

export function parityLedgerLines() {
	return SB_PARITY_LEDGER_LINES.map(decorateLine)
}

export function parityLedgerLine(lineId) {
	const line = lineDefinition(lineId)
	return line ? decorateLine(line) : null
}

export function parityLinesForPhase(phaseId) {
	return SB_PARITY_LEDGER_LINES.filter((line) => line.phases.includes(phaseId)).map(decorateLine)
}

export function openParityLines() {
	return parityLedgerLines().filter((line) => line.state === LEDGER_LINE_STATES.open)
}

export function closedParityLines() {
	return parityLedgerLines().filter((line) => line.state === LEDGER_LINE_STATES.closed)
}


export function closeParityLine(lineId, proof) {
	const runtime = lineStatesById.get(lineId)
	if (!runtime) return { accepted: false, reason: "linha inexistente: " + lineId }
	if (!proof?.phaseId) return { accepted: false, reason: "prova sem fase dona" }
	if (!proof?.measurement) return { accepted: false, reason: "prova sem medicao" }

	const line = lineDefinition(lineId)
	if (!line.phases.includes(proof.phaseId)) {
		return { accepted: false, reason: proof.phaseId + " nao e dona da linha " + lineId }
	}

	runtime.state = LEDGER_LINE_STATES.closed
	runtime.measurement = proof.measurement
	runtime.closedBy = proof.phaseId
	return { accepted: true, reason: null }
}

export function reopenParityLine(lineId) {
	const runtime = lineStatesById.get(lineId)
	if (!runtime) return { accepted: false, reason: "linha inexistente: " + lineId }
	runtime.state = LEDGER_LINE_STATES.open
	runtime.measurement = null
	runtime.closedBy = null
	return { accepted: true, reason: null }
}


export function phaseCompletionState(phaseId) {
	const lines = parityLinesForPhase(phaseId)
	const openLineIds = lines.filter((line) => line.state === LEDGER_LINE_STATES.open).map((line) => line.id)
	return {
		phaseId,
		totalLines: lines.length,
		closedLines: lines.length - openLineIds.length,
		openLines: openLineIds,
		done: lines.length > 0 && openLineIds.length === 0,
	}
}

export function isPhaseAuthorizedToClaimDone(phaseId) {
	return phaseCompletionState(phaseId).done
}


export function parityLedgerProblems() {
	const problems = []
	if (SB_PARITY_LEDGER_LINES.length !== EXPECTED_PARITY_LINE_TOTAL) {
		problems.push("o ledger tem " + SB_PARITY_LEDGER_LINES.length + " linhas, o plano define " + EXPECTED_PARITY_LINE_TOTAL)
	}

	const knownPhaseIds = new Set(EVERY_PHASE_ID)
	const seenLineIds = new Set()
	for (const line of SB_PARITY_LEDGER_LINES) {
		if (seenLineIds.has(line.id)) problems.push("linha duplicada: " + line.id)
		seenLineIds.add(line.id)
		if (!line.term) problems.push("linha " + line.id + " sem termo de paridade")
		if (!line.unrealReference) problems.push("linha " + line.id + " sem referencia da UE 5.9")
		if (!line.engineToday) problems.push("linha " + line.id + " sem o estado da engine hoje")
		if (!line.gate) problems.push("linha " + line.id + " sem portao numerico")
		if (line.phases.length === 0) problems.push("linha " + line.id + " sem fase dona")
		for (const phaseId of line.phases) {
			if (!knownPhaseIds.has(phaseId)) problems.push("linha " + line.id + " aponta fase fora do manifesto: " + phaseId)
		}
		for (const gateKey of line.contractGates) {
			if (!(gateKey in SB_GATES)) problems.push("linha " + line.id + " aponta portao inexistente no contrato: " + gateKey)
		}
		if (line.sources.length === 0) problems.push("linha " + line.id + " sem fonte que a sustente")
		for (const sourceId of line.sources) {
			if (!referenceSource(sourceId)) problems.push("linha " + line.id + " aponta fonte desconhecida: " + sourceId)
		}
	}

	return problems
}

export function parityLedgerSummary() {
	const lines = parityLedgerLines()
	const openLines = lines.filter((line) => line.state === LEDGER_LINE_STATES.open)
	const coveredPhaseIds = new Set()
	for (const line of SB_PARITY_LEDGER_LINES) {
		for (const phaseId of line.phases) coveredPhaseIds.add(phaseId)
	}
	return {
		total: lines.length,
		expectedTotal: EXPECTED_PARITY_LINE_TOTAL,
		open: openLines.length,
		closed: lines.length - openLines.length,
		phasesCovered: coveredPhaseIds.size,
		problems: parityLedgerProblems(),
	}
}

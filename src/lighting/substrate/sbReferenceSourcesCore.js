export const SOURCE_KINDS = {
	engineDocs: "engineDocs",
	engineTalk: "engineTalk",
	paper: "paper",
	engineAudit: "engineAudit",
}

export const RESIDUE_STATES = {
	unverified: "unverified",
	confirmed: "confirmed",
	refuted: "refuted",
}

export const SB_DOCUMENTED_UNREAL_VERSIONS = ["5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8"]
export const SB_FIRST_DOCUMENTED_UNREAL_VERSION = SB_DOCUMENTED_UNREAL_VERSIONS[0]
export const SB_LAST_DOCUMENTED_UNREAL_VERSION = SB_DOCUMENTED_UNREAL_VERSIONS[SB_DOCUMENTED_UNREAL_VERSIONS.length - 1]
export const SB_UNVERIFIED_UNREAL_VERSION = "5.9"

export const SB_HONESTY_STATEMENT =
	"A documentacao publica consultada cobre UE " +
	SB_FIRST_DOCUMENTED_UNREAL_VERSION +
	" ate " +
	SB_LAST_DOCUMENTED_UNREAL_VERSION +
	". Nao existe fonte publica verificavel para os deltas exclusivos da " +
	SB_UNVERIFIED_UNREAL_VERSION +
	": cada diferenca suspeita esta registrada como residuo nomeado, e nenhuma fase pode afirmar paridade com a " +
	SB_UNVERIFIED_UNREAL_VERSION +
	" antes de fechar o residuo com fonte ou build."


export const SB_REFERENCE_SOURCES = {
	unrealSubstrateDocs: {
		label: "Epic Games -- documentacao do Substrate",
		kind: SOURCE_KINDS.engineDocs,
		coversUnrealVersions: SB_DOCUMENTED_UNREAL_VERSIONS,
		verified: true,
		note: "arvore de BSDFs, operadores, orcamentos por pixel e cvars r.Substrate.*",
	},
	unrealSubstrateTalks: {
		label: "Epic Games -- palestras tecnicas do Substrate",
		kind: SOURCE_KINDS.engineTalk,
		coversUnrealVersions: ["5.2", "5.3", "5.4"],
		verified: true,
		note: "motivacao do modelo de slabs, simplificacao e orcamento de bytes",
	},
	engineAudit: {
		label: "Auditoria da engine (secao 2 do plano), medida arquivo por arquivo",
		kind: SOURCE_KINDS.engineAudit,
		coversUnrealVersions: [],
		verified: true,
		note: "unica fonte da coluna 'engine hoje': numeros medidos, nao opinados",
	},
	belcourBarlaIridescence2017: {
		label: "Belcour e Barla -- A Practical Extension to Microfacet Theory for the Modeling of Varying Iridescence (2017)",
		kind: SOURCE_KINDS.paper,
		coversUnrealVersions: [],
		verified: true,
		note: "interferencia de Airy por espessura em nanometros e IOR",
	},
	zeltnerSheen2022: {
		label: "Zeltner et al. -- Practical Multiple-Scattering Sheen Using Linearly Transformed Cosines (2022)",
		kind: SOURCE_KINDS.paper,
		coversUnrealVersions: [],
		verified: true,
		note: "sheen com energia conservada e qualidade escalavel",
	},
	heitzLtc2016: {
		label: "Heitz et al. -- Real-Time Polygonal-Light Shading with Linearly Transformed Cosines (2016)",
		kind: SOURCE_KINDS.paper,
		coversUnrealVersions: [],
		verified: true,
		note: "as 2 unidades de textura de LTC ja gastas pela engine",
	},
	heitzGlints2016: {
		label: "Heitz et al. -- microfacetas estocasticas e glints em tempo real (2015-2016)",
		kind: SOURCE_KINDS.paper,
		coversUnrealVersions: [],
		verified: true,
		note: "cintilancia estavel no tempo, com LOD",
	},
	christensenBurleySubsurface2015: {
		label: "Christensen e Burley -- Approximate Reflectance Profiles for Efficient Subsurface Scattering (2015)",
		kind: SOURCE_KINDS.paper,
		coversUnrealVersions: [],
		verified: true,
		note: "perfil de difusao por caminho livre medio",
	},
	chiangHair2016: {
		label: "Chiang et al. -- A Practical and Controllable Hair and Fur Model for Production Path Tracing (2016)",
		kind: SOURCE_KINDS.paper,
		coversUnrealVersions: [],
		verified: true,
		note: "lobos R, TT e TRT com energia limitada",
	},
	mcguireBavoilOit2013: {
		label: "McGuire e Bavoil -- Weighted Blended Order-Independent Transparency (2013)",
		kind: SOURCE_KINDS.paper,
		coversUnrealVersions: [],
		verified: true,
		note: "degradacao aceitavel quando a ordenacao por pixel nao cabe",
	},
	fdezAgueraMultiScatter2019: {
		label: "Fdez-Aguera -- A Multiple-Scattering Microfacet Model for Real-Time Image-Based Lighting (2019)",
		kind: SOURCE_KINDS.paper,
		coversUnrealVersions: [],
		verified: true,
		note: "compensacao de energia usada no white furnace da bancada",
	},
}







export const SB_FIVE_NINE_RESIDUES = [
	{
		id: "substrateEnabledByDefault",
		title: "Substrate ligado por padrao",
		question: "A 5.9 liga r.Substrate por padrao em projetos novos, ou continua opt-in por projeto?",
		ledgerLines: [1, 37, 38],
	},
	{
		id: "bytesPerPixelDefault",
		title: "Padrao de bytes por pixel",
		question: "r.Substrate.BytesPerPixel continua com padrao 80 na 5.9, e o teto por closure mudou?",
		ledgerLines: [7],
	},
	{
		id: "closuresPerPixelDefault",
		title: "Padrao de closures por pixel",
		question: "Quantas closures por pixel a 5.9 permite por padrao em cada escalabilidade?",
		ledgerLines: [6, 34],
	},
	{
		id: "simplificationHeuristic",
		title: "Heuristica de simplificacao",
		question: "A regra de parameter blending que escolhe quais closures irmas fundir mudou na 5.9?",
		ledgerLines: [8],
	},
	{
		id: "sheenQualityLevels",
		title: "Niveis de qualidade do sheen",
		question: "Quantos niveis r.Substrate.SheenQuality expoe na 5.9 e qual integrador cada nivel usa?",
		ledgerLines: [13],
	},
	{
		id: "glintsLutFormat",
		title: "LUT de glints",
		question: "Qual o formato e a geracao da LUT de r.Substrate.Glints.LUT na 5.9?",
		ledgerLines: [15],
	},
	{
		id: "specularProfileAuthoring",
		title: "Autoria do specular profile",
		question: "Como a 5.9 autora e amostra o specular profile, e trocar a LUT ainda evita recompilar?",
		ledgerLines: [16],
	},
	{
		id: "subsurfaceProfileCvars",
		title: "Perfis de SSS",
		question: "Quais r.SSS.* a 5.9 mantem e qual perfil de difusao virou padrao?",
		ledgerLines: [18, 19],
	},
	{
		id: "orderedTranslucencyScope",
		title: "Alcance da translucidez ordenada",
		question: "r.OIT.SortedPixels na 5.9 cobre quais plataformas e qual o limite de camadas por pixel?",
		ledgerLines: [20],
	},
	{
		id: "specializedBsdfCoverage",
		title: "BSDFs especializados",
		question: "Hair, eye e single layer water na 5.9: quais lobos e parametros exatos cada um expoe?",
		ledgerLines: [21, 22, 23],
	},
	{
		id: "decalMaterialBuffer",
		title: "Decais no buffer de material",
		question: "Como a 5.9 escreve decais no buffer de material e quais canais do slab aceitam escrita?",
		ledgerLines: [26],
	},
	{
		id: "legacyConversionPath",
		title: "Conversao do legado",
		question: "A conversao automatica de materiais legados da 5.9 preserva quais parametros, e com que perda?",
		ledgerLines: [27, 44],
	},
	{
		id: "closureLightingIntegration",
		title: "Iluminacao por closure",
		question: "Como Lumen e MegaLights avaliam multiplas closures por pixel na 5.9, e a que custo?",
		ledgerLines: [29, 30],
	},
	{
		id: "debugModeNames",
		title: "Modos de debug",
		question: "Quais r.Substrate.Debug.* existem na 5.9 e o que cada modo mostra por pixel?",
		ledgerLines: [31, 32, 33],
	},
]

const residueStatesById = new Map(
	SB_FIVE_NINE_RESIDUES.map((residue) => [residue.id, { status: RESIDUE_STATES.unverified, evidence: null }]),
)

function decorateResidue(residue) {
	const runtime = residueStatesById.get(residue.id)
	return {
		...residue,
		ledgerLines: [...residue.ledgerLines],
		status: runtime.status,
		evidence: runtime.evidence,
	}
}

export function referenceSourceIds() {
	return Object.keys(SB_REFERENCE_SOURCES)
}

export function referenceSource(sourceId) {
	return SB_REFERENCE_SOURCES[sourceId] ?? null
}

export function sourcesCoveringUnrealVersion(unrealVersion) {
	return referenceSourceIds().filter((sourceId) => SB_REFERENCE_SOURCES[sourceId].coversUnrealVersions.includes(unrealVersion))
}


export function verifiedSourcesCoveringUnrealVersion(unrealVersion) {
	return sourcesCoveringUnrealVersion(unrealVersion).filter((sourceId) => SB_REFERENCE_SOURCES[sourceId].verified)
}

export function fiveNineResidues() {
	return SB_FIVE_NINE_RESIDUES.map(decorateResidue)
}

export function fiveNineResidue(residueId) {
	const residue = SB_FIVE_NINE_RESIDUES.find((entry) => entry.id === residueId)
	return residue ? decorateResidue(residue) : null
}

export function unverifiedResidues() {
	return fiveNineResidues().filter((residue) => residue.status === RESIDUE_STATES.unverified)
}


export function resolveResidue(residueId, resolution) {
	const runtime = residueStatesById.get(residueId)
	if (!runtime) return { accepted: false, reason: "residuo inexistente: " + residueId }

	const status = resolution?.status
	if (status !== RESIDUE_STATES.confirmed && status !== RESIDUE_STATES.refuted) {
		return { accepted: false, reason: "estado invalido para residuo: " + status }
	}
	if (!resolution?.evidence) return { accepted: false, reason: "residuo sem evidencia: " + residueId }

	runtime.status = status
	runtime.evidence = resolution.evidence
	return { accepted: true, reason: null }
}

export function reopenResidue(residueId) {
	const runtime = residueStatesById.get(residueId)
	if (!runtime) return { accepted: false, reason: "residuo inexistente: " + residueId }
	runtime.status = RESIDUE_STATES.unverified
	runtime.evidence = null
	return { accepted: true, reason: null }
}


export function divergenceReport() {
	const residues = fiveNineResidues()
	return {
		fromVersion: SB_LAST_DOCUMENTED_UNREAL_VERSION,
		toVersion: SB_UNVERIFIED_UNREAL_VERSION,
		honestyStatement: SB_HONESTY_STATEMENT,
		documentedVersions: [...SB_DOCUMENTED_UNREAL_VERSIONS],
		verifiedSourcesForTargetVersion: verifiedSourcesCoveringUnrealVersion(SB_UNVERIFIED_UNREAL_VERSION),
		residues,
		total: residues.length,
		unverified: residues.filter((residue) => residue.status === RESIDUE_STATES.unverified).length,
		confirmed: residues.filter((residue) => residue.status === RESIDUE_STATES.confirmed).length,
		refuted: residues.filter((residue) => residue.status === RESIDUE_STATES.refuted).length,
	}
}


export function referenceSourcesProblems() {
	const problems = []
	const knownKinds = new Set(Object.values(SOURCE_KINDS))

	for (const sourceId of referenceSourceIds()) {
		const source = SB_REFERENCE_SOURCES[sourceId]
		if (!source.label) problems.push("fonte sem rotulo: " + sourceId)
		if (!knownKinds.has(source.kind)) problems.push("fonte com tipo desconhecido: " + sourceId)
		if (!source.note) problems.push("fonte sem nota do que ela sustenta: " + sourceId)
		if (source.verified && source.coversUnrealVersions.includes(SB_UNVERIFIED_UNREAL_VERSION)) {
			problems.push("fonte alega cobrir a " + SB_UNVERIFIED_UNREAL_VERSION + " sem ser verificavel: " + sourceId)
		}
	}

	const seenResidueIds = new Set()
	for (const residue of SB_FIVE_NINE_RESIDUES) {
		if (seenResidueIds.has(residue.id)) problems.push("residuo duplicado: " + residue.id)
		seenResidueIds.add(residue.id)
		if (!residue.title) problems.push("residuo sem titulo: " + residue.id)
		if (!residue.question) problems.push("residuo sem pergunta: " + residue.id)
		if (residue.ledgerLines.length === 0) problems.push("residuo sem linha de ledger: " + residue.id)
	}

	return problems
}

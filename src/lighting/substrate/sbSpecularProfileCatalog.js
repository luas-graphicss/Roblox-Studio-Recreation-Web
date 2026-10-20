export const SB_SPECULAR_PROFILE_NEUTRAL_INDEX = 0
export const SB_SPECULAR_PROFILE_NEUTRAL_ID = "neutral"


const CATALOG_PROBE_STEPS = 9


export function clampCosine(value) {
	if (!Number.isFinite(value)) return 0
	return Math.min(1, Math.max(0, value))
}


function cosineAlignment(cosThetaView, cosThetaLight) {
	return Math.max(0, 1 - 2 * Math.abs(cosThetaView - cosThetaLight))
}

const SPECULAR_PROFILES = [
	{
		id: SB_SPECULAR_PROFILE_NEUTRAL_ID,
		label: "Neutro",
		description: "ganho 1 em todo o dominio: o especular sai exatamente como a SB-F10 entregou",
		respond: () => 1,
	},
	{
		id: "grazingSoftener",
		label: "Suavizador de raspao",
		description: "apaga o brilho rasante e nunca cria energia: o ganho fica sempre em 1 ou abaixo",
		respond: (cosThetaView, cosThetaLight) => (0.35 + 0.65 * Math.pow(cosThetaView, 0.6)) * (0.85 + 0.15 * cosThetaLight),
	},
	{
		id: "retroReflective",
		label: "Retrorreflexivo",
		description: "reforca o especular quando a luz volta pela direcao da vista",
		respond: (cosThetaView, cosThetaLight) => 1 + 0.75 * cosineAlignment(cosThetaView, cosThetaLight),
	},
	{
		id: "polishedCoat",
		label: "Verniz polido",
		description: "apaga a resposta espalhada e concentra o brilho onde vista e luz sao frontais",
		respond: (cosThetaView, cosThetaLight) => 0.6 + 0.9 * Math.sqrt(cosThetaView * cosThetaLight),
	},
]

export function specularProfileCount() {
	return SPECULAR_PROFILES.length
}

export function specularProfileIds() {
	return SPECULAR_PROFILES.map((profile) => profile.id)
}

export function specularProfileAt(profileIndex) {
	return SPECULAR_PROFILES[profileIndex] ?? null
}

export function specularProfileIndexOf(profileId) {
	const foundIndex = SPECULAR_PROFILES.findIndex((profile) => profile.id === profileId)
	return foundIndex >= 0 ? foundIndex : null
}


export function resolveSpecularProfileIndex(profileIdOrIndex) {
	if (Number.isInteger(profileIdOrIndex)) {
		const withinRange = profileIdOrIndex >= 0 && specularProfileCount() > profileIdOrIndex
		return withinRange ? profileIdOrIndex : SB_SPECULAR_PROFILE_NEUTRAL_INDEX
	}
	const indexById = specularProfileIndexOf(profileIdOrIndex)
	return indexById === null ? SB_SPECULAR_PROFILE_NEUTRAL_INDEX : indexById
}


export function specularProfileGain(profileIndex, cosThetaView, cosThetaLight) {
	const profile = specularProfileAt(profileIndex)
	if (!profile) return 1
	const gain = profile.respond(clampCosine(cosThetaView), clampCosine(cosThetaLight))
	return Number.isFinite(gain) ? gain : 1
}

export function describeSpecularProfileCatalog() {
	return SPECULAR_PROFILES.map((profile, profileIndex) => ({
		index: profileIndex,
		id: profile.id,
		label: profile.label,
		description: profile.description,
		neutral: profileIndex === SB_SPECULAR_PROFILE_NEUTRAL_INDEX,
	}))
}

function catalogProbeCosines() {
	const cosines = []
	for (let stepIndex = 0; CATALOG_PROBE_STEPS > stepIndex; stepIndex += 1) {
		cosines.push(stepIndex / (CATALOG_PROBE_STEPS - 1))
	}
	return cosines
}


export function findSpecularProfileCatalogProblems() {
	const problems = []
	const ids = specularProfileIds()

	if (new Set(ids).size !== ids.length) problems.push("perfil com id duplicado")
	if (ids[SB_SPECULAR_PROFILE_NEUTRAL_INDEX] !== SB_SPECULAR_PROFILE_NEUTRAL_ID) {
		problems.push("o indice 0 deixou de ser o perfil neutro")
	}

	for (const profile of SPECULAR_PROFILES) {
		if (typeof profile.respond !== "function") problems.push("perfil sem resposta: " + profile.id)
		if (!profile.label || !profile.description) problems.push("perfil sem rotulo ou descricao: " + profile.id)
	}

	const cosines = catalogProbeCosines()
	for (const [profileIndex, profile] of SPECULAR_PROFILES.entries()) {
		if (typeof profile.respond !== "function") continue
		for (const cosThetaView of cosines) {
			for (const cosThetaLight of cosines) {
				const gain = profile.respond(cosThetaView, cosThetaLight)
				if (!Number.isFinite(gain) || 0 > gain) problems.push("resposta invalida no perfil " + profile.id)
				if (profileIndex === SB_SPECULAR_PROFILE_NEUTRAL_INDEX && gain !== 1) {
					problems.push("o perfil neutro respondeu diferente de 1")
				}
			}
		}
	}

	return Array.from(new Set(problems))
}

SPECULAR_PROFILES.forEach((profile) => Object.freeze(profile))
Object.freeze(SPECULAR_PROFILES)

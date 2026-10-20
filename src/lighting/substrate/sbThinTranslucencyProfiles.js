export const SB_THIN_TRANSLUCENCY_PROFILES = Object.freeze({
	foliageLeaf: Object.freeze({
		label: "folha de duas faces",
		transmittanceColor: Object.freeze([0.22, 0.62, 0.12]),
		thicknessMillimeters: 0.2,
		phaseAsymmetry: 0.55,
		referenceAlbedo: Object.freeze([0.16, 0.36, 0.12]),
		referenceRoughness: 0.62,
		why: "a clorofila absorve vermelho e azul; o que atravessa a lamina e verde",
	}),

	paperSheet: Object.freeze({
		label: "folha de papel",
		transmittanceColor: Object.freeze([0.92, 0.9, 0.86]),
		thicknessMillimeters: 0.1,
		phaseAsymmetry: 0.2,
		referenceAlbedo: Object.freeze([0.75, 0.74, 0.71]),
		referenceRoughness: 0.85,
		why: "celulose quase nao absorve: espalha muito e transmite quase neutro",
	}),

	cottonCloth: Object.freeze({
		label: "tecido de algodao",
		transmittanceColor: Object.freeze([0.68, 0.5, 0.42]),
		thicknessMillimeters: 0.35,
		phaseAsymmetry: 0.35,
		referenceAlbedo: Object.freeze([0.42, 0.3, 0.26]),
		referenceRoughness: 0.9,
		why: "trama grossa: transmite pouco e puxa para o quente da fibra tingida",
	}),

	flowerPetal: Object.freeze({
		label: "petala",
		transmittanceColor: Object.freeze([0.95, 0.42, 0.5]),
		thicknessMillimeters: 0.15,
		phaseAsymmetry: 0.6,
		referenceAlbedo: Object.freeze([0.62, 0.24, 0.32]),
		referenceRoughness: 0.55,
		why: "pigmento vermelho com lamina fina: e o caso mais forte de contraluz",
	}),
})


export const SB_DEFAULT_THIN_TRANSLUCENCY_PROFILE_ID = "foliageLeaf"

export function thinTranslucencyProfileIds() {
	return Object.keys(SB_THIN_TRANSLUCENCY_PROFILES).sort()
}

export function thinTranslucencyProfile(profileId) {
	return SB_THIN_TRANSLUCENCY_PROFILES[profileId] ?? null
}

export function describeThinTranslucencyProfiles() {
	return thinTranslucencyProfileIds().map((profileId) => ({
		id: profileId,
		...SB_THIN_TRANSLUCENCY_PROFILES[profileId],
	}))
}

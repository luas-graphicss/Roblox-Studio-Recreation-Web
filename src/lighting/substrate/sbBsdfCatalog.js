export const SB_BSDF_KINDS = {
	slab: {
		owner: "SB-F4",
		label: "Slab",
		closureCost: 1,
		description: "camada de material com difusa, especular, fuzz, SSS, thin film e glints",
		supportsLayering: true,
	},
	hair: {
		owner: "SB-F24",
		label: "Hair",
		closureCost: 1,
		description: "fibra com os lobos R, TT e TRT",
		supportsLayering: false,
	},
	eye: {
		owner: "SB-F25",
		label: "Eye",
		closureCost: 1,
		description: "cornea sobre iris com refracao e limbo",
		supportsLayering: false,
	},
	singleLayerWater: {
		owner: "SB-F26",
		label: "Single Layer Water",
		closureCost: 1,
		description: "superficie de agua com absorcao e scattering por profundidade",
		supportsLayering: false,
	},
	volume: {
		owner: "SB-F27",
		label: "Volumetric Fog / Cloud",
		closureCost: 1,
		description: "participacao volumetrica: extincao, albedo e fase",
		supportsLayering: false,
	},
	unlit: {
		owner: "SB-F27",
		label: "Unlit",
		closureCost: 0,
		description: "cor emitida, sem iluminacao",
		supportsLayering: false,
	},
}

export const SB_MATERIAL_DOMAINS = {
	surface: { owner: "SB-F6", description: "malha opaca ou translucida" },
	volume: { owner: "SB-F27", description: "nevoa e nuvem" },
	lightFunction: { owner: "SB-F27", description: "mascara projetada por uma luz" },
	postProcess: { owner: "SB-F27", description: "material aplicado na imagem final" },
	decal: { owner: "SB-F29", description: "escreve no buffer de material da superficie abaixo" },
}

export function bsdfKinds() {
	return Object.keys(SB_BSDF_KINDS)
}

export function bsdfClosureCost(kind) {
	return SB_BSDF_KINDS[kind]?.closureCost ?? null
}

export function supportsLayering(kind) {
	return Boolean(SB_BSDF_KINDS[kind]?.supportsLayering)
}

export function materialDomains() {
	return Object.keys(SB_MATERIAL_DOMAINS)
}

export function describeBsdfCatalog() {
	return bsdfKinds().map((kind) => ({ kind, ...SB_BSDF_KINDS[kind] }))
}

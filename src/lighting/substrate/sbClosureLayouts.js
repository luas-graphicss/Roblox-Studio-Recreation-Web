function deepFreeze(value) {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value
	Object.freeze(value)
	Object.values(value).forEach(deepFreeze)
	return value
}

export const SB_CLOSURE_HEADER_BYTES = 4


export const SB_CLOSURE_HEADER_FIELDS = [
	{ name: "kind", bytes: 1, description: "tipo de BSDF" },
	{ name: "flags", bytes: 1, description: "bits de feature ligados nesta closure" },
	{ name: "closureCount", bytes: 1, description: "quantas closures o pixel carrega" },
	{ name: "layerIndex", bytes: 1, description: "posicao na pilha de camadas" },
]


export const SB_CLOSURE_LAYOUTS = {
	slab: {
		owner: "SB-F8",
		description: "a closure base do Substrate",
		payload: [
			{ name: "albedo", bytes: 3 },
			{ name: "f0", bytes: 3 },
			{ name: "f90", bytes: 1 },
			{ name: "roughness", bytes: 1 },
			{ name: "anisotropy", bytes: 1 },
			{ name: "anisotropyRotation", bytes: 1 },
			{ name: "normal", bytes: 4 },
			{ name: "tangent", bytes: 2 },
			{ name: "secondRoughness", bytes: 1 },
			{ name: "secondRoughnessWeight", bytes: 1 },
			{ name: "fuzzAmount", bytes: 1 },
			{ name: "fuzzRoughness", bytes: 1 },
			{ name: "fuzzColor", bytes: 3 },
			{ name: "subsurfaceMeanFreePath", bytes: 3 },
			{ name: "subsurfacePhase", bytes: 1 },
			{ name: "thinFilmThicknessNanometers", bytes: 2 },
			{ name: "thinFilmIor", bytes: 1 },
			{ name: "glintDensity", bytes: 2 },
			{ name: "glintRoughness", bytes: 1 },
			{ name: "specularProfileIndex", bytes: 1 },
			{ name: "emissive", bytes: 3 },
			{ name: "opacity", bytes: 1 },
			{ name: "coverage", bytes: 1 },
			{ name: "thickness", bytes: 1 },
			{ name: "transmittanceColor", bytes: 3 },
		],
	},

	hair: {
		owner: "SB-F24",
		description: "R, TT e TRT",
		payload: [
			{ name: "baseColor", bytes: 3 },
			{ name: "melanin", bytes: 1 },
			{ name: "roughness", bytes: 1 },
			{ name: "radialRoughness", bytes: 1 },
			{ name: "cuticleAngle", bytes: 1 },
			{ name: "ior", bytes: 1 },
			{ name: "tangent", bytes: 4 },
			{ name: "scatter", bytes: 1 },
		],
	},

	eye: {
		owner: "SB-F25",
		description: "cornea, iris e limbo",
		payload: [
			{ name: "irisColor", bytes: 3 },
			{ name: "irisDepth", bytes: 1 },
			{ name: "pupilRadius", bytes: 1 },
			{ name: "corneaRoughness", bytes: 1 },
			{ name: "corneaIor", bytes: 1 },
			{ name: "limbusDarkening", bytes: 1 },
			{ name: "normal", bytes: 4 },
		],
	},

	singleLayerWater: {
		owner: "SB-F26",
		description: "agua de camada unica com absorcao e scattering",
		payload: [
			{ name: "absorption", bytes: 3 },
			{ name: "scattering", bytes: 3 },
			{ name: "phaseG", bytes: 1 },
			{ name: "roughness", bytes: 1 },
			{ name: "ior", bytes: 1 },
			{ name: "normal", bytes: 4 },
		],
	},

	volume: {
		owner: "SB-F27",
		description: "nevoa e nuvem",
		payload: [
			{ name: "extinction", bytes: 3 },
			{ name: "albedo", bytes: 3 },
			{ name: "phaseG", bytes: 1 },
			{ name: "emissive", bytes: 3 },
		],
	},

	unlit: {
		owner: "SB-F27",
		description: "cor emitida sem iluminacao",
		payload: [
			{ name: "emissive", bytes: 3 },
			{ name: "opacity", bytes: 1 },
		],
	},
}

export function closureLayoutKinds() {
	return Object.keys(SB_CLOSURE_LAYOUTS)
}

export function closurePayloadBytes(kind) {
	const layout = SB_CLOSURE_LAYOUTS[kind]
	if (!layout) return null
	return layout.payload.reduce((total, field) => total + field.bytes, 0)
}

export function closureLayoutBytes(kind) {
	const payloadBytes = closurePayloadBytes(kind)
	if (payloadBytes === null) return null
	return SB_CLOSURE_HEADER_BYTES + payloadBytes
}


export function closurePayloadFieldNames(kind) {
	const layout = SB_CLOSURE_LAYOUTS[kind]
	if (!layout) return []
	return layout.payload.map((field) => field.name)
}







export function closureLayoutProblems() {
	const problems = []
	for (const kind of closureLayoutKinds()) {
		const layout = SB_CLOSURE_LAYOUTS[kind]
		if (!layout.owner) problems.push("layout sem fase dona: " + kind)
		if (!layout.description) problems.push("layout sem descricao: " + kind)
		if (layout.payload.length === 0) problems.push("layout sem nenhum campo: " + kind)

		const fieldNames = closurePayloadFieldNames(kind)
		if (new Set(fieldNames).size !== fieldNames.length) {
			problems.push("campo duplicado no payload de " + kind)
		}
		for (const field of layout.payload) {
			if (!Number.isInteger(field.bytes) || 1 > field.bytes) {
				problems.push("campo " + kind + "." + field.name + " com contagem de bytes invalida")
			}
		}
	}
	return problems
}

export function describeClosureLayouts() {
	return closureLayoutKinds().map((kind) => ({
		kind,
		owner: SB_CLOSURE_LAYOUTS[kind].owner,
		description: SB_CLOSURE_LAYOUTS[kind].description,
		headerBytes: SB_CLOSURE_HEADER_BYTES,
		payloadBytes: closurePayloadBytes(kind),
		totalBytes: closureLayoutBytes(kind),
	}))
}

deepFreeze(SB_CLOSURE_HEADER_FIELDS)
deepFreeze(SB_CLOSURE_LAYOUTS)

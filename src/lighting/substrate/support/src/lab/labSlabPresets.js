function createSlab(overrides) {
	return {
		albedo: [0.82, 0.82, 0.82],
		f0: [0.04, 0.04, 0.04],
		f90: [1, 1, 1],
		roughness: 0.4,
		anisotropy: 0,
		anisotropyRotation: 0,
		secondRoughness: 0,
		secondRoughnessWeight: 0,
		fuzzAmount: 0,
		fuzzRoughness: 0.5,
		fuzzColor: [1, 1, 1],
		subsurfaceMeanFreePath: [0, 0, 0],
		subsurfacePhase: 0,
		thinFilmThicknessNanometers: 0,
		thinFilmIor: 1.35,
		glintDensity: 0,
		glintRoughness: 0.05,
		emissive: [0, 0, 0],
		opacity: 1,
		...overrides,
	}
}


function createLayeredSlab(topLayer, bottomLayer, layering) {
	return {
		operator: "verticalLayering",
		coverage: layering?.coverage ?? 1,
		thickness: layering?.thickness ?? 0.02,
		transmittanceColor: layering?.transmittanceColor ?? [1, 1, 1],
		top: topLayer,
		bottom: bottomLayer,
	}
}

export const SB_SLAB_PRESETS = {
	dielectricChart: createSlab({ albedo: [0.72, 0.72, 0.74], roughness: 0.3 }),

	polishedMetal: createSlab({
		albedo: [0, 0, 0],
		f0: [0.95, 0.93, 0.88],
		roughness: 0.08,
	}),

	brushedMetal: createSlab({
		albedo: [0, 0, 0],
		f0: [0.91, 0.9, 0.88],
		roughness: 0.32,
		anisotropy: 0.85,
		secondRoughness: 0.55,
		secondRoughnessWeight: 0.25,
	}),

	clothFuzz: createSlab({
		albedo: [0.35, 0.11, 0.13],
		roughness: 0.85,
		fuzzAmount: 0.9,
		fuzzRoughness: 0.35,
		fuzzColor: [0.95, 0.8, 0.78],
	}),

	skin: createSlab({
		albedo: [0.86, 0.63, 0.55],
		roughness: 0.52,
		subsurfaceMeanFreePath: [4.8, 1.6, 1.1],
		subsurfacePhase: 0.35,
	}),

	soapBubble: createSlab({
		albedo: [0.02, 0.02, 0.02],
		roughness: 0.05,
		thinFilmThicknessNanometers: 520,
		thinFilmIor: 1.33,
		opacity: 0.35,
	}),

	glitterFlake: createSlab({
		albedo: [0.05, 0.05, 0.07],
		f0: [0.9, 0.9, 0.92],
		roughness: 0.22,
		glintDensity: 1800,
		glintRoughness: 0.04,
	}),

	foliage: createSlab({
		albedo: [0.16, 0.36, 0.12],
		roughness: 0.62,
		subsurfaceMeanFreePath: [1.2, 2.4, 0.6],
	}),

	glass: createSlab({
		albedo: [0.02, 0.03, 0.03],
		roughness: 0.04,
		opacity: 0.18,
	}),

	hair: createSlab({ albedo: [0.14, 0.08, 0.05], roughness: 0.28, anisotropy: 0.9 }),

	eye: createSlab({ albedo: [0.24, 0.32, 0.42], roughness: 0.12 }),

	water: createSlab({ albedo: [0.02, 0.05, 0.07], roughness: 0.03, opacity: 0.4 }),
}


export const SB_LAYERED_PRESETS = {
	carPaint: createLayeredSlab(
		createSlab({ albedo: [0, 0, 0], f0: [0.05, 0.05, 0.05], roughness: 0.06 }),
		createSlab({ albedo: [0.44, 0.03, 0.06], f0: [0.6, 0.58, 0.56], roughness: 0.28, glintDensity: 900 }),
		{ coverage: 1, thickness: 0.08, transmittanceColor: [0.95, 0.92, 0.9] },
	),

	varnishedWood: createLayeredSlab(
		createSlab({ albedo: [0, 0, 0], roughness: 0.14 }),
		createSlab({ albedo: [0.32, 0.18, 0.09], roughness: 0.55 }),
		{ coverage: 0.9, thickness: 0.2, transmittanceColor: [0.86, 0.72, 0.5] },
	),

	oiledSkin: createLayeredSlab(
		createSlab({ albedo: [0, 0, 0], roughness: 0.2 }),
		SB_SLAB_PRESETS.skin,
		{ coverage: 0.65, thickness: 0.03, transmittanceColor: [1, 0.98, 0.96] },
	),
}

export function slabPresetIds() {
	return Object.keys(SB_SLAB_PRESETS).sort()
}

export function layeredPresetIds() {
	return Object.keys(SB_LAYERED_PRESETS).sort()
}

export { createSlab, createLayeredSlab }

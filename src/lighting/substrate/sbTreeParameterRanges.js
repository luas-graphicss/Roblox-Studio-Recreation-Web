function scalarRange(minimum, maximum) {
	return { componentCount: 1, minimum, maximum }
}

function colorRange(minimum, maximum) {
	return { componentCount: 3, minimum, maximum }
}

export const SB_STRUCTURAL_PARAMETER_RANGES = Object.freeze({
	albedo: colorRange(0, 1),
	f0: colorRange(0, 1),
	f90: scalarRange(0, 1),
	fuzzColor: colorRange(0, 1),
	transmittanceColor: colorRange(0, 1),
	subsurfaceMeanFreePath: colorRange(0, 64),
	emissive: colorRange(0, 100000),
	roughness: scalarRange(0, 1),
	secondRoughness: scalarRange(0, 1),
	secondRoughnessWeight: scalarRange(0, 1),
	fuzzAmount: scalarRange(0, 1),
	fuzzRoughness: scalarRange(0, 1),
	glintRoughness: scalarRange(0, 1),
	opacity: scalarRange(0, 1),
	coverage: scalarRange(0, 1),
	weight: scalarRange(0, 1),
	anisotropyRotation: scalarRange(0, 1),
	anisotropy: scalarRange(-1, 1),
	subsurfacePhase: scalarRange(-1, 1),
	thickness: scalarRange(0, 64),
	thinFilmThicknessNanometers: scalarRange(0, 2000),
	thinFilmIor: scalarRange(1, 3),
	glintDensity: scalarRange(0, 100000),
})


export function hasStructuralRange(parameterName, parameterRanges = SB_STRUCTURAL_PARAMETER_RANGES) {
	return Boolean(parameterRanges[parameterName])
}

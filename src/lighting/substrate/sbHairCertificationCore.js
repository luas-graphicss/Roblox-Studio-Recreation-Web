import {
	SB_HAIR_LOBE_NAMES,
	azimuthalScattering,
	lobeAttenuations,
	longitudinalLobeCenter,
	longitudinalLobeWidth,
	longitudinalScattering,
	sanitizeHairParameters,
} from "./sbHairBsdfCore.js"


export const SB_HAIR_ENERGY_CEILING = 1


export const SB_HAIR_GATE_VIEW_COSINES = Object.freeze([1, 0.94, 0.82, 0.66, 0.45, 0.2])


export const SB_HAIR_GATE_CUTICLE_ANGLES = Object.freeze([0, 0.034907, 0.069813, 0.10472])


export const SB_HAIR_MAXIMUM_LOBE_SIMILARITY = 0.95


export const SB_HAIR_MINIMUM_LOBE_SHARE = 0.005


export const SB_HAIR_MINIMUM_HIGHLIGHT_SHIFT_RATIO = 0.5


export const SB_HAIR_PROFILE_HALF_RANGE = 0.4
export const SB_HAIR_PROFILE_SAMPLE_COUNT = 2001


export const SB_HAIR_MASS_SAMPLE_COUNT = 4001


export const SB_HAIR_MAXIMUM_PROFILE_MASS_ERROR = 0.002

function integrateBySamples(values, step) {
	let total = 0
	for (let index = 1; values.length > index; index += 1) {
		total += ((values[index - 1] + values[index]) / 2) * step
	}
	return total
}

function sampleProfile(profileAtAngle, startAngle, endAngle, sampleCount) {
	const step = (endAngle - startAngle) / (sampleCount - 1)
	const angles = []
	const values = []
	for (let index = 0; sampleCount > index; index += 1) {
		const angle = startAngle + step * index
		angles.push(angle)
		values.push(profileAtAngle(angle))
	}
	return { angles, values, step }
}


export function sampleLongitudinalProfile(lobeName, hairParameters, halfRange = SB_HAIR_PROFILE_HALF_RANGE) {
	const hair = sanitizeHairParameters(hairParameters)
	return sampleProfile(
		(angle) => longitudinalScattering(lobeName, angle, hair),
		-halfRange,
		halfRange,
		SB_HAIR_PROFILE_SAMPLE_COUNT,
	)
}


export function measureProfileMass(hairParameters) {
	const hair = sanitizeHairParameters(hairParameters)
	const lobes = SB_HAIR_LOBE_NAMES.map((lobeName) => {
		const longitudinal = sampleProfile(
			(angle) => longitudinalScattering(lobeName, angle, hair),
			-Math.PI / 2,
			Math.PI / 2,
			SB_HAIR_MASS_SAMPLE_COUNT,
		)
		const azimuthal = sampleProfile(
			(angle) => azimuthalScattering(lobeName, angle, hair),
			-Math.PI,
			Math.PI,
			SB_HAIR_MASS_SAMPLE_COUNT,
		)
		const longitudinalMass = integrateBySamples(longitudinal.values, longitudinal.step)
		const azimuthalMass = integrateBySamples(azimuthal.values, azimuthal.step)
		return {
			name: lobeName,
			longitudinalMass,
			azimuthalMass,
			worstError: Math.max(Math.abs(1 - longitudinalMass), Math.abs(1 - azimuthalMass)),
		}
	})
	const worstMassError = Math.max(...lobes.map((lobe) => lobe.worstError))
	return {
		lobes,
		worstMassError,
		maximumMassError: SB_HAIR_MAXIMUM_PROFILE_MASS_ERROR,
		normalized: SB_HAIR_MAXIMUM_PROFILE_MASS_ERROR > worstMassError,
	}
}

function cosineSimilarity(firstValues, secondValues) {
	let dotProduct = 0
	let firstNorm = 0
	let secondNorm = 0
	for (let index = 0; firstValues.length > index; index += 1) {
		dotProduct += firstValues[index] * secondValues[index]
		firstNorm += firstValues[index] * firstValues[index]
		secondNorm += secondValues[index] * secondValues[index]
	}
	const denominator = Math.sqrt(firstNorm * secondNorm)
	if (denominator > 0) return dotProduct / denominator
	return 1
}


export function measureLobeShares(hairParameters, viewCosines = SB_HAIR_GATE_VIEW_COSINES) {
	const hair = sanitizeHairParameters(hairParameters)
	const measureByLobe = {}
	SB_HAIR_LOBE_NAMES.forEach((lobeName) => {
		measureByLobe[lobeName] = { name: lobeName, bestShare: 0, worstShare: 1, bestViewCosine: null }
	})
	viewCosines.forEach((viewCosine) => {
		const attenuation = lobeAttenuations(hair, viewCosine, viewCosine)
		const lobeStrengths = SB_HAIR_LOBE_NAMES.map((lobeName) => Math.max(...attenuation.lobes[lobeName]))
		const strengthSum = lobeStrengths.reduce((total, strength) => total + strength, 0)
		SB_HAIR_LOBE_NAMES.forEach((lobeName, lobeIndex) => {
			const share = strengthSum > 0 ? lobeStrengths[lobeIndex] / strengthSum : 0
			const measure = measureByLobe[lobeName]
			if (share > measure.bestShare) {
				measure.bestShare = share
				measure.bestViewCosine = viewCosine
			}
			if (measure.worstShare > share) measure.worstShare = share
		})
	})
	const shares = SB_HAIR_LOBE_NAMES.map((lobeName) => measureByLobe[lobeName])
	return {
		shares,
		minimumBestShare: Math.min(...shares.map((entry) => entry.bestShare)),
		minimumWorstShare: Math.min(...shares.map((entry) => entry.worstShare)),
		minimumAllowedShare: SB_HAIR_MINIMUM_LOBE_SHARE,
		sampleCount: viewCosines.length,
	}
}


export function measureLobeSeparability(hairParameters, viewCosines = SB_HAIR_GATE_VIEW_COSINES) {
	const hair = sanitizeHairParameters(hairParameters)
	const profiles = SB_HAIR_LOBE_NAMES.map((lobeName) => ({
		name: lobeName,
		center: longitudinalLobeCenter(lobeName, hair.cuticleAngle),
		width: longitudinalLobeWidth(lobeName, hair.roughness),
		values: sampleProfile(
			(angle) => longitudinalScattering(lobeName, angle, hair),
			-Math.PI / 2,
			Math.PI / 2,
			SB_HAIR_PROFILE_SAMPLE_COUNT,
		).values,
	}))
	const pairs = []
	for (let firstIndex = 0; profiles.length > firstIndex; firstIndex += 1) {
		for (let secondIndex = firstIndex + 1; profiles.length > secondIndex; secondIndex += 1) {
			pairs.push({
				lobes: profiles[firstIndex].name + "|" + profiles[secondIndex].name,
				similarity: cosineSimilarity(profiles[firstIndex].values, profiles[secondIndex].values),
			})
		}
	}
	const maximumSimilarity = Math.max(...pairs.map((pair) => pair.similarity))
	const shares = measureLobeShares(hair, viewCosines)
	const independentShapes = SB_HAIR_MAXIMUM_LOBE_SIMILARITY > maximumSimilarity
	const measurableShares = shares.minimumBestShare > SB_HAIR_MINIMUM_LOBE_SHARE
	return {
		lobes: profiles.map((profile) => ({ name: profile.name, center: profile.center, width: profile.width })),
		lobeCount: profiles.length,
		pairs,
		maximumSimilarity,
		maximumAllowedSimilarity: SB_HAIR_MAXIMUM_LOBE_SIMILARITY,
		minimumBestShare: shares.minimumBestShare,
		minimumWorstShare: shares.minimumWorstShare,
		shares: shares.shares,
		independentShapes,
		measurableShares,
		separable: independentShapes && measurableShares,
	}
}


export function measureHairEnergy(hairParameters, viewCosines = SB_HAIR_GATE_VIEW_COSINES) {
	const hair = sanitizeHairParameters(hairParameters)
	const samples = viewCosines.map((viewCosine) => {
		const attenuation = lobeAttenuations(hair, viewCosine, viewCosine)
		return {
			viewCosine,
			fresnel: attenuation.fresnel,
			energy: attenuation.energy,
			analyticCeiling: attenuation.energyCeiling,
			withinAnalyticCeiling: attenuation.energyCeiling >= attenuation.energy,
		}
	})
	const worstSample = samples.reduce((worst, sample) => (sample.energy > worst.energy ? sample : worst), samples[0])
	return {
		samples,
		worstEnergy: worstSample.energy,
		worstViewCosine: worstSample.viewCosine,
		analyticCeilingAtWorst: worstSample.analyticCeiling,
		energyCeiling: SB_HAIR_ENERGY_CEILING,
		withinAnalyticCeiling: samples.every((sample) => sample.withinAnalyticCeiling),
		withinEnergyCeiling: SB_HAIR_ENERGY_CEILING >= worstSample.energy,
		sampleCount: samples.length,
	}
}


export function measureHighlightShift(hairParameters, cuticleAngles = SB_HAIR_GATE_CUTICLE_ANGLES) {
	const hair = sanitizeHairParameters(hairParameters)
	const samples = cuticleAngles.map((cuticleAngle) => {
		const tiltedHair = sanitizeHairParameters({ ...hair, cuticleAngle })
		const profile = sampleLongitudinalProfile("R", tiltedHair)
		let peakIndex = 0
		for (let index = 1; profile.values.length > index; index += 1) {
			if (profile.values[index] > profile.values[peakIndex]) peakIndex = index
		}
		const expectedPeak = longitudinalLobeCenter("R", tiltedHair.cuticleAngle)
		const measuredPeak = profile.angles[peakIndex]
		return {
			cuticleAngle: tiltedHair.cuticleAngle,
			measuredPeak,
			expectedPeak,
			peakError: Math.abs(measuredPeak - expectedPeak),
			secondaryPeak: longitudinalLobeCenter("TRT", tiltedHair.cuticleAngle),
			step: profile.step,
		}
	})
	const step = samples[0].step
	let risingCount = 0
	let fallingCount = 0
	for (let index = 1; samples.length > index; index += 1) {
		const delta = samples[index].measuredPeak - samples[index - 1].measuredPeak
		if (delta > step) risingCount += 1
		if (-step > delta) fallingCount += 1
	}
	const transitionCount = samples.length - 1
	const monotonic = risingCount === transitionCount || fallingCount === transitionCount
	const angleSpan = samples[samples.length - 1].cuticleAngle - samples[0].cuticleAngle
	const peakSpan = samples[samples.length - 1].measuredPeak - samples[0].measuredPeak
	const shiftPerCuticleRadian = angleSpan > 0 ? peakSpan / angleSpan : 0
	const lastSample = samples[samples.length - 1]
	return {
		samples,
		searchStep: step,
		monotonic,
		shiftPerCuticleRadian,
		minimumShiftRatio: SB_HAIR_MINIMUM_HIGHLIGHT_SHIFT_RATIO,
		worstPeakError: Math.max(...samples.map((sample) => sample.peakError)),
		primaryToSecondarySeparation: Math.abs(lastSample.secondaryPeak - lastSample.measuredPeak),
		movesWithCuticle: monotonic && Math.abs(shiftPerCuticleRadian) >= SB_HAIR_MINIMUM_HIGHLIGHT_SHIFT_RATIO,
	}
}


export function certifyHairBsdf(options = {}) {
	const hair = sanitizeHairParameters(options.hair)
	const viewCosines = options.viewCosines ?? SB_HAIR_GATE_VIEW_COSINES
	const cuticleAngles = options.cuticleAngles ?? SB_HAIR_GATE_CUTICLE_ANGLES
	const separability = measureLobeSeparability(hair, viewCosines)
	const energy = measureHairEnergy(hair, viewCosines)
	const highlight = measureHighlightShift(hair, cuticleAngles)
	const mass = measureProfileMass(hair)
	const problems = []
	if (SB_HAIR_LOBE_NAMES.length !== separability.lobeCount) problems.push("contagem de lobos diferente de tres")
	if (!separability.independentShapes) {
		problems.push("perfis de lobo parecidos demais: cosseno " + separability.maximumSimilarity.toFixed(6))
	}
	if (!separability.measurableShares) {
		problems.push("fatia de energia de lobo abaixo do piso: " + separability.minimumBestShare.toFixed(6))
	}
	if (!energy.withinEnergyCeiling) problems.push("energia acima de 1: " + energy.worstEnergy.toFixed(6))
	if (!energy.withinAnalyticCeiling) problems.push("energia acima do teto analitico da fibra")
	if (!mass.normalized) problems.push("perfil de lobo fora da massa 1: erro " + mass.worstMassError.toFixed(6))
	if (!highlight.monotonic) problems.push("pico do highlight primario nao e monotonico na cuticula")
	if (!highlight.movesWithCuticle) {
		problems.push("highlight primario quase parado: " + highlight.shiftPerCuticleRadian.toFixed(6) + " rad por rad")
	}
	return { ok: 0 === problems.length, problems, parameters: hair, separability, energy, highlight, mass }
}


export function describeHairBsdf(hairParameters) {
	const certification = certifyHairBsdf({ hair: hairParameters })
	return [
		"lobos: " + SB_HAIR_LOBE_NAMES.join(", "),
		"cosseno maximo entre perfis: " + certification.separability.maximumSimilarity.toFixed(6),
		"menor fatia por lobo na melhor vista dele: " + certification.separability.minimumBestShare.toFixed(6),
		"pior energia: " + certification.energy.worstEnergy.toFixed(6) + " (teto " + SB_HAIR_ENERGY_CEILING + ")",
		"deslocamento do highlight: " + certification.highlight.shiftPerCuticleRadian.toFixed(6) + " rad por rad",
		"pior erro de massa de perfil: " + certification.mass.worstMassError.toFixed(6),
		certification.ok ? "portao: ok" : "portao: " + certification.problems.join("; "),
	].join("\n")
}

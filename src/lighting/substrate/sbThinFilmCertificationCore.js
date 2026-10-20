import { SB_GATES } from "./sbMaterialContract.js"
import {
	SB_THIN_FILM_CHANNEL_COUNT,
	SB_THIN_FILM_MAXIMUM_THICKNESS_NANOMETERS,
	computeBaseFresnel,
	computeThinFilmReflectance,
	computeThinFilmSpecularTint,
	describeThinFilmInterference,
	reflectanceFromInterference,
} from "./sbThinFilmCore.js"
import { computeColorDeltaE76, integrateThinFilmSpectralColor } from "./sbThinFilmSpectralReferenceCore.js"


export const SB_THIN_FILM_GATE_VIEW_ANGLES_DEGREES = Object.freeze([0, 10, 20, 30, 40, 50, 60, 70])


export const SB_THIN_FILM_GATE_THICKNESSES_NANOMETERS = Object.freeze([180, 320, 450, 580])


export const SB_THIN_FILM_GATE_FILM_IOR = 1.33


export const SB_THIN_FILM_GATE_BASES = Object.freeze([
	Object.freeze({ id: "dielectric", baseNormalReflectance: 0.04 }),
	Object.freeze({ id: "goldMetal", baseNormalReflectance: Object.freeze([0.944, 0.776, 0.373]) }),
])


export const SB_THIN_FILM_MINIMUM_VISIBLE_DELTA_E76 = 5


export const SB_THIN_FILM_CONVERGENCE_RATIO_GATE = 0.5

const NEAR_CONVERGENCE_THICKNESS_NANOMETERS = 300
const RANGE_THICKNESS_STEP_NANOMETERS = 50
const RANGE_FILM_IORS = Object.freeze([1.2, 1.33, 1.5, 2, 3])
const DEFAULT_VIEW_COSINE = 0.7

function cosineOfDegrees(angleDegrees) {
	return Math.cos((angleDegrees * Math.PI) / 180)
}

function maximumChannelDeviation(left, right) {
	let worst = 0
	for (let channelIndex = 0; SB_THIN_FILM_CHANNEL_COUNT > channelIndex; channelIndex += 1) {
		worst = Math.max(worst, Math.abs(left[channelIndex] - right[channelIndex]))
	}
	return worst
}

function gateOptions(options) {
	return {
		viewAnglesDegrees: options?.viewAnglesDegrees ?? SB_THIN_FILM_GATE_VIEW_ANGLES_DEGREES,
		thicknessesNanometers: options?.thicknessesNanometers ?? SB_THIN_FILM_GATE_THICKNESSES_NANOMETERS,
		bases: options?.bases ?? SB_THIN_FILM_GATE_BASES,
		filmIor: options?.filmIor ?? SB_THIN_FILM_GATE_FILM_IOR,
		gates: options?.gates ?? SB_GATES,
	}
}


export function measureThinFilmSpectralAgreement(options) {
	const { viewAnglesDegrees, thicknessesNanometers, bases, filmIor, gates } = gateOptions(options)
	const tolerance = gates.maxThinFilmDeltaE76
	const entries = []
	for (const base of bases) {
		for (const thicknessNanometers of thicknessesNanometers) {
			for (const viewAngleDegrees of viewAnglesDegrees) {
				const sample = {
					baseNormalReflectance: base.baseNormalReflectance,
					cosThetaView: cosineOfDegrees(viewAngleDegrees),
					thicknessNanometers,
					filmIor,
				}
				const modelColor = computeThinFilmReflectance(sample)
				const referenceColor = integrateThinFilmSpectralColor(sample)
				entries.push({
					baseId: base.id,
					viewAngleDegrees,
					thicknessNanometers,
					deltaE76: computeColorDeltaE76(modelColor, referenceColor),
					modelColor,
					referenceColor,
				})
			}
		}
	}
	const worstEntry = entries.reduce((worst, entry) => (worst === null || entry.deltaE76 > worst.deltaE76 ? entry : worst), null)
	const worstDeltaE76 = worstEntry === null ? 0 : worstEntry.deltaE76
	const averageDeltaE76 = entries.length === 0 ? 0 : entries.reduce((sum, entry) => sum + entry.deltaE76, 0) / entries.length
	return {
		ok: tolerance >= worstDeltaE76,
		tolerance,
		worstDeltaE76,
		averageDeltaE76,
		worstEntry,
		sampleCount: entries.length,
		angleCount: viewAnglesDegrees.length,
		thicknessCount: thicknessesNanometers.length,
		entries,
	}
}


export function measureThinFilmNeutrality(options) {
	const { viewAnglesDegrees, bases, filmIor } = gateOptions(options)
	const failures = []
	let checkedCount = 0
	for (const base of bases) {
		for (const viewAngleDegrees of viewAnglesDegrees) {
			const cosThetaView = cosineOfDegrees(viewAngleDegrees)
			const sample = { baseNormalReflectance: base.baseNormalReflectance, cosThetaView, thicknessNanometers: 0, filmIor }
			const baseFresnel = computeBaseFresnel(base.baseNormalReflectance, cosThetaView)
			const reflectance = computeThinFilmReflectance(sample)
			const tint = computeThinFilmSpecularTint(sample)
			checkedCount += 1
			for (let channelIndex = 0; SB_THIN_FILM_CHANNEL_COUNT > channelIndex; channelIndex += 1) {
				if (reflectance[channelIndex] !== baseFresnel[channelIndex]) {
					failures.push({ baseId: base.id, viewAngleDegrees, channelIndex, kind: "refletancia" })
				}
				if (tint[channelIndex] !== 1) {
					failures.push({ baseId: base.id, viewAngleDegrees, channelIndex, kind: "tint" })
				}
			}
		}
	}
	return { ok: failures.length === 0, checkedCount, failures }
}


export function measureThinFilmRange(options) {
	const { viewAnglesDegrees, bases } = gateOptions(options)
	let minimumReflectance = Number.POSITIVE_INFINITY
	let maximumReflectance = Number.NEGATIVE_INFINITY
	let sampleCount = 0
	const failures = []
	for (const base of bases) {
		for (const filmIor of RANGE_FILM_IORS) {
			for (
				let thicknessNanometers = 0;
				SB_THIN_FILM_MAXIMUM_THICKNESS_NANOMETERS >= thicknessNanometers;
				thicknessNanometers += RANGE_THICKNESS_STEP_NANOMETERS
			) {
				for (const viewAngleDegrees of viewAnglesDegrees) {
					const reflectance = computeThinFilmReflectance({
						baseNormalReflectance: base.baseNormalReflectance,
						cosThetaView: cosineOfDegrees(viewAngleDegrees),
						thicknessNanometers,
						filmIor,
					})
					sampleCount += 1
					for (const channel of reflectance) {
						if (!Number.isFinite(channel) || 0 > channel || channel > 1) {
							failures.push({ baseId: base.id, filmIor, thicknessNanometers, viewAngleDegrees, channel })
						}
						minimumReflectance = Math.min(minimumReflectance, channel)
						maximumReflectance = Math.max(maximumReflectance, channel)
					}
				}
			}
		}
	}
	return {
		ok: failures.length === 0,
		sampleCount,
		minimumReflectance,
		maximumReflectance,
		failures: failures.slice(0, 8),
		failureCount: failures.length,
	}
}


export function measureThinFilmVisibility(options) {
	const { thicknessesNanometers, bases, filmIor } = gateOptions(options)
	let maximumDeltaE76 = 0
	let loudestSample = null
	for (const base of bases) {
		const baseFresnel = computeBaseFresnel(base.baseNormalReflectance, DEFAULT_VIEW_COSINE)
		for (const thicknessNanometers of thicknessesNanometers) {
			const reflectance = computeThinFilmReflectance({
				baseNormalReflectance: base.baseNormalReflectance,
				cosThetaView: DEFAULT_VIEW_COSINE,
				thicknessNanometers,
				filmIor,
			})
			const deltaE76 = computeColorDeltaE76(reflectance, baseFresnel)
			if (deltaE76 > maximumDeltaE76) {
				maximumDeltaE76 = deltaE76
				loudestSample = { baseId: base.id, thicknessNanometers, deltaE76 }
			}
		}
	}
	return {
		ok: maximumDeltaE76 >= SB_THIN_FILM_MINIMUM_VISIBLE_DELTA_E76,
		maximumDeltaE76,
		minimumRequired: SB_THIN_FILM_MINIMUM_VISIBLE_DELTA_E76,
		loudestSample,
	}
}


export function measureThinFilmConvergence(options) {
	const { bases, filmIor } = gateOptions(options)
	const base = bases[0]
	const amplitudeAt = (thicknessNanometers) => {
		const interference = describeThinFilmInterference({
			baseNormalReflectance: base.baseNormalReflectance,
			cosThetaView: DEFAULT_VIEW_COSINE,
			thicknessNanometers,
			filmIor,
		})
		return maximumChannelDeviation(reflectanceFromInterference(interference), interference.constantTerm)
	}
	const nearAmplitude = amplitudeAt(NEAR_CONVERGENCE_THICKNESS_NANOMETERS)
	const farAmplitude = amplitudeAt(SB_THIN_FILM_MAXIMUM_THICKNESS_NANOMETERS)
	const ratio = nearAmplitude === 0 ? 0 : farAmplitude / nearAmplitude
	return {
		ok: SB_THIN_FILM_CONVERGENCE_RATIO_GATE >= ratio,
		nearThicknessNanometers: NEAR_CONVERGENCE_THICKNESS_NANOMETERS,
		farThicknessNanometers: SB_THIN_FILM_MAXIMUM_THICKNESS_NANOMETERS,
		nearAmplitude,
		farAmplitude,
		ratio,
		gate: SB_THIN_FILM_CONVERGENCE_RATIO_GATE,
	}
}


export function certifyThinFilm(options) {
	const spectralAgreement = measureThinFilmSpectralAgreement(options)
	const neutrality = measureThinFilmNeutrality(options)
	const range = measureThinFilmRange(options)
	const visibility = measureThinFilmVisibility(options)
	const convergence = measureThinFilmConvergence(options)
	const problems = []
	if (!spectralAgreement.ok) {
		problems.push(
			"deltaE76 " +
				spectralAgreement.worstDeltaE76.toFixed(3) +
				" passou do portao " +
				spectralAgreement.tolerance +
				" (base " +
				(spectralAgreement.worstEntry?.baseId ?? "?") +
				", " +
				(spectralAgreement.worstEntry?.thicknessNanometers ?? "?") +
				" nm, " +
				(spectralAgreement.worstEntry?.viewAngleDegrees ?? "?") +
				" graus)",
		)
	}
	if (!neutrality.ok) problems.push("espessura zero mudou a imagem em " + neutrality.failures.length + " canais")
	if (!range.ok) problems.push("refletancia fora de 0..1 em " + range.failureCount + " amostras")
	if (!visibility.ok) {
		problems.push(
			"efeito invisivel: deltaE76 maximo " +
				visibility.maximumDeltaE76.toFixed(3) +
				" abaixo do minimo " +
				visibility.minimumRequired,
		)
	}
	if (!convergence.ok) problems.push("franja nao converge: razao " + convergence.ratio.toFixed(4))
	return {
		ok: problems.length === 0,
		problems,
		spectralAgreement,
		neutrality,
		range,
		visibility,
		convergence,
	}
}

import { SB_GATES } from "./sbMaterialContract.js"
import { computeSsim } from "./support/src/qa/sbImageMetrics.js"
import { evaluateSlabSpecularBrdf, smithVisibilityHeightCorrelated } from "./sbSlabSpecularCore.js"
import {
	anisotropicAlphaSplit,
	anisotropicBentNormalBlend,
	anisotropicGgxDistribution,
	anisotropicHighlightStretch,
	anisotropicSmithVisibility,
	evaluateAnisotropicSpecularBrdf,
	evaluateAnisotropicSpecularBrdfInFrameSpace,
	normalizeAnisotropicSlab,
} from "./sbAnisotropyCore.js"
import { buildTangentFrame, rotateVectorAroundAxis } from "./sbTangentFrameCore.js"


export const SB_ANISOTROPY_INSTALL_RESOLUTION = Object.freeze({
	albedoPolarSteps: 128,
	albedoAzimuthSteps: 64,
	normalizationPolarSteps: 256,
	normalizationAzimuthSteps: 128,
	highlightMapSize: 48,
})


export const SB_ANISOTROPY_CONSOLE_RESOLUTION = Object.freeze({
	albedoPolarSteps: 192,
	albedoAzimuthSteps: 96,
	normalizationPolarSteps: 512,
	normalizationAzimuthSteps: 256,
	highlightMapSize: 64,
})

const CERTIFIED_PHASE_ID = "SB-F11"
const PARITY_TOLERANCE = 1e-9
const CERTIFICATION_ROUGHNESSES = Object.freeze([0.4, 0.6, 0.85])
const CERTIFICATION_ANISOTROPIES = Object.freeze([0, 0.25, 0.5])
const CERTIFICATION_VIEW_COSINES = Object.freeze([0.35, 0.6, 0.9])
const CERTIFICATION_LIGHT_COSINES = Object.freeze([0.2, 0.45, 0.7, 0.95])
const CERTIFICATION_LIGHT_AZIMUTHS = Object.freeze([0, 0.7, 1.9, 3.4, 5.1])
const ALBEDO_VIEW_COSINE = 0.6
const ALBEDO_VIEW_AZIMUTHS = Object.freeze([0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4])
const STREAK_PERTURBATION_RADIANS = 0.25
const HIGHLIGHT_TARGET_PEAK = 200
const BASE_NORMAL = Object.freeze([0, 0, 1])
const BASE_TANGENT = Object.freeze([1, 0, 0])
const WORLD_UP_FOR_CONTROL = Object.freeze([0, 1, 0])
const POSE_SLAB = Object.freeze({ f0: [0.04, 0.04, 0.04], f90: 1, roughness: 0.35, anisotropy: 0.8, anisotropyRotation: 0.4 })
const POSE_ROTATIONS = Object.freeze([
	Object.freeze({ label: "giro em torno da normal", axis: Object.freeze([0, 0, 1]), radians: 0.96 }),
	Object.freeze({ label: "giro em eixo obliquo", axis: Object.freeze([0.4, 0.7, 0.6]), radians: 0.82 }),
])


function directionFromCosine(cosine, azimuth) {
	const clampedCosine = Math.min(Math.max(cosine, 0), 1)
	const sine = Math.sqrt(Math.max(1 - clampedCosine * clampedCosine, 0))
	return [sine * Math.cos(azimuth), sine * Math.sin(azimuth), clampedCosine]
}

const BASE_VIEW_DIRECTION = Object.freeze(directionFromCosine(0.65, 0.6))


export function formatPercent(value) {
	return `${(value * 100).toFixed(2)}%`
}

function resolveResolution(resolution) {
	return { ...SB_ANISOTROPY_CONSOLE_RESOLUTION, ...(resolution ?? {}) }
}

function relativeDifference(measured, expected) {
	return Math.abs(measured - expected) / Math.max(Math.abs(expected), 1e-9)
}

function buildTestSlab(roughness, anisotropy, anisotropyRotation) {
	return { f0: [0.04, 0.04, 0.04], f90: 1, roughness, anisotropy, anisotropyRotation: anisotropyRotation ?? 0 }
}

function buildWhiteFurnaceSlab(roughness, anisotropy) {
	return { f0: [1, 1, 1], f90: 1, roughness, anisotropy, anisotropyRotation: 0 }
}


export function measureIsotropicLobeParity() {
	let worstRelativeDifference = 0
	let comparisonCount = 0
	for (const roughness of CERTIFICATION_ROUGHNESSES) {
		const slab = buildTestSlab(roughness, 0)
		const normalizedSlab = normalizeAnisotropicSlab(slab)
		const split = anisotropicAlphaSplit({ normalizedSlab })
		for (const viewCosine of CERTIFICATION_VIEW_COSINES) {
			const viewDirection = directionFromCosine(viewCosine, 0)
			for (const lightCosine of CERTIFICATION_LIGHT_COSINES) {
				for (const azimuth of CERTIFICATION_LIGHT_AZIMUTHS) {
					const lightDirection = directionFromCosine(lightCosine, azimuth)
					const anisotropicLobe = evaluateAnisotropicSpecularBrdfInFrameSpace({
						normalizedSlab,
						split,
						viewDirection,
						lightDirection,
					})
					const isotropicLobe = evaluateSlabSpecularBrdf({ slab, viewDirection, lightDirection })
					worstRelativeDifference = Math.max(
						worstRelativeDifference,
						relativeDifference(anisotropicLobe[0], isotropicLobe[0]),
					)
					comparisonCount += 1
				}
			}
		}
	}
	return {
		comparisonCount,
		worstRelativeDifference,
		tolerance: PARITY_TOLERANCE,
		ok: PARITY_TOLERANCE >= worstRelativeDifference,
	}
}


export function measureDistributionNormalization(options = {}) {
	const gates = options.gates ?? SB_GATES
	const resolution = resolveResolution(options.resolution)
	const polarStepCount = resolution.normalizationPolarSteps
	const azimuthStepCount = resolution.normalizationAzimuthSteps
	const polarStep = Math.PI / 2 / polarStepCount
	const azimuthStep = (2 * Math.PI) / azimuthStepCount
	let worstDeviation = 0
	let measurementCount = 0
	for (const roughness of CERTIFICATION_ROUGHNESSES) {
		for (const anisotropy of CERTIFICATION_ANISOTROPIES) {
			const split = anisotropicAlphaSplit({ slab: buildTestSlab(roughness, anisotropy) })
			let integral = 0
			for (let polarIndex = 0; polarStepCount > polarIndex; polarIndex += 1) {
				const polarAngle = (polarIndex + 0.5) * polarStep
				const cosinePolar = Math.cos(polarAngle)
				const sinePolar = Math.sin(polarAngle)
				for (let azimuthIndex = 0; azimuthStepCount > azimuthIndex; azimuthIndex += 1) {
					const azimuth = (azimuthIndex + 0.5) * azimuthStep
					const halfVector = [sinePolar * Math.cos(azimuth), sinePolar * Math.sin(azimuth), cosinePolar]
					integral += anisotropicGgxDistribution(halfVector, split) * cosinePolar * sinePolar * polarStep * azimuthStep
				}
			}
			worstDeviation = Math.max(worstDeviation, Math.abs(integral - 1))
			measurementCount += 1
		}
	}
	const gate = gates.maxReferenceEnergyDeviation
	return { measurementCount, worstDeviation, gate, ok: gate >= worstDeviation }
}


function integrateDirectionalAlbedo(options) {
	const resolution = options.resolution
	const polarStepCount = resolution.albedoPolarSteps
	const azimuthStepCount = resolution.albedoAzimuthSteps
	const polarStep = Math.PI / 2 / polarStepCount
	const azimuthStep = (2 * Math.PI) / azimuthStepCount
	let albedo = 0
	for (let polarIndex = 0; polarStepCount > polarIndex; polarIndex += 1) {
		const polarAngle = (polarIndex + 0.5) * polarStep
		const cosinePolar = Math.cos(polarAngle)
		const sinePolar = Math.sin(polarAngle)
		for (let azimuthIndex = 0; azimuthStepCount > azimuthIndex; azimuthIndex += 1) {
			const azimuth = (azimuthIndex + 0.5) * azimuthStep
			const lightDirection = [sinePolar * Math.cos(azimuth), sinePolar * Math.sin(azimuth), cosinePolar]
			const lobe = evaluateAnisotropicSpecularBrdfInFrameSpace({
				normalizedSlab: options.normalizedSlab,
				split: options.split,
				viewDirection: options.viewDirection,
				lightDirection,
			})
			albedo += lobe[0] * cosinePolar * sinePolar * polarStep * azimuthStep
		}
	}
	return albedo
}


const ANISOTROPY_ROTATION_PROBE_RADIANS = 0.7


function measureAzimuthalAlbedoMean(options) {
	let albedoSum = 0
	let worstAlbedo = 0
	for (const viewAzimuth of ALBEDO_VIEW_AZIMUTHS) {
		const albedo = integrateDirectionalAlbedo({
			normalizedSlab: options.normalizedSlab,
			split: options.split,
			viewDirection: directionFromCosine(ALBEDO_VIEW_COSINE, viewAzimuth - options.frameRotationRadians),
			resolution: options.resolution,
		})
		albedoSum += albedo
		worstAlbedo = Math.max(worstAlbedo, albedo)
	}
	return {
		mean: albedoSum / ALBEDO_VIEW_AZIMUTHS.length,
		worstAlbedo,
		measurementCount: ALBEDO_VIEW_AZIMUTHS.length,
	}
}


export function measureAnisotropicEnergyAgreement(options = {}) {
	const gates = options.gates ?? SB_GATES
	const resolution = resolveResolution(options.resolution)
	let worstAlbedo = 0
	let worstAzimuthalDeviation = 0
	let worstEnergyShiftFromIsotropy = 0
	let measurementCount = 0
	for (const roughness of CERTIFICATION_ROUGHNESSES) {
		let isotropicAzimuthalMean = null
		for (const anisotropy of CERTIFICATION_ANISOTROPIES) {
			const normalizedSlab = normalizeAnisotropicSlab(buildWhiteFurnaceSlab(roughness, anisotropy))
			const split = anisotropicAlphaSplit({ normalizedSlab })
			const restingFrame = measureAzimuthalAlbedoMean({
				normalizedSlab,
				split,
				resolution,
				frameRotationRadians: 0,
			})
			const rotatedFrame = measureAzimuthalAlbedoMean({
				normalizedSlab,
				split,
				resolution,
				frameRotationRadians: ANISOTROPY_ROTATION_PROBE_RADIANS,
			})
			worstAlbedo = Math.max(worstAlbedo, restingFrame.worstAlbedo, rotatedFrame.worstAlbedo)
			measurementCount += restingFrame.measurementCount + rotatedFrame.measurementCount
			worstAzimuthalDeviation = Math.max(
				worstAzimuthalDeviation,
				relativeDifference(rotatedFrame.mean, restingFrame.mean),
			)
			if (isotropicAzimuthalMean === null) isotropicAzimuthalMean = restingFrame.mean
			else
				worstEnergyShiftFromIsotropy = Math.max(
					worstEnergyShiftFromIsotropy,
					relativeDifference(restingFrame.mean, isotropicAzimuthalMean),
				)
		}
	}
	const gate = gates.maxReferenceEnergyDeviation
	const energyIsConserved = 1 + gate >= worstAlbedo
	return {
		measurementCount,
		worstAlbedo,
		worstAzimuthalDeviation,
		worstEnergyShiftFromIsotropy,
		gate,
		energyIsConserved,
		ok: energyIsConserved && gate >= worstAzimuthalDeviation,
	}
}


export function measureVisibilityParity() {
	let worstRelativeDifference = 0
	let comparisonCount = 0
	for (const roughness of CERTIFICATION_ROUGHNESSES) {
		const normalizedSlab = normalizeAnisotropicSlab(buildTestSlab(roughness, 0))
		const split = anisotropicAlphaSplit({ normalizedSlab })
		for (const viewCosine of CERTIFICATION_VIEW_COSINES) {
			const viewDirection = directionFromCosine(viewCosine, 0)
			for (const lightCosine of CERTIFICATION_LIGHT_COSINES) {
				const lightDirection = directionFromCosine(lightCosine, 2.1)
				const anisotropicVisibility = anisotropicSmithVisibility(viewDirection, lightDirection, split)
				const isotropicVisibility = smithVisibilityHeightCorrelated(viewCosine, lightCosine, normalizedSlab.alpha)
				worstRelativeDifference = Math.max(
					worstRelativeDifference,
					relativeDifference(anisotropicVisibility, isotropicVisibility),
				)
				comparisonCount += 1
			}
		}
	}
	return {
		comparisonCount,
		worstRelativeDifference,
		tolerance: PARITY_TOLERANCE,
		ok: PARITY_TOLERANCE >= worstRelativeDifference,
	}
}


function buildRotatedRig(rotation) {
	return {
		rotation,
		normal: rotateVectorAroundAxis(BASE_NORMAL, rotation.axis, rotation.radians),
		tangent: rotateVectorAroundAxis(BASE_TANGENT, rotation.axis, rotation.radians),
		viewDirection: rotateVectorAroundAxis(BASE_VIEW_DIRECTION, rotation.axis, rotation.radians),
	}
}


function buildSurfaceFrameForRig(rig) {
	return buildTangentFrame({
		normal: rig.normal,
		tangent: rig.tangent,
		anisotropyRotation: POSE_SLAB.anisotropyRotation,
	})
}


function buildWorldUpFrameForRig(rig) {
	return buildTangentFrame({
		normal: rig.normal,
		tangent: WORLD_UP_FOR_CONTROL,
		anisotropyRotation: POSE_SLAB.anisotropyRotation,
	})
}


function buildHighlightMap(rig, buildFrameForRig, mapSize) {
	const frame = buildFrameForRig(rig)
	const values = new Float32Array(mapSize * mapSize)
	for (let row = 0; mapSize > row; row += 1) {
		const lightCosine = (row + 0.5) / mapSize
		for (let column = 0; mapSize > column; column += 1) {
			const azimuth = ((column + 0.5) / mapSize) * 2 * Math.PI
			const lightDirection = rotateVectorAroundAxis(
				directionFromCosine(lightCosine, azimuth),
				rig.rotation.axis,
				rig.rotation.radians,
			)
			const lobe = evaluateAnisotropicSpecularBrdf({
				slab: POSE_SLAB,
				frame,
				viewDirection: rig.viewDirection,
				lightDirection,
			})
			values[row * mapSize + column] = lobe[0]
		}
	}
	return values
}


function toLumaPlane(values, scale) {
	const lumaPlane = new Float32Array(values.length)
	for (let index = 0; values.length > index; index += 1) {
		lumaPlane[index] = Math.min(values[index] * scale, 255)
	}
	return lumaPlane
}

function measurePoseSsim(buildFrameForRig, rotation, mapSize) {
	const referenceRig = buildRotatedRig({ label: "pose base", axis: BASE_NORMAL, radians: 0 })
	const referenceValues = buildHighlightMap(referenceRig, buildFrameForRig, mapSize)
	let peakValue = 0
	for (let index = 0; referenceValues.length > index; index += 1) {
		peakValue = Math.max(peakValue, referenceValues[index])
	}
	const scale = HIGHLIGHT_TARGET_PEAK / Math.max(peakValue, 1e-9)
	const rotatedValues = buildHighlightMap(buildRotatedRig(rotation), buildFrameForRig, mapSize)
	return computeSsim(toLumaPlane(referenceValues, scale), toLumaPlane(rotatedValues, scale), mapSize, mapSize)
}


export function measureHighlightPoseStability(options = {}) {
	const gates = options.gates ?? SB_GATES
	const resolution = resolveResolution(options.resolution)
	const mapSize = resolution.highlightMapSize
	const gate = gates.anisotropyPoseMinimumSsim
	const poses = POSE_ROTATIONS.map((rotation) => ({
		label: rotation.label,
		surfaceFrameSsim: measurePoseSsim(buildSurfaceFrameForRig, rotation, mapSize),
		worldUpControlSsim: measurePoseSsim(buildWorldUpFrameForRig, rotation, mapSize),
	}))
	const worstSurfaceFrameSsim = Math.min(...poses.map((pose) => pose.surfaceFrameSsim))
	const worstControlSsim = Math.min(...poses.map((pose) => pose.worldUpControlSsim))
	const controlIsRejected = gate > worstControlSsim
	return {
		mapSize,
		poses,
		worstSurfaceFrameSsim,
		worstControlSsim,
		gate,
		controlIsRejected,
		ok: worstSurfaceFrameSsim >= gate && controlIsRejected,
	}
}

const STREAK_SLAB = Object.freeze(buildTestSlab(0.35, 0.8))


function measureLobeAlongWorldAxes(anisotropyRotation) {
	const frame = buildTangentFrame({ normal: BASE_NORMAL, tangent: BASE_TANGENT, anisotropyRotation })
	const viewDirection = [0, 0, 1]
	const lightTowardWorldX = rotateVectorAroundAxis(viewDirection, [0, 1, 0], STREAK_PERTURBATION_RADIANS)
	const lightTowardWorldY = rotateVectorAroundAxis(viewDirection, [1, 0, 0], STREAK_PERTURBATION_RADIANS)
	return {
		alongWorldX: evaluateAnisotropicSpecularBrdf({
			slab: STREAK_SLAB,
			frame,
			viewDirection,
			lightDirection: lightTowardWorldX,
		})[0],
		alongWorldY: evaluateAnisotropicSpecularBrdf({
			slab: STREAK_SLAB,
			frame,
			viewDirection,
			lightDirection: lightTowardWorldY,
		})[0],
	}
}


export function measureStreakOrientation() {
	const unrotated = measureLobeAlongWorldAxes(0)
	const quarterTurned = measureLobeAlongWorldAxes(Math.PI / 2)
	const stretch = anisotropicHighlightStretch(anisotropicAlphaSplit({ slab: STREAK_SLAB }))
	const stretchesAlongTangent = unrotated.alongWorldX > unrotated.alongWorldY
	const rotationSwapsAxes = quarterTurned.alongWorldY > quarterTurned.alongWorldX
	return {
		stretch,
		unrotated,
		quarterTurned,
		stretchesAlongTangent,
		rotationSwapsAxes,
		ok: stretchesAlongTangent && rotationSwapsAxes,
	}
}


export function measureBentNormalNeutrality() {
	const neutralBlend = anisotropicBentNormalBlend({ slab: buildTestSlab(0.4, 0) })
	const anisotropicBlend = anisotropicBentNormalBlend({ slab: buildTestSlab(0.4, 0.8) })
	return { neutralBlend, anisotropicBlend, ok: neutralBlend === 1 && 1 > anisotropicBlend }
}


export function certifyAnisotropy(options = {}) {
	const gates = options.gates ?? SB_GATES
	const resolution = resolveResolution(options.resolution)
	const lobeParity = measureIsotropicLobeParity()
	const visibilityParity = measureVisibilityParity()
	const distributionNormalization = measureDistributionNormalization({ gates, resolution })
	const energyAgreement = measureAnisotropicEnergyAgreement({ gates, resolution })
	const poseStability = measureHighlightPoseStability({ gates, resolution })
	const streakOrientation = measureStreakOrientation()
	const bentNormalNeutrality = measureBentNormalNeutrality()
	const problems = []
	if (!lobeParity.ok) {
		problems.push(
			`lobo com anisotropia 0 nao bate com a SB-F10: pior diferenca ${lobeParity.worstRelativeDifference.toExponential(2)}`,
		)
	}
	if (!visibilityParity.ok) {
		problems.push(
			`visibilidade anisotropica nao reduz a isotropica: pior diferenca ${visibilityParity.worstRelativeDifference.toExponential(2)}`,
		)
	}
	if (!distributionNormalization.ok) {
		problems.push(
			`D nao integra 1: desvio de ${formatPercent(distributionNormalization.worstDeviation)} no portao de ${formatPercent(distributionNormalization.gate)}`,
		)
	}
	if (!energyAgreement.energyIsConserved) {
		problems.push(`albedo do forno branco passou de 1: ${energyAgreement.worstAlbedo.toFixed(4)}`)
	} else if (!energyAgreement.ok) {
		problems.push(
			`girar a anisotropia mudou a media azimutal do albedo em ${formatPercent(energyAgreement.worstAzimuthalDeviation)} no portao de ${formatPercent(energyAgreement.gate)}`,
		)
	}
	if (!poseStability.ok) {
		problems.push(
			`highlight nao ficou preso a superficie: SSIM ${poseStability.worstSurfaceFrameSsim.toFixed(6)} no portao de ${poseStability.gate} (controle ${poseStability.worstControlSsim.toFixed(4)})`,
		)
	}
	if (!streakOrientation.ok) problems.push("estria nao seguiu a tangente nem a rotacao da anisotropia")
	if (!bentNormalNeutrality.ok) problems.push("normal desviada nao e neutra com anisotropia 0")
	return {
		phaseId: CERTIFIED_PHASE_ID,
		ok: problems.length === 0,
		problems,
		lobeParity,
		visibilityParity,
		distributionNormalization,
		energyAgreement,
		poseStability,
		streakOrientation,
		bentNormalNeutrality,
		gates: {
			anisotropyPoseMinimumSsim: gates.anisotropyPoseMinimumSsim,
			maxReferenceEnergyDeviation: gates.maxReferenceEnergyDeviation,
		},
	}
}

const DEFAULT_SAMPLE_COUNT = 256
const FURNACE_COSINE_ANGLES = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1]

function radicalInverseBase2(bits) {
	let value = bits
	value = (value << 16) | (value >>> 16)
	value = ((value & 0x55555555) << 1) | ((value & 0xaaaaaaaa) >>> 1)
	value = ((value & 0x33333333) << 2) | ((value & 0xcccccccc) >>> 2)
	value = ((value & 0x0f0f0f0f) << 4) | ((value & 0xf0f0f0f0) >>> 4)
	value = ((value & 0x00ff00ff) << 8) | ((value & 0xff00ff00) >>> 8)
	return (value >>> 0) * 2.3283064365386963e-10
}


export function hammersleyPoint(index, sampleCount) {
	return { u: index / sampleCount, v: radicalInverseBase2(index) }
}

export function ggxImportanceSampleHalfVector(u, v, roughness) {
	const alpha = Math.max(1e-4, roughness * roughness)
	const phi = 2 * Math.PI * u
	const cosTheta = Math.sqrt((1 - v) / (1 + (alpha * alpha - 1) * v))
	const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta))
	return { x: sinTheta * Math.cos(phi), y: sinTheta * Math.sin(phi), z: cosTheta }
}

export function smithG1HeightCorrelated(cosTheta, alpha) {
	const cosSquared = cosTheta * cosTheta
	const tanSquared = (1 - cosSquared) / Math.max(1e-8, cosSquared)
	return 2 / (1 + Math.sqrt(1 + alpha * alpha * tanSquared))
}


export function directionalAlbedoSingleScatter(cosThetaView, roughness, sampleCount) {
	const samples = sampleCount ?? DEFAULT_SAMPLE_COUNT
	const alpha = Math.max(1e-4, roughness * roughness)
	const viewDirection = {
		x: Math.sqrt(Math.max(0, 1 - cosThetaView * cosThetaView)),
		y: 0,
		z: Math.max(1e-4, cosThetaView),
	}
	let albedoSum = 0

	for (let index = 0; index < samples; index += 1) {
		const { u, v } = hammersleyPoint(index, samples)
		const halfVector = ggxImportanceSampleHalfVector(u, v, roughness)
		const viewDotHalf =
			viewDirection.x * halfVector.x + viewDirection.y * halfVector.y + viewDirection.z * halfVector.z
		if (viewDotHalf <= 0) continue

		const lightDirection = {
			x: 2 * viewDotHalf * halfVector.x - viewDirection.x,
			y: 2 * viewDotHalf * halfVector.y - viewDirection.y,
			z: 2 * viewDotHalf * halfVector.z - viewDirection.z,
		}
		if (lightDirection.z <= 0) continue

		const shadowing = smithG1HeightCorrelated(viewDirection.z, alpha)
		const masking = smithG1HeightCorrelated(lightDirection.z, alpha)
		const visibility = (shadowing * masking) / Math.max(1e-8, shadowing + masking - shadowing * masking)
		albedoSum += visibility * (viewDotHalf / Math.max(1e-8, viewDirection.z * halfVector.z))
	}

	return albedoSum / samples
}


export function multiScatterCompensation(singleScatterAlbedo, fresnelAverage) {
	const averageFresnel = fresnelAverage ?? 1
	const missingEnergy = Math.min(1, Math.max(0, 1 - singleScatterAlbedo))
	const singleScatterEnergy = averageFresnel * singleScatterAlbedo
	const energyLeftAfterOneBounce = Math.max(1e-6, 1 - averageFresnel * missingEnergy)
	const multiScatterEnergy = (singleScatterEnergy * averageFresnel * missingEnergy) / energyLeftAfterOneBounce
	return {
		missingEnergy,
		multiScatterEnergy,
		compensated: singleScatterEnergy + multiScatterEnergy,
	}
}


export function whiteFurnaceQuickCheck(slab, options) {
	const roughness = slab?.roughness ?? 0.4
	const sampleCount = options?.sampleCount ?? DEFAULT_SAMPLE_COUNT
	const perAngle = FURNACE_COSINE_ANGLES.map((cosTheta) => {
		const singleScatter = directionalAlbedoSingleScatter(cosTheta, roughness, sampleCount)
		const compensation = multiScatterCompensation(singleScatter)
		return {
			cosTheta,
			singleScatter,
			missingEnergy: compensation.missingEnergy,
			multiScatterEnergy: compensation.multiScatterEnergy,
			compensated: compensation.compensated,
		}
	})

	const compensatedValues = perAngle.map((entry) => entry.compensated)
	const worstSingleScatter = Math.min(...perAngle.map((entry) => entry.singleScatter))

	return {
		roughness,
		sampleCount,
		perAngle,
		compensatedMinimum: Math.min(...compensatedValues),
		compensatedMaximum: Math.max(...compensatedValues),
		worstSingleScatter,
		note: "atalho da base; a SB-F5 substitui por integrador de referencia",
	}
}


export function furnaceVerdict(quickCheckResult, gates) {
	const withinRange =
		quickCheckResult.compensatedMinimum >= gates.furnaceMinimum &&
		quickCheckResult.compensatedMaximum <= gates.furnaceMaximum
	return {
		withinRange,
		range: [gates.furnaceMinimum, gates.furnaceMaximum],
		measured: [quickCheckResult.compensatedMinimum, quickCheckResult.compensatedMaximum],
	}
}

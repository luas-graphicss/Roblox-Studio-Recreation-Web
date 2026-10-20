const SSIM_WINDOW_SIZE = 8
const SSIM_C1 = (0.01 * 255) ** 2
const SSIM_C2 = (0.03 * 255) ** 2
const FIREFLY_NEIGHBOURHOOD_RATIO = 8
const FIREFLY_MINIMUM_LUMA = 40

function assertSameShape(left, right) {
	if (!left?.pixels || !right?.pixels) {
		throw new Error("compareCaptures: captura sem pixels")
	}
	if (left.width !== right.width || left.height !== right.height) {
		throw new Error(
			"compareCaptures: tamanhos diferentes (" +
				left.width +
				"x" +
				left.height +
				" vs " +
				right.width +
				"x" +
				right.height +
				"): comparacao invalida",
		)
	}
}


export function lumaFromRgb(red, green, blue) {
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function extractLumaPlane(capture) {
	const pixelTotal = capture.width * capture.height
	const luma = new Float32Array(pixelTotal)
	for (let index = 0; index < pixelTotal; index += 1) {
		const offset = index * 4
		luma[index] = lumaFromRgb(capture.pixels[offset], capture.pixels[offset + 1], capture.pixels[offset + 2])
	}
	return luma
}


export function computeSsim(leftLuma, rightLuma, width, height) {
	const windowsAcross = Math.max(1, Math.floor(width / SSIM_WINDOW_SIZE))
	const windowsDown = Math.max(1, Math.floor(height / SSIM_WINDOW_SIZE))
	let ssimSum = 0
	let windowCount = 0

	for (let windowRow = 0; windowRow < windowsDown; windowRow += 1) {
		for (let windowColumn = 0; windowColumn < windowsAcross; windowColumn += 1) {
			let leftSum = 0
			let rightSum = 0
			let leftSquareSum = 0
			let rightSquareSum = 0
			let crossSum = 0
			let sampleCount = 0

			for (let row = 0; row < SSIM_WINDOW_SIZE; row += 1) {
				const pixelRow = windowRow * SSIM_WINDOW_SIZE + row
				if (pixelRow >= height) break
				for (let column = 0; column < SSIM_WINDOW_SIZE; column += 1) {
					const pixelColumn = windowColumn * SSIM_WINDOW_SIZE + column
					if (pixelColumn >= width) break
					const index = pixelRow * width + pixelColumn
					const leftValue = leftLuma[index]
					const rightValue = rightLuma[index]
					leftSum += leftValue
					rightSum += rightValue
					leftSquareSum += leftValue * leftValue
					rightSquareSum += rightValue * rightValue
					crossSum += leftValue * rightValue
					sampleCount += 1
				}
			}

			if (sampleCount === 0) continue
			const leftMean = leftSum / sampleCount
			const rightMean = rightSum / sampleCount
			const leftVariance = leftSquareSum / sampleCount - leftMean * leftMean
			const rightVariance = rightSquareSum / sampleCount - rightMean * rightMean
			const covariance = crossSum / sampleCount - leftMean * rightMean

			const numerator = (2 * leftMean * rightMean + SSIM_C1) * (2 * covariance + SSIM_C2)
			const denominator =
				(leftMean * leftMean + rightMean * rightMean + SSIM_C1) * (leftVariance + rightVariance + SSIM_C2)
			ssimSum += denominator === 0 ? 1 : numerator / denominator
			windowCount += 1
		}
	}

	return windowCount === 0 ? 1 : ssimSum / windowCount
}

export function computePsnr(left, right) {
	const pixelTotal = left.width * left.height
	let squaredErrorSum = 0
	for (let index = 0; index < pixelTotal; index += 1) {
		const offset = index * 4
		for (let channel = 0; channel < 3; channel += 1) {
			const difference = left.pixels[offset + channel] - right.pixels[offset + channel]
			squaredErrorSum += difference * difference
		}
	}
	const meanSquaredError = squaredErrorSum / (pixelTotal * 3)
	if (meanSquaredError === 0) return Infinity
	return 10 * Math.log10((255 * 255) / meanSquaredError)
}

function srgbByteToLinear(byteValue) {
	const normalized = byteValue / 255
	return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function linearRgbToLab(red, green, blue) {
	const x = (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047
	const y = red * 0.2126 + green * 0.7152 + blue * 0.0722
	const z = (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883
	const pivot = (value) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116)
	const pivotX = pivot(x)
	const pivotY = pivot(y)
	const pivotZ = pivot(z)
	return { lightness: 116 * pivotY - 16, greenRed: 500 * (pivotX - pivotY), blueYellow: 200 * (pivotY - pivotZ) }
}

function pixelToLab(pixels, offset) {
	return linearRgbToLab(
		srgbByteToLinear(pixels[offset]),
		srgbByteToLinear(pixels[offset + 1]),
		srgbByteToLinear(pixels[offset + 2]),
	)
}


export function computeDeltaE76(left, right) {
	const pixelTotal = left.width * left.height
	const deltas = new Float32Array(pixelTotal)
	let sum = 0
	let maximum = 0

	for (let index = 0; index < pixelTotal; index += 1) {
		const offset = index * 4
		const leftLab = pixelToLab(left.pixels, offset)
		const rightLab = pixelToLab(right.pixels, offset)
		const delta = Math.sqrt(
			(leftLab.lightness - rightLab.lightness) ** 2 +
				(leftLab.greenRed - rightLab.greenRed) ** 2 +
				(leftLab.blueYellow - rightLab.blueYellow) ** 2,
		)
		deltas[index] = delta
		sum += delta
		if (delta > maximum) maximum = delta
	}

	const sorted = Array.from(deltas).sort((leftValue, rightValue) => leftValue - rightValue)
	const percentileIndex = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
	return {
		mean: pixelTotal === 0 ? 0 : sum / pixelTotal,
		max: maximum,
		percentile95: sorted.length ? sorted[percentileIndex] : 0,
	}
}


export function countFireflies(capture) {
	const { width, height } = capture
	const luma = extractLumaPlane(capture)
	let fireflyCount = 0

	for (let row = 1; row < height - 1; row += 1) {
		for (let column = 1; column < width - 1; column += 1) {
			const index = row * width + column
			const centerLuma = luma[index]
			if (centerLuma < FIREFLY_MINIMUM_LUMA) continue
			let neighbourSum = 0
			for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
				for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
					if (rowOffset === 0 && columnOffset === 0) continue
					neighbourSum += luma[(row + rowOffset) * width + column + columnOffset]
				}
			}
			const neighbourMean = neighbourSum / 8
			if (centerLuma > Math.max(1, neighbourMean) * FIREFLY_NEIGHBOURHOOD_RATIO) fireflyCount += 1
		}
	}

	const pixelTotal = width * height
	return { count: fireflyCount, ratio: pixelTotal === 0 ? 0 : fireflyCount / pixelTotal }
}


export function computeNoiseSpectrum(capture) {
	const { width, height } = capture
	const luma = extractLumaPlane(capture)
	let highFrequencyEnergy = 0
	let totalEnergy = 0

	for (let row = 1; row < height - 1; row += 1) {
		for (let column = 1; column < width - 1; column += 1) {
			const index = row * width + column
			let blurSum = 0
			for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
				for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
					blurSum += luma[(row + rowOffset) * width + column + columnOffset]
				}
			}
			const highFrequency = luma[index] - blurSum / 9
			highFrequencyEnergy += highFrequency * highFrequency
			totalEnergy += luma[index] * luma[index]
		}
	}

	return {
		highFrequencyEnergy,
		totalEnergy,
		highFrequencyRatio: totalEnergy === 0 ? 0 : highFrequencyEnergy / totalEnergy,
	}
}


export function compareCaptures(left, right) {
	assertSameShape(left, right)
	const leftLuma = extractLumaPlane(left)
	const rightLuma = extractLumaPlane(right)

	let differentPixelCount = 0
	let maximumChannelDifference = 0
	const pixelTotal = left.width * left.height
	for (let index = 0; index < pixelTotal; index += 1) {
		const offset = index * 4
		let pixelDiffers = false
		for (let channel = 0; channel < 3; channel += 1) {
			const difference = Math.abs(left.pixels[offset + channel] - right.pixels[offset + channel])
			if (difference > 0) pixelDiffers = true
			if (difference > maximumChannelDifference) maximumChannelDifference = difference
		}
		if (pixelDiffers) differentPixelCount += 1
	}

	return {
		width: left.width,
		height: left.height,
		ssim: computeSsim(leftLuma, rightLuma, left.width, left.height),
		psnr: computePsnr(left, right),
		deltaE: computeDeltaE76(left, right),
		fireflies: countFireflies(right),
		noiseSpectrum: computeNoiseSpectrum(right),
		differentPixelRatio: pixelTotal === 0 ? 0 : differentPixelCount / pixelTotal,
		maximumChannelDifference,
	}
}


export function computeTemporalVariance(captureSequence) {
	if (!captureSequence?.length) return { sampleCount: 0, variance: 0, mean: 0 }
	const ratios = captureSequence.map((capture) => computeNoiseSpectrum(capture).highFrequencyRatio)
	const mean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length
	const variance = ratios.reduce((sum, value) => sum + (value - mean) ** 2, 0) / ratios.length
	return { sampleCount: ratios.length, mean, variance, ratios }
}

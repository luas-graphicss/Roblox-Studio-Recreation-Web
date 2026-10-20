export const MSM_SPECTRUM_GATE = Object.freeze({


	lowFrequencyRadiusRatio: 0.25,


	maximumLowFrequencyMeanRatio: 0.35,


	maximumLowFrequencyPeakRatio: 1.5,

	minimumLowFrequencyBinCount: 8,
});

const twiddleTables = new Map();


function twiddleTableFor(size) {
	const cached = twiddleTables.get(size);
	if (cached) return cached;
	const cosine = new Float64Array(size * size);
	const sine = new Float64Array(size * size);
	for (let frequency = 0; frequency < size; frequency += 1) {
		for (let position = 0; position < size; position += 1) {
			const angle = (-2 * Math.PI * frequency * position) / size;
			cosine[frequency * size + position] = Math.cos(angle);
			sine[frequency * size + position] = Math.sin(angle);
		}
	}
	const table = { cosine, sine };
	twiddleTables.set(size, table);
	return table;
}


export function signedFrequencyOf(frequency, size) {
	return frequency * 2 <= size ? frequency : frequency - size;
}


export function computePowerSpectrum(values, size) {
	const { cosine, sine } = twiddleTableFor(size);
	const rowReal = new Float64Array(size * size);
	const rowImaginary = new Float64Array(size * size);

	for (let y = 0; y < size; y += 1) {
		const rowOffset = y * size;
		for (let frequencyX = 0; frequencyX < size; frequencyX += 1) {
			const twiddleOffset = frequencyX * size;
			let real = 0;
			let imaginary = 0;
			for (let x = 0; x < size; x += 1) {
				const sample = values[rowOffset + x];
				real += sample * cosine[twiddleOffset + x];
				imaginary += sample * sine[twiddleOffset + x];
			}
			rowReal[rowOffset + frequencyX] = real;
			rowImaginary[rowOffset + frequencyX] = imaginary;
		}
	}

	const power = new Float64Array(size * size);
	for (let frequencyX = 0; frequencyX < size; frequencyX += 1) {
		for (let frequencyY = 0; frequencyY < size; frequencyY += 1) {
			const twiddleOffset = frequencyY * size;
			let real = 0;
			let imaginary = 0;
			for (let y = 0; y < size; y += 1) {
				const sampleReal = rowReal[y * size + frequencyX];
				const sampleImaginary = rowImaginary[y * size + frequencyX];
				const twiddleCosine = cosine[twiddleOffset + y];
				const twiddleSine = sine[twiddleOffset + y];
				real += sampleReal * twiddleCosine - sampleImaginary * twiddleSine;
				imaginary += sampleReal * twiddleSine + sampleImaginary * twiddleCosine;
			}
			power[frequencyY * size + frequencyX] = real * real + imaginary * imaginary;
		}
	}

	power[0] = 0;
	return power;
}


export function radialPowerProfile(power, size, meanPower) {
	const radiusCount = Math.floor(size / 2) + 1;
	const totals = new Float64Array(radiusCount);
	const counts = new Float64Array(radiusCount);
	for (let frequencyY = 0; frequencyY < size; frequencyY += 1) {
		for (let frequencyX = 0; frequencyX < size; frequencyX += 1) {
			if (frequencyX === 0 && frequencyY === 0) continue;
			const signedX = signedFrequencyOf(frequencyX, size);
			const signedY = signedFrequencyOf(frequencyY, size);
			const radius = Math.round(Math.sqrt(signedX * signedX + signedY * signedY));
			if (radius >= radiusCount) continue;
			totals[radius] += power[frequencyY * size + frequencyX];
			counts[radius] += 1;
		}
	}
	const profile = [];
	for (let radius = 0; radius < radiusCount; radius += 1) {
		profile.push({
			radius,
			relativePower: counts[radius] > 0 && meanPower > 0 ? totals[radius] / counts[radius] / meanPower : 0,
			binCount: counts[radius],
		});
	}
	return profile;
}


export function evaluateSpectrumBlueness(request) {
	const source = request && typeof request === "object" ? request : {};
	const gate = source.gate && typeof source.gate === "object" ? source.gate : MSM_SPECTRUM_GATE;
	const label = typeof source.label === "string" ? source.label : "plane";
	const size = Math.floor(Number(source.size));
	const values = source.values;
	const problems = [];

	if (!(size >= 4) || !values || values.length !== size * size) {
		return {
			pass: false,
			label,
			lowFrequencyMeanRatio: Number.NaN,
			lowFrequencyPeakRatio: Number.NaN,
			lowFrequencyBinCount: 0,
			lowFrequencyRadius: 0,
			meanPower: 0,
			radialProfile: [],
			problems: ["the plane handed to the spectrum gate is not a square of side " + size],
		};
	}

	const power = computePowerSpectrum(values, size);
	let totalPower = 0;
	for (let index = 1; index < power.length; index += 1) totalPower += power[index];
	const meanPower = totalPower / (power.length - 1);

	const nyquist = size / 2;
	const lowFrequencyRadius = gate.lowFrequencyRadiusRatio * nyquist;
	let lowTotal = 0;
	let lowCount = 0;
	let lowPeak = 0;
	for (let frequencyY = 0; frequencyY < size; frequencyY += 1) {
		for (let frequencyX = 0; frequencyX < size; frequencyX += 1) {
			if (frequencyX === 0 && frequencyY === 0) continue;
			const signedX = signedFrequencyOf(frequencyX, size);
			const signedY = signedFrequencyOf(frequencyY, size);
			if (signedX * signedX + signedY * signedY > lowFrequencyRadius * lowFrequencyRadius) continue;
			const binPower = power[frequencyY * size + frequencyX];
			lowTotal += binPower;
			lowCount += 1;
			if (binPower > lowPeak) lowPeak = binPower;
		}
	}

	const lowFrequencyMeanRatio = lowCount > 0 && meanPower > 0 ? lowTotal / lowCount / meanPower : 0;
	const lowFrequencyPeakRatio = meanPower > 0 ? lowPeak / meanPower : 0;

	if (lowCount < gate.minimumLowFrequencyBinCount) {
		problems.push("the low frequency band has only " + lowCount + " bins, too few to mean anything");
	}
	if (!(lowFrequencyMeanRatio <= gate.maximumLowFrequencyMeanRatio)) {
		problems.push(
			"low frequency mean ratio " +
				lowFrequencyMeanRatio.toFixed(4) +
			" above the gate " +
				gate.maximumLowFrequencyMeanRatio,
		);
	}
	if (!(lowFrequencyPeakRatio <= gate.maximumLowFrequencyPeakRatio)) {
		problems.push(
			"low frequency peak ratio " +
				lowFrequencyPeakRatio.toFixed(4) +
			" above the gate " +
				gate.maximumLowFrequencyPeakRatio,
		);
	}

	return {
		pass: problems.length === 0,
		label,
		lowFrequencyMeanRatio,
		lowFrequencyPeakRatio,
		lowFrequencyBinCount: lowCount,
		lowFrequencyRadius,
		meanPower,
		radialProfile: radialPowerProfile(power, size, meanPower),
		problems,
	};
}

export const MSM_NEIGHBOURHOOD_OWNER = "MSM-F26";

export const MSM_NEIGHBOURHOOD_RADIUS = 1;
export const MSM_NEIGHBOURHOOD_TAP_COUNT = 9;
export const MSM_NEIGHBOURHOOD_CHANNEL_COUNT = 3;


export const MSM_NEIGHBOURHOOD_OFFSETS = Object.freeze([
	Object.freeze([-1, -1]),
	Object.freeze([0, -1]),
	Object.freeze([1, -1]),
	Object.freeze([-1, 0]),
	Object.freeze([0, 0]),
	Object.freeze([1, 0]),
	Object.freeze([-1, 1]),
	Object.freeze([0, 1]),
	Object.freeze([1, 1]),
]);


export const MSM_NEIGHBOURHOOD_BOX_INITIAL_MINIMUM = 1e20;
export const MSM_NEIGHBOURHOOD_BOX_INITIAL_MAXIMUM = 0;


export const MSM_NEIGHBOURHOOD_BOX_WIDENING = 0;
export const MSM_NEIGHBOURHOOD_CLAMP_SPACE = "stored";

export const MSM_NEIGHBOURHOOD_REASON = Object.freeze({
	sampled: "sampled",
	samplerMissing: "samplerMissing",
});

export const MSM_NEIGHBOURHOOD_MIRROR_ARGUMENT_ORDER = Object.freeze({
	sampleNeighbourhoodBox: Object.freeze({
		arguments: Object.freeze(["uvX", "uvY", "texelWidth", "texelHeight", "sampleStored"]),
		glslCounterpart: "msmSampleCurrentNeighbourhood",
		note: "the GLSL takes one vec2 uv and returns centre, minimum and maximum through out parameters",
		jsArgumentCount: 1,
	}),
	clampTripleToBox: Object.freeze({
		arguments: Object.freeze(["storedTriple", "box"]),
		glslCounterpart: "clamp",
		note: "the GLSL uses the built in clamp(vec3, vec3, vec3) directly",
	}),
});

const toFloat32 = Math.fround;


export function sampleNeighbourhoodBox(request) {
	const source = request && typeof request === "object" ? request : {};
	const sampleStored = typeof source.sampleStored === "function" ? source.sampleStored : null;
	if (!sampleStored) {
		return Object.freeze({ sampled: false, reason: MSM_NEIGHBOURHOOD_REASON.samplerMissing, tapCount: 0 });
	}

	const uvX = Number(source.uvX);
	const uvY = Number(source.uvY);
	const texelWidth = Number(source.texelWidth);
	const texelHeight = Number(source.texelHeight);

	const centre = [0, 0, 0];
	const minimum = [
		MSM_NEIGHBOURHOOD_BOX_INITIAL_MINIMUM,
		MSM_NEIGHBOURHOOD_BOX_INITIAL_MINIMUM,
		MSM_NEIGHBOURHOOD_BOX_INITIAL_MINIMUM,
	];
	const maximum = [
		MSM_NEIGHBOURHOOD_BOX_INITIAL_MAXIMUM,
		MSM_NEIGHBOURHOOD_BOX_INITIAL_MAXIMUM,
		MSM_NEIGHBOURHOOD_BOX_INITIAL_MAXIMUM,
	];
	let tapCount = 0;

	for (let offsetIndex = 0; MSM_NEIGHBOURHOOD_OFFSETS.length > offsetIndex; offsetIndex += 1) {
		const offsetX = MSM_NEIGHBOURHOOD_OFFSETS[offsetIndex][0];
		const offsetY = MSM_NEIGHBOURHOOD_OFFSETS[offsetIndex][1];
		const tapStored = sampleStored(toFloat32(uvX + texelWidth * offsetX), toFloat32(uvY + texelHeight * offsetY));
		tapCount += 1;


		const centreWeight = (1 - Math.abs(offsetX)) * (1 - Math.abs(offsetY));
		for (let channel = 0; MSM_NEIGHBOURHOOD_CHANNEL_COUNT > channel; channel += 1) {
			const tapChannel = toFloat32(tapStored[channel]);
			centre[channel] = toFloat32(centre[channel] + tapChannel * centreWeight);
			if (minimum[channel] > tapChannel) minimum[channel] = tapChannel;
			if (tapChannel > maximum[channel]) maximum[channel] = tapChannel;
		}
	}

	return Object.freeze({
		sampled: true,
		reason: MSM_NEIGHBOURHOOD_REASON.sampled,
		centreStored: centre,
		minimum,
		maximum,
		tapCount,
	});
}


export function clampTripleToBox(storedTriple, box) {
	const clamped = [0, 0, 0];
	let clampedChannelCount = 0;
	for (let channel = 0; MSM_NEIGHBOURHOOD_CHANNEL_COUNT > channel; channel += 1) {
		const value = toFloat32(storedTriple[channel]);
		const lowerBound = box.minimum[channel];
		const upperBound = box.maximum[channel];
		let clampedValue = value;
		if (clampedValue < lowerBound) clampedValue = lowerBound;
		if (clampedValue > upperBound) clampedValue = upperBound;
		if (clampedValue !== value) clampedChannelCount += 1;
		clamped[channel] = toFloat32(clampedValue);
	}
	return { clamped, clampedChannelCount };
}


export function neighbourhoodBoxWidth(box) {
	return [
		box.maximum[0] - box.minimum[0],
		box.maximum[1] - box.minimum[1],
		box.maximum[2] - box.minimum[2],
	];
}


export function measureEnvelopeOvershoot(storedTriple, box) {
	let worstOvershoot = 0;
	let worstChannel = 0;
	for (let channel = 0; MSM_NEIGHBOURHOOD_CHANNEL_COUNT > channel; channel += 1) {
		const value = Number(storedTriple[channel]);
		const belowBox = box.minimum[channel] - value;
		const aboveBox = value - box.maximum[channel];
		const overshoot = Math.max(belowBox, aboveBox, 0);
		if (overshoot > worstOvershoot) {
			worstOvershoot = overshoot;
			worstChannel = channel;
		}
	}
	return { insideEnvelope: worstOvershoot === 0, worstOvershoot, worstChannel };
}

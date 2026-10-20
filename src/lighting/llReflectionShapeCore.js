export const SUPPORT_FRACTION_OF_PEAK = 0.15;


export const PLATEAU_FRACTION_OF_PEAK = 0.5;


export const MID_TONE_LOW_FRACTION = 0.2;
export const MID_TONE_HIGH_FRACTION = 0.8;


export const RECTANGLE_PLATEAU_GATE = 0.6;
export const RECTANGLE_BOX_FILL_GATE = 0.55;


export const MIN_SUPPORT_PIXELS = 24;


export function differenceField(fieldAfter, fieldBefore) {
	if (fieldAfter.length !== fieldBefore.length) throw new Error("differenceField: tamanhos diferentes (" + fieldAfter.length + " vs " + fieldBefore.length + ")");
	const out = new Float64Array(fieldAfter.length);
	for (let index = 0; index < out.length; index++) out[index] = Math.max(0, fieldAfter[index] - fieldBefore[index]);
	return out;
}


export function meanAbsoluteDifference(fieldA, fieldB) {
	if (fieldA.length !== fieldB.length) throw new Error("meanAbsoluteDifference: tamanhos diferentes (" + fieldA.length + " vs " + fieldB.length + ")");
	let sum = 0;
	for (let index = 0; index < fieldA.length; index++) sum += Math.abs(fieldA[index] - fieldB[index]);
	return sum / Math.max(fieldA.length, 1);
}

export function fieldPeak(field) {
	let peak = 0;
	for (let index = 0; index < field.length; index++) if (field[index] > peak) peak = field[index];
	return peak;
}

function emptyShape(peak) {
	return {
		peak: peak,
		supportCount: 0,
		supportMean: 0,
		plateauCount: 0,
		plateauFraction: 0,
		midToneFraction: 0,
		box: null,
		boxFill: 0,
		aspect: 0,
		readsAsRectangle: false,
	};
}

function measureSupportMask(field, width, height, mask, peak) {
	const plateauLevel = peak * PLATEAU_FRACTION_OF_PEAK;
	const midToneLow = peak * MID_TONE_LOW_FRACTION;
	const midToneHigh = peak * MID_TONE_HIGH_FRACTION;
	let supportCount = 0;
	let supportSum = 0;
	let plateauCount = 0;
	let midToneCount = 0;
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = y * width + x;
			if (!mask[index]) continue;
			const value = field[index];
			supportCount++;
			supportSum += value;
			if (value >= plateauLevel) plateauCount++;
			if (value >= midToneLow && value <= midToneHigh) midToneCount++;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
	}
	if (supportCount === 0) return emptyShape(peak);
	const box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
	const boxFill = supportCount / Math.max(box.w * box.h, 1);
	const plateauFraction = plateauCount / supportCount;
	return {
		peak: peak,
		supportCount: supportCount,
		supportMean: supportSum / supportCount,
		plateauCount: plateauCount,
		plateauFraction: plateauFraction,
		midToneFraction: midToneCount / supportCount,
		box: box,
		boxFill: boxFill,
		aspect: box.w / Math.max(box.h, 1),
		readsAsRectangle: supportCount >= MIN_SUPPORT_PIXELS && plateauFraction >= RECTANGLE_PLATEAU_GATE && boxFill >= RECTANGLE_BOX_FILL_GATE,
	};
}

function supportMaskOfWholeField(field, peak) {
	const supportLevel = peak * SUPPORT_FRACTION_OF_PEAK;
	const mask = new Uint8Array(field.length);
	for (let index = 0; index < field.length; index++) mask[index] = field[index] >= supportLevel ? 1 : 0;
	return mask;
}


export function measureHighlightShape(params) {
	const field = params.field;
	const width = Math.max(1, params.width | 0);
	const height = Math.max(1, params.height | 0);
	const peak = fieldPeak(field);
	if (!(peak > 0)) return emptyShape(0);
	return measureSupportMask(field, width, height, supportMaskOfWholeField(field, peak), peak);
}


export function largestSupportComponent(params) {
	const field = params.field;
	const width = Math.max(1, params.width | 0);
	const height = Math.max(1, params.height | 0);
	const peak = fieldPeak(field);
	const mask = new Uint8Array(field.length);
	if (!(peak > 0)) return { mask: mask, count: 0, peak: 0, componentCount: 0 };
	const supportLevel = peak * SUPPORT_FRACTION_OF_PEAK;
	const visited = new Uint8Array(field.length);
	const stack = new Int32Array(field.length);
	const best = new Uint8Array(field.length);
	const current = new Uint8Array(field.length);
	let bestCount = 0;
	let componentCount = 0;
	for (let seed = 0; seed < field.length; seed++) {
		if (visited[seed] || field[seed] < supportLevel) continue;
		componentCount++;
		let stackSize = 0;
		let currentCount = 0;
		const touched = [];
		stack[stackSize++] = seed;
		visited[seed] = 1;
		while (stackSize > 0) {
			const index = stack[--stackSize];
			current[index] = 1;
			touched.push(index);
			currentCount++;
			const x = index % width;
			const y = (index - x) / width;
			if (x > 0) {
				const left = index - 1;
				if (!visited[left] && field[left] >= supportLevel) {
					visited[left] = 1;
					stack[stackSize++] = left;
				}
			}
			if (x + 1 < width) {
				const right = index + 1;
				if (!visited[right] && field[right] >= supportLevel) {
					visited[right] = 1;
					stack[stackSize++] = right;
				}
			}
			if (y > 0) {
				const up = index - width;
				if (!visited[up] && field[up] >= supportLevel) {
					visited[up] = 1;
					stack[stackSize++] = up;
				}
			}
			if (y + 1 < height) {
				const down = index + width;
				if (!visited[down] && field[down] >= supportLevel) {
					visited[down] = 1;
					stack[stackSize++] = down;
				}
			}
		}
		if (currentCount > bestCount) {
			best.fill(0);
			for (let i = 0; i < touched.length; i++) best[touched[i]] = 1;
			bestCount = currentCount;
		}
		for (let i = 0; i < touched.length; i++) current[touched[i]] = 0;
	}
	return { mask: best, count: bestCount, peak: peak, componentCount: componentCount };
}


export function measureLargestHighlightShape(params) {
	const width = Math.max(1, params.width | 0);
	const height = Math.max(1, params.height | 0);
	const component = largestSupportComponent(params);
	if (component.count === 0) return Object.assign(emptyShape(component.peak), { componentCount: component.componentCount });
	const shape = measureSupportMask(params.field, width, height, component.mask, component.peak);
	shape.componentCount = component.componentCount;
	shape.centroid = null;
	let sumX = 0;
	let sumY = 0;
	for (let index = 0; index < component.mask.length; index++) {
		if (!component.mask[index]) continue;
		const x = index % width;
		sumX += x;
		sumY += (index - x) / width;
	}
	shape.centroid = { x: sumX / component.count, y: sumY / component.count };
	return shape;
}

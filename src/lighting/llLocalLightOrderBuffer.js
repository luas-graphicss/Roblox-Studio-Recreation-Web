function asArray(value) {
	return Array.isArray(value) ? value : [];
}


export function createLocalLightOrderBuffer() {
	const orderedLights = [];
	let fillCount = 0;
	let largestFillLength = 0;

	return {


		fill(pointLights, spotLights) {
			const points = asArray(pointLights);
			const spots = asArray(spotLights);
			const pointCount = points.length;
			const totalCount = pointCount + spots.length;


			orderedLights.length = totalCount;
			for (let index = 0; index !== pointCount; index += 1) {
				orderedLights[index] = points[index];
			}
			for (let index = 0; index !== spots.length; index += 1) {
				orderedLights[pointCount + index] = spots[index];
			}
			fillCount += 1;
			if (totalCount > largestFillLength) largestFillLength = totalCount;
			return orderedLights;
		},


		lights() {
			return orderedLights;
		},

		length() {
			return orderedLights.length;
		},


		clear() {
			orderedLights.length = 0;
			return this;
		},


		stats() {
			return { fills: fillCount, length: orderedLights.length, largestFillLength };
		},
	};
}

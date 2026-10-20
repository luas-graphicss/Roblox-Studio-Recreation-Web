export function createMeteredLightPool() {

	const recordPool = [];


	const meteredLights = [];

	let sampleCount = 0;
	let passCount = 0;

	return {

		begin() {
			sampleCount = 0;
			passCount += 1;
			return this;
		},


		add(intensityCandela, distance) {
			let record = recordPool[sampleCount];
			if (record === undefined) {
				record = { intensityCandela: 0, distance: 0 };
				recordPool[sampleCount] = record;
			}
			record.intensityCandela = intensityCandela;
			record.distance = distance;
			sampleCount += 1;
			return record;
		},


		lights() {
			meteredLights.length = sampleCount;
			for (let index = 0; index !== sampleCount; index += 1) {
				meteredLights[index] = recordPool[index];
			}
			return meteredLights;
		},

		sampleCount() {
			return sampleCount;
		},


		pooledRecordCount() {
			return recordPool.length;
		},

		passesServed() {
			return passCount;
		},


		reset() {
			recordPool.length = 0;
			meteredLights.length = 0;
			sampleCount = 0;
			return this;
		},
	};
}

import { MSM_SPATIAL_FILTER_TAP_COUNT, isSpatialFilterGateOpen } from "./msmVarianceCore.js";

export const MSM_FILTERED_FRACTION_OWNER = "MSM-F28";


export const MSM_FILTERED_PIXEL_FRACTION_LIMIT = 0.35;


export const MSM_WARP_BLOCK_EDGE = 8;

function emptyMeasurement(blockEdge) {
	return Object.freeze({
		pixelCount: 0,
		filteredPixelCount: 0,
		filteredPixelFraction: 0,
		blockEdge,
		blockCount: 0,
		filteredBlockCount: 0,
		filteredBlockFraction: 0,
		totalTapCount: 0,
		tapsPerPixel: 0,
		withinLimit: true,
	});
}


export function measureFilteredPixelFraction(request) {
	const width = Math.max(0, Math.floor(request?.width ?? 0));
	const height = Math.max(0, Math.floor(request?.height ?? 0));
	const blockEdge = Math.max(1, Math.floor(request?.blockEdge ?? MSM_WARP_BLOCK_EDGE));
	const readMoments = request?.readMoments;
	const pixelCount = width * height;
	if (pixelCount === 0 || typeof readMoments !== "function") {
		return emptyMeasurement(blockEdge);
	}

	const blocksAcross = Math.ceil(width / blockEdge);
	const blocksDown = Math.ceil(height / blockEdge);
	const filteredBlockIndices = new Set();
	let filteredPixelCount = 0;

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const moments = readMoments(x, y);
			const gate = isSpatialFilterGateOpen({
				firstMoment: moments?.firstMoment,
				secondMoment: moments?.secondMoment,
				spatialFilter: request?.spatialFilter,
			});
			if (!gate.open) {
				continue;
			}
			filteredPixelCount += 1;
			filteredBlockIndices.add(Math.floor(y / blockEdge) * blocksAcross + Math.floor(x / blockEdge));
		}
	}

	const blockCount = blocksAcross * blocksDown;
	const filteredPixelFraction = filteredPixelCount / pixelCount;


	const totalTapCount = filteredPixelCount * MSM_SPATIAL_FILTER_TAP_COUNT;

	return Object.freeze({
		pixelCount,
		filteredPixelCount,
		filteredPixelFraction,
		blockEdge,
		blockCount,
		filteredBlockCount: filteredBlockIndices.size,
		filteredBlockFraction: filteredBlockIndices.size / blockCount,
		totalTapCount,
		tapsPerPixel: totalTapCount / pixelCount,
		withinLimit: filteredPixelFraction <= MSM_FILTERED_PIXEL_FRACTION_LIMIT,
	});
}

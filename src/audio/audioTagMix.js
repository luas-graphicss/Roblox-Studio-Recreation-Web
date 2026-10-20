export const TAG_MIX_LIMITS = Object.freeze({
	volumeMin: 0,
	volumeMax: 1,                                          
	rateMin: 0.25,                                                       
	rateMax: 4,


	volumeEpsilon: 0.001,
	rateEpsilon: 0.0008,
	volumeMaxRaw: 10,                                                 
	maxGroupDepth: 10,                                          
});

function num(v, fb) {


	if (typeof v === "symbol") return fb;
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : fb;
}

function clamp(v, lo, hi, fb) {
	const n = num(v, fb);
	return n < lo ? lo : n > hi ? hi : n;
}


export function groupChainGain(volumes) {
	if (!Array.isArray(volumes) || volumes.length === 0) return 1;
	let mul = 1;
	const n = Math.min(volumes.length, TAG_MIX_LIMITS.maxGroupDepth);
	for (let i = 0; i < n; i++) {
		mul *= clamp(volumes[i], 0, TAG_MIX_LIMITS.volumeMaxRaw, 1);
	}
	return Number.isFinite(mul) && mul >= 0 ? mul : 1;
}


export function computeTagMix(input) {
	const src = input && typeof input === "object" ? input : {};
	const volume = clamp(src.volume, 0, TAG_MIX_LIMITS.volumeMaxRaw, 0.5);
	const groupGainRaw = num(src.groupGain, 1);
	const groupGain = groupGainRaw >= 0 ? groupGainRaw : 1;
	const spatialGain = clamp(src.spatialGain, 0, 1, 1);
	const volumeScale = clamp(src.volumeScale, 0, 1, 1);
	const raw = volume * groupGain * spatialGain * volumeScale;
	const safeRaw = Number.isFinite(raw) && raw >= 0 ? raw : 0;
	const rate = clamp(
		num(src.baseRate, 1) * num(src.doppler, 1),
		TAG_MIX_LIMITS.rateMin,
		TAG_MIX_LIMITS.rateMax,
		1,
	);
	return {
		volume: safeRaw > TAG_MIX_LIMITS.volumeMax ? TAG_MIX_LIMITS.volumeMax : safeRaw,
		rate,
		volumeSaturated: safeRaw > TAG_MIX_LIMITS.volumeMax,
	};
}

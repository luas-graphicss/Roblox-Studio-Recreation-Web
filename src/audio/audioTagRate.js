export const TAG_RATE_SAFE = Object.freeze({ min: 0.25, max: 4 });


export const TAG_RATE_MAX_LADDER = Object.freeze([64, 32, 16, 8, 4]);
export const TAG_RATE_MIN_LADDER = Object.freeze([1 / 64, 1 / 32, 0.0625, 0.125, 0.25]);

function finiteNum(v) {
	return typeof v === "number" && Number.isFinite(v);
}


function accepts(el, v) {
	try {
		el.playbackRate = v;
	} catch {
		return false;
	}
	let back;
	try {
		back = Number(el.playbackRate);
	} catch {
		return false;
	}
	if (!finiteNum(back)) return false;
	return Math.abs(back - v) <= Math.abs(v) * 1e-6 + 1e-9;
}

export function detectTagRateRange(AudioCtor) {
	const out = {
		min: TAG_RATE_SAFE.min,
		max: TAG_RATE_SAFE.max,
		zeroOk: false,
		probed: false,
		reason: null,
	};
	if (typeof AudioCtor !== "function") {
		out.reason = "noAudio";
		return out;
	}
	let el = null;
	try {
		el = new AudioCtor();
	} catch {
		el = null;
	}
	if (!el) {
		out.reason = "ctor";
		return out;
	}
	for (const c of TAG_RATE_MAX_LADDER) {
		if (accepts(el, c)) {
			out.max = c;
			break;
		}
	}
	for (const c of TAG_RATE_MIN_LADDER) {
		if (accepts(el, c)) {
			out.min = c;
			break;
		}
	}
	out.zeroOk = accepts(el, 0);
	try {
		el.playbackRate = 1;                                                       
	} catch {}

	if (!finiteNum(out.min) || out.min <= 0 || out.min > TAG_RATE_SAFE.min) out.min = TAG_RATE_SAFE.min;
	if (!finiteNum(out.max) || out.max < TAG_RATE_SAFE.max) out.max = TAG_RATE_SAFE.max;
	out.probed = true;
	return out;
}

export function clampTagRate(v, range) {
	const r =
		range && finiteNum(range.min) && finiteNum(range.max) && range.min > 0 && range.min <= range.max
			? range
			: TAG_RATE_SAFE;
	if (!finiteNum(v)) return 1;
	if (v <= 0) return r.zeroOk ? 0 : r.min;
	return Math.min(r.max, Math.max(r.min, v));
}

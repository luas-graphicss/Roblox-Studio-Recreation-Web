import { DIRECT_ENDPOINT } from "./audioCdn.js";

export const TAG_LIMITS = Object.freeze({
	probeTimeoutMs: 15000,                                                       
	negativeTtlMs: 60000,                                                    
});

const RE_DIGITS = /^[1-9][0-9]{0,19}$/;


export function tagUrlForAssetId(id) {
	const s = String(id == null ? "" : id).trim();
	if (!RE_DIGITS.test(s)) return null;
	return DIRECT_ENDPOINT + s;
}


export function detectTagCapability(AudioCtor) {
	const out = { available: false, mp3: false, ogg: false };
	if (typeof AudioCtor !== "function") return out;
	let el = null;
	try {
		el = new AudioCtor();
	} catch {
		return out;
	}
	if (!el || typeof el.canPlayType !== "function") return out;
	const can = (t) => {
		try {
			return el.canPlayType(t) !== "";
		} catch {
			return false;
		}
	};
	out.available = true;
	out.mp3 = can("audio/mpeg");
	out.ogg = can('audio/ogg; codecs="vorbis"');
	return out;
}


export function createTagProber(opts = {}) {
	const AudioCtor =
		typeof opts.AudioCtor === "function" ? opts.AudioCtor : typeof Audio === "function" ? Audio : null;
	const now = typeof opts.now === "function" ? opts.now : () => Date.now();
	const setTimer = typeof opts.setTimer === "function" ? opts.setTimer : (fn, ms) => setTimeout(fn, ms);
	const clearTimer = typeof opts.clearTimer === "function" ? opts.clearTimer : (h) => clearTimeout(h);
	const urlFor = typeof opts.urlFor === "function" ? opts.urlFor : tagUrlForAssetId;
	const limits = { ...TAG_LIMITS, ...(opts.limits || {}) };

	const okCache = new Map();                                
	const negative = new Map();                           
	const inFlight = new Map();                          
	const counters = { probes: 0, ok: 0, errors: 0, timeouts: 0, negativeHits: 0, deduped: 0 };

	function isNegative(id) {
		const key = String(id == null ? "" : id).trim();
		const rec = negative.get(key);
		if (!rec) return false;
		if (now() >= rec.until) {
			negative.delete(key);                                         
			return false;
		}
		return true;
	}

	function negativeReason(id) {
		const rec = negative.get(String(id == null ? "" : id).trim());
		return rec ? rec.reason : null;
	}

	function probe(id) {
		const key = String(id == null ? "" : id).trim();
		const url = urlFor(key);
		if (!url) return Promise.resolve({ ok: false, reason: "badId" });
		if (!AudioCtor) return Promise.resolve({ ok: false, reason: "noAudio" });
		const hit = okCache.get(key);
		if (hit) return Promise.resolve(hit);
		if (isNegative(key)) {
			counters.negativeHits++;
			return Promise.resolve({ ok: false, reason: negativeReason(key) || "media", negative: true });
		}
		const flying = inFlight.get(key);
		if (flying) {
			counters.deduped++;
			return flying;
		}
		counters.probes++;
		const p = new Promise((resolve) => {
			let el = null;
			let timer = null;
			let done = false;
			const finish = (res) => {
				if (done) return;
				done = true;
				if (timer != null) clearTimer(timer);

				try {
					if (el) {
						el.onloadedmetadata = null;
						el.onerror = null;
						if (typeof el.removeAttribute === "function") el.removeAttribute("src");
						if (typeof el.load === "function") el.load();
					}
				} catch {}
				if (res.ok) {
					counters.ok++;
					okCache.set(key, res);
				} else {
					if (res.reason === "timeout") counters.timeouts++;
					else counters.errors++;
					negative.set(key, { until: now() + limits.negativeTtlMs, reason: res.reason });
				}
				resolve(res);
			};
			try {
				el = new AudioCtor();
			} catch {
				finish({ ok: false, reason: "noAudio" });
				return;
			}
			try {
				el.preload = "metadata";
				el.onloadedmetadata = () => {
					const d = Number(el.duration);


					finish({ ok: true, duration: Number.isFinite(d) && d > 0 ? d : 0 });
				};
				el.onerror = () => finish({ ok: false, reason: "media" });
				timer = setTimer(() => finish({ ok: false, reason: "timeout" }), limits.probeTimeoutMs);
				el.src = url;
				if (typeof el.load === "function") el.load();
			} catch {
				finish({ ok: false, reason: "media" });
			}
		});
		inFlight.set(key, p);
		const clear = () => inFlight.delete(key);
		p.then(clear, clear);
		return p;
	}

	function clearNegative() {
		negative.clear();
	}

	return { probe, isNegative, negativeReason, clearNegative, counters, limits };
}

export const TAG_GRAPH_LIMITS = Object.freeze({
	probeTimeoutMs: 15000,                                           
	negativeTtlMs: 60000,                                                    
});


const RE_DIGITS = /^[1-9][0-9]{0,19}$/;
const DIRECT_ENDPOINT = "https://assetdelivery.roblox.com/v1/asset/?id=";


export function graphUrlForAssetId(id) {
	const s = String(id == null ? "" : id).trim();
	if (!RE_DIGITS.test(s)) return null;
	return DIRECT_ENDPOINT + s;
}


export function detectGraphCapability(AudioCtor, AudioCtxCtor) {
	const out = { available: false, crossOrigin: false, mediaElementSource: false };
	if (typeof AudioCtor !== "function") return out;
	let el = null;
	try {
		el = new AudioCtor();
	} catch {
		return out;
	}
	if (!el) return out;
	out.crossOrigin = "crossOrigin" in el;
	out.mediaElementSource =
		typeof AudioCtxCtor === "function" &&
		!!AudioCtxCtor.prototype &&
		typeof AudioCtxCtor.prototype.createMediaElementSource === "function";
	out.available = out.crossOrigin && out.mediaElementSource;
	try {
		if (typeof el.removeAttribute === "function") el.removeAttribute("src");
	} catch {}
	return out;
}


export function createGraphProber(opts = {}) {
	const AudioCtor =
		opts.AudioCtor !== undefined ? opts.AudioCtor : typeof Audio === "function" ? Audio : null;
	const now = typeof opts.now === "function" ? opts.now : () => Date.now();
	const setTimer =
		typeof opts.setTimer === "function" ? opts.setTimer : (fn, ms) => setTimeout(fn, ms);
	const clearTimer = typeof opts.clearTimer === "function" ? opts.clearTimer : (t) => clearTimeout(t);
	const urlFor = typeof opts.urlFor === "function" ? opts.urlFor : graphUrlForAssetId;
	const limits = { ...TAG_GRAPH_LIMITS, ...(opts.limits || {}) };

	const counters = { probes: 0, ok: 0, errors: 0, timeouts: 0, negativeHits: 0, deduped: 0, cacheHits: 0 };
	const okCache = new Map();                                            
	const negative = new Map();                           
	const inflight = new Map();                          

	function normId(id) {
		return String(id == null ? "" : id).trim();
	}

	function isNegative(id) {
		const rec = negative.get(normId(id));
		if (!rec) return false;
		if (rec.until > now()) return true;
		negative.delete(normId(id));
		return false;
	}

	function negativeReason(id) {
		const key = normId(id);
		const rec = negative.get(key);
		if (!rec) return null;
		if (rec.until > now()) return rec.reason;
		negative.delete(key);
		return null;
	}


	function markUnavailable(id, reason) {
		const key = normId(id);
		if (!key) return;
		negative.set(key, { until: now() + limits.negativeTtlMs, reason: reason || "cors" });
	}


	function clearNegative(id) {
		if (id === undefined) {
			negative.clear();
			okCache.clear();
			return;
		}
		const key = normId(id);
		negative.delete(key);
		okCache.delete(key);
	}

	function probe(id) {
		const key = normId(id);
		const url = urlFor(key);
		if (!url) return Promise.resolve({ ok: false, reason: "badId" });
		if (typeof AudioCtor !== "function") return Promise.resolve({ ok: false, reason: "noAudio" });


		const hit = okCache.get(key);
		if (hit) {
			counters.cacheHits++;
			return Promise.resolve({ ...hit });
		}
		const neg = negative.get(key);
		if (neg) {
			if (neg.until > now()) {
				counters.negativeHits++;
				return Promise.resolve({ ok: false, reason: neg.reason });
			}
			negative.delete(key);                                              
		}
		const running = inflight.get(key);
		if (running) {
			counters.deduped++;
			return running;
		}
		counters.probes++;
		const p = new Promise((resolve) => {
			let el = null;
			try {
				el = new AudioCtor();
			} catch {
				el = null;
			}
			if (!el) {
				resolve({ ok: false, reason: "noAudio" });
				return;
			}
			let done = false;
			let timer = null;
			const cleanup = () => {
				try {
					el.onloadedmetadata = null;
					el.onerror = null;
					el.pause && el.pause();
					if (typeof el.removeAttribute === "function") el.removeAttribute("src");
					if (typeof el.load === "function") el.load();
				} catch {}
			};
			const finish = (res) => {
				if (done) return;
				done = true;
				if (timer !== null && timer !== undefined) clearTimer(timer);
				cleanup();
				resolve(res);
			};
			const fail = (reason) => {
				if (done) return;
				if (reason === "timeout") counters.timeouts++;
				else counters.errors++;
				negative.set(key, { until: now() + limits.negativeTtlMs, reason });
				finish({ ok: false, reason });
			};
			try {
				el.crossOrigin = "anonymous";                                                
			} catch {}
			try {
				el.preload = "metadata";                                           
			} catch {}
			el.onloadedmetadata = () => {
				counters.ok++;
				const d = Number(el.duration);

				const res = { ok: true, duration: Number.isFinite(d) && d > 0 ? d : 0 };
				okCache.set(key, res);
				finish({ ...res });
			};



			el.onerror = () => fail("cors");
			timer = setTimer(() => fail("timeout"), limits.probeTimeoutMs);
			try {
				el.src = url;
				if (typeof el.load === "function") el.load();
			} catch {
				fail("cors");
			}
		});
		inflight.set(key, p);
		p.then(
			() => inflight.delete(key),
			() => inflight.delete(key),
		);
		return p;
	}

	return { probe, isNegative, negativeReason, markUnavailable, clearNegative, counters, limits };
}

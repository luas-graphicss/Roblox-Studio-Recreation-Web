export const TAG_PROMOTE_LIMITS = Object.freeze({
	firstDelayMs: 65000,                                                       
	maxDelayMs: 300000,                           
	backoffFactor: 2,
	jitterMaxMs: 5000,                                                   
	maxWatched: 64,                                      
});

function finiteNum(v) {
	return typeof v === "number" && Number.isFinite(v);
}

function toKey(id) {
	return String(id == null ? "" : id).trim();
}


function hash32(s) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h >>> 0;
}

export function createPromotionScheduler(opts = {}) {
	const now = typeof opts.now === "function" ? opts.now : () => Date.now();
	const limits = { ...TAG_PROMOTE_LIMITS, ...(opts.limits || {}) };

	if (!finiteNum(limits.firstDelayMs) || limits.firstDelayMs < 0) limits.firstDelayMs = TAG_PROMOTE_LIMITS.firstDelayMs;
	if (!finiteNum(limits.maxDelayMs) || limits.maxDelayMs < limits.firstDelayMs) limits.maxDelayMs = Math.max(TAG_PROMOTE_LIMITS.maxDelayMs, limits.firstDelayMs);
	if (!finiteNum(limits.backoffFactor) || limits.backoffFactor < 1) limits.backoffFactor = TAG_PROMOTE_LIMITS.backoffFactor;
	if (!finiteNum(limits.jitterMaxMs) || limits.jitterMaxMs < 0) limits.jitterMaxMs = TAG_PROMOTE_LIMITS.jitterMaxMs;
	if (!finiteNum(limits.maxWatched) || limits.maxWatched < 1) limits.maxWatched = TAG_PROMOTE_LIMITS.maxWatched;

	const watched = new Map();                                        
	const counters = {
		watched: 0,                                             
		attempts: 0,                                                
		retries: 0,                   
		promotions: 0,                      
		overflow: 0,                                      
		invariantViolations: 0,                                                 
	};

	function nowMs() {
		const t = now();
		return finiteNum(t) ? t : 0;
	}

	function jitterOf(id) {
		return limits.jitterMaxMs > 0 ? hash32(id) % (limits.jitterMaxMs + 1) : 0;
	}

	function delayFor(id, attempts) {
		const n = Math.max(0, attempts | 0);
		let d = limits.firstDelayMs * Math.pow(limits.backoffFactor, n);
		if (!finiteNum(d) || d > limits.maxDelayMs) d = limits.maxDelayMs;
		return d + jitterOf(id);
	}


	function sync(ids) {
		const keep = new Set();
		const list = Array.isArray(ids) ? ids : [];
		for (const raw of list) {
			const id = toKey(raw);
			if (!id) continue;
			keep.add(id);
			if (watched.has(id)) continue;
			if (watched.size >= limits.maxWatched) {
				counters.overflow++;
				continue;
			}
			watched.set(id, { attempts: 0, nextAt: nowMs() + delayFor(id, 0), inflight: false });
			counters.watched++;
		}
		for (const id of Array.from(watched.keys())) {
			if (!keep.has(id)) watched.delete(id);
		}
	}


	function due(atMs) {
		const t = finiteNum(atMs) ? atMs : nowMs();
		const out = [];
		for (const [id, rec] of watched) {
			if (!rec.inflight && rec.nextAt <= t) out.push(id);
		}
		return out;
	}

	function begin(id) {
		const rec = watched.get(toKey(id));
		if (!rec || rec.inflight) return false;
		rec.inflight = true;
		counters.attempts++;
		return true;
	}

	function settle(id, outcome) {
		const key = toKey(id);
		const rec = watched.get(key);
		if (!rec) return;
		if (outcome === "promoted") {
			counters.promotions++;
			watched.delete(key);
			return;
		}
		if (outcome === "gone") {
			watched.delete(key);
			return;
		}

		rec.inflight = false;
		rec.attempts += 1;
		counters.retries++;
		rec.nextAt = nowMs() + delayFor(key, rec.attempts);
	}


	function forceNow(id) {
		if (id === undefined || id === null) {
			for (const rec of watched.values()) {
				rec.nextAt = 0;
				rec.inflight = false;
			}
			return;
		}
		const rec = watched.get(toKey(id));
		if (rec) {
			rec.nextAt = 0;
			rec.inflight = false;
		}
	}

	function snapshot() {
		const t = nowMs();
		const ids = {};
		for (const [id, rec] of watched) {
			ids[id] = {
				attempts: rec.attempts,
				inflight: rec.inflight,
				nextInMs: Math.max(0, Math.round(rec.nextAt - t)),
			};
		}
		return { counters: { ...counters }, watched: ids };
	}

	return { sync, due, begin, settle, forceNow, snapshot, counters, limits };
}

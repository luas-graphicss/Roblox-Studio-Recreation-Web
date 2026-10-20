export const CDN_AUDIO_LIMITS = Object.freeze({
	maxBytes: 20 * 1024 * 1024,                           
	timeoutMs: 15000,
	negativeTtlMs: 60000,                                            
});

export const DIRECT_ENDPOINT = "https://assetdelivery.roblox.com/v1/asset/?id=";

const RE_RBXASSETID = /^rbxassetid:\/\/(\d+)$/i;
const RE_HTTP_ASSET = /^https?:\/\/(?:www\.|web\.)?roblox\.com\/asset\/?\?(?:[^#]*&)?id=(\d+)(?:&|#|$)/i;


export function extractAssetId(normalizedKey) {
	if (typeof normalizedKey !== "string") return null;
	const s = normalizedKey.trim();
	if (s.length === 0 || s.length > 512) return null;
	const m = RE_RBXASSETID.exec(s) || RE_HTTP_ASSET.exec(s);
	if (!m) return null;
	const id = m[1].replace(/^0+(?=\d)/, "");
	if (id === "0" || id.length > 20) return null;
	return id;
}


export function buildEndpoints(id, proxies) {
	const direct = DIRECT_ENDPOINT + id;
	const list = [direct];
	if (Array.isArray(proxies)) {
		for (const p of proxies) {
			if (typeof p !== "string" || p.length === 0 || p.length > 2048) continue;
			list.push(p.indexOf("{url}") >= 0 ? p.split("{url}").join(encodeURIComponent(direct)) : p + encodeURIComponent(direct));
		}
	}
	return list;
}


export function sniffAudioContainer(bytes) {
	if (!bytes || typeof bytes.length !== "number" || bytes.length < 4) return null;
	const b = bytes;
	if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return "mp3";         
	if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3";                   
	if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return "ogg";          
	if (
		b.length >= 12 &&
		b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&          
		b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45          
	) {
		return "wav";
	}
	if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return "flac";          
	return null;
}


export function createCdnFetcher(opts = {}) {
	const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
	const now = opts.now || (() => Date.now());
	const limits = Object.assign({}, CDN_AUDIO_LIMITS, opts.limits || {});
	const negative = new Map();                                           
	const inFlight = new Map();                                     
	const counters = {
		requests: 0,
		deduped: 0,
		negativeHits: 0,
		success: 0,
		httpErrors: 0,
		networkErrors: 0,
		timeouts: 0,
		tooBig: 0,
		badContent: 0,
	};

	function isNegative(id) {
		const rec = negative.get(String(id));
		if (!rec) return false;
		if (rec.until !== Infinity && now() >= rec.until) {
			negative.delete(String(id));                              
			return false;
		}
		return true;
	}

	function negativeReason(id) {
		const rec = negative.get(String(id));
		return rec ? rec.reason : null;
	}


	function markPermanentFailure(id, reason) {
		negative.set(String(id), { until: Infinity, reason: reason || "decode" });
	}

	function clearNegative() {
		negative.clear();
	}

	async function readBody(res) {
		const lenRaw = res && res.headers && typeof res.headers.get === "function" ? res.headers.get("content-length") : null;
		const len = lenRaw == null ? NaN : parseInt(lenRaw, 10);
		if (Number.isFinite(len) && len > limits.maxBytes) return { tooBig: true };


		const stream = res && res.body && typeof res.body.getReader === "function" ? res.body : null;
		if (stream) {
			const reader = stream.getReader();
			const chunks = [];
			let total = 0;
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					if (!value || !value.byteLength) continue;
					total += value.byteLength;
					if (total > limits.maxBytes) {
						try {
							reader.cancel();
						} catch {}
						return { tooBig: true };
					}
					chunks.push(value);
				}
			} finally {
				try {
					reader.releaseLock();
				} catch {}
			}
			const bytes = new Uint8Array(total);
			let off = 0;
			for (const ch of chunks) {
				bytes.set(ch, off);
				off += ch.byteLength;
			}
			return { bytes };
		}
		const ab = await res.arrayBuffer();
		if (!ab || ab.byteLength > limits.maxBytes) return { tooBig: true };
		return { bytes: new Uint8Array(ab) };
	}

	async function tryEndpoint(url) {
		const ac = typeof AbortController === "function" ? new AbortController() : null;
		let timer = null;
		let timedOut = false;
		try {
			const timeout = new Promise((_, reject) => {
				timer = setTimeout(() => {
					timedOut = true;
					if (ac) {
						try {
							ac.abort();
						} catch {}
					}
					reject(new Error("timeout"));
				}, limits.timeoutMs);
			});
			const res = await Promise.race([fetchImpl(url, ac ? { signal: ac.signal } : {}), timeout]);
			if (!res || res.ok !== true) {
				counters.httpErrors++;
				return { error: "http", status: res ? res.status | 0 : 0 };
			}
			const body = await Promise.race([readBody(res), timeout]);
			if (body.tooBig) {
				counters.tooBig++;
				return { error: "tooBig" };
			}
			const container = sniffAudioContainer(body.bytes);
			if (!container) {
				counters.badContent++;
				return { error: "badContent" };
			}
			return { bytes: body.bytes, container };
		} catch {
			if (timedOut) {
				counters.timeouts++;
				return { error: "timeout" };
			}
			counters.networkErrors++;
			return { error: "network" };
		} finally {
			if (timer) clearTimeout(timer);
		}
	}


	function fetchAudio(id, callOpts = {}) {
		const key = String(id);
		if (!/^\d{1,20}$/.test(key)) return Promise.resolve({ error: "badId" });
		if (!fetchImpl) return Promise.resolve({ error: "noFetch" });
		if (isNegative(key)) {
			counters.negativeHits++;
			return Promise.resolve({ error: negativeReason(key) || "negative", negative: true });
		}
		const flying = inFlight.get(key);
		if (flying) {
			counters.deduped++;
			return flying;
		}
		counters.requests++;
		const p = (async () => {
			const endpoints = buildEndpoints(key, callOpts.proxies);
			let last = { error: "network" };
			for (const url of endpoints) {
				const r = await tryEndpoint(url);
				if (r.bytes) {
					counters.success++;
					return { bytes: r.bytes, container: r.container, url };
				}
				last = r;
			}
			negative.set(key, { until: now() + limits.negativeTtlMs, reason: last.error });
			return last;
		})();
		inFlight.set(key, p);
		const done = () => inFlight.delete(key);
		p.then(done, done);
		return p;
	}

	return { fetchAudio, isNegative, negativeReason, markPermanentFailure, clearNegative, counters, limits };
}

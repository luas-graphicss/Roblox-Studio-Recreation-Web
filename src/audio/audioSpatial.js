export const SPEED_OF_SOUND = 343;

export const SPATIAL_LIMITS = Object.freeze({
	minUpdateMs: 8,
	maxUpdateMs: 100,
	maxFrameDtMs: 250,
	gainTauMs: 25,
	posRampMs: 40,
	rateRampMs: 60,
	minDelta: Object.freeze({ gain: 0.0005, position: 0.002, rate: 0.0008 }),
	maxRadialSpeed: 1000,
	dopplerMin: 0.5,
	dopplerMax: 2,
	dopplerSmooth: 0.3,
	maxHrtfSources: 8,
	hrtfHysteresis: 0.15,
});


function num(v, fb) {
	if (typeof v === "number") return Number.isFinite(v) ? v : fb;
	if (v == null || typeof v === "symbol" || typeof v === "function") return fb;
	let n;
	try {
		n = Number(v);
	} catch {
		return fb;
	}
	return Number.isFinite(n) ? n : fb;
}

function clamp(v, lo, hi, fb) {
	const n = num(v, fb);
	return n < lo ? lo : n > hi ? hi : n;
}

function vec3(v) {
	if (!v || typeof v !== "object") return { x: 0, y: 0, z: 0 };
	return { x: num(v.x, 0), y: num(v.y, 0), z: num(v.z, 0) };
}


function effectiveLimits(overrides) {
	if (!overrides || typeof overrides !== "object") return SPATIAL_LIMITS;
	const o = overrides;
	const md = o.minDelta && typeof o.minDelta === "object" ? o.minDelta : {};
	const minUpdateMs = Math.max(0.001, num(o.minUpdateMs, SPATIAL_LIMITS.minUpdateMs));
	const maxUpdateMs = Math.max(minUpdateMs, num(o.maxUpdateMs, SPATIAL_LIMITS.maxUpdateMs));
	const maxFrameDtMs = Math.max(maxUpdateMs, num(o.maxFrameDtMs, SPATIAL_LIMITS.maxFrameDtMs));
	const dopplerMin = Math.max(0.001, num(o.dopplerMin, SPATIAL_LIMITS.dopplerMin));
	return {
		minUpdateMs,
		maxUpdateMs,
		maxFrameDtMs,
		gainTauMs: Math.max(0.001, num(o.gainTauMs, SPATIAL_LIMITS.gainTauMs)),
		posRampMs: Math.max(minUpdateMs, num(o.posRampMs, SPATIAL_LIMITS.posRampMs)),
		rateRampMs: Math.max(0.001, num(o.rateRampMs, SPATIAL_LIMITS.rateRampMs)),
		minDelta: {
			gain: Math.max(0, num(md.gain, SPATIAL_LIMITS.minDelta.gain)),
			position: Math.max(0, num(md.position, SPATIAL_LIMITS.minDelta.position)),
			rate: Math.max(0, num(md.rate, SPATIAL_LIMITS.minDelta.rate)),
		},
		maxRadialSpeed: Math.max(0, num(o.maxRadialSpeed, SPATIAL_LIMITS.maxRadialSpeed)),
		dopplerMin,
		dopplerMax: Math.max(dopplerMin, num(o.dopplerMax, SPATIAL_LIMITS.dopplerMax)),
		dopplerSmooth: clamp(o.dopplerSmooth, 0, 1, SPATIAL_LIMITS.dopplerSmooth),
		maxHrtfSources: Math.max(0, Math.floor(num(o.maxHrtfSources, SPATIAL_LIMITS.maxHrtfSources))),
		hrtfHysteresis: clamp(o.hrtfHysteresis, 0, 1, SPATIAL_LIMITS.hrtfHysteresis),
	};
}

function isAudioParamLike(p) {
	return !!p && typeof p === "object" && typeof p.value === "number" && typeof p.setValueAtTime === "function";
}


export function detectSpatialCapability(ctx) {
	const out = { panner: false, hrtf: false, paramAutomation: false, listenerParams: false, reason: null };
	try {
		if (!ctx || (typeof ctx !== "object" && typeof ctx !== "function")) {
			out.reason = "noCtx";
			return out;
		}
		const missing = [];
		let panner = null;
		try {
			if (typeof ctx.createPanner === "function") panner = ctx.createPanner();
		} catch {
			panner = null;
		}
		out.panner = !!panner;
		if (!out.panner) missing.push("panner");
		if (panner) {

			try {
				panner.panningModel = "HRTF";
				out.hrtf = panner.panningModel === "HRTF";
			} catch {
				out.hrtf = false;
			}
		}
		if (!out.hrtf) missing.push("hrtf");
		let param = null;
		try {
			if (typeof ctx.createGain === "function") {
				const g = ctx.createGain();
				param = g ? g.gain : null;
			}
		} catch {
			param = null;
		}
		if (!param && panner) param = panner.positionX || null;                 
		out.paramAutomation =
			!!param &&
			typeof param.setTargetAtTime === "function" &&
			typeof param.linearRampToValueAtTime === "function" &&
			typeof param.cancelScheduledValues === "function";
		if (!out.paramAutomation) missing.push("paramAutomation");
		let lp = null;
		try {
			lp = ctx.listener ? ctx.listener.positionX : null;
		} catch {
			lp = null;
		}
		out.listenerParams = isAudioParamLike(lp);
		if (!out.listenerParams) missing.push("listenerParams");
		out.reason = missing.length > 0 ? "missing:" + missing.join(",") : null;
	} catch {
		out.panner = false;
		out.hrtf = false;
		out.paramAutomation = false;
		out.listenerParams = false;
		out.reason = "detectError";
	}
	return out;
}


export function createFrameClock(opts = {}) {
	const o = opts && typeof opts === "object" ? opts : {};
	const limits = effectiveLimits(o.limits);
	const nowFn = typeof o.now === "function" ? o.now : null;
	const counters = { frames: 0, updates: 0, skipped: 0, forced: 0, longFrames: 0 };
	let lastUpdateMs = null;

	function readNow(nowMs) {
		let t = num(nowMs, NaN);
		if (!Number.isFinite(t) && nowFn) {
			try {
				t = num(nowFn(), NaN);
			} catch {
				t = NaN;
			}
		}
		if (!Number.isFinite(t)) t = lastUpdateMs == null ? 0 : lastUpdateMs + limits.minUpdateMs;
		return t;
	}

	function tick(nowMs) {
		counters.frames++;
		const t = readNow(nowMs);
		if (lastUpdateMs == null) {

			lastUpdateMs = t;
			counters.updates++;
			const dtMs = limits.minUpdateMs;
			return { update: true, dt: dtMs / 1000, dtMs, forced: false };
		}
		let elapsed = t - lastUpdateMs;
		if (!Number.isFinite(elapsed)) elapsed = limits.minUpdateMs;
		if (elapsed < 0) {

			lastUpdateMs = t;
			counters.skipped++;
			const dtMs = Math.min(limits.minUpdateMs, limits.maxFrameDtMs);
			return { update: false, dt: dtMs / 1000, dtMs, forced: false };
		}
		if (elapsed > limits.maxFrameDtMs) counters.longFrames++;
		if (elapsed < limits.minUpdateMs) {
			counters.skipped++;
			const dtMs = Math.max(elapsed, 0.001);
			return { update: false, dt: dtMs / 1000, dtMs, forced: false };
		}
		const dtMs = Math.min(elapsed, limits.maxFrameDtMs);
		const forced = elapsed >= limits.maxUpdateMs;
		counters.updates++;
		if (forced) counters.forced++;
		lastUpdateMs = t;
		return { update: true, dt: dtMs / 1000, dtMs, forced };
	}

	function reset() {
		lastUpdateMs = null;
		counters.frames = 0;
		counters.updates = 0;
		counters.skipped = 0;
		counters.forced = 0;
		counters.longFrames = 0;
	}

	return { tick, reset, counters, limits };
}


export function rolloffGain(mode, d, rMin, rMax, emitterSize, maxDistance) {
	const dd = num(d, 0);
	const emitter = num(emitterSize, 0);
	const maxDist = num(maxDistance, 0);
	if (dd <= emitter) return 1;
	if (maxDist > 0 && dd >= maxDist) return 0;
	const start = Math.max(emitter, num(rMin, 0));
	const end = Math.max(start + 0.001, Math.min(maxDist > 0 ? maxDist : num(rMax, 0), num(rMax, 0)));
	const rollMode = typeof mode === "string" ? mode : "";
	if (rollMode === "Linear" || rollMode === "LinearSquare") {
		const t = 1 - clamp((dd - start) / (end - start), 0, 1, 0);
		return rollMode === "Linear" ? t : t * t;
	}
	const g = start / Math.max(dd, start);           
	if (rollMode === "InverseTapered") {
		const t = 1 - clamp((dd - start) / (end - start), 0, 1, 0);
		return g * (0.5 + 0.5 * t);
	}
	return g;
}


export function computeSpatial(input) {
	const inp = input && typeof input === "object" ? input : {};
	const limits = effectiveLimits(inp.limits);

	const pos = vec3(inp.emitter);
	const listener = inp.listener && typeof inp.listener === "object" ? inp.listener : null;
	const lpos = vec3(listener ? listener.pos : null);

	const prev = inp.prev && typeof inp.prev === "object" ? inp.prev : null;
	const prevPos = prev && prev.pos && typeof prev.pos === "object" ? vec3(prev.pos) : null;
	const prevT = prev ? num(prev.t, 0) : 0;
	const prevDoppler = prev ? clamp(prev.doppler, limits.dopplerMin, limits.dopplerMax, 1) : 1;

	const t = num(inp.t, prev ? prevT : 0);

	const roll = inp.rolloff && typeof inp.rolloff === "object" ? inp.rolloff : {};
	const mode = typeof roll.mode === "string" && roll.mode.length > 0 ? roll.mode : "Inverse";
	const rMin = Math.max(0.1, num(roll.min, 10));
	const rMax = Math.max(rMin + 0.1, num(roll.max, 10000));
	const emitterSize = clamp(roll.emitterSize, 0, 100, 10);
	const maxDistance = Math.max(0, num(roll.maxDistance, 10000));

	const factors = inp.factors && typeof inp.factors === "object" ? inp.factors : {};
	const distanceFactor = Math.max(0.001, num(factors.distanceFactor, 1));
	const dopplerScale = Math.max(0, num(factors.dopplerScale, 1));
	const rolloffScale = Math.max(0.001, num(factors.rolloffScale, 1));

	const dx = pos.x - lpos.x;
	const dy = pos.y - lpos.y;
	const dz = pos.z - lpos.z;
	let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
	if (!Number.isFinite(distance)) distance = 0;


	const dtFloor = limits.minUpdateMs / 1000;
	let dt = num(inp.dt, NaN);
	if (!Number.isFinite(dt) && prev) dt = t - prevT;
	if (!Number.isFinite(dt) || dt < dtFloor) dt = dtFloor;


	let radialSpeed = 0;
	let doppler;
	if (prev) {
		if (prevPos) {
			const vx = (pos.x - prevPos.x) / dt;
			const vy = (pos.y - prevPos.y) / dt;
			const vz = (pos.z - prevPos.z) / dt;
			const dl = Math.max(0.001, distance);
			radialSpeed = clamp((vx * dx + vy * dy + vz * dz) / dl, -limits.maxRadialSpeed, limits.maxRadialSpeed, 0);
		}
		const target = clamp(1 - (radialSpeed * dopplerScale) / SPEED_OF_SOUND, limits.dopplerMin, limits.dopplerMax, 1);
		doppler = prevDoppler * (1 - limits.dopplerSmooth) + target * limits.dopplerSmooth;
	} else {
		doppler = clamp(1, limits.dopplerMin, limits.dopplerMax, 1);
	}
	if (!Number.isFinite(doppler)) doppler = 1;


	let gain = 0;
	if (!(maxDistance > 0 && distance >= maxDistance)) {
		const dEff = (distance / distanceFactor) * Math.max(0.001, rolloffScale);
		gain = clamp(rolloffGain(mode, dEff, rMin, rMax, emitterSize, maxDistance), 0, 1, 0);
	}
	const audible = gain > 0;

	return {
		audible,
		distance,
		gain,
		position: { x: pos.x, y: pos.y, z: pos.z },
		doppler,
		radialSpeed,
		next: { pos: { x: pos.x, y: pos.y, z: pos.z }, t, doppler },
	};
}


export function rampPlan(kind, from, to, dtMs, opts = {}) {
	const o = opts && typeof opts === "object" ? opts : {};
	const limits = effectiveLimits(o.limits);
	const k = kind === "gain" || kind === "position" || kind === "rate" ? kind : "gain";
	const f = num(from, 0);
	const target = num(to, f);
	const delta = target - f;
	if (o.automation === false || Math.abs(delta) < limits.minDelta[k]) {
		return { method: "set", tau: 0, durationMs: 0, delta };
	}
	if (k === "position") {
		const durationMs = clamp(dtMs, limits.minUpdateMs, limits.posRampMs, limits.minUpdateMs);
		return { method: "linearRamp", tau: Math.max(0.001, durationMs / 1000), durationMs, delta };
	}
	const tau = Math.max(0.001, (k === "gain" ? limits.gainTauMs : limits.rateRampMs) / 1000);

	const durationMs = Math.max(1, Math.round(tau * 3000));
	return { method: "setTarget", tau, durationMs, delta };
}


export function planHrtfBudget(sources, opts = {}) {
	const o = opts && typeof opts === "object" ? opts : {};
	const limits = effectiveLimits(o.limits);
	const result = { hrtf: new Set(), upgraded: [], downgraded: [], considered: 0 };
	const valid = [];
	const seen = new Set();
	if (Array.isArray(sources)) {
		for (const s of sources) {
			if (!s || typeof s !== "object") continue;
			const rawId = s.id;
			if (typeof rawId !== "string" && typeof rawId !== "number") continue;
			const id = String(rawId);
			if (id.length === 0 || seen.has(id)) continue;
			const gain = num(s.gain, NaN);
			if (!Number.isFinite(gain)) continue;
			const rawDist = num(s.distance, NaN);
			seen.add(id);
			valid.push({
				id,
				gain: Math.max(0, gain),
				distance: Number.isFinite(rawDist) ? Math.max(0, rawDist) : Number.MAX_VALUE,
				wasHrtf: s.wasHrtf === true,
			});
		}
	}
	result.considered = valid.length;
	if (valid.length === 0) return result;

	const sorted = valid.slice().sort((a, b) => {
		if (b.gain !== a.gain) return b.gain - a.gain;
		if (a.distance !== b.distance) return a.distance - b.distance;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
	const budget = limits.maxHrtfSources;
	const selected = new Set();
	if (sorted.length <= budget) {
		for (const s of sorted) selected.add(s.id);
	} else if (budget > 0) {

		const cutoffGain = sorted[budget - 1].gain;


		const threshold = cutoffGain > 0 ? cutoffGain * (1 - limits.hrtfHysteresis) : Number.EPSILON;

		for (const s of sorted) {
			if (selected.size >= budget) break;
			if (s.wasHrtf && s.gain >= threshold) selected.add(s.id);
		}

		for (const s of sorted) {
			if (selected.size >= budget) break;
			if (!selected.has(s.id)) selected.add(s.id);
		}
	}
	for (const s of valid) {
		if (selected.has(s.id)) {
			result.hrtf.add(s.id);
			if (!s.wasHrtf) result.upgraded.push(s.id);
		} else if (s.wasHrtf) {
			result.downgraded.push(s.id);
		}
	}
	return result;
}

export const RT_FULL_VERSION = "rt-full-11c1";


export const RT_FULL_MAX_DIM = 1920;
export const RT_FULL_MAX_TEXELS = 2400000;
export const RT_FULL_MIN_DIM = 64;


export const RT_FULL_TILE = 16;


export const RT_FULL_BATCH = 262144;


export const TILE_LIT = 0;
export const TILE_SHADOW = 1;
export const TILE_TRACE = 2;


export const RT_FULL_LIT_HI = 0.985;
export const RT_FULL_SHADOW_LO = 0.015;

export const RT_FULL_RANGE_CUT = 0.08;


export const RT_DENOISE_ITERATIONS = 2;
export const RT_DENOISE_SIGMA_Z = 0.35;
export const RT_DENOISE_K_VAR = 6;
export const RT_DENOISE_K_MIN = 0.15;

function num(v, fb) {
	return typeof v === "number" && Number.isFinite(v) ? v : fb;
}

function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v;
}


export function fullResDimsFor(viewW, viewH, maxDim, maxTexels) {
	const w0 = Math.max(1, Math.round(num(viewW, 1)));
	const h0 = Math.max(1, Math.round(num(viewH, 1)));
	const cap = clamp(Math.round(num(maxDim, RT_FULL_MAX_DIM)), RT_FULL_MIN_DIM, 4096);
	const capT = clamp(
		Math.round(num(maxTexels, RT_FULL_MAX_TEXELS)),
		RT_FULL_MIN_DIM * RT_FULL_MIN_DIM,
		16777216,
	);
	let scale = Math.min(1, cap / Math.max(w0, h0));
	if (w0 * h0 * scale * scale > capT) {
		scale = Math.sqrt(capT / (w0 * h0));
	}
	let w = Math.round(w0 * scale);
	let h = Math.round(h0 * scale);

	while (w * h > capT && (w > RT_FULL_MIN_DIM || h > RT_FULL_MIN_DIM)) {
		if (w >= h && w > RT_FULL_MIN_DIM) w--;
		else if (h > RT_FULL_MIN_DIM) h--;
		else break;
	}
	w = clamp(w, RT_FULL_MIN_DIM, cap);
	h = clamp(h, RT_FULL_MIN_DIM, cap);
	return { w, h };
}


export function tileGridFor(w, h, tile) {
	const tw = clamp(Math.round(num(tile, RT_FULL_TILE)), 4, 128);
	const gw = Math.max(1, Math.round(num(w, 1)));
	const gh = Math.max(1, Math.round(num(h, 1)));
	return { tilesX: Math.ceil(gw / tw), tilesY: Math.ceil(gh / tw), tile: tw };
}


export function classifyTiles(args) {
	const a = args && typeof args === "object" ? args : {};
	const lowVis = a.lowVis || null;
	const lowValid = a.lowValid || null;
	const lowW = Math.max(1, Math.round(num(a.lowW, 1)));
	const lowH = Math.max(1, Math.round(num(a.lowH, 1)));
	const fullW = Math.max(1, Math.round(num(a.fullW, 1)));
	const fullH = Math.max(1, Math.round(num(a.fullH, 1)));
	const grid = tileGridFor(fullW, fullH, a.tile);
	const tile = grid.tile;
	const tilesX = grid.tilesX;
	const tilesY = grid.tilesY;
	const litHi = clamp(num(a.litHi, RT_FULL_LIT_HI), 0.5, 1);
	const shadowLo = clamp(num(a.shadowLo, RT_FULL_SHADOW_LO), 0, 0.5);
	const rangeCut = Math.max(0, num(a.rangeCut, RT_FULL_RANGE_CUT));
	const range = a.tileRangeRel || null;
	const state = new Uint8Array(tilesX * tilesY);
	let lit = 0;
	let shadow = 0;
	let trace = 0;
	const okLow = !!(lowVis && lowVis.length >= lowW * lowH);
	for (let ty = 0; ty < tilesY; ty++) {
		for (let tx = 0; tx < tilesX; tx++) {
			const t = ty * tilesX + tx;


			if (range && num(range[t], Infinity) > rangeCut) {
				state[t] = TILE_TRACE;
				trace++;
				continue;
			}
			if (!okLow) {
				state[t] = TILE_TRACE;
				trace++;
				continue;
			}


			const x0 = clamp(Math.floor((tx * tile * lowW) / fullW) - 1, 0, lowW - 1);
			const x1 = clamp(
				Math.floor(((Math.min(fullW, (tx + 1) * tile) - 1) * lowW) / fullW) + 1,
				0,
				lowW - 1,
			);
			const y0 = clamp(Math.floor((ty * tile * lowH) / fullH) - 1, 0, lowH - 1);
			const y1 = clamp(
				Math.floor(((Math.min(fullH, (ty + 1) * tile) - 1) * lowH) / fullH) + 1,
				0,
				lowH - 1,
			);
			let minV = Infinity;
			let maxV = -Infinity;
			let seen = false;
			let bad = false;
			for (let y = y0; y <= y1 && !bad; y++) {
				const row = y * lowW;
				for (let x = x0; x <= x1; x++) {
					const i = row + x;
					if (lowValid && !(num(lowValid[i], 0) > 0)) continue;
					const v = lowVis[i];
					if (typeof v !== "number" || !Number.isFinite(v)) {
						bad = true;
						break;
					}
					seen = true;
					if (v < minV) minV = v;
					if (v > maxV) maxV = v;
				}
			}
			if (bad) {
				state[t] = TILE_TRACE;
				trace++;
			} else if (!seen) {


				state[t] = TILE_TRACE;
				trace++;
			} else if (minV >= litHi) {
				state[t] = TILE_LIT;
				lit++;
			} else if (maxV <= shadowLo) {
				state[t] = TILE_SHADOW;
				shadow++;
			} else {
				state[t] = TILE_TRACE;
				trace++;
			}
		}
	}
	return { state, tilesX, tilesY, tile, lit, shadow, trace };
}


export function denoiseMaskPass(args) {
	const a = args && typeof args === "object" ? args : {};
	const src = a.src || null;
	const dst = a.dst || null;
	const depth = a.depth || null;
	const valid = a.valid || null;
	const w = Math.max(1, Math.round(num(a.w, 1)));
	const h = Math.max(1, Math.round(num(a.h, 1)));
	const grid = tileGridFor(w, h, a.tile);
	const tile = grid.tile;
	const tilesX = grid.tilesX;
	const tilesTotal = tilesX * grid.tilesY;
	const state = a.tileState || null;
	const step = clamp(Math.round(num(a.step, 1)), 1, 8);
	const sigmaZ = Math.max(1e-4, num(a.sigmaZ, RT_DENOISE_SIGMA_Z));
	const kVar = Math.max(0, num(a.kVar, RT_DENOISE_K_VAR));
	const kMin = clamp(num(a.kMin, RT_DENOISE_K_MIN), 0, 1);
	const from = clamp(Math.round(num(a.tileFrom, 0)), 0, tilesTotal);
	const to = clamp(Math.round(num(a.tileTo, tilesTotal)), from, tilesTotal);
	if (!src || !dst || !depth || src.length < w * h || dst.length < w * h || depth.length < w * h) {
		return 0;
	}
	const K = [1, 2, 1];
	let written = 0;
	for (let t = from; t < to; t++) {
		if (state && state[t] !== TILE_TRACE) continue;
		const tx = t % tilesX;
		const ty = (t / tilesX) | 0;
		const px1 = Math.min(w, tx * tile + tile);
		const py1 = Math.min(h, ty * tile + tile);
		for (let y = ty * tile; y < py1; y++) {
			for (let x = tx * tile; x < px1; x++) {
				const i = y * w + x;
				const vp = clamp(num(src[i], 1), 0, 1);
				if (valid && !(valid[i] > 0)) {
					dst[i] = vp;
					continue;
				}
				const zp = num(depth[i], 0);
				const cut = sigmaZ * Math.max(0.02, zp);
				let sum = 0;
				let wsum = 0;
				let m1 = 0;
				let m2 = 0;
				let n = 0;
				for (let dy = -1; dy <= 1; dy++) {
					const yy = y + dy * step;
					if (yy < 0 || yy >= h) continue;
					for (let dx = -1; dx <= 1; dx++) {
						const xx = x + dx * step;
						if (xx < 0 || xx >= w) continue;
						const j = yy * w + xx;
						if (valid && !(valid[j] > 0)) continue;
						const vq = src[j];
						if (typeof vq !== "number" || !Number.isFinite(vq)) continue;
						const dz = Math.abs(num(depth[j], 0) - zp);
						if (dz >= cut) continue;
						const wk = K[dx + 1] * K[dy + 1] * (1 - dz / cut);
						sum += vq * wk;
						wsum += wk;
						m1 += vq;
						m2 += vq * vq;
						n++;
					}
				}
				if (!(wsum > 0) || n < 2) {
					dst[i] = vp;
					continue;
				}
				const mean = m1 / n;
				const varc = Math.max(0, m2 / n - mean * mean);


				const k = clamp(Math.sqrt(varc) * kVar + kMin, kMin, 1);
				const filtered = clamp(sum / wsum, 0, 1);
				dst[i] = clamp(vp + (filtered - vp) * k, 0, 1);
				written++;
			}
		}
	}
	return written;
}


export const PARITY_SCENES = Object.freeze([
	Object.freeze({ id: "a", nome: "Contato: baseplate + objetos pequenos", foco: "contact hardening (Fases 1/9)" }),
	Object.freeze({ id: "b", nome: "Cidade 4096 studs", foco: "cascatas/páginas + estabilidade em órbita (Fases 1/4)" }),
	Object.freeze({ id: "c", nome: "Vale com montanhas (far field)", foco: "sombra além do range clássico (Fase 5)" }),
	Object.freeze({ id: "d", nome: "Interior com 24 luzes locais", foco: "atlas/budget de sombras locais (Fase 6)" }),
	Object.freeze({ id: "e", nome: "Avatares em movimento", foco: "cápsulas + estabilidade temporal (Fases 2/3)" }),
	Object.freeze({ id: "f", nome: "Penumbra extrema (sol baixo + softness 1.0)", foco: "PCSS/RT — penumbra larga limpa (Fases 1/7/11)" }),
]);


export function confusionRate(trials) {
	const list = Array.isArray(trials) ? trials : [];
	let total = 0;
	let confused = 0;
	const perScene = {};
	for (let i = 0; i < list.length; i++) {
		const t = list[i];
		if (!t || typeof t !== "object") continue;
		const truth = t.truth === "engine" || t.truth === "ue" ? t.truth : null;
		const guess =
			t.guess === "engine" || t.guess === "ue" || t.guess === "indistinto" ? t.guess : null;
		if (!truth || !guess) continue;
		total++;
		const c = guess === "indistinto" || guess !== truth;
		if (c) confused++;
		const sid = typeof t.sceneId === "string" ? t.sceneId : "?";
		if (!perScene[sid]) perScene[sid] = { total: 0, confused: 0 };
		perScene[sid].total++;
		if (c) perScene[sid].confused++;
	}
	const rate = total > 0 ? confused / total : 0;
	let scenesCovered = 0;
	for (let i = 0; i < PARITY_SCENES.length; i++) {
		const ps = perScene[PARITY_SCENES[i].id];
		if (ps && ps.total > 0) scenesCovered++;
	}
	return {
		total,
		confused,
		rate,
		scenesCovered,
		pass70: scenesCovered === PARITY_SCENES.length && rate >= 0.7,
		perScene,
	};
}

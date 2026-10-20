import { tileGridFor } from "./rtFullResCore.js";

function num(v, fb) {
	return typeof v === "number" && Number.isFinite(v) ? v : fb;
}

export const RETRACE_VERSION = "retrace-13a";


export const RETRACE_FRACTION = Object.freeze({ ultra: 1 / 4, high: 1 / 8, medium: 1 / 16 });

export function retraceBudgetForTier(tier, tilesTotal) {
	const total = Math.max(0, Math.floor(num(tilesTotal, 0)));
	const frac = RETRACE_FRACTION[tier];
	if (!frac || total <= 0) return 0;
	return Math.max(1, Math.ceil(total * frac));
}


export function tileDeltaError(args) {
	const a = args && typeof args === "object" ? args : {};
	const w = Math.max(1, Math.floor(num(a.w, 1)));
	const h = Math.max(1, Math.floor(num(a.h, 1)));
	const grid = tileGridFor(w, h);
	const prev = a.prev && typeof a.prev.length === "number" ? a.prev : [];
	const cur = a.cur && typeof a.cur.length === "number" ? a.cur : [];
	const valid = a.valid && typeof a.valid.length === "number" ? a.valid : null;
	const tiles = grid.tilesX * grid.tilesY;
	const sum = new Float64Array(tiles);
	const cnt = new Float64Array(tiles);
	const bad = new Uint8Array(tiles);
	for (let y = 0; y < h; y++) {
		const ty = Math.min(grid.tilesY - 1, Math.floor(y / grid.tile));
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			const t = ty * grid.tilesX + Math.min(grid.tilesX - 1, Math.floor(x / grid.tile));
			if (valid && !valid[i]) continue;
			const p = prev[i];
			const c = cur[i];
			if (typeof p !== "number" || !Number.isFinite(p) || typeof c !== "number" || !Number.isFinite(c)) {
				bad[t] = 1;
				continue;
			}
			sum[t] += Math.abs(c - p);
			cnt[t] += 1;
		}
	}
	const err = new Float64Array(tiles);
	for (let t = 0; t < tiles; t++) {
		err[t] = bad[t] || cnt[t] === 0 ? Infinity : sum[t] / cnt[t];
	}
	return { err, grid };
}


export function retraceOrder(args) {
	const a = args && typeof args === "object" ? args : {};
	const err = a.err && typeof a.err.length === "number" ? a.err : [];
	const budget = Math.floor(num(a.budget, 0));
	const minErr = num(a.minErr, 0);
	if (budget <= 0 || err.length === 0) return [];
	const idx = [];
	for (let i = 0; i < err.length; i++) {
		const e = err[i];
		const v = typeof e === "number" && !Number.isNaN(e) ? e : Infinity;
		if (v >= minErr) idx.push(i);
	}
	idx.sort((p, q) => {
		const ep = typeof err[p] === "number" && !Number.isNaN(err[p]) ? err[p] : Infinity;
		const eq = typeof err[q] === "number" && !Number.isNaN(err[q]) ? err[q] : Infinity;
		if (ep !== eq) return eq < ep ? -1 : 1;
		return p - q;
	});
	return idx.slice(0, Math.min(budget, idx.length));
}


export function reprojectMask(args) {
	const a = args && typeof args === "object" ? args : {};
	const w = Math.max(1, Math.floor(num(a.w, 1)));
	const h = Math.max(1, Math.floor(num(a.h, 1)));
	const n = w * h;
	const origins = a.origins && typeof a.origins.length === "number" ? a.origins : null;
	const mask = a.mask && typeof a.mask.length === "number" ? a.mask : null;
	const m = a.prevVp && typeof a.prevVp.length === "number" && a.prevVp.length === 16 ? a.prevVp : null;
	const vis = new Float32Array(n);
	const valid = new Uint8Array(n);
	const prev = new Float32Array(n);
	vis.fill(1);
	const ok = !!(origins && origins.length >= n * 4 && mask && mask.length >= n * 4 && m);
	for (let i = 0; i < n; i++) {
		const q = i * 4;
		const shown = ok ? mask[q] / 255 : 1;
		prev[i] = Number.isFinite(shown) ? shown : 1;
		if (!ok) continue;
		if (!(origins[q + 3] > 0)) continue;                                     
		const x = origins[q];
		const y = origins[q + 1];
		const z = origins[q + 2];

		const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
		if (!(cw > 1e-6)) continue;                                   
		const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw;
		const cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
		if (!(cx > -1 && cx < 1 && cy > -1 && cy < 1)) continue;                        
		const px = Math.round((cx * 0.5 + 0.5) * (w - 1));
		const py = Math.round((cy * 0.5 + 0.5) * (h - 1));
		const j = ((py < 0 ? 0 : py >= h ? h - 1 : py) * w + (px < 0 ? 0 : px >= w ? w - 1 : px)) * 4;
		if (!(mask[j + 1] >= 128)) continue;                            
		const v = mask[j] / 255;
		if (!Number.isFinite(v)) continue;
		vis[i] = v < 0 ? 0 : v > 1 ? 1 : v;
		valid[i] = 1;
	}
	return { vis, valid, prev };
}


export function buildRetraceTexelOrder(args) {
	const a = args && typeof args === "object" ? args : {};
	const w = Math.max(1, Math.floor(num(a.w, 1)));
	const grid = a.grid && typeof a.grid === "object" ? a.grid : null;
	const tilesX = Math.max(1, Math.floor(num(grid && grid.tilesX, 1)));
	const tilesY = Math.max(1, Math.floor(num(grid && grid.tilesY, 1)));
	const tile = Math.max(1, Math.floor(num(grid && grid.tile, 16)));
	const activeIdx = a.activeIdx && typeof a.activeIdx.length === "number" ? a.activeIdx : [];
	const activeCount = Math.max(0, Math.min(Math.floor(num(a.activeCount, 0)), activeIdx.length));
	const order = a.order && typeof a.order.length === "number" ? a.order : [];
	const tilesTotal = tilesX * tilesY;

	const rank = new Int32Array(tilesTotal).fill(tilesTotal);
	for (let k = 0; k < order.length; k++) {
		const t = Math.floor(num(order[k], -1));
		if (t >= 0 && t < tilesTotal && rank[t] === tilesTotal) rank[t] = k;
	}
	const rankOf = (texel) => {
		const px = texel % w;
		const py = Math.floor(texel / w);
		const tx = Math.min(tilesX - 1, Math.floor(px / tile));
		const ty = Math.min(tilesY - 1, Math.floor(py / tile));
		return rank[ty * tilesX + tx];
	};
	const buckets = new Int32Array(tilesTotal + 2);
	for (let k = 0; k < activeCount; k++) buckets[rankOf(activeIdx[k]) + 1]++;
	for (let r = 1; r < buckets.length; r++) buckets[r] += buckets[r - 1];
	const out = new Int32Array(activeCount);
	for (let k = 0; k < activeCount; k++) {
		out[buckets[rankOf(activeIdx[k])]++] = activeIdx[k];
	}
	return out;
}

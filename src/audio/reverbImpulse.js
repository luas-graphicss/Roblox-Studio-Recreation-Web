const TAIL_CAP_S = 6;                                                                         
const FADE_S = 0.05;                             
const HF_REF_HZ = 5000;                                       

function num(v, fb) {
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : fb;
}

function clamp(v, lo, hi, fb) {
	const n = num(v, fb);
	return n < lo ? lo : n > hi ? hi : n;
}

function hashStr(s) {
	const str = String(s == null ? "" : s);
	let h = 2166136261 >>> 0;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h >>> 0;
}

function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}


function mbToGain(mb) {
	return Math.pow(10, clamp(mb, -10000, 2000, 0) / 2000);
}


export const REVERB_PRESET_PARAMS = Object.freeze({
	Off: null,
	NoReverb: null,
	GenericReverb: { t60: 1.49, hfr: 0.83, erDelay: 0.007, lateDelay: 0.011, erMb: -2602, lateMb: 200, diffusion: 1, density: 1, wet: 0.18 },
	PaddedCell: { t60: 0.17, hfr: 0.1, erDelay: 0.001, lateDelay: 0.002, erMb: -1204, lateMb: 207, diffusion: 1, density: 1, wet: 0.1 },
	Room: { t60: 0.4, hfr: 0.83, erDelay: 0.002, lateDelay: 0.003, erMb: -1646, lateMb: 53, diffusion: 1, density: 1, wet: 0.14 },
	Bathroom: { t60: 1.49, hfr: 0.54, erDelay: 0.007, lateDelay: 0.011, erMb: -370, lateMb: 1030, diffusion: 1, density: 0.6, wet: 0.24 },
	LivingRoom: { t60: 0.5, hfr: 0.1, erDelay: 0.003, lateDelay: 0.004, erMb: -1376, lateMb: -1104, diffusion: 1, density: 1, wet: 0.12 },
	StoneRoom: { t60: 2.31, hfr: 0.64, erDelay: 0.012, lateDelay: 0.017, erMb: -711, lateMb: 83, diffusion: 1, density: 1, wet: 0.2 },
	Auditorium: { t60: 4.32, hfr: 0.59, erDelay: 0.02, lateDelay: 0.03, erMb: -789, lateMb: -289, diffusion: 1, density: 1, wet: 0.22 },
	ConcertHall: { t60: 3.92, hfr: 0.7, erDelay: 0.02, lateDelay: 0.029, erMb: -1230, lateMb: -2, diffusion: 1, density: 1, wet: 0.26 },
	Cave: { t60: 2.91, hfr: 1.3, erDelay: 0.015, lateDelay: 0.022, erMb: -602, lateMb: -302, diffusion: 1, density: 1, wet: 0.3 },
	Arena: { t60: 7.24, hfr: 0.33, erDelay: 0.02, lateDelay: 0.03, erMb: -1166, lateMb: 16, diffusion: 1, density: 1, wet: 0.24 },
	Hangar: { t60: 10.05, hfr: 0.23, erDelay: 0.02, lateDelay: 0.03, erMb: -602, lateMb: 198, diffusion: 1, density: 1, wet: 0.28 },
	CarpettedHallway: { t60: 0.3, hfr: 0.1, erDelay: 0.002, lateDelay: 0.03, erMb: -1831, lateMb: -1630, diffusion: 1, density: 1, wet: 0.08 },
	Hallway: { t60: 1.49, hfr: 0.59, erDelay: 0.007, lateDelay: 0.011, erMb: -1219, lateMb: 441, diffusion: 1, density: 1, wet: 0.18 },
	StoneCorridor: { t60: 2.7, hfr: 0.79, erDelay: 0.013, lateDelay: 0.02, erMb: -1214, lateMb: 395, diffusion: 1, density: 1, wet: 0.2 },
	Alley: { t60: 1.49, hfr: 0.86, erDelay: 0.007, lateDelay: 0.011, erMb: -1204, lateMb: -4, diffusion: 0.3, density: 1, wet: 0.16 },
	Forest: { t60: 1.49, hfr: 0.54, erDelay: 0.162, lateDelay: 0.088, erMb: -2560, lateMb: -613, diffusion: 0.79, density: 1, wet: 0.1 },
	City: { t60: 1.49, hfr: 0.67, erDelay: 0.007, lateDelay: 0.011, erMb: -2273, lateMb: -2217, diffusion: 0.5, density: 1, wet: 0.12 },
	Mountains: { t60: 1.49, hfr: 0.21, erDelay: 0.3, lateDelay: 0.1, erMb: -2780, lateMb: -2014, diffusion: 0.27, density: 1, wet: 0.1 },
	Quarry: { t60: 1.49, hfr: 0.83, erDelay: 0.061, lateDelay: 0.025, erMb: -10000, lateMb: 500, diffusion: 1, density: 1, wet: 0.18 },
	Plain: { t60: 1.49, hfr: 0.5, erDelay: 0.179, lateDelay: 0.1, erMb: -2466, lateMb: -2514, diffusion: 0.21, density: 1, wet: 0.08 },
	ParkingLot: { t60: 1.65, hfr: 1.5, erDelay: 0.008, lateDelay: 0.012, erMb: -1363, lateMb: -1153, diffusion: 1, density: 1, wet: 0.14 },
	SewerPipe: { t60: 2.81, hfr: 0.14, erDelay: 0.014, lateDelay: 0.021, erMb: 429, lateMb: 1023, diffusion: 0.8, density: 0.6, wet: 0.32 },
	UnderWater: { t60: 1.49, hfr: 0.1, erDelay: 0.007, lateDelay: 0.011, erMb: -449, lateMb: 1700, diffusion: 1, density: 1, wet: 0.36 },
});


export function reverbPresetParams(name) {
	const key = String(name == null ? "" : name);
	if (!Object.prototype.hasOwnProperty.call(REVERB_PRESET_PARAMS, key)) return null;
	return REVERB_PRESET_PARAMS[key];
}


export function buildImpulseResponse(params, sampleRate, seedLabel) {
	const sr = clamp(sampleRate, 3000, 384000, 48000);
	const t60 = clamp(params && params.t60, 0.05, 20, 1.5);
	const hfr = clamp(params && params.hfr, 0.05, 2, 0.83);
	const erDelay = clamp(params && params.erDelay, 0, 0.5, 0.007);
	const lateDelay = clamp(params && params.lateDelay, 0, 0.5, 0.011);
	const diffusion = clamp(params && params.diffusion, 0, 1, 1);
	const density = clamp(params && params.density, 0, 1, 1);

	const erG = mbToGain(params && params.erMb !== undefined ? params.erMb : -2602);
	const lateG = mbToGain(params && params.lateMb !== undefined ? params.lateMb : 200);
	const peakG = Math.max(erG, lateG, 1e-6);
	const erRel = erG / peakG;
	const lateRel = lateG / peakG;

	const lateStart = erDelay + lateDelay;

	const tailSec = Math.min(TAIL_CAP_S, t60 * Math.max(1, hfr));
	const len = Math.max(32, Math.round((lateStart + tailSec + FADE_S) * sr));
	const fadeSamples = Math.max(1, Math.round(FADE_S * sr));
	const lpCoef = Math.exp((-2 * Math.PI * HF_REF_HZ) / sr);                               

	const minFill = 0.1 + 0.65 * density;
	const rampT = 0.02 + (1 - diffusion) * 0.18;

	const channels = [];
	for (let ch = 0; ch < 2; ch++) {
		const data = new Float32Array(len);
		const rnd = mulberry32(hashStr(String(seedLabel || "ir") + ":" + ch));


		if (erRel > 1e-4) {
			const tapCount = 6 + Math.round(14 * diffusion);
			const spread = clamp(0.01 + 0.012 * t60, 0.01, 0.1, 0.03);                                   
			for (let k = 0; k < tapCount; k++) {
				const frac = Math.pow((k + rnd()) / tapCount, 0.8);
				const idx = Math.min(len - 1, Math.round((erDelay + spread * frac) * sr));
				const sign = k % 2 === 0 ? 1 : -1;
				data[idx] += sign * erRel * Math.pow(0.8, k) * (0.75 + 0.5 * rnd());
			}
		}


		if (lateRel > 1e-4) {
			const startIdx = Math.min(len - 1, Math.round(lateStart * sr));
			const kLow = -3 / Math.max(0.05, t60);                              
			const kHigh = -3 / Math.max(0.05, t60 * hfr);


			let lp1 = 0;
			let lp2 = 0;
			for (let i = startIdx; i < len; i++) {
				const t = (i - startIdx) / sr;
				const fill = Math.min(1, minFill + (1 - minFill) * (t / rampT));
				const white = rnd() < fill ? rnd() * 2 - 1 : 0;
				lp1 += (1 - lpCoef) * (white - lp1);
				lp2 += (1 - lpCoef) * (lp1 - lp2);
				const low = lp2 * Math.pow(10, kLow * t);
				const high = (white - lp2) * Math.pow(10, kHigh * t);
				data[i] += lateRel * (low + high);
			}
		}


		for (let i = 0; i < fadeSamples; i++) {
			const idx = len - 1 - i;
			if (idx >= 0) data[idx] *= i / fadeSamples;
		}
		channels.push(data);
	}


	let peak = 0;
	for (const data of channels) {
		for (let i = 0; i < data.length; i++) {
			const a = Math.abs(data[i]);
			if (a > peak) peak = a;
		}
	}
	if (peak > 1e-8) {
		const scale = 0.9 / peak;
		for (const data of channels) {
			for (let i = 0; i < data.length; i++) data[i] *= scale;
		}
	}

	return { sampleRate: sr, length: len, channels };
}


export function buildAmbientImpulse(name, sampleRate) {
	const params = reverbPresetParams(name);
	if (!params || !(params.wet > 0)) return null;
	return buildImpulseResponse(params, sampleRate, "ambient:" + String(name));
}


export function buildEffectImpulse(opts, sampleRate) {
	const decayTime = clamp(opts && opts.decayTime, 0.1, 20, 1.5);
	const diffusion = clamp(opts && opts.diffusion, 0, 1, 1);
	const density = clamp(opts && opts.density, 0, 1, 1);
	const params = {
		t60: decayTime,
		hfr: 0.7,
		erDelay: 0.007,
		lateDelay: 0.011,
		erMb: -1200,
		lateMb: 0,
		diffusion,
		density,
	};
	return buildImpulseResponse(
		params,
		sampleRate,
		`effect:${decayTime.toFixed(3)}:${diffusion.toFixed(3)}:${density.toFixed(3)}`,
	);
}

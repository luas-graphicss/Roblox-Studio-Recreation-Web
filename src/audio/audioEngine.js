import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { Events } from "../datamodel/index.js";
import { clampTagRate, detectTagRateRange, TAG_RATE_SAFE } from "./audioTagRate.js";
import { logger } from "../core/logger.js";
import { assetStore } from "../assets/assetStore.js";
import { normalizeSoundId, parseDataUri, parseWav } from "./audioDecode.js";
import { buildAmbientImpulse, buildEffectImpulse, reverbPresetParams } from "./reverbImpulse.js";
import { createCdnFetcher, extractAssetId } from "./audioCdn.js";
import { filterAllowedProxyPrefixes } from "../runtime/cdnProxyPolicy.js";
import { createTagProber, detectTagCapability, tagUrlForAssetId } from "./audioTag.js";
import { createGraphProber, detectGraphCapability, graphUrlForAssetId } from "./audioTagGraph.js";
import { createPromotionScheduler } from "./audioTagPromote.js";
import { createByteVault } from "./audioByteVault.js";
import { TAG_MIX_LIMITS, computeTagMix, groupChainGain } from "./audioTagMix.js";
import { SPATIAL_LIMITS, computeSpatial, createFrameClock, detectSpatialCapability, planHrtfBudget, rampPlan } from "./audioSpatial.js";


import { createListenerScope } from "../core/listenerScope.js";


import { runOnNextUserGesture } from "../core/nextUserGestureRetry.js";


const RUNTIME_MODE_CHANGED = "runtime:modeChanged";


const MAX_PLAYING = 64;
const MAX_GROUP_DEPTH = 10;
const TICK_MS = 100;
const SPEED_OF_SOUND = 343;
const DEG2RAD = Math.PI / 180;

const SOUND_EFFECT_CLASS_NAMES = Object.freeze([
	"EqualizerSoundEffect",
	"ReverbSoundEffect",
	"DistortionSoundEffect",
	"ChorusSoundEffect",
	"CompressorSoundEffect",
	"EchoSoundEffect",
	"FlangeSoundEffect",
	"PitchShiftSoundEffect",
	"TremoloSoundEffect",
]);
const EFFECT_SET = new Set(SOUND_EFFECT_CLASS_NAMES);


function num(v, fb) {
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : fb;
}

function clamp(v, lo, hi, fb) {
	const n = num(v, fb);
	return n < lo ? lo : n > hi ? hi : n;
}

function dbToGain(db, lo, hi) {
	return Math.pow(10, clamp(db, lo, hi, 0) / 20);
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

function prop(inst, name) {
	try {
		return inst && typeof inst.getProperty === "function" ? inst.getProperty(name) : undefined;
	} catch {
		return undefined;
	}
}

function alive(inst) {
	return !!(inst && (typeof inst.isDestroyed !== "function" || !inst.isDestroyed()));
}

function isSound(inst) {
	return !!(alive(inst) && inst.className === "Sound");
}

function isGroup(inst) {
	return !!(alive(inst) && inst.className === "SoundGroup");
}

function isEffect(inst) {
	return !!(alive(inst) && EFFECT_SET.has(inst.className));
}

function isBasePartInst(inst) {
	return !!(
		alive(inst) &&
		typeof inst.hasProperty === "function" &&
		inst.hasProperty("Anchored") &&
		inst.hasProperty("Position")
	);
}


function rotateByEulerDeg(v, rot) {
	const rx = num(rot && rot.x, 0) * DEG2RAD;
	const ry = num(rot && rot.y, 0) * DEG2RAD;
	const rz = num(rot && rot.z, 0) * DEG2RAD;
	let c = Math.cos(rz);
	let s = Math.sin(rz);
	const x1 = v.x * c - v.y * s;
	const y1 = v.x * s + v.y * c;
	const z1 = v.z;
	c = Math.cos(rx);
	s = Math.sin(rx);
	const y2 = y1 * c - z1 * s;
	const z2 = y1 * s + z1 * c;
	const x2 = x1;
	c = Math.cos(ry);
	s = Math.sin(ry);
	return { x: x2 * c + z2 * s, y: y2, z: -x2 * s + z2 * c };
}

function rotateByQuat(v, q) {
	const qx = q.x || 0;
	const qy = q.y || 0;
	const qz = q.z || 0;
	const qw = q.w === undefined ? 1 : q.w;
	const tx = 2 * (qy * v.z - qz * v.y);
	const ty = 2 * (qz * v.x - qx * v.z);
	const tz = 2 * (qx * v.y - qy * v.x);
	return {
		x: v.x + qw * tx + (qy * tz - qz * ty),
		y: v.y + qw * ty + (qz * tx - qx * tz),
		z: v.z + qw * tz + (qx * ty - qy * tx),
	};
}


let ctx = null;
let master = null;
let reverbIn = null;
let reverbConvolver = null;
let reverbWet = null;
let currentReverbName = null;
let inited = false;
let getCameraFn = null;
let tickTimer = null;
let mode = "edit";
let syncingProps = false;                                                    
let warnedLimit = false;
let playingCount = 0;



let oneShotCount = 0;


const playOnRemoveFired = new WeakSet();

const pendingGroupRebuilds = new Set();
const unsubs = [];
const soundStates = new Map();                               
const groupGains = new Map();                                                   
const bufferCache = new Map();                                                        
const decodePending = new Map();                                                      
const decodeFailed = new Set();                                                  
let assetEpoch = 0;                                                                      
let previewGen = 0;                                                             

let cdnFetcher = null;                                                      
const cdnFallback = new Map();                                                                       
const cdnWarned = new Set();                              

let byteVault = null;                                                     
let localAssetPromotions = 0;                                                  

let spatialCapability = null;                                                         
let spatialClock = null;                                                                         
let spatialDriveMs = -Infinity;                                                       
let hrtfPlanMs = -Infinity;                                                  
let hrtfActive = new Set();                                         
let spatialUpdateStamps = [];                                                   
let spatialUid = 0;                                                   
let spatialFallbackDriving = false;                                            
let listenerType = "Camera";
let listenerValue = null;
let previewState = null;
let previewVolume = 0.35;

function ensureCtx() {
	if (ctx) return ctx;
	const AC = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
	if (!AC) return null;
	ctx = new AC();
	master = ctx.createGain();
	master.gain.value = 1;
	master.connect(ctx.destination);

	reverbIn = ctx.createGain();
	reverbConvolver = ctx.createConvolver();
	reverbWet = ctx.createGain();
	reverbWet.gain.value = 0;
	reverbIn.connect(reverbConvolver);
	reverbConvolver.connect(reverbWet);
	reverbWet.connect(master);
	applyAmbientReverb();


	const unlockListeners = createListenerScope("audioEngine:autoplayUnlock");
	const unlock = () => {
		if (!ctx) return;
		if (ctx.state !== "suspended") {
			unlockListeners.disposeAll();
			return;
		}
		ctx.resume().then(() => unlockListeners.disposeAll()).catch(() => {});
	};
	unlockListeners.add(window, "pointerdown", unlock, true);
	unlockListeners.add(window, "keydown", unlock, true);
	return ctx;
}


function assetForSoundId(key) {
	const rec = key && assetStore && typeof assetStore.getById === "function" ? assetStore.getById(key) : null;
	return rec && rec.section === "audio" && rec.dataUri ? rec : null;
}




function cdnIdForSoundId(key) {
	if (typeof globalThis !== "undefined" && globalThis.ROBLOX_AUDIO_CDN_DISABLED === true) return null;
	if (!key || assetForSoundId(key)) return null;
	return extractAssetId(key);
}

function ensureCdnFetcher() {
	if (!cdnFetcher) cdnFetcher = createCdnFetcher({});
	return cdnFetcher;
}


function cdnProxies() {
	const configured = typeof globalThis !== "undefined" ? globalThis.ROBLOX_AUDIO_CDN_PROXIES : null;
	const allowed = filterAllowedProxyPrefixes(configured);
	return allowed.length ? allowed : null;
}




function cdnFallbackBuffer(key) {
	let buf = cdnFallback.get(key);
	if (!buf) {
		buf = synthesizeBuffer(key);
		if (buf) cdnFallback.set(key, buf);
	}
	return buf || null;
}

function cdnWarnOnce(id, reason) {
	if (cdnWarned.has(id)) return;
	cdnWarned.add(id);
	if (reason === "decode") {
		logger.warn(`Áudio: o asset ${id} foi baixado da CDN mas o navegador não decodificou o formato; usando som sintetizado no lugar.`);
		return;
	}
	const ttlS = Math.round((ensureCdnFetcher().limits.negativeTtlMs || 60000) / 1000);
	logger.warn(
		`Áudio: não foi possível baixar o asset ${id} da CDN do Roblox (${reason}); usando som sintetizado temporário ` +
			`(nova tentativa automática em ~${ttlS}s). Navegadores bloqueiam a CDN por CORS — é possível configurar proxies em ROBLOX_AUDIO_CDN_PROXIES.`
	);
}


export function getCdnAudioDiagnostics() {
	const sources = {};
	const graphReasons = {};
	for (const [id, rung] of cdnRung) {
		sources[id] = rung;
		const why = graphProber ? graphProber.negativeReason(id) : null;
		if (why) graphReasons[id] = why;
	}
	return {
		enabled: !(typeof globalThis !== "undefined" && globalThis.ROBLOX_AUDIO_CDN_DISABLED === true),
		capability: ensureTagCapability(),
		graphCapability: ensureGraphCapability(),             
		tagRateRange: ensureTagRateRange(),                                                            


		tagEmulation: { spatialVolume: true, doppler: true, soundGroups: "volume", pitchShift: true, pan: false, reverb: false, dspEffects: false, livePromotion: true },
		tagPromotion: tagPromoter ? tagPromoter.snapshot() : null,


		byteVault: byteVault ? byteVault.stats() : null,
		localAssetPromotions,
		counters: cdnFetcher ? { ...cdnFetcher.counters } : null,
		tagCounters: tagProber ? { ...tagProber.counters } : null,
		graphCounters: graphProber ? { ...graphProber.counters } : null,
		fallbackActive: cdnFallback.size,
		sources,
		graphReasons,                                                       
	};
}

function roundDur(buffer) {
	return Math.round(buffer.duration * 100) / 100;
}


function noteBytesRung(key) {
	const id = cdnIdForSoundId(key);
	if (id && cdnRung.get(id) !== "bytes") cdnRung.set(id, "bytes");
}


function getBufferSync(soundId) {
	const key = normalizeSoundId(soundId);
	if (!key) return null;
	const hit = bufferCache.get(key);
	if (hit) {
		noteBytesRung(key);             
		return hit;
	}
	if (assetForSoundId(key)) return null;                                      
	if (cdnIdForSoundId(key)) return null;                                               
	const buf = synthesizeBuffer(key);
	if (buf) bufferCache.set(key, buf);
	return buf;
}


function decodeArrayBuffer(c, ab) {
	return new Promise((resolve, reject) => {
		let p = null;
		try {
			p = c.decodeAudioData(ab, resolve, reject);
		} catch (e) {
			reject(e);
			return;
		}
		if (p && typeof p.then === "function") p.then(resolve, reject);
	});
}


function decodeAssetBuffer(key, rec) {
	let pending = decodePending.get(key);
	if (pending) return pending;
	const epoch = assetEpoch;                                                        
	pending = (async () => {
		const c = ensureCtx();
		if (!c) return null;
		const parsed = parseDataUri(rec.dataUri);
		if (!parsed || parsed.bytes.length === 0) return null;
		let buf = null;
		try {

			buf = await decodeArrayBuffer(c, parsed.bytes.slice().buffer);
		} catch {
			buf = null;
		}
		if (!buf) {


			const wav = parseWav(parsed.bytes);
			if (wav) {
				try {
					buf = c.createBuffer(wav.channels.length, wav.frames, wav.sampleRate);
					for (let i = 0; i < wav.channels.length; i++) buf.getChannelData(i).set(wav.channels[i]);
				} catch {
					buf = null;                                                 
				}
			}
		}
		return buf || null;
	})();
	decodePending.set(key, pending);
	pending
		.then((buf) => {
			decodePending.delete(key);
			if (epoch !== assetEpoch) return;                                                       
			if (buf) {
				bufferCache.set(key, buf);
			} else {
				decodeFailed.add(key);                                                             
				logger.warn(`Áudio: falha ao decodificar o asset "${rec.name}" (${key}).`);
			}
		})
		.catch(() => decodePending.delete(key));
	return pending;
}


function vaultOn() {
	return !(typeof globalThis !== "undefined" && globalThis.ROBLOX_AUDIO_VAULT_DISABLED === true);
}

function ensureByteVault() {
	if (!byteVault) byteVault = createByteVault({});
	return byteVault;
}

function vaultGet(id) {
	if (!vaultOn()) return Promise.resolve(null);
	return ensureByteVault().get(id);
}

function vaultPut(id, bytes, container) {
	if (!vaultOn()) return;
	ensureByteVault().put(id, bytes, container);                                   
}


async function decodeCdnBytes(c, bytes, container) {
	let buf = null;
	try {

		buf = await decodeArrayBuffer(c, bytes.slice().buffer);
	} catch {
		buf = null;
	}
	if (!buf && container === "wav") {
		const wav = parseWav(bytes);
		if (wav) {
			try {
				buf = c.createBuffer(wav.channels.length, wav.frames, wav.sampleRate);
				for (let i = 0; i < wav.channels.length; i++) buf.getChannelData(i).set(wav.channels[i]);
			} catch {
				buf = null;
			}
		}
	}
	return buf || null;
}


function decodeCdnBuffer(key, id) {
	let pending = decodePending.get(key);
	if (pending) return pending;
	const epoch = assetEpoch;
	pending = (async () => {
		const c = ensureCtx();
		if (!c) return null;


		const vaulted = await vaultGet(id);
		if (vaulted) {
			const vbuf = await decodeCdnBytes(c, vaulted.bytes, vaulted.container);
			if (vbuf) return vbuf;
		}
		const res = await ensureCdnFetcher().fetchAudio(id, { proxies: cdnProxies() });


		if (!res || !res.bytes) return null;
		const buf = await decodeCdnBytes(c, res.bytes, res.container);
		if (!buf) {

			ensureCdnFetcher().markPermanentFailure(id, "decode");
			return null;
		}


		vaultPut(id, res.bytes, res.container);
		return buf;
	})();
	decodePending.set(key, pending);
	pending
		.then((buf) => {
			decodePending.delete(key);
			if (epoch !== assetEpoch) return;                                  
			if (buf) {
				bufferCache.set(key, buf);                                                    
				cdnFallback.delete(key);                                                     
			}
		})
		.catch(() => decodePending.delete(key));
	return pending;
}


let tagCapability = null;                                                   
let tagProber = null;
let graphCapability = null;                                                     
let graphProber = null;
const cdnRung = new Map();                                                                 
const cdnTagInfoOnce = new Set();                                            
const cdnGraphInfoOnce = new Set();                                                  
const cdnPromoteInfoOnce = new Set();                                               
let tagPromoter = null;                                                                    

function ensureTagCapability() {
	if (!tagCapability) tagCapability = detectTagCapability(typeof Audio === "function" ? Audio : null);
	return tagCapability;
}

function ensureTagProber() {
	if (!tagProber) tagProber = createTagProber({});
	return tagProber;
}


function ensureGraphCapability() {
	if (!graphCapability) {
		const AC = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
		graphCapability = detectGraphCapability(typeof Audio === "function" ? Audio : null, AC);
	}
	return graphCapability;
}

function ensureGraphProber() {
	if (!graphProber) graphProber = createGraphProber({});
	return graphProber;
}

function cdnGraphInfo(id) {
	if (cdnGraphInfoOnce.has(id)) return;
	cdnGraphInfoOnce.add(id);
	logger.info(
		`Áudio: asset ${id} tocando via tag <audio> COM grafo Web Audio (áudio REAL da CDN com espacialização 3D, SoundGroup, efeitos, reverb e Volume até 10 — os bytes não puderam ser baixados, mas a mídia veio com CORS liberado).`,
	);
}

function cdnTagInfo(id) {
	if (cdnTagInfoOnce.has(id)) return;
	cdnTagInfoOnce.add(id);
	logger.warn(
		`Áudio: asset ${id} tocando via tag <audio> simples (áudio REAL da CDN; bytes e CORS de mídia bloqueados). Parte 171: espacialização 3D (atenuação + doppler), SoundGroups (volume) e PitchShift EMULADOS no elemento; pan estéreo, reverb e demais efeitos DSP seguem indisponíveis neste degrau (mídia tainted) e o volume satura em 1.0. Parte 175: degrau TRANSITÓRIO — o motor re-sonda a CDN em segundo plano e PROMOVE o som ao vivo (posição preservada) assim que bytes ou CORS de mídia aparecerem. Parte 185: bytes obtidos UMA vez (ex.: proxies em ROBLOX_AUDIO_CDN_PROXIES) ficam no cofre local e este id passa a tocar COMPLETO para sempre nesta origem; importar o áudio no Asset Manager também libera na hora.`,
	);
}


function resolveCdnSource(key, id, cb) {

	const downToTag = () => {
		if (!ensureTagCapability().available) {
			cdnRung.set(id, "jingle");
			cdnWarnOnce(id, ensureCdnFetcher().negativeReason(id) || "network");
			cb({ buffer: cdnFallbackBuffer(key) });
			return;
		}
		ensureTagProber()
			.probe(id)
			.then((r) => {
				if (r && r.ok) {
					cdnRung.set(id, "tag");
					cdnTagInfo(id);
					cb({ tag: { id, duration: num(r.duration, 0) } });
					return;
				}
				cdnRung.set(id, "jingle");
				cdnWarnOnce(id, ensureCdnFetcher().negativeReason(id) || (r && r.reason) || "network");
				cb({ buffer: cdnFallbackBuffer(key) });
			});
	};


	const downToGraph = () => {
		if (!ensureGraphCapability().available) {
			downToTag();
			return;
		}
		ensureGraphProber()
			.probe(id)
			.then((g) => {
				if (g && g.ok) {
					cdnRung.set(id, "tag-graph");
					cdnGraphInfo(id);
					cb({ tagGraph: { id, duration: num(g.duration, 0) } });
					return;
				}
				downToTag();
			});
	};


	const forced = typeof globalThis !== "undefined" ? globalThis.ROBLOX_AUDIO_FORCE_RUNG : null;
	if (forced === "jingle") {
		cdnRung.set(id, "jingle");
		cb({ buffer: cdnFallbackBuffer(key) });
		return;
	}
	if (forced === "tag") {
		downToTag();
		return;
	}
	if (forced === "tag-graph") {
		downToGraph();
		return;
	}
	decodeCdnBuffer(key, id).then((buf) => {
		if (buf) {
			cdnRung.set(id, "bytes");
			cb({ buffer: buf });
			return;
		}
		downToGraph();
	});
}


function requestSource(soundId, cb) {
	const key = normalizeSoundId(soundId);
	if (!key || decodeFailed.has(key)) {
		cb(null);
		return;
	}
	const hit = bufferCache.get(key);
	if (hit) {
		noteBytesRung(key);             
		cb({ buffer: hit });
		return;
	}
	const rec = assetForSoundId(key);
	if (rec) {
		decodeAssetBuffer(key, rec).then((buf) => cb(buf ? { buffer: buf } : null));
		return;
	}
	const cdnId = cdnIdForSoundId(key);
	if (cdnId) {

		resolveCdnSource(key, cdnId, cb);
		return;
	}
	const buf = getBufferSync(key);
	cb(buf ? { buffer: buf } : null);
}

function synthesizeBuffer(id) {
	const c = ensureCtx();
	if (!c) return null;
	const h = hashStr(id);
	const dur = 1.5 + (h % 50) / 10;                                          
	const sr = c.sampleRate;
	const n = Math.max(1, Math.floor(dur * sr));
	const buf = c.createBuffer(2, n, sr);
	const notes = 3 + (h % 4);
	const base = 110 * Math.pow(2, (h % 25) / 12);
	for (let ch = 0; ch < 2; ch++) {
		const data = buf.getChannelData(ch);
		const rnd = mulberry32(h + ch * 7919);
		for (let i = 0; i < notes; i++) {
			const f = base * Math.pow(2, Math.floor(rnd() * 13) / 12);
			const start = Math.floor((i / notes) * n);
			const len = Math.floor(n / notes);
			const detune = 1 + (rnd() - 0.5) * 0.01;
			for (let j = 0; j < len; j++) {
				const t = j / sr;
				const env = Math.min(1, j / (sr * 0.01)) * Math.exp((-3 * j) / len);
				data[start + j] +=
					(Math.sin(2 * Math.PI * f * detune * t) * 0.3 +
						Math.sin(2 * Math.PI * f * 2 * t) * 0.08) *
					env;
			}
		}
	}
	return buf;
}


function soundServiceInst() {
	const dm = store && typeof store.getDataModel === "function" ? store.getDataModel() : null;
	if (!dm || typeof dm.getChildren !== "function") return null;
	return dm.getChildren().find((c) => c && c.className === "SoundService") || null;
}


function impulseToBuffer(ir) {
	const c = ensureCtx();
	if (!c || !ir) return null;
	const buf = c.createBuffer(2, ir.length, c.sampleRate);
	buf.getChannelData(0).set(ir.channels[0]);
	buf.getChannelData(1).set(ir.channels[1]);
	return buf;
}


const ambientIrCache = new Map();

function applyAmbientReverb() {
	if (!ctx) return;
	const name = String(prop(soundServiceInst(), "AmbientReverb") || "NoReverb");
	if (name === currentReverbName) return;
	const params = reverbPresetParams(name);
	if (params && params.wet > 0) {
		const key = name + "@" + ctx.sampleRate;
		let buf = ambientIrCache.get(key);
		if (!buf) {
			buf = impulseToBuffer(buildAmbientImpulse(name, ctx.sampleRate));
			if (buf) ambientIrCache.set(key, buf);
		}
		if (buf) {
			reverbConvolver.buffer = buf;
			reverbWet.gain.value = params.wet;
			currentReverbName = name;                                           
			return;
		}


		return;
	}
	reverbWet.gain.value = 0;
	currentReverbName = name;
}


function buildEffectNode(e) {
	const c = ctx;
	const cn = e.className;
	if (cn === "PitchShiftSoundEffect") {


		return { pitchFactor: clamp(prop(e, "Octave"), 0.5, 2, 1) };
	}
	if (cn === "EqualizerSoundEffect") {
		const low = c.createBiquadFilter();
		low.type = "lowshelf";
		low.frequency.value = 220;
		low.gain.value = clamp(prop(e, "LowGain"), -80, 10, 0);
		const mid = c.createBiquadFilter();
		mid.type = "peaking";
		mid.frequency.value = 1100;
		mid.Q.value = 0.7;
		mid.gain.value = clamp(prop(e, "MidGain"), -80, 10, 0);
		const high = c.createBiquadFilter();
		high.type = "highshelf";
		high.frequency.value = 5200;
		high.gain.value = clamp(prop(e, "HighGain"), -80, 10, 0);
		low.connect(mid);
		mid.connect(high);
		return { input: low, output: high, lfos: [] };
	}
	if (cn === "ReverbSoundEffect") {
		const input = c.createGain();
		const out = c.createGain();
		const conv = c.createConvolver();

		conv.buffer = impulseToBuffer(
			buildEffectImpulse(
				{
					decayTime: clamp(prop(e, "DecayTime"), 0.1, 20, 1.5),
					diffusion: clamp(prop(e, "Diffusion"), 0, 1, 1),
					density: clamp(prop(e, "Density"), 0, 1, 1),
				},
				c.sampleRate,
			),
		);
		const dry = c.createGain();
		dry.gain.value = dbToGain(prop(e, "DryLevel"), -100, 0);
		const wet = c.createGain();
		wet.gain.value = dbToGain(prop(e, "WetLevel"), -100, 0);
		input.connect(dry);
		dry.connect(out);
		input.connect(conv);
		conv.connect(wet);
		wet.connect(out);
		return { input, output: out, lfos: [] };
	}
	if (cn === "DistortionSoundEffect") {
		const ws = c.createWaveShaper();
		const level = clamp(prop(e, "Level"), 0, 1, 0.75);
		const k = level * 120;
		const curve = new Float32Array(257);
		for (let i = 0; i <= 256; i++) {
			const x = i / 128 - 1;
			curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
		}
		ws.curve = curve;
		ws.oversample = "2x";
		return { input: ws, output: ws, lfos: [] };
	}
	if (cn === "ChorusSoundEffect" || cn === "FlangeSoundEffect") {
		const isFlange = cn === "FlangeSoundEffect";
		const input = c.createGain();
		const out = c.createGain();
		const mix = clamp(prop(e, "Mix"), 0, 1, 0.5);
		const depth = clamp(prop(e, "Depth"), 0, 1, 0.45);
		const rate = clamp(prop(e, "Rate"), 0, 20, isFlange ? 5 : 0.5);
		const delay = c.createDelay(0.1);
		delay.delayTime.value = isFlange ? 0.005 : 0.018;
		const lfo = c.createOscillator();
		lfo.frequency.value = Math.max(0.01, rate);
		const lfoGain = c.createGain();
		lfoGain.gain.value = depth * (isFlange ? 0.003 : 0.006);
		lfo.connect(lfoGain);
		lfoGain.connect(delay.delayTime);
		lfo.start();
		const dry = c.createGain();
		dry.gain.value = 1 - mix * 0.5;
		const wet = c.createGain();
		wet.gain.value = mix;
		input.connect(dry);
		dry.connect(out);
		input.connect(delay);
		delay.connect(wet);
		wet.connect(out);
		if (isFlange) {
			const fb = c.createGain();
			fb.gain.value = 0.45;
			delay.connect(fb);
			fb.connect(delay);
		}
		return { input, output: out, lfos: [lfo] };
	}
	if (cn === "CompressorSoundEffect") {
		const comp = c.createDynamicsCompressor();


		comp.attack.value = clamp(prop(e, "Attack"), 0, 1, 0.1);


		comp.release.value = clamp(prop(e, "Release"), 1, 1000, 101) / 1000;
		comp.ratio.value = clamp(prop(e, "Ratio"), 1, 20, 12);                               
		comp.threshold.value = clamp(prop(e, "Threshold"), -60, 0, -40);
		const makeup = c.createGain();
		makeup.gain.value = dbToGain(prop(e, "MakeupGain"), -80, 40);
		comp.connect(makeup);
		return { input: comp, output: makeup, lfos: [] };
	}
	if (cn === "EchoSoundEffect") {
		const input = c.createGain();
		const out = c.createGain();
		const delay = c.createDelay(2.1);
		delay.delayTime.value = clamp(prop(e, "Delay"), 0.01, 2, 1);                       
		const fb = c.createGain();
		fb.gain.value = Math.min(0.95, clamp(prop(e, "Feedback"), 0, 1, 0.5));
		const dry = c.createGain();
		dry.gain.value = dbToGain(prop(e, "DryLevel"), -80, 0);
		const wet = c.createGain();
		wet.gain.value = dbToGain(prop(e, "WetLevel"), -80, 0);
		input.connect(dry);
		dry.connect(out);
		input.connect(delay);
		delay.connect(wet);
		wet.connect(out);
		delay.connect(fb);
		fb.connect(delay);
		return { input, output: out, lfos: [] };
	}
	if (cn === "TremoloSoundEffect") {
		const carrier = c.createGain();
		const depth = clamp(prop(e, "Depth"), 0, 1, 1);
		const duty = clamp(prop(e, "Duty"), 0, 1, 0.5);
		const freq = clamp(prop(e, "Frequency"), 0, 20, 5);
		carrier.gain.value = 1 - depth * 0.5;
		const lfo = c.createOscillator();

		lfo.type = duty < 0.35 || duty > 0.65 ? "square" : "sine";
		lfo.frequency.value = Math.max(0.01, freq);
		const lfoGain = c.createGain();
		lfoGain.gain.value = depth * 0.5;
		lfo.connect(lfoGain);
		lfoGain.connect(carrier.gain);
		lfo.start();
		return { input: carrier, output: carrier, lfos: [lfo] };
	}
	return null;
}


function buildEffectChain(owner) {
	const c = ctx;
	const input = c.createGain();
	let head = input;
	let pitchFactor = 1;
	const lfos = [];
	const kids = owner && typeof owner.getChildren === "function" ? owner.getChildren() : [];
	const effs = kids
		.filter((k) => isEffect(k) && prop(k, "Enabled") !== false)
		.sort((a, b) => num(prop(a, "Priority"), 0) - num(prop(b, "Priority"), 0));
	for (const e of effs) {
		const built = buildEffectNode(e);
		if (!built) continue;
		if (built.pitchFactor !== undefined) {
			pitchFactor *= built.pitchFactor;
			continue;
		}
		head.connect(built.input);
		head = built.output;
		for (const l of built.lfos) lfos.push(l);
	}
	return { input, output: head, pitchFactor, lfos };
}


function groupParentOf(g) {
	const ref = prop(g, "SoundGroup");
	if (isGroup(ref) && ref !== g) return ref;
	const par = typeof g.getParent === "function" ? g.getParent() : null;
	return isGroup(par) ? par : null;
}

function groupDepthOf(g) {
	let d = 0;
	let cur = g;
	const seen = new Set();
	while (isGroup(cur) && !seen.has(cur) && d <= MAX_GROUP_DEPTH + 1) {
		seen.add(cur);
		cur = groupParentOf(cur);
		d++;
	}
	return d;
}


function groupChainCycles(g) {
	let cur = groupParentOf(g);
	let hops = 0;
	while (isGroup(cur) && hops <= MAX_GROUP_DEPTH + 1) {
		if (cur === g) return true;
		cur = groupParentOf(cur);
		hops++;
	}
	return false;
}


function rewireGroups() {
	if (!ctx) return;
	for (const [g, rec] of groupGains) {
		try {
			rec.gain.disconnect();
		} catch {}




		if (rec.chainOut) {
			try {
				rec.chainOut.disconnect();
			} catch {}
			rec.chainOut = null;
		}
		for (const l of rec.lfos) {
			try {
				l.stop();
			} catch {}
		}
		rec.lfos = [];
		if (!isGroup(g)) groupGains.delete(g);
	}
	for (const [g, rec] of groupGains) {
		rec.gain.gain.value = clamp(prop(g, "Volume"), 0, 10, 1);
		const chain = buildEffectChain(g);
		rec.lfos = chain.lfos;
		const parent = groupParentOf(g);
		let dest = master;

		if (parent && !groupChainCycles(g) && groupDepthOf(g) <= MAX_GROUP_DEPTH) {
			let prec = groupGains.get(parent);
			if (!prec) {
				prec = { gain: ctx.createGain(), lfos: [] };
				groupGains.set(parent, prec);
			}
			dest = prec.gain;
		}
		try {
			rec.gain.connect(chain.input);
			chain.output.connect(dest);
		} catch {



			try {
				chain.output.connect(master);
			} catch {}
		}
		rec.chainOut = chain.output;                                                 
	}
}


function groupDestination(groupInst) {
	if (!isGroup(groupInst)) return master;
	let rec = groupGains.get(groupInst);
	if (!rec) {
		rec = { gain: ctx.createGain(), lfos: [] };
		groupGains.set(groupInst, rec);
		rewireGroups();
	}
	return rec.gain;
}


function spatialParentOf(inst) {
	const par = typeof inst.getParent === "function" ? inst.getParent() : null;
	if (!par) return null;
	if (isBasePartInst(par)) return { kind: "part", node: par };
	if (par.className === "Attachment") return { kind: "attachment", node: par };
	return null;                                                                
}

function emitterPosition(sp) {
	if (!sp) return null;
	if (sp.kind === "part") {
		const p = prop(sp.node, "Position");
		return { x: num(p && p.x, 0), y: num(p && p.y, 0), z: num(p && p.z, 0) };
	}
	const att = sp.node;
	const part = typeof att.getParent === "function" ? att.getParent() : null;
	if (!isBasePartInst(part)) return null;
	const pp = prop(part, "Position");
	const rot = prop(part, "Rotation");
	const lp = prop(att, "Position");
	const off = rotateByEulerDeg(
		{ x: num(lp && lp.x, 0), y: num(lp && lp.y, 0), z: num(lp && lp.z, 0) },
		rot || {},
	);
	return {
		x: num(pp && pp.x, 0) + off.x,
		y: num(pp && pp.y, 0) + off.y,
		z: num(pp && pp.z, 0) + off.z,
	};
}

function listenerPose() {
	if (listenerType === "CFrame" && listenerValue) {


		const q = {
			x: num(listenerValue.qx, 0), y: num(listenerValue.qy, 0),
			z: num(listenerValue.qz, 0), w: num(listenerValue.qw, 1),
		};
		return {
			pos: { x: num(listenerValue.x, 0), y: num(listenerValue.y, 0), z: num(listenerValue.z, 0) },
			fwd: rotateByQuat({ x: 0, y: 0, z: -1 }, q),
			up: rotateByQuat({ x: 0, y: 1, z: 0 }, q),
		};
	}
	const cam = typeof getCameraFn === "function" ? getCameraFn() : null;
	if (!cam || !cam.position) {
		return { pos: { x: 0, y: 0, z: 0 }, fwd: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } };
	}
	const q = cam.quaternion || { x: 0, y: 0, z: 0, w: 1 };
	return {
		pos: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
		fwd: rotateByQuat({ x: 0, y: 0, z: -1 }, q),
		up: rotateByQuat({ x: 0, y: 1, z: 0 }, q),
	};
}


function rolloffGain(rollMode, d, rMin, rMax, emitter, maxDist) {
	if (d <= emitter) return 1;
	if (maxDist > 0 && d >= maxDist) return 0;
	const start = Math.max(emitter, rMin);
	const end = Math.max(start + 0.001, Math.min(maxDist > 0 ? maxDist : rMax, rMax));
	if (rollMode === "Linear" || rollMode === "LinearSquare") {
		const t = 1 - clamp((d - start) / (end - start), 0, 1, 0);
		return rollMode === "Linear" ? t : t * t;
	}
	const g = start / Math.max(d, start);           
	if (rollMode === "InverseTapered") {
		const t = 1 - clamp((d - start) / (end - start), 0, 1, 0);
		return g * (0.5 + 0.5 * t);
	}
	return g;
}


function emitSoundEvent(inst, type, extra) {
	bus.emit("audio:event", { instance: inst, type, soundId: String(prop(inst, "SoundId") || ""), ...(extra || {}) });
}


const ENGINE_OWNED_PROPS = new Set(["IsPlaying", "TimeLength", "IsLoaded", "IsPaused"]);
function syncProps(inst, values) {
	if (!alive(inst) || typeof inst.setProperty !== "function") return;


	if (
		Object.prototype.hasOwnProperty.call(values, "Playing") &&
		!Object.prototype.hasOwnProperty.call(values, "IsPlaying")
	) {
		values = { ...values, IsPlaying: !!values.Playing };
	}
	syncingProps = true;
	try {
		for (const k of Object.keys(values)) {


			try {


				if (ENGINE_OWNED_PROPS.has(k) && typeof inst._setInternal === "function") {
					inst._setInternal(k, values[k]);
				} else {
					inst.setProperty(k, values[k]);
				}
			} catch {

			}
		}
	} finally {
		syncingProps = false;
	}
}

function stateFor(inst) {
	let st = soundStates.get(inst);
	if (!st) {
		st = {
			inst,
			src: null,
			nodes: [],
			lfos: [],
			volGain: null,
			spatGain: null,
			panner: null,
			revSend: null,
			baseRate: 1,
			doppler: 1,
			playing: false,
			paused: false,
			pauseAt: 0,
			startCtx: 0,
			startOffset: 0,
			manualStop: false,
			lastPos: null,
			lastT: 0,
			loadGen: 0,                                                 
			loadedKey: null,                                              
			tagEl: null,                                                   
			tagUrl: null,
			tagActive: false,
			tagGraph: false,                                                    
			tagCross: false,                                                     
			tagSrcNode: null,                                                         
			pitchFactor: 1,                                                   
			tagMixLast: null,                                                           
			tagSpatialGain: 1,                                                

			spatialId: "snd" + (++spatialUid),                                
			spatialPrev: null,                                                 
			spatialLast: null,                                                      
			spatialOut: null,                                                    
			spatialRateWritten: null,                                             

			loopPos: null,                                                      
			loopCount: 0,                                                       
			forceGlobal: false,                                                            
		};
		soundStates.set(inst, st);
	}
	return st;
}


function teardown(st) {
	st.loadGen = (st.loadGen | 0) + 1;                                       
	if (st.src) {
		try {
			st.src.onended = null;
			st.src.stop();
		} catch {}
		try {
			st.src.disconnect();
		} catch {}
	}
	for (const l of st.lfos) {
		try {
			l.stop();
		} catch {}
	}
	for (const n of st.nodes) {
		try {
			n.disconnect();
		} catch {}
	}
	if (st.tagEl && st.tagActive) {

		try {
			st.tagEl.onended = null;
			st.tagEl.onerror = null;
			st.tagEl.pause();
		} catch {}
	}
	st.tagActive = false;
	st.tagGraph = false;
	if (st.playing) playingCount = Math.max(0, playingCount - 1);
	st.src = null;
	st.nodes = [];
	st.lfos = [];
	st.volGain = null;
	st.spatGain = null;
	st.panner = null;
	st.revSend = null;

	hrtfActive.delete(st.spatialId);
	st.spatialPrev = null;
	st.spatialLast = null;
	st.spatialOut = null;
	st.spatialRateWritten = null;             
	st.tagMixLast = null;                                                     
	st.playing = false;
}

function currentTimePos(st) {
	if (st.tagActive && st.tagEl) {

		const t = num(st.tagEl.currentTime, 0);
		return t >= 0 ? t : 0;
	}
	if (!st.playing || !ctx || !st.src || !st.src.buffer) return st.paused ? st.pauseAt : 0;
	const rate = Math.max(0.0001, st.baseRate * st.doppler);
	let t = st.startOffset + (ctx.currentTime - st.startCtx) * rate;
	const dur = st.src.buffer.duration;
	if (st.src.loop && dur > 0) t = t % dur;
	return clamp(t, 0, dur, 0);
}


function rebaseClock(st) {
	if (!ctx || !st.playing || !st.src || !st.src.buffer) return;
	const dur = st.src.buffer.duration;
	const rate = Math.max(0.0001, st.baseRate * st.doppler);
	let t = st.startOffset + (ctx.currentTime - st.startCtx) * rate;
	if (st.src.loop && dur > 0) t = t % dur;
	st.startOffset = clamp(t, 0, dur, 0);
	st.startCtx = ctx.currentTime;
}

function effectiveBaseRate(inst) {

	const ps = prop(inst, "PlaybackSpeed");
	const pitch = prop(inst, "Pitch");
	const v = ps !== undefined && ps !== null ? ps : pitch;
	return clamp(v, 0, 20, 1);                
}


function markLoaded(inst, st, key, buffer) {
	syncProps(inst, { TimeLength: roundDur(buffer), IsLoaded: true });
	if (st.loadedKey !== key) {
		st.loadedKey = key;
		emitSoundEvent(inst, "Loaded");
	}
}


function preloadSoundId(inst, st, key) {
	const gen = st.loadGen;
	requestSource(key, (res) => {
		if (!alive(inst) || st.loadGen !== gen) return;
		if (normalizeSoundId(prop(inst, "SoundId")) !== key) return;                    
		if (!res) {
			syncProps(inst, { IsLoaded: false });
			return;
		}

		markLoaded(inst, st, key, res.buffer || res.tagGraph || res.tag);
	});
}


function startPlayback(inst, fromTime) {
	const c = ensureCtx();
	if (!c) return false;
	const st = stateFor(inst);
	st.loadGen = (st.loadGen | 0) + 1;                                           
	if (st.src || st.tagActive) {
		st.manualStop = true;
		teardown(st);
	}
	if (playingCount >= MAX_PLAYING) {
		if (!warnedLimit) {
			warnedLimit = true;
			logger.warn(`Áudio: limite de ${MAX_PLAYING} sons simultâneos atingido (anti-exploit).`);
		}
		return false;
	}
	const soundId = prop(inst, "SoundId");
	const buffer = getBufferSync(soundId);
	if (buffer) return attachAndStart(inst, st, buffer, fromTime);
	const key = normalizeSoundId(soundId);
	if (!key || decodeFailed.has(key) || (!assetForSoundId(key) && !cdnIdForSoundId(key))) {
		syncProps(inst, { IsLoaded: false });
		return false;
	}

	const gen = st.loadGen;
	requestSource(key, (res) => {

		if (!alive(inst) || st.loadGen !== gen || st.src || st.tagActive) return;
		if (!res) {
			syncProps(inst, { IsLoaded: false, Playing: false, IsPaused: false });
			return;
		}
		markLoaded(inst, st, key, res.buffer || res.tagGraph || res.tag);
		if (res.tagGraph) {

			attachTagGraphAndStart(inst, st, res.tagGraph, fromTime);
			return;
		}
		if (res.tag) {

			attachTagAndStart(inst, st, res.tag, fromTime);
			return;
		}
		if (playingCount >= MAX_PLAYING) {
			syncProps(inst, { Playing: false });
			return;
		}
		attachAndStart(inst, st, res.buffer, fromTime);
	});
	return "pending";
}


function attachAndStart(inst, st, buffer, fromTime) {
	const c = ctx;
	markLoaded(inst, st, normalizeSoundId(prop(inst, "SoundId")), buffer);

	const src = c.createBufferSource();
	src.buffer = buffer;
	src.loop = !!prop(inst, "Looped");

	const chain = buildEffectChain(inst);
	const vol = c.createGain();
	vol.gain.value = clamp(prop(inst, "Volume"), 0, 10, 0.5);
	src.connect(chain.input);
	chain.output.connect(vol);
	st.nodes = [chain.input, chain.output, vol];
	st.lfos = chain.lfos;

	const groupRef = prop(inst, "SoundGroup");
	const dest = isGroup(groupRef) ? groupDestination(groupRef) : master;


	const sp = st.forceGlobal ? null : spatialParentOf(inst);
	if (sp) {

		const spat = c.createGain();
		const pan = c.createPanner();
		pan.panningModel = "equalpower";
		pan.distanceModel = "linear";
		pan.rolloffFactor = 0;                                         
		pan.maxDistance = 1e7;
		vol.connect(spat);
		spat.connect(pan);
		pan.connect(dest);

		const send = c.createGain();
		send.gain.value = 1;
		spat.connect(send);
		send.connect(reverbIn);
		st.spatGain = spat;
		st.panner = pan;
		st.revSend = send;
		st.nodes.push(spat, pan, send);
	} else {
		vol.connect(dest);                                              
	}

	st.src = src;
	st.volGain = vol;
	st.pitchFactor = num(chain.pitchFactor, 1);                                                
	st.baseRate = effectiveBaseRate(inst) * st.pitchFactor;
	st.doppler = 1;
	st.lastPos = null;
	st.spatialPrev = null;
	st.spatialLast = null;
	st.spatialOut = null;
	st.spatialRateWritten = null;             
	src.playbackRate.value = Math.max(0.0001, st.baseRate);
	const offset = clamp(fromTime, 0, buffer.duration, 0);
	st.startCtx = c.currentTime;
	st.startOffset = offset;
	st.playing = true;
	st.paused = false;
	st.manualStop = false;
	playingCount++;
	src.onended = () => {
		if (st.src !== src) return;
		const wasManual = st.manualStop;
		teardown(st);
		if (!wasManual) {
			syncProps(inst, { Playing: false, IsPaused: false, TimePosition: 0 });

			emitSoundEvent(inst, "Ended");
		}
	};
	src.start(0, offset);
	updateSpatial(st, soundServiceFactors());
	return true;
}


function disableGraphRung(reason) {
	const cap = ensureGraphCapability();
	if (!cap.available) return;
	graphCapability = { ...cap, available: false, mediaElementSource: false, disabledReason: reason };
	logger.warn(
		`Áudio: degrau tag-graph desativado nesta sessão (${reason}); ids da CDN sem bytes voltam ao degrau tag simples.`,
	);
}

function ensureTagGraphSource(st, el) {


	if (st.tagSrcNode) return st.tagSrcNode;
	let node = null;
	try {
		node = ctx.createMediaElementSource(el);
	} catch {
		node = null;
	}
	if (!node) disableGraphRung("mediaElementSource");
	st.tagSrcNode = node;
	return node;
}

function attachTagGraphAndStart(inst, st, meta, fromTime) {
	const c = ensureCtx();
	if (!c) return false;
	if (playingCount >= MAX_PLAYING) {
		syncProps(inst, { Playing: false });
		return false;
	}
	const url = graphUrlForAssetId(meta.id);
	if (!url) return attachTagAndStart(inst, st, meta, fromTime);
	let el = st.tagEl;
	if (el && !st.tagCross) {


		releaseTag(st);
		el = null;
	}
	if (!el) {
		try {
			el = new Audio();
		} catch {
			el = null;
		}
		if (!el) return attachTagAndStart(inst, st, meta, fromTime);
		try {
			el.crossOrigin = "anonymous";                            
		} catch {}
		st.tagEl = el;
		st.tagCross = true;
		st.tagUrl = null;
		st.tagSrcNode = null;
	}
	if (st.tagUrl !== url) {
		st.tagUrl = url;
		el.src = url;
	}
	const srcNode = ensureTagGraphSource(st, el);
	if (!srcNode) {

		cdnRung.set(meta.id, "tag");
		releaseTag(st);
		return attachTagAndStart(inst, st, meta, fromTime);
	}
	el.loop = !!prop(inst, "Looped");
	try {
		el.volume = 1;                                                         
	} catch {}

	const chain = buildEffectChain(inst);
	const vol = c.createGain();
	vol.gain.value = clamp(prop(inst, "Volume"), 0, 10, 0.5);
	try {
		srcNode.disconnect();                                                  
	} catch {}
	srcNode.connect(chain.input);
	chain.output.connect(vol);
	st.nodes = [chain.input, chain.output, vol];
	st.lfos = chain.lfos;

	const groupRef = prop(inst, "SoundGroup");
	const dest = isGroup(groupRef) ? groupDestination(groupRef) : master;


	const sp = st.forceGlobal ? null : spatialParentOf(inst);
	if (sp) {


		const spat = c.createGain();
		const pan = c.createPanner();
		pan.panningModel = "equalpower";
		pan.distanceModel = "linear";
		pan.rolloffFactor = 0;
		pan.maxDistance = 1e7;
		vol.connect(spat);
		spat.connect(pan);
		pan.connect(dest);
		const send = c.createGain();
		send.gain.value = 1;
		spat.connect(send);
		send.connect(reverbIn);
		st.spatGain = spat;
		st.panner = pan;
		st.revSend = send;
		st.nodes.push(spat, pan, send);
	} else {
		vol.connect(dest);
	}

	st.volGain = vol;
	st.pitchFactor = num(chain.pitchFactor, 1);
	st.baseRate = effectiveBaseRate(inst) * st.pitchFactor;
	st.doppler = 1;
	st.lastPos = null;
	st.spatialPrev = null;
	st.spatialLast = null;
	st.spatialOut = null;
	st.spatialRateWritten = null;                                          


	applyTagRate(el, st.baseRate);
	try {
		const dur = num(meta.duration, 0);
		el.currentTime = dur > 0 ? clamp(fromTime, 0, dur, 0) : Math.max(0, num(fromTime, 0));
	} catch {}
	st.tagActive = true;
	st.tagGraph = true;
	st.playing = true;
	st.paused = false;
	st.manualStop = false;
	playingCount++;
	const gen = st.loadGen;
	el.onended = () => {
		if (!st.tagActive || st.tagEl !== el) return;
		const wasManual = st.manualStop;
		teardown(st);                                                   
		if (!wasManual) {
			syncProps(inst, { Playing: false, IsPaused: false, TimePosition: 0 });
			emitSoundEvent(inst, "Ended");
		}
	};
	el.onerror = () => {


		if (!st.tagActive || st.tagEl !== el) return;
		const at = Math.max(0, num(el.currentTime, 0));
		teardown(st);


		if (at <= 0) {
			ensureGraphProber().markUnavailable(meta.id, "media");
			cdnRung.set(meta.id, "tag");
			releaseTag(st);
			if (attachTagAndStart(inst, st, meta, 0)) return;
		}
		syncProps(inst, { Playing: false, IsPaused: false });
	};


	if (c.state === "suspended") c.resume().catch(() => {});
	const p = el.play();
	if (p && typeof p.catch === "function") {
		p.catch(() => {
			if (typeof window === "undefined") return;
			const retry = () => {
				if (st.loadGen === gen && st.tagActive && st.tagEl === el) {
					const q = el.play();
					if (q && typeof q.catch === "function") q.catch(() => {});
				}
			};


			runOnNextUserGesture("audioEngine:blockedPlaybackRetry", retry);
		});
	}
	updateSpatial(st, soundServiceFactors());
	return true;
}


function playTagGraphOneShot(meta, volume, rate, destNode, onDone) {
	const c = ensureCtx();
	if (!c) return null;
	const url = graphUrlForAssetId(meta.id);
	if (!url) return null;
	let el = null;
	try {
		el = new Audio();
	} catch {
		return null;
	}
	try {
		el.crossOrigin = "anonymous";
	} catch {}
	let node = null;
	try {
		el.src = url;
		node = c.createMediaElementSource(el);
	} catch {
		node = null;
	}
	if (!node) {


		disableGraphRung("mediaElementSource");
		try {
			el.pause();
			el.removeAttribute("src");
			el.load();
		} catch {}
		return null;
	}
	const g = c.createGain();
	g.gain.value = clamp(volume, 0, 10, 0.5);
	node.connect(g);
	g.connect(destNode || master);
	applyTagRate(el, rate);
	const cleanup = () => {
		if (typeof onDone === "function") onDone();
		try {
			el.onended = null;
			el.onerror = null;
			el.pause();
			node.disconnect();
			g.disconnect();
			el.removeAttribute("src");
			el.load();
		} catch {}
	};
	el.onended = cleanup;
	el.onerror = cleanup;
	if (c.state === "suspended") c.resume().catch(() => {});             
	const p = el.play();


	if (p && typeof p.catch === "function") p.catch(() => cleanup());
	return { el, gain: g, node };
}


function tagGroupVolumes(inst) {
	const volumes = [];
	let g = prop(inst, "SoundGroup");
	const seen = new Set();
	while (isGroup(g) && !seen.has(g) && volumes.length < MAX_GROUP_DEPTH) {
		seen.add(g);
		volumes.push(prop(g, "Volume"));
		g = groupParentOf(g);
	}
	return volumes;
}


function tagPitchFactor(inst) {
	let factor = 1;
	const kids = typeof inst.getChildren === "function" ? inst.getChildren() : [];
	for (const e of kids) {
		if (!isEffect(e) || e.className !== "PitchShiftSoundEffect") continue;
		if (prop(e, "Enabled") === false) continue;
		factor *= clamp(prop(e, "Octave"), 0.5, 2, 1);
	}
	return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

let tagSaturationWarned = false;                                              


function applyTagMix(st, f, spatialGain, doppler) {
	const el = st.tagEl;
	if (!el) return;
	const mix = computeTagMix({
		volume: prop(st.inst, "Volume"),
		groupGain: groupChainGain(tagGroupVolumes(st.inst)),
		spatialGain,
		volumeScale: f.volumeScale,
	});
	const rawRate = num(st.baseRate, 1) * num(doppler, 1);
	const rate = tagRate(rawRate);
	const last = st.tagMixLast;
	let lastV = last ? last.volume : null;
	let lastR = last ? last.rate : null;
	if (lastV == null || Math.abs(lastV - mix.volume) >= TAG_MIX_LIMITS.volumeEpsilon) {
		try {
			el.volume = mix.volume;
			lastV = mix.volume;
		} catch {}
	}
	if (lastR == null || Math.abs(lastR - rate) >= TAG_MIX_LIMITS.rateEpsilon) {
		applyTagRate(el, rawRate);
		lastR = rate;
	}
	st.tagMixLast = { volume: lastV, rate: lastR };
	if (mix.volumeSaturated && !tagSaturationWarned) {
		tagSaturationWarned = true;
		logger.info(
			"Áudio: um som no degrau tag simples pediu volume efetivo acima de 1.0 — o elemento de mídia satura em 1.0 (teto físico). Os degraus bytes/tag-graph não têm esse teto. Parte 175: a promoção ao vivo tira o som deste teto sozinha assim que bytes/CORS aparecerem. Parte 185: bytes vistos 1x ficam no cofre local (para sempre nesta origem) e import local promove na hora.",
		);
	}
}


function refreshTagMixes() {
	const f = soundServiceFactors();
	for (const [, st] of soundStates) {
		if (st.playing && st.tagActive && !st.tagGraph && st.tagEl) {
			applyTagMix(st, f, num(st.tagSpatialGain, 1), num(st.doppler, 1));
		}
	}
}


function ensureTagPromoter() {


	if (!tagPromoter) tagPromoter = createPromotionScheduler({ now: perfNowMs });
	return tagPromoter;
}


function promoteTagSound(inst, st, id) {
	if (!alive(inst) || !st.playing || !st.tagActive || st.tagGraph) {
		if (tagPromoter) tagPromoter.counters.invariantViolations++;
		return false;
	}
	const at = currentTimePos(st);
	st.manualStop = true;
	const r = startPlayback(inst, at);
	if (r === false) return false;                                              
	if (!cdnPromoteInfoOnce.has(id)) {
		cdnPromoteInfoOnce.add(id);
		logger.info(
			`Áudio: asset ${id} PROMOVIDO ao vivo do degrau tag simples (posição preservada em ~${Math.round(at * 100) / 100}s) — espacialização com pan real, reverb, efeitos DSP e Volume acima de 1.0 voltam a valer no novo degrau.`,
		);
	}
	return true;
}




function attemptPromotion(id, key) {
	decodeCdnBuffer(key, id)
		.then((buf) => {
			if (buf) return "bytes";
			if (!ensureGraphCapability().available) return null;
			return ensureGraphProber()
				.probe(id)
				.then((g) => (g && g.ok ? "tag-graph" : null));
		})
		.then((rung) => {
			if (!tagPromoter) return;
			if (!rung) {
				tagPromoter.settle(id, "retry");
				return;
			}
			let promoted = false;
			for (const [inst, st] of soundStates) {
				if (!st.playing || !st.tagActive || st.tagGraph) continue;
				const k = normalizeSoundId(prop(inst, "SoundId"));
				if (cdnIdForSoundId(k) !== id) continue;
				if (promoteTagSound(inst, st, id)) promoted = true;
			}


			tagPromoter.settle(id, promoted ? "promoted" : "gone");
		})
		.catch(() => {
			if (tagPromoter) tagPromoter.settle(id, "retry");
		});
}


function stepTagPromotion(nowMs) {
	const forced = typeof globalThis !== "undefined" ? globalThis.ROBLOX_AUDIO_FORCE_RUNG : null;
	if (forced === "tag" || forced === "jingle") return;                         
	let stuck = null;                                             
	for (const [inst, st] of soundStates) {
		if (!st.playing || !st.tagActive || st.tagGraph) continue;
		const key = normalizeSoundId(prop(inst, "SoundId"));


		if (key && assetForSoundId(key)) {
			const numId = extractAssetId(key) || key;
			if (promoteTagSound(inst, st, numId)) localAssetPromotions++;
			continue;
		}
		const id = cdnIdForSoundId(key);
		if (!id) continue;
		if (!stuck) stuck = new Map();
		let rec = stuck.get(id);
		if (!rec) {
			rec = { key, entries: [] };
			stuck.set(id, rec);
		}
		rec.entries.push([inst, st]);
	}
	const promoter = ensureTagPromoter();
	promoter.sync(stuck ? Array.from(stuck.keys()) : []);
	if (!stuck) return;


	for (const [id, rec] of stuck) {
		if (!bufferCache.has(rec.key)) continue;
		let promoted = false;
		for (const [inst, st] of rec.entries) {
			if (promoteTagSound(inst, st, id)) promoted = true;
		}
		promoter.settle(id, promoted ? "promoted" : "retry");
	}
	const t = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : perfNowMs();
	for (const id of promoter.due(t)) {
		const rec = stuck.get(id);
		if (!rec) continue;
		if (!promoter.begin(id)) continue;
		attemptPromotion(id, rec.key);
	}
}


let tagRateRange = null;

function ensureTagRateRange() {
	if (!tagRateRange) tagRateRange = detectTagRateRange(typeof Audio === "function" ? Audio : null);
	return tagRateRange;
}

function tagRate(v) {
	return clampTagRate(v, ensureTagRateRange());
}


function applyTagRate(el, v) {
	if (!el) return;
	try {
		el.playbackRate = tagRate(v);
	} catch {
		tagRateRange = { ...TAG_RATE_SAFE, zeroOk: false, probed: false, reason: "shrunk" };
		try {
			el.playbackRate = clampTagRate(v, tagRateRange);
		} catch {}
	}
}

function attachTagAndStart(inst, st, meta, fromTime) {
	if (playingCount >= MAX_PLAYING) {
		syncProps(inst, { Playing: false });
		return false;
	}
	const url = tagUrlForAssetId(meta.id);
	if (!url) return false;
	let el = st.tagEl;
	if (el && (st.tagCross || st.tagSrcNode)) {


		releaseTag(st);
		el = null;
	}
	if (!el) {
		try {
			el = new Audio();
		} catch {
			syncProps(inst, { Playing: false });
			return false;
		}
		st.tagEl = el;
		st.tagUrl = null;                                                         
	}
	if (st.tagUrl !== url) {
		st.tagUrl = url;
		el.src = url;
	}
	el.loop = !!prop(inst, "Looped");


	st.pitchFactor = tagPitchFactor(inst);
	st.baseRate = effectiveBaseRate(inst) * st.pitchFactor;
	st.tagMixLast = null;                                                       


	st.doppler = 1;
	st.lastPos = null;
	st.spatialPrev = null;
	st.spatialLast = null;
	st.spatialOut = null;
	st.spatialRateWritten = null;
	updateTagSpatial(st, soundServiceFactors());
	try {


		const dur = num(meta.duration, 0);
		el.currentTime = dur > 0 ? clamp(fromTime, 0, dur, 0) : Math.max(0, num(fromTime, 0));
	} catch {}
	st.tagActive = true;
	st.playing = true;
	st.paused = false;
	st.manualStop = false;
	playingCount++;
	const gen = st.loadGen;
	el.onended = () => {
		if (!st.tagActive || st.tagEl !== el) return;
		st.tagActive = false;
		if (st.playing) playingCount = Math.max(0, playingCount - 1);
		st.playing = false;
		syncProps(inst, { Playing: false, IsPaused: false, TimePosition: 0 });
		emitSoundEvent(inst, "Ended");
	};


	el.onerror = () => {
		if (!st.tagActive || st.tagEl !== el) return;
		st.tagActive = false;
		if (st.playing) playingCount = Math.max(0, playingCount - 1);
		st.playing = false;
		try {
			el.onended = null;
			el.onerror = null;
			el.pause();
			if (typeof el.removeAttribute === "function") el.removeAttribute("src");
			if (typeof el.load === "function") el.load();
		} catch {}
		syncProps(inst, { Playing: false, IsPaused: false });
	};
	const p = el.play();
	if (p && typeof p.catch === "function") {
		p.catch(() => {


			if (typeof window === "undefined") return;
			const retry = () => {
				if (st.loadGen === gen && st.tagActive && st.tagEl === el) {
					const q = el.play();
					if (q && typeof q.catch === "function") q.catch(() => {});
				}
			};


			runOnNextUserGesture("audioEngine:blockedPlaybackRetry", retry);
		});
	}
	updateSpatial(st, soundServiceFactors());
	return true;
}


function releaseTag(st) {
	const el = st.tagEl;
	if (st.tagSrcNode) {

		try {
			st.tagSrcNode.disconnect();
		} catch {}
	}
	st.tagSrcNode = null;
	st.tagCross = false;
	st.tagGraph = false;
	st.tagEl = null;
	st.tagUrl = null;
	st.tagActive = false;
	if (!el) return;
	try {
		el.onended = null;
		el.onerror = null;
		el.pause();
		if (typeof el.removeAttribute === "function") el.removeAttribute("src");
		if (typeof el.load === "function") el.load();
	} catch {}
}


function playTagOneShot(meta, volume, rate, onDone) {
	const url = tagUrlForAssetId(meta.id);
	if (!url) return null;
	let el = null;
	try {
		el = new Audio(url);
	} catch {
		return null;
	}
	el.volume = clamp(volume, 0, 1, 0.5);
	applyTagRate(el, rate);
	const cleanup = () => {
		if (typeof onDone === "function") onDone();
		try {
			el.onended = null;
			el.onerror = null;
			el.removeAttribute("src");
			el.load();
		} catch {}
	};
	el.onended = cleanup;
	el.onerror = cleanup;                                                     
	const p = el.play();


	if (p && typeof p.catch === "function") p.catch(() => cleanup());
	return el;
}


export function soundPlay(inst) {
	if (!isSound(inst)) return;
	const st = stateFor(inst);
	st.forceGlobal = false;                                               
	st.loopCount = 0;
	st.loopPos = null;

	if (startPlayback(inst, 0)) {
		syncProps(inst, { Playing: true, IsPaused: false, TimePosition: 0 });
		emitSoundEvent(inst, "Played");
	} else {


		syncProps(inst, { Playing: false, IsPaused: false });
	}
}


export function playLocalSound(inst) {
	if (!isSound(inst)) return;
	const st = stateFor(inst);
	st.forceGlobal = true;
	st.loopCount = 0;
	st.loopPos = null;
	if (startPlayback(inst, 0)) {
		syncProps(inst, { Playing: true, IsPaused: false, TimePosition: 0 });
		emitSoundEvent(inst, "Played");
	} else {
		syncProps(inst, { Playing: false, IsPaused: false });             
	}
}

export function soundPause(inst) {
	if (!isSound(inst)) return;
	const st = soundStates.get(inst);
	if (!st) return;
	if (!st.playing) {


		st.loadGen = (st.loadGen | 0) + 1;
		if (prop(inst, "Playing")) {
			st.paused = true;
			st.pauseAt = 0;
			syncProps(inst, { Playing: false, IsPaused: true });
			emitSoundEvent(inst, "Paused");
		}
		return;
	}
	const at = currentTimePos(st);                             
	st.manualStop = true;
	teardown(st);
	st.paused = true;
	st.pauseAt = at;
	syncProps(inst, { Playing: false, IsPaused: true, TimePosition: Math.round(at * 100) / 100 });
	emitSoundEvent(inst, "Paused");
}

export function soundResume(inst) {
	if (!isSound(inst)) return;
	const st = soundStates.get(inst);
	if (!st || !st.paused) return;
	st.loopPos = null;                                                       
	if (startPlayback(inst, st.pauseAt)) {
		st.paused = false;
		syncProps(inst, { Playing: true, IsPaused: false });
		emitSoundEvent(inst, "Resumed");
	}
}

export function soundStop(inst) {
	if (!isSound(inst)) return;
	const st = soundStates.get(inst);
	if (st) st.loadGen = (st.loadGen | 0) + 1;                                     
	if (st && (st.playing || st.paused)) {
		st.manualStop = true;
		teardown(st);
		st.paused = false;
		st.pauseAt = 0;
	}
	syncProps(inst, { Playing: false, IsPaused: false, TimePosition: 0 });
	emitSoundEvent(inst, "Stopped");
}

function stopAllSounds() {
	for (const [inst, st] of soundStates) {
		st.loadGen = (st.loadGen | 0) + 1;                                    
		if (st.playing || st.paused) {
			st.manualStop = true;
			teardown(st);
			st.paused = false;
			st.pauseAt = 0;
			syncProps(inst, { Playing: false, IsPaused: false, TimePosition: 0 });
		}
	}
}


export function setAudioListener(type, value) {
	const t = String(type && typeof type === "object" && type.name ? type.name : type || "Camera");
	if (t === "CFrame" && value && typeof value === "object") {
		listenerType = "CFrame";


		listenerValue = {
			x: num(value.x, 0), y: num(value.y, 0), z: num(value.z, 0),
			qx: num(value.qx, 0), qy: num(value.qy, 0),
			qz: num(value.qz, 0), qw: num(value.qw, 1),
		};
	} else {
		listenerType = "Camera";
		listenerValue = null;
	}
}

export function getAudioListener() {
	return { type: listenerType, value: listenerValue };
}

function soundServiceFactors() {
	const ss = soundServiceInst();
	return {
		distanceFactor: clamp(prop(ss, "DistanceFactor"), 0.033, 10, 1),
		dopplerScale: clamp(prop(ss, "DopplerScale"), 0, 10, 1),
		rolloffScale: clamp(prop(ss, "RolloffScale"), 0, 10, 1),
		volumeScale: clamp(prop(ss, "VolumeScale"), 0, 1, 1),
	};
}


function perfNowMs() {
	return (typeof globalThis.performance !== "undefined" && typeof globalThis.performance.now === "function")
		? globalThis.performance.now()
		: (ctx ? ctx.currentTime * 1000 : 0);
}

function ensureSpatialCapability() {
	if (spatialCapability) return spatialCapability;
	try {
		spatialCapability = detectSpatialCapability(ctx || null);
	} catch {
		spatialCapability = { panner: false, hrtf: false, paramAutomation: false, listenerParams: false, reason: "detectError" };
	}
	return spatialCapability;
}

function spatialMode() {
	try {
		const s = globalThis.ROBLOX_AUDIO_SPATIAL_MODE;
		if (typeof s === "string" && (s === "hrtf" || s === "equalpower")) return s;
	} catch {}
	return "auto";
}

function clearParamAutomation(param, now) {
	try {
		if (typeof param.cancelAndHoldAtTime === "function") {
			param.cancelAndHoldAtTime(now);
		} else {
			const cur = typeof param.value === "number" ? param.value : 0;
			param.cancelScheduledValues(now);
			param.setValueAtTime(cur, now);
		}
	} catch {}
}

function writeParam(param, kind, to, dtMs, cap) {
	if (!cap || !cap.paramAutomation) {
		try { param.value = to; } catch {}
		return;
	}
	const now = ctx ? ctx.currentTime : 0;
	try {
		const plan = rampPlan(kind, param.value, to, dtMs);
		if (plan.method === "set") {
			param.value = to;
			return;
		}
		clearParamAutomation(param, now);
		if (plan.method === "setTarget") {
			param.setTargetAtTime(to, now, Math.max(0.001, plan.tau));
		} else {
			param.linearRampToValueAtTime(to, now + Math.max(0.001, plan.durationMs / 1000));
		}
	} catch {
		try { param.value = to; } catch {}
	}
}

function desiredPanningModel(id) {
	const cap = ensureSpatialCapability();
	if (!cap.hrtf) return "equalpower";
	const m = spatialMode();
	if (m === "hrtf") return "HRTF";
	if (m === "equalpower") return "equalpower";

	return hrtfActive.has(id) ? "HRTF" : "equalpower";
}

function applyPanningModel(st) {
	if (!st.panner) return;
	const desired = desiredPanningModel(st.spatialId);
	try {
		if (st.panner.panningModel !== desired) st.panner.panningModel = desired;
	} catch {}

}

function replanHrtfBudget(active) {
	const cap = ensureSpatialCapability();
	const m = spatialMode();
	const newHrtf = new Set();
	if (m === "hrtf" && cap.hrtf) {
		for (const st of active) newHrtf.add(st.spatialId);
	} else if (m !== "equalpower" && cap.hrtf && active.length > 0) {
		const sources = active.map(st => ({
			id: st.spatialId,
			gain: (st.spatialOut && st.spatialOut.gain) || 0,
			distance: (st.spatialOut && st.spatialOut.distance) || 0,
			wasHrtf: hrtfActive.has(st.spatialId),
		}));
		try {
			const res = planHrtfBudget(sources);
			for (const id of res.hrtf) newHrtf.add(id);
		} catch {}
	}
	hrtfActive = newHrtf;
	for (const st of active) applyPanningModel(st);
}


function rolloffParamsOf(inst) {
	return {
		mode: String(prop(inst, "RollOffMode") || "Inverse"),
		min: Math.max(0.1, num(prop(inst, "RollOffMinDistance"), 10)),
		max: Math.max(0.1 + Math.max(0.1, num(prop(inst, "RollOffMinDistance"), 10)), num(prop(inst, "RollOffMaxDistance"), 10000)),
		emitterSize: clamp(prop(inst, "EmitterSize"), 0, 100, 10),
		maxDistance: Math.max(0, num(prop(inst, "MaxDistance"), 10000)),
	};
}


function updateSpatial(st, f, dtMs, nowMs) {
	if (st.tagActive && !st.tagGraph && st.tagEl) {

		updateTagSpatial(st, f, dtMs, nowMs);
		return;
	}
	if (!st.panner || !st.spatGain) return;
	const sp = spatialParentOf(st.inst);


	if (!sp) {
		if (!st.spatialLast || st.spatialLast.gain !== 1) {
			clearParamAutomation(st.spatGain.gain, ctx ? ctx.currentTime : 0);
			try { st.spatGain.gain.value = 1; } catch {}
			st.spatialLast = { gain: 1, x: 0, y: 0, z: 0, rate: Math.max(0.0001, st.baseRate * st.doppler) };
		}
		return;
	}
	const pos = emitterPosition(sp);
	if (!pos) {
		if (!st.spatialLast || st.spatialLast.gain !== 1) {
			clearParamAutomation(st.spatGain.gain, ctx ? ctx.currentTime : 0);
			try { st.spatGain.gain.value = 1; } catch {}
			st.spatialLast = { gain: 1, x: 0, y: 0, z: 0, rate: Math.max(0.0001, st.baseRate * st.doppler) };
		}
		return;
	}

	const cap = ensureSpatialCapability();
	const isFirst = !st.spatialLast;
	const stepMs = isFirst ? 0 : (dtMs != null ? Math.min(Math.max(dtMs, 1), SPATIAL_LIMITS.maxFrameDtMs) : TICK_MS);
	const nowSec = (nowMs != null ? nowMs : perfNowMs()) / 1000;


	const put = (param, kind, to) => {
		if (isFirst) {
			try { param.value = to; } catch {}
		} else {
			writeParam(param, kind, to, stepMs, cap);
		}
	};

	const L = listenerPose();
	const t = nowSec;

	const out = computeSpatial({
		emitter: pos,
		listener: L,
		prev: st.spatialPrev,
		t,
		dt: stepMs > 0 ? stepMs / 1000 : undefined,
		rolloff: rolloffParamsOf(st.inst),
		factors: f,
	});

	st.spatialPrev = out.next;
	st.spatialOut = out;

	if (!out.audible) {


		if (!st.spatialLast || st.spatialLast.gain !== 0) {
			clearParamAutomation(st.spatGain.gain, ctx ? ctx.currentTime : 0);
			try { st.spatGain.gain.value = 0; } catch {}
		}








		st.doppler = out.doppler;
		st.spatialLast = { gain: 0, x: pos.x, y: pos.y, z: pos.z, rate: Math.max(0.0001, st.baseRate * st.doppler) };
		return;
	}


	if (!st.spatialLast || st.spatialLast.gain !== out.gain) {
		put(st.spatGain.gain, "gain", out.gain);
	}


	if (!st.spatialLast || st.spatialLast.x !== out.position.x ||
			st.spatialLast.y !== out.position.y || st.spatialLast.z !== out.position.z) {
		if (st.panner.positionX) {
			put(st.panner.positionX, "position", out.position.x);
			put(st.panner.positionY, "position", out.position.y);
			put(st.panner.positionZ, "position", out.position.z);
		} else if (st.panner.setPosition) {
			st.panner.setPosition(out.position.x, out.position.y, out.position.z);
		}
	}




	const rate = Math.max(0.0001, st.baseRate * out.doppler);


	if (st.src) {
		if (st.spatialRateWritten == null || Math.abs(st.spatialRateWritten - rate) >= SPATIAL_LIMITS.minDelta.rate) {
			rebaseClock(st);
			st.doppler = out.doppler;
			put(st.src.playbackRate, "rate", rate);
			st.spatialRateWritten = rate;
		} else {
			st.doppler = out.doppler;
		}
	} else {
		st.doppler = out.doppler;
		if (st.tagGraph && st.tagEl &&
				(st.spatialRateWritten == null || Math.abs(st.spatialRateWritten - rate) >= SPATIAL_LIMITS.minDelta.rate)) {


			applyTagRate(st.tagEl, rate);
			st.spatialRateWritten = rate;
		}
	}

	st.spatialLast = { gain: out.gain, x: out.position.x, y: out.position.y, z: out.position.z, rate };
	st.lastPos = pos;                                              
	st.lastT = nowSec;
}


function updateTagSpatial(st, f, dtMs, nowMs) {
	if (!st.tagEl) return;
	const sp = st.forceGlobal ? null : spatialParentOf(st.inst);
	const pos = sp ? emitterPosition(sp) : null;
	let gain = 1;
	let doppler = 1;
	if (pos) {
		const isFirst = !st.spatialPrev;
		const stepMs = isFirst ? 0 : (dtMs != null ? Math.min(Math.max(dtMs, 1), SPATIAL_LIMITS.maxFrameDtMs) : TICK_MS);
		const nowSec = (nowMs != null ? nowMs : perfNowMs()) / 1000;
		const out = computeSpatial({
			emitter: pos,
			listener: listenerPose(),
			prev: st.spatialPrev,
			t: nowSec,
			dt: stepMs > 0 ? stepMs / 1000 : undefined,
			rolloff: rolloffParamsOf(st.inst),
			factors: f,
		});
		st.spatialPrev = out.next;
		st.spatialOut = out;
		gain = out.audible ? out.gain : 0;
		doppler = out.doppler;
		st.lastPos = pos;
		st.lastT = nowSec;
	} else {
		st.spatialPrev = null;
		st.spatialOut = null;
	}
	st.doppler = doppler;
	st.tagSpatialGain = gain;
	applyTagMix(st, f, gain, doppler);
}

function updateGlobalListener() {
	if (!ctx || !ctx.listener) return;
	const L = listenerPose();
	const l = ctx.listener;
	if (l.positionX) {
		l.positionX.value = L.pos.x;
		l.positionY.value = L.pos.y;
		l.positionZ.value = L.pos.z;
		l.forwardX.value = L.fwd.x;
		l.forwardY.value = L.fwd.y;
		l.forwardZ.value = L.fwd.z;
		l.upX.value = L.up.x;
		l.upY.value = L.up.y;
		l.upZ.value = L.up.z;
	} else {
		if (l.setPosition) l.setPosition(L.pos.x, L.pos.y, L.pos.z);
		if (l.setOrientation) l.setOrientation(L.fwd.x, L.fwd.y, L.fwd.z, L.up.x, L.up.y, L.up.z);
	}
}


function runSpatialStep(t) {

	try {
		if (!ctx || !inited) return;
		const active = [];
		const tagged = [];                                                        
		for (const [, st] of soundStates) {
			if (!st.playing) continue;
			if (st.panner && st.spatGain) active.push(st);
			else if (st.tagActive && !st.tagGraph && st.tagEl) tagged.push(st);
		}
		if (active.length === 0 && tagged.length === 0) return;


		if (!spatialClock) spatialClock = createFrameClock({ limits: SPATIAL_LIMITS });
		const step = spatialClock.tick(t);
		if (!step.update) return;


		updateGlobalListener();
		const f = soundServiceFactors();
		for (const st of active) updateSpatial(st, f, step.dtMs, t);


		for (const st of tagged) updateTagSpatial(st, f, step.dtMs, t);


		if (t - hrtfPlanMs >= 250) {
			hrtfPlanMs = t;
			replanHrtfBudget(active);
		}


		if (!spatialFallbackDriving) {
			spatialUpdateStamps.push(t);
			if (spatialUpdateStamps.length > 300) spatialUpdateStamps.shift();
		}
	} catch {}
}


export function hasActiveSpatialSources() {
	if (!ctx || !inited) return false;
	for (const [, st] of soundStates) {
		if (!st.playing) continue;
		if (st.panner && st.spatGain) return true;
		if (st.tagActive && !st.tagGraph && st.tagEl) return true;
	}
	return false;
}


export function stepAudioSpatial(nowMs) {
	try {
		const t = (typeof nowMs === "number" && Number.isFinite(nowMs)) ? nowMs : perfNowMs();
		if (!spatialFallbackDriving) spatialDriveMs = t;
		runSpatialStep(t);
	} catch {}
}


function getSpatialAudioDiagnostics() {
	const cap = spatialCapability || { panner: false, hrtf: false, paramAutomation: false, listenerParams: false, reason: "not-init" };
	const now = perfNowMs();

	spatialUpdateStamps = spatialUpdateStamps.filter(ts => now - ts <= 1000);
	const sources = {};
	for (const [, st] of soundStates) {
		if (!st.playing) continue;
		if (st.panner) {
			sources[st.spatialId] = {
				gain: st.spatialOut ? Math.round(st.spatialOut.gain * 1000) / 1000 : null,
				distance: st.spatialOut ? Math.round(st.spatialOut.distance * 10) / 10 : null,
				hrtf: st.panner.panningModel === "HRTF",
			};
			continue;
		}
		if (st.tagActive && !st.tagGraph && st.tagEl) {

			sources[st.spatialId] = {
				gain: st.spatialOut ? Math.round(st.spatialOut.gain * 1000) / 1000 : null,
				distance: st.spatialOut ? Math.round(st.spatialOut.distance * 10) / 10 : null,
				hrtf: false,
				emulatedTag: true,
				elementVolume: st.tagMixLast && st.tagMixLast.volume != null ? Math.round(st.tagMixLast.volume * 1000) / 1000 : null,
			};
		}
	}
	return {
		capability: { ...cap },
		mode: spatialMode(),
		updatesPerSec: spatialUpdateStamps.length,
		frameCounters: spatialClock ? { ...spatialClock.counters } : null,
		hrtfActive: Array.from(hrtfActive),
		sources,
	};
}


function tick() {
	if (!ctx) return;
	const f = soundServiceFactors();
	master.gain.value = f.volumeScale;                                        
	applyAmbientReverb();

	const nowMs = perfNowMs();
	if (nowMs - spatialDriveMs >= SPATIAL_LIMITS.maxFrameDtMs) {
		spatialFallbackDriving = true;
		try { stepAudioSpatial(nowMs); } catch {}
		spatialFallbackDriving = false;
	}
	for (const [inst, st] of soundStates) {
		if (!alive(inst)) {
			teardown(st);
			releaseTag(st);                                                        
			soundStates.delete(inst);
			continue;
		}
		if (!st.playing) continue;
		const posNow = currentTimePos(st);


		const looping = st.tagActive && st.tagEl ? !!st.tagEl.loop : !!(st.src && st.src.loop);


		if (!looping) {
			st.loopPos = null;
		} else {
			if (st.loopPos != null && posNow + 0.05 < st.loopPos) {
				st.loopCount = (st.loopCount | 0) + 1;
				emitSoundEvent(inst, "DidLoop", { loops: st.loopCount });
			}
			st.loopPos = posNow;
		}
		syncProps(inst, { TimePosition: Math.round(posNow * 100) / 100 });
	}


	stepTagPromotion(nowMs);
}


function rebuildIfActive(inst) {
	const st = soundStates.get(inst);
	if (!st || !st.playing) return;
	const at = currentTimePos(st);
	st.manualStop = true;


	const r = startPlayback(inst, at);
	if (r === false) {
		syncProps(inst, { Playing: false, IsPaused: false });
	}
}


function onPropertyChanged(p) {
	if (syncingProps || !p || !p.instance) return;
	const inst = p.instance;
	const cn = inst.className;
	const name = p.property;
	if (cn === "Sound") {
		const st = soundStates.get(inst);
		if (name === "Volume") {
			if (st && st.volGain) st.volGain.gain.value = clamp(p.value, 0, 10, 0.5);


			if (st && st.tagActive && !st.tagGraph && st.tagEl) {
				applyTagMix(st, soundServiceFactors(), num(st.tagSpatialGain, 1), num(st.doppler, 1));
			}
			return;
		}
		if (name === "Pitch" || name === "PlaybackSpeed") {

			const v = clamp(p.value, 0, 20, 1);
			syncProps(inst, name === "Pitch" ? { PlaybackSpeed: v } : { Pitch: v });
			if (st && st.src) {
				rebaseClock(st);                                                           


				st.baseRate = effectiveBaseRate(inst) * num(st.pitchFactor, 1);
				st.src.playbackRate.value = Math.max(0.0001, st.baseRate * st.doppler);
			}
			if (st && st.tagActive && st.tagEl) {


				st.baseRate = effectiveBaseRate(inst) * num(st.pitchFactor, 1);
				if (st.tagGraph) {
					applyTagRate(st.tagEl, st.baseRate * num(st.doppler, 1));
				} else {
					applyTagMix(st, soundServiceFactors(), num(st.tagSpatialGain, 1), num(st.doppler, 1));
				}
			}
			return;
		}
		if (name === "Looped") {
			if (st && st.src) st.src.loop = !!p.value;
			if (st && st.tagActive && st.tagEl) st.tagEl.loop = !!p.value;
			return;
		}
		if (name === "TimePosition") {

			const t = Math.max(0, num(p.value, 0));
			if (st && st.tagActive && st.tagEl) {


				try {
					const known = num(prop(inst, "TimeLength"), 0);
					st.tagEl.currentTime = known > 0 ? clamp(t, 0, known, 0) : t;
				} catch {}
				st.loopPos = null;                                              
				return;
			}
			if (st && st.playing) {
				st.manualStop = true;
				st.loopPos = null;                                              
				startPlayback(inst, clamp(t, 0, num(prop(inst, "TimeLength"), 0), 0));
			} else if (st) {
				st.pauseAt = t;
				st.loopPos = null;
			}
			return;
		}
		if (name === "SoundId") {
			const state = stateFor(inst);
			state.loadedKey = null;                                               


			state.loadGen = (state.loadGen | 0) + 1;
			const wasPlaying = !!(st && st.playing);
			const key = normalizeSoundId(p.value);
			const buf = getBufferSync(p.value);
			if (buf) {


				markLoaded(inst, state, key, buf);
				if (wasPlaying) {
					state.manualStop = true;
					state.loopPos = null;                                          
					state.loopCount = 0;
					startPlayback(inst, 0);
				}
				return;
			}
			syncProps(inst, { IsLoaded: false, TimeLength: 0 });
			const hasAsset = !!key && !decodeFailed.has(key) && (!!assetForSoundId(key) || !!cdnIdForSoundId(key));
			if (wasPlaying) {
				state.manualStop = true;
				state.loopPos = null;                                          
				state.loopCount = 0;
				if (hasAsset) {
					startPlayback(inst, 0);                                               
				} else {
					teardown(state);
					syncProps(inst, { Playing: false, IsPaused: false, TimePosition: 0 });
				}
				return;
			}

			if (hasAsset) preloadSoundId(inst, state, key);
			return;
		}
		if (name === "SoundGroup") {


			if (st && st.playing && st.tagActive && !st.tagGraph && st.tagEl) {
				applyTagMix(st, soundServiceFactors(), num(st.tagSpatialGain, 1), num(st.doppler, 1));
				return;
			}
			rebuildIfActive(inst);
			return;
		}
		if (name === "Playing") {
			if (p.value && (!st || !st.playing)) soundPlay(inst);
			else if (!p.value && st && st.playing) soundStop(inst);
			return;
		}

		return;
	}
	if (cn === "SoundGroup") {
		if (name === "Volume") {
			const rec = groupGains.get(inst);
			if (rec) rec.gain.gain.value = clamp(p.value, 0, 10, 1);
			refreshTagMixes();                                            
		} else if (name === "SoundGroup") {
			rewireGroups();
			refreshTagMixes();                                       
		}
		return;
	}
	if (EFFECT_SET.has(cn)) {
		const owner = typeof inst.getParent === "function" ? inst.getParent() : null;
		if (isSound(owner)) {
			const stO = soundStates.get(owner);
			if (stO && stO.playing && stO.tagActive && !stO.tagGraph && stO.tagEl) {


				stO.pitchFactor = tagPitchFactor(owner);
				stO.baseRate = effectiveBaseRate(owner) * stO.pitchFactor;
				applyTagMix(stO, soundServiceFactors(), num(stO.tagSpatialGain, 1), num(stO.doppler, 1));
				return;
			}
			rebuildIfActive(owner);
		} else if (isGroup(owner)) {
			rewireGroups();
		}
		return;
	}
	if (cn === "SoundService") {
		if (!ctx) return;
		if (name === "VolumeScale") {
			master.gain.value = clamp(p.value, 0, 1, 1);


			refreshTagMixes();
		} else if (name === "AmbientReverb") {
			currentReverbName = null;
			applyAmbientReverb();
		}

	}
}

function onChildAdded(p) {
	if (!p || !p.child) return;
	const child = p.child;
	if (isEffect(child)) {
		const owner = p.parent;
		if (isSound(owner)) rebuildIfActive(owner);
		else if (isGroup(owner)) rewireGroups();
		return;
	}
	if (isGroup(child)) {
		rewireGroups();
		return;
	}
	if (isSound(child)) {


		playOnRemoveFired.delete(child);                                                     
		const key = normalizeSoundId(prop(child, "SoundId"));
		if (key && !decodeFailed.has(key) && !bufferCache.get(key) && (assetForSoundId(key) || cdnIdForSoundId(key))) {
			preloadSoundId(child, stateFor(child), key);
		}
		if (mode !== "edit" && prop(child, "Playing")) {


			const stx = soundStates.get(child);
			if (!stx || !stx.playing) soundPlay(child);
		}
	}
}

function onChildRemoved(p) {
	if (!p || !p.child) return;
	const child = p.child;


	const cur = typeof child.getParent === "function" ? child.getParent() : null;
	const isReparent = !!(cur && cur !== p.parent && alive(child));
	if (child.className === "Sound") {
		if (isReparent) {


			const st = soundStates.get(child);
			if (st && st.playing) rebuildIfActive(child);
			return;
		}

		if (prop(child, "PlayOnRemove")) firePlayOnRemove(child);
		const st = soundStates.get(child);
		if (st) {
			st.manualStop = true;
			teardown(st);
			releaseTag(st);                                                        
			soundStates.delete(child);
		}
		return;
	}
	if (isEffect(child)) {
		const owner = p.parent;
		if (isSound(owner)) rebuildIfActive(owner);
		else if (isGroup(owner)) rewireGroups();
		return;
	}
	if (child.className === "SoundGroup") {
		if (isReparent) {


			rewireGroups();
			return;
		}
		const rec = groupGains.get(child);
		if (rec) {
			try {
				rec.gain.disconnect();
			} catch {}
			for (const l of rec.lfos) {

				try {
					l.stop();
				} catch {}
			}
			groupGains.delete(child);
		}
		rewireGroups();


		scheduleGroupSoundsRebuild(child);
	}
}

function onDestroying(p) {
	const inst = p && p.instance;
	if (!inst) return;
	const st = soundStates.get(inst);


	if (inst.className === "Sound" && prop(inst, "PlayOnRemove")) firePlayOnRemove(inst);
	if (st) {
		st.manualStop = true;
		teardown(st);
		releaseTag(st);                                                        
		soundStates.delete(inst);
	}
	const rec = groupGains.get(inst);
	if (rec) {
		try {
			rec.gain.disconnect();
		} catch {}
		for (const l of rec.lfos) {

			try {
				l.stop();
			} catch {}
		}
		groupGains.delete(inst);
		rewireGroups();



		scheduleGroupSoundsRebuild(inst);
	}
}


function playOneShot(soundId, volume) {
	const c = ensureCtx();
	if (!c) return;
	requestSource(soundId, (res) => {
		if (!res || playingCount + oneShotCount >= MAX_PLAYING) return;
		let done = false;
		const release = () => {
			if (done) return;
			done = true;
			oneShotCount = Math.max(0, oneShotCount - 1);
		};
		if (res.tagGraph) {


			if (playTagGraphOneShot(res.tagGraph, clamp(volume, 0, 10, 0.5), 1, master, release)) {
				oneShotCount++;
				return;
			}

			const scale0 = soundServiceFactors().volumeScale;
			if (playTagOneShot(res.tagGraph, clamp(clamp(volume, 0, 10, 0.5) * scale0, 0, 1, 0.5), 1, release)) oneShotCount++;
			return;
		}
		if (res.tag) {


			const scale = soundServiceFactors().volumeScale;
			if (playTagOneShot(res.tag, clamp(clamp(volume, 0, 10, 0.5) * scale, 0, 1, 0.5), 1, release)) oneShotCount++;
			return;
		}
		const buffer = res.buffer;
		const src = c.createBufferSource();
		src.buffer = buffer;
		const g = c.createGain();
		g.gain.value = clamp(volume, 0, 10, 0.5);
		src.connect(g);
		g.connect(master);
		src.onended = () => {
			release();
			try {
				src.disconnect();
				g.disconnect();
			} catch {}
		};
		src.start(0);
		oneShotCount++;
	});
}


function firePlayOnRemove(inst) {
	if (playOnRemoveFired.has(inst)) return;
	playOnRemoveFired.add(inst);
	playOneShot(prop(inst, "SoundId"), clamp(prop(inst, "Volume"), 0, 10, 0.5));
}


function scheduleGroupSoundsRebuild(groupInst) {
	if (pendingGroupRebuilds.has(groupInst)) return;
	pendingGroupRebuilds.add(groupInst);
	queueMicrotask(() => {
		pendingGroupRebuilds.delete(groupInst);
		for (const [inst, st] of soundStates) {
			if (!st.playing) continue;
			if (prop(inst, "SoundGroup") === groupInst) rebuildIfActive(inst);
		}
	});
}


function onAssetsChanged(p) {
	if (!p || (p.action !== "remove" && p.action !== "restore" && p.action !== "add")) return;
	if (p.action === "add") {
		const rec = p.asset;
		if (!rec || rec.section !== "audio" || !rec.id) return;
		assetEpoch++;                                                           
		bufferCache.delete(rec.id);
		decodeFailed.delete(rec.id);
		cdnFallback.delete(rec.id);
		const cdnNum = extractAssetId(rec.id);
		if (cdnNum) {
			cdnWarned.delete(cdnNum);                                          
			cdnRung.delete(cdnNum);                                                  
			cdnTagInfoOnce.delete(cdnNum);
			cdnGraphInfoOnce.delete(cdnNum);
		}
		return;
	}
	if (p.action === "remove") {
		const rec = p.asset;
		if (!rec || rec.section !== "audio" || !rec.id) return;
		assetEpoch++;
		bufferCache.delete(rec.id);
		decodeFailed.delete(rec.id);
		cdnFallback.delete(rec.id);
		return;
	}
	assetEpoch++;
	bufferCache.clear();                                                           
	decodeFailed.clear();
	cdnFallback.clear();                                                  
	cdnWarned.clear();
	cdnRung.clear();                                            
	cdnTagInfoOnce.clear();
	cdnGraphInfoOnce.clear();
	if (cdnFetcher) cdnFetcher.clearNegative();                                       
	if (tagProber) tagProber.clearNegative();                             
	if (graphProber) graphProber.clearNegative();                                
}


function onModeChanged(p) {
	mode = p && p.mode ? String(p.mode) : "edit";
	if (mode === "edit") {

		stopAllSounds();
		return;
	}

	const dm = store && typeof store.getDataModel === "function" ? store.getDataModel() : null;
	if (!dm) return;
	const visit = (node) => {
		if (!node) return;
		if (isSound(node) && prop(node, "Playing")) soundPlay(node);
		const kids = typeof node.getChildren === "function" ? node.getChildren() : [];
		for (const k of kids) visit(k);
	};
	visit(dm);
}


export function playAssetPreview(soundId, name, rate) {
	const c = ensureCtx();
	if (!c) return;
	stopAudioPreview();
	const token = ++previewGen;
	requestSource(soundId, (res) => {
		if (previewGen !== token || !res) return;
		const id = String(soundId == null ? "" : soundId);
		if (res.tagGraph) {


			let gel = null;
			const one = playTagGraphOneShot(res.tagGraph, previewVolume, rate, c.destination, () => {
				if (previewState && gel && previewState.tagEl === gel) {
					previewState = null;
					bus.emit("audio:previewChanged", { playing: false });
				}
			});
			if (!one) return;
			gel = one.el;
			gel.onended = () => {
				if (previewState && previewState.tagEl === gel) {
					previewState = null;
					bus.emit("audio:previewChanged", { playing: false });
				}
				try {
					gel.onerror = null;
					gel.pause();
					one.node.disconnect();
					one.gain.disconnect();
					gel.removeAttribute("src");
					gel.load();
				} catch {}
			};
			gel.onerror = gel.onended;
			previewState = { tagEl: gel, gain: one.gain, node: one.node, id };
			bus.emit("audio:previewChanged", { playing: true, id, name: String(name || id || "Preview") });
			return;
		}
		if (res.tag) {


			let tagPrevEl = null;
			const el = playTagOneShot(res.tag, previewVolume, rate, () => {
				if (previewState && tagPrevEl && previewState.tagEl === tagPrevEl) {
					previewState = null;
					bus.emit("audio:previewChanged", { playing: false });
				}
			});
			if (!el) return;
			tagPrevEl = el;
			el.onended = () => {
				if (previewState && previewState.tagEl === el) {
					previewState = null;
					bus.emit("audio:previewChanged", { playing: false });
				}
				try {
					el.onerror = null;
					el.removeAttribute("src");
					el.load();
				} catch {}
			};
			el.onerror = el.onended;                                                               
			previewState = { tagEl: el, id };
			bus.emit("audio:previewChanged", { playing: true, id, name: String(name || id || "Preview") });
			return;
		}
		const buffer = res.buffer;
		const src = c.createBufferSource();
		src.buffer = buffer;
		src.playbackRate.value = Math.max(0.05, clamp(rate, 0.05, 20, 1));
		const gain = c.createGain();
		gain.gain.value = previewVolume;
		src.connect(gain);
		gain.connect(c.destination);
		src.onended = () => {
			if (previewState && previewState.src === src) {
				previewState = null;
				bus.emit("audio:previewChanged", { playing: false });
			}
			try {
				src.disconnect();
				gain.disconnect();
			} catch {}
		};
		previewState = { src, gain, id };
		src.start(0);
		bus.emit("audio:previewChanged", { playing: true, id, name: String(name || id || "Preview") });
	});
}


export function previewSoundInstance(inst) {
	if (!isSound(inst)) return;


	playAssetPreview(prop(inst, "SoundId"), inst.name || "Sound", effectiveBaseRate(inst));
}

export function stopAudioPreview() {
	previewGen++;                                                      
	if (!previewState) return;
	const st = previewState;
	previewState = null;


	if (st.tagEl) {
		try {
			st.tagEl.onended = null;
			st.tagEl.onerror = null;
			st.tagEl.pause();
			st.tagEl.removeAttribute("src");
			st.tagEl.load();
		} catch {}

		try { if (st.node) st.node.disconnect(); } catch {}
		try { if (st.gain) st.gain.disconnect(); } catch {}
	}
	if (st.src) {
		try {
			st.src.onended = null;
			st.src.stop();
		} catch {}
		try { st.src.disconnect(); } catch {}
		try { st.gain.disconnect(); } catch {}
	}
	bus.emit("audio:previewChanged", { playing: false });
}

export function isAudioPreviewActive(id) {
	if (!previewState) return false;
	return id === undefined || previewState.id === String(id);
}

export function setAudioPreviewVolume(v) {
	previewVolume = clamp(v, 0, 1, 0.35);
	if (previewState && previewState.gain) previewState.gain.gain.value = previewVolume;

	if (previewState && previewState.tagEl && !previewState.node) previewState.tagEl.volume = previewVolume;
}


export function initAudioEngine(opts = {}) {
	if (typeof opts.getCamera === "function") getCameraFn = opts.getCamera;
	if (inited) return { dispose() {} };
	inited = true;
	unsubs.push(
		bus.on(Events.PropertyChanged, onPropertyChanged),
		bus.on(Events.ChildAdded, onChildAdded),
		bus.on(Events.ChildRemoved, onChildRemoved),
		bus.on(Events.Destroying, onDestroying),
		bus.on(RUNTIME_MODE_CHANGED, onModeChanged),
		bus.on("assets:changed", onAssetsChanged),                                      
	);


	if (typeof globalThis !== "undefined") {
		globalThis.ROBLOX_AUDIO_CDN_DIAG = getCdnAudioDiagnostics;
		globalThis.ROBLOX_AUDIO_SPATIAL_DIAG = getSpatialAudioDiagnostics;


		globalThis.ROBLOX_AUDIO_PROMOTE_NOW = (id) => {
			const t = perfNowMs();
			stepTagPromotion(t);                                    
			ensureTagPromoter().forceNow(id);
			stepTagPromotion(t);                                        
			return tagPromoter ? tagPromoter.snapshot() : null;
		};


		globalThis.ROBLOX_AUDIO_VAULT_CLEAR = () => ensureByteVault().clear();
	}
	tickTimer = setInterval(tick, TICK_MS);
	return {
		dispose() {
			if (tickTimer) {
				clearInterval(tickTimer);
				tickTimer = null;
			}
			while (unsubs.length) {
				const off = unsubs.pop();
				if (typeof off === "function") off();
			}
			stopAllSounds();
			stopAudioPreview();
			inited = false;
			getCameraFn = null;

			spatialClock = null;
			spatialDriveMs = -Infinity;
			hrtfPlanMs = -Infinity;
			hrtfActive = new Set();
			spatialUpdateStamps = [];
			tagPromoter = null;                                                     
			byteVault = null;                                                     
			localAssetPromotions = 0;
		},
	};
}

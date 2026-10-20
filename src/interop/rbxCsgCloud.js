import { extractAssetId, buildEndpoints } from "../audio/audioCdn.js";
import { filterAllowedProxyPrefixes } from "../runtime/cdnProxyPolicy.js";
import { base64ToBytes } from "./rbxBlobs.js";
import {
  SOLID_LIMITS,
  decodeCsgMeshData,
  decodeCsgPhysicsData,
  hullsToTriangleSoup,
} from "./rbxSolidMesh.js";

export const CSG_CLOUD_LIMITS = Object.freeze({
  maxBytes: SOLID_LIMITS.maxBlobBytes,                                         
  timeoutMs: 15000,
  negativeTtlMs: 60000,                                            
  badPayloadTtlMs: 600000,                                                    
  maxPerImport: 64,                                           
  maxConcurrent: 4,                         
  maxAssetIdB64: 2048,                                               
});


export function getCsgCloudProxies() {
  const own = globalThis.ROBLOX_CSG_CDN_PROXIES;
  if (Array.isArray(own)) return filterAllowedProxyPrefixes(own);
  const audio = globalThis.ROBLOX_AUDIO_CDN_PROXIES;
  return filterAllowedProxyPrefixes(audio);
}


export function extractCloudAssetIdFromRaw(raw) {
  try {
    if (!(raw instanceof Map)) return null;
    const b64 = raw.get("AssetId");
    if (typeof b64 !== "string" || b64.length === 0 || b64.length > CSG_CLOUD_LIMITS.maxAssetIdB64) {
      return null;
    }
    const bytes = base64ToBytes(b64, 1024);
    if (!bytes || bytes.length === 0) return null;
    let text = "";
    for (let i = 0; i < bytes.length; i++) {
      const c = bytes[i];
      if (c === 0) break;                            
      if (c < 0x20 || c > 0x7e) return null;                                         
      text += String.fromCharCode(c);
    }
    return extractAssetId(text.trim());
  } catch (_) {
    return null;
  }
}


export function collectCloudCsgPending(roots) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(roots) ? roots : [];
  for (const root of list) {
    if (!root) continue;
    const nodes = [root];
    try {
      if (typeof root.getDescendants === "function") nodes.push(...root.getDescendants());
    } catch (_) {

    }
    for (const inst of nodes) {
      if (!inst || seen.has(inst)) continue;
      seen.add(inst);
      const pending = inst._cloudCsgPending;
      if (!pending || typeof pending !== "object" || !pending.assetId) continue;
      if (inst._importedSolid) continue;                    
      const hasRecipe =
        (Array.isArray(inst._sourceParts) && inst._sourceParts.length > 0) || inst._original != null;
      if (hasRecipe) continue;                                         
      if (typeof inst.isDestroyed === "function" && inst.isDestroyed()) continue;
      out.push(inst);
    }
  }
  return out;
}


export function decodeCloudCsgBytes(bytes, warnings) {
  const w = Array.isArray(warnings) ? warnings : [];
  const out = { solid: null, meshFormat: null, physFormat: null };
  try {
    if (!bytes || typeof bytes.length !== "number" || bytes.length === 0) return out;
    const meshRes = decodeCsgMeshData(bytes, w, null);
    out.meshFormat = meshRes ? meshRes.format : null;
    if (meshRes && meshRes.ok && Array.isArray(meshRes.positions) && meshRes.positions.length >= 9) {
      out.solid = {
        source: "meshData",
        positions: meshRes.positions,
        colors: Array.isArray(meshRes.colors) && meshRes.colors.length > 0 ? meshRes.colors : null,
        hulls: null,
        boxOnly: false,
        triCount: Math.floor(meshRes.positions.length / 9),
      };
      return out;
    }
    const physRes = decodeCsgPhysicsData(bytes, w);
    out.physFormat = physRes ? physRes.format : null;
    if (
      physRes &&
      physRes.ok &&
      physRes.kind === "hulls" &&
      Array.isArray(physRes.hulls) &&
      physRes.hulls.length > 0
    ) {
      const soup = hullsToTriangleSoup(physRes.hulls);
      if (Array.isArray(soup) && soup.length >= 9) {
        out.solid = {
          source: "hulls",
          positions: soup,
          colors: null,
          hulls: physRes.hulls,
          boxOnly: false,
          triCount: Math.floor(soup.length / 9),
        };
      }
    }
    return out;
  } catch (_) {
    return out;
  }
}


export function createCsgCloudResolver(opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const now = opts.now || (() => Date.now());
  const limits = Object.assign({}, CSG_CLOUD_LIMITS, opts.limits || {});
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
    empty: 0,
    badPayloads: 0,
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
    negative.set(String(id), { until: Infinity, reason: reason || "formato" });
  }

  function clearNegative() {
    negative.clear();
  }

  async function readBody(res) {
    const lenRaw =
      res && res.headers && typeof res.headers.get === "function" ? res.headers.get("content-length") : null;
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
            } catch (_) {

            }
            return { tooBig: true };
          }
          chunks.push(value);
        }
      } finally {
        try {
          reader.releaseLock();
        } catch (_) {

        }
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
            } catch (_) {

            }
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
      if (!body.bytes || body.bytes.length === 0) {
        counters.empty++;
        return { error: "empty" };
      }
      return { bytes: body.bytes };
    } catch (_) {
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


  function fetchCsgAsset(id, callOpts = {}) {
    const key = String(id);
    if (!/^\d{1,20}$/.test(key)) return Promise.resolve({ error: "badId", permanent: true });
    if (!fetchImpl) return Promise.resolve({ error: "noFetch" });
    if (isNegative(key)) {
      counters.negativeHits++;
      const rec = negative.get(key);
      return Promise.resolve({
        error: (rec && rec.reason) || "negative",
        negative: true,
        permanent: !!rec && rec.until === Infinity,
      });
    }
    const flying = inFlight.get(key);
    if (flying) {
      counters.deduped++;
      return flying;
    }
    counters.requests++;
    const p = (async () => {
      const endpoints = buildEndpoints(key, callOpts.proxies);
      const validate = typeof callOpts.validate === "function" ? callOpts.validate : null;
      let last = { error: "network" };
      for (const url of endpoints) {
        const r = await tryEndpoint(url);
        if (r.bytes) {
          if (!validate) {
            counters.success++;
            return { bytes: r.bytes, url };
          }
          const decoded = validate(r.bytes);
          if (decoded) {
            counters.success++;
            return { bytes: r.bytes, url, decoded };
          }


          counters.badPayloads++;
          last = { error: "badPayload" };
          continue;
        }
        last = r;
      }
      const ttlMs = last.error === "badPayload" ? limits.badPayloadTtlMs : limits.negativeTtlMs;
      negative.set(key, { until: now() + ttlMs, reason: last.error });
      return last;
    })();
    inFlight.set(key, p);
    const done = () => inFlight.delete(key);
    p.then(done, done);
    return p;
  }

  async function hydrateOne(inst, proxies, onResolved, summary) {
    try {
      const pending = inst._cloudCsgPending;
      if (!pending || typeof pending !== "object" || !pending.assetId) return;
      if (typeof inst.isDestroyed === "function" && inst.isDestroyed()) return;
      if (inst._importedSolid) return;
      summary.attempted += 1;
      const r = await fetchCsgAsset(pending.assetId, {
        proxies,


        validate: (bytes) => {
          const d = decodeCloudCsgBytes(bytes, []);
          return d.solid ? d : null;
        },
      });
      if (!r || !r.decoded || !r.decoded.solid) {
        if (r && (r.error === "badPayload" || r.permanent)) summary.failedDecode += 1;
        else summary.failedNet += 1;
        return;
      }
      const dec = r.decoded;

      if (typeof inst.isDestroyed === "function" && inst.isDestroyed()) return;
      if (inst._importedSolid) return;
      const bs = pending.baseSize;
      const baseSize = {
        x: bs && Number.isFinite(bs.x) && bs.x > 0 ? bs.x : 1,
        y: bs && Number.isFinite(bs.y) && bs.y > 0 ? bs.y : 1,
        z: bs && Number.isFinite(bs.z) && bs.z > 0 ? bs.z : 1,
      };
      const solid = { ...dec.solid, baseSize };
      inst._importedSolid = solid;
      const hasRecipe =
        (Array.isArray(inst._sourceParts) && inst._sourceParts.length > 0) || inst._original != null;
      if (!hasRecipe) {


        inst._csgMesh = { positions: solid.positions, baseSize: solid.baseSize };
      }
      inst._cloudCsgPending = null;
      if (solid.source === "meshData") summary.meshOk += 1;
      else summary.hullsOk += 1;
      summary.resolved += 1;
      if (onResolved) {
        try {
          onResolved(inst);
        } catch (_) {

        }
      }
    } catch (_) {
      summary.failedNet += 1;
    }
  }


  async function hydrate(insts, hopts = {}) {
    const all = Array.isArray(insts) ? insts.filter(Boolean) : [];
    const list = all.slice(0, limits.maxPerImport);
    const summary = {
      attempted: 0,
      resolved: 0,
      meshOk: 0,
      hullsOk: 0,
      failedNet: 0,
      failedDecode: 0,
      skippedCap: Math.max(0, all.length - list.length),
    };
    if (!list.length) return summary;
    const proxies = Array.isArray(hopts.proxies) ? hopts.proxies : [];
    const onResolved = typeof hopts.onResolved === "function" ? hopts.onResolved : null;
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(limits.maxConcurrent | 0 || 1, list.length));
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(
        (async () => {
          for (;;) {
            const idx = cursor;
            cursor += 1;
            if (idx >= list.length) return;
            await hydrateOne(list[idx], proxies, onResolved, summary);
          }
        })(),
      );
    }
    await Promise.all(workers);
    return summary;
  }

  return {
    hydrate,
    fetchCsgAsset,
    isNegative,
    negativeReason,
    markPermanentFailure,
    clearNegative,
    counters,
    limits,
  };
}


export const sharedCsgCloudResolver = createCsgCloudResolver();


export const CSG_RETRY_DELAYS_MS = Object.freeze([61000, 120000, 180000]);

export function createCsgCloudRetryQueue(opts = {}) {
  const runHydration = typeof opts.runHydration === "function" ? opts.runHydration : null;
  const delays =
    Array.isArray(opts.delays) && opts.delays.length > 0 ? opts.delays : CSG_RETRY_DELAYS_MS;
  const setTimerImpl = opts.setTimerImpl || ((fn, ms) => setTimeout(fn, ms));
  const clearTimerImpl = opts.clearTimerImpl || ((t) => clearTimeout(t));
  const pending = new Set();
  let timer = null;
  let attempt = 0;
  let running = false;


  function stillPending(inst) {
    if (!inst) return false;
    const p = inst._cloudCsgPending;
    if (!p || typeof p !== "object" || !p.assetId) return false;
    if (inst._importedSolid) return false;
    const hasRecipe =
      (Array.isArray(inst._sourceParts) && inst._sourceParts.length > 0) || inst._original != null;
    if (hasRecipe) return false;
    if (typeof inst.isDestroyed === "function" && inst.isDestroyed()) return false;
    return true;
  }

  function prune() {
    for (const inst of Array.from(pending)) {
      if (!stillPending(inst)) pending.delete(inst);
    }
  }

  function nextDelayMs() {
    return delays[Math.min(attempt, delays.length - 1)];
  }

  function arm() {
    if (timer != null || running) return;
    prune();
    if (pending.size === 0) {
      attempt = 0;                                                  
      return;
    }
    timer = setTimerImpl(() => {
      timer = null;
      return fire();
    }, nextDelayMs());
  }

  async function fire() {
    if (running) return;
    running = true;
    try {
      prune();
      if (pending.size > 0 && runHydration) {
        attempt += 1;
        await runHydration(Array.from(pending), attempt);
      }
    } catch (_) {

    } finally {
      running = false;
      arm();
    }
  }

  return {
    add(insts) {
      const list = Array.isArray(insts) ? insts : [insts];
      for (const inst of list) if (stillPending(inst)) pending.add(inst);
      arm();
    },


    kickNow() {
      if (timer != null) {
        clearTimerImpl(timer);
        timer = null;
      }
      attempt = 0;
      return fire();
    },
    size() {
      prune();
      return pending.size;
    },
    nextDelayMs,
    get isArmed() {
      return timer != null;
    },
  };
}

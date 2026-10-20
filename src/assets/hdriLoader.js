import { hdriKindForExt } from "../lighting/hdriCore.js";
import { decodeHdriJob } from "./hdriDecodeJob.js";


export function dataUriToBytes(uri) {
  const s = String(uri || "");
  const comma = s.indexOf(",");
  if (s.indexOf("data:") !== 0 || comma < 0) throw new Error("hdri: data URI invalida");
  const meta = s.slice(5, comma).toLowerCase();
  const body = s.slice(comma + 1);
  if (meta.indexOf("base64") >= 0) {
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const text = decodeURIComponent(body);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

let workerRef = null;
let workerBroken = false;
let jobSeq = 0;
const jobs = new Map();


function createHdriDecodeWorker() {
  return new Worker(new URL("./hdriDecodeWorker.js", import.meta.url), { type: "module" });
}

function getWorker() {
  if (workerRef || workerBroken) return workerRef;
  try {
    if (typeof Worker === "undefined" || typeof URL === "undefined") {
      workerBroken = true;
      return null;
    }
    workerRef = createHdriDecodeWorker();
    workerRef.onmessage = function (ev) {
      const m = ev.data || {};
      const job = jobs.get(m.id);
      if (!job) return;
      jobs.delete(m.id);
      if (m.ok) job.resolve({ width: m.width, height: m.height, half: new Uint16Array(m.half), stats: m.stats });
      else job.reject(new Error(m.error || "hdri worker: falha desconhecida"));
    };
    workerRef.onerror = function () {


      const pending = Array.from(jobs.values());
      jobs.clear();
      disposeHdriWorker();
      workerBroken = true;
      for (const j of pending) j.reject(new Error("hdri worker indisponivel"));
    };
  } catch (_e) {
    workerBroken = true;
    workerRef = null;
  }
  return workerRef;
}

export function disposeHdriWorker() {
  if (workerRef) {
    try { workerRef.terminate(); } catch (_e) {                }
    workerRef = null;
  }
  const pending = Array.from(jobs.values());
  jobs.clear();
  for (const j of pending) j.reject(new Error("hdri: loader descartado"));
}


export async function loadHdriEquirect(args) {
  const dataUri = args.dataUri;
  const kind = hdriKindForExt(args.ext);
  if (!kind) throw new Error("hdri: extensao nao suportada: " + String(args.ext));


  let maxSize = Number(args.maxSize);
  if (!Number.isFinite(maxSize)) maxSize = 2048;
  const intensity = args.intensity;
  const t0 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  let result = null;
  const w = getWorker();
  if (w) {
    const bytes = dataUriToBytes(dataUri);
    try {
      result = await new Promise(function (resolve, reject) {
        const id = ++jobSeq;
        jobs.set(id, { resolve: resolve, reject: reject });
        try {
          w.postMessage({ id: id, buffer: bytes.buffer, kind: kind, maxSize: maxSize, intensity: intensity }, [bytes.buffer]);
        } catch (e) {
          jobs.delete(id);
          reject(new Error("hdri worker indisponivel (postMessage): " + ((e && e.message) || e)));
        }
      });
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/^(hdr|exr|hdri):/.test(msg)) throw e;                        
      result = null;                                                      
    }
  }
  if (!result) {

    result = await decodeHdriJob(dataUriToBytes(dataUri), kind, maxSize, intensity);
  }
  const t1 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  return { width: result.width, height: result.height, half: result.half, stats: result.stats, ms: Math.round(t1 - t0) };
}

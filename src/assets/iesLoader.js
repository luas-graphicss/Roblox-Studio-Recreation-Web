import { parseIesText, iesProfileToCell } from "../lighting/iesCookieCore.js";

let worker = null;                                             
let seq = 0;
const pending = new Map();


function createIesDecodeWorker() {
  return new Worker(new URL("./iesDecodeWorker.js", import.meta.url), { type: "module" });
}

function ensureWorker() {
  if (worker !== null) return worker;
  if (typeof Worker === "undefined" || typeof URL === "undefined") {
    worker = false;
    return worker;
  }
  try {
    worker = createIesDecodeWorker();
    worker.onmessage = (ev) => {
      const d = ev.data || {};
      const cb = pending.get(d.id);
      if (!cb) return;
      pending.delete(d.id);
      cb(d);
    };
    worker.onerror = () => {


      for (const [, cb] of pending) cb({ ok: false, error: "worker do .ies falhou" });
      pending.clear();
      worker = false;
    };
  } catch (_e) {
    worker = false;
  }
  return worker;
}

function parseMainThread(text, t0) {
  try {
    const p = parseIesText(text);
    if (!p.ok) return { ok: false, error: p.error, ms: Date.now() - t0, path: "main" };
    return {
      ok: true,
      cell: iesProfileToCell(p),
      meta: { nV: p.nV, nH: p.nH, maxCandela: p.maxCandela, photometricType: p.photometricType },
      ms: Date.now() - t0,
      path: "main",
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), ms: Date.now() - t0, path: "main" };
  }
}


export function loadIesProfile(opts) {
  const text = opts && typeof opts.text === "string" ? opts.text : "";
  const timeoutMs = opts && Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 4000;
  const t0 = Date.now();
  const w = ensureWorker();
  if (!w) return Promise.resolve(parseMainThread(text, t0));
  return new Promise((resolve) => {
    const id = ++seq;
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      pending.delete(id);
      resolve(parseMainThread(text, t0));                                     
    }, timeoutMs);
    pending.set(id, (d) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!d.ok) {
        resolve({ ok: false, error: d.error || "parse .ies falhou", ms: Date.now() - t0, path: "worker" });
        return;
      }
      resolve({ ok: true, cell: new Uint8Array(d.cell), meta: d.meta, ms: Date.now() - t0, path: "worker" });
    });
    try {
      w.postMessage({ id, text });
    } catch (_e) {
      if (!done) {
        done = true;
        clearTimeout(timer);
        pending.delete(id);
        resolve(parseMainThread(text, t0));
      }
    }
  });
}


export function decodeIesDataUri(dataUri) {
  const s = typeof dataUri === "string" ? dataUri : "";
  const comma = s.indexOf(",");
  if (comma === -1) return "";
  const head = s.slice(0, comma).toLowerCase();
  const body = s.slice(comma + 1);
  try {
    if (head.indexOf(";base64") !== -1) {
      if (typeof atob === "function") return atob(body);
      if (typeof Buffer !== "undefined") return Buffer.from(body, "base64").toString("latin1");
      return "";
    }
    return decodeURIComponent(body);
  } catch (_e) {
    return "";
  }
}


export function cookieCellFromDataUri(dataUri) {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined" || typeof Image === "undefined") {
      reject(new Error("sem DOM para decodificar o cookie"));
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 128;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          reject(new Error("canvas 2d indisponível"));
          return;
        }
        ctx.drawImage(img, 0, 0, 128, 128);
        const data = ctx.getImageData(0, 0, 128, 128).data;
        const cell = new Uint8Array(128 * 128);
        for (let i = 0; i < cell.length; i++) {
          const o = i * 4;
          cell[i] = Math.round(0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) & 255;
        }
        resolve(cell);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("imagem do cookie não decodifica"));
    img.src = dataUri;
  });
}

export const ENVCAP_FACES = 6;
export const ENVCAP_SIZE = 64;


export const ENVCAP_SIZE_LITE = 32;

function fin(v, d) {
  return Number.isFinite(v) ? v : d;
}

function clamp01(v) {
  const n = fin(Number(v), 0);
  return n < 0 ? 0 : n > 1 ? 1 : n;
}


export function envCapturePlan(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const smLite = o.smLite === true;
  const wanted = o.forced === true ? true : o.forced === false ? false : o.realistic === true;
  const weakVeto = o.weak === true && !smLite;
  const on = o.pmremOk === true && !weakVeto && wanted;
  return { on, size: smLite ? ENVCAP_SIZE_LITE : ENVCAP_SIZE, faces: ENVCAP_FACES, lite: smLite };
}


export function envCaptureSignature(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const q = (v, s) => Math.round(clamp01(v) * s);
  const qd = (v) => Math.round(fin(Number(v), 0) * 57);
  return [
    String(o.skySig || ""),
    qd(o.sunX),
    qd(o.sunY),
    qd(o.sunZ),
    q(o.physBlend, 32),
    fin(Number(o.cloudsOn), 0) > 0.5 ? 1 : 0,
    q(o.cloudCover, 16),
    q(o.nightSky, 8),
    q(o.stars, 8),
  ].join("|");
}


export function pickEnvCapAction(st) {
  const s = st && typeof st === "object" ? st : {};
  if (s.on !== true) return "off";
  if (s.dirty !== true) return "wait";
  if (s.idle !== true) return "wait";
  return fin(Number(s.facesDone), 0) < ENVCAP_FACES - 1 ? "face" : "finish";
}


export function envCapWorstCaseFrames(idleFrames) {
  return Math.max(0, fin(Number(idleFrames), 0)) + ENVCAP_FACES;
}


export function sanitizeEnvScale(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

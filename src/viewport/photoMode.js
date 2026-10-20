import { createPhotoModeController, PHOTO_TAPS, PHOTO_BLOCKERS, PHOTO_IDLE_MS } from "../lighting/photoModeCore.js";

const POSE_EPS_POS = 0.02;
const POSE_EPS_QUAT = 0.001;

export function createPhotoMode(args) {
  const a = args || {};
  const requestRender = typeof a.requestRender === "function" ? a.requestRender : null;
  const ctl = createPhotoModeController(a);


  const probeMsRaw = Number(a.idleMs);
  const probeDelayMs = Number.isFinite(probeMsRaw) && probeMsRaw >= 0 ? probeMsRaw : PHOTO_IDLE_MS;
  let px = NaN, py = NaN, pz = NaN;
  let qx = NaN, qy = NaN, qz = NaN, qw = NaN;
  let last = null;
  let probeTimer = null;                                                         
  let probesFired = 0;                                                   


  function poseMoved(camera) {
    if (!camera || !camera.position || !camera.quaternion) return true;
    const p = camera.position;
    const q = camera.quaternion;
    const still =
      Math.abs(p.x - px) <= POSE_EPS_POS &&
      Math.abs(p.y - py) <= POSE_EPS_POS &&
      Math.abs(p.z - pz) <= POSE_EPS_POS &&
      Math.abs(q.x - qx) <= POSE_EPS_QUAT &&
      Math.abs(q.y - qy) <= POSE_EPS_QUAT &&
      Math.abs(q.z - qz) <= POSE_EPS_QUAT &&
      Math.abs(q.w - qw) <= POSE_EPS_QUAT;
    if (!still) {


      px = p.x; py = p.y; pz = p.z;
      qx = q.x; qy = q.y; qz = q.z; qw = q.w;
    }
    return !still;
  }


  function disarmProbe() {
    if (probeTimer !== null) {
      clearTimeout(probeTimer);
      probeTimer = null;
    }
  }
  function armProbe() {
    if (!requestRender || typeof setTimeout !== "function") return;
    disarmProbe();
    probeTimer = setTimeout(() => {
      probeTimer = null;
      probesFired += 1;
      requestRender();
    }, probeDelayMs);
  }


  function frame(f) {
    const i = f || {};
    const moving = !!i.busy || poseMoved(i.camera);
    last = ctl.update({
      nowMs: i.nowMs,
      enabled: !!i.enabled,
      moving,
      baseScale: i.baseScale,
    });


    if (last.enabled && moving) armProbe();
    else disarmProbe();


    if ((last.wantsFrame || last.reverted) && requestRender) requestRender();
    return last;
  }


  function scaleFor(classicScale, effectiveScale) {
    const classic = Number.isFinite(classicScale) && classicScale > 0 ? classicScale : 1;
    if (!last || !last.enabled) return classic;
    const eff = Number.isFinite(effectiveScale) && effectiveScale > 0 ? effectiveScale : classic;
    const s = Number.isFinite(last.scale) && last.scale > 0 ? last.scale : eff;
    return Math.min(1, Math.max(eff, s));
  }


  function tapsBoost() {
    return !!(last && last.enabled && last.fullTaps);
  }

  function snapshot() {
    if (!last) return null;
    const s = ctl.snapshot();
    s.taps = PHOTO_TAPS;
    s.blockers = PHOTO_BLOCKERS;

    s.probeArmed = probeTimer !== null;
    s.probes = probesFired;
    return s;
  }

  function reset() {
    ctl.reset();
    disarmProbe();                                         
    probesFired = 0;
    px = py = pz = qx = qy = qz = qw = NaN;
    last = null;
  }

  return { frame, scaleFor, tapsBoost, snapshot, reset };
}

import { sanitizeQuat, quatSlerp, quatLookRotation } from "./cframeMath.js";

export const CAM_INTERP_VERSION = "camera-interp-1";

export const CAM_INTERP_LIMITS = { minDuration: 0.05, maxDuration: 10 };


export function easeSmoothstep(q) {
  const x = Number(q);
  if (!Number.isFinite(x)) return 0;
  return x * x * (3 - 2 * x);
}


function finiteOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function posOf(pose) {
  const src = pose && typeof pose === "object" ? pose : {};
  return { x: finiteOr(src.x, 0), y: finiteOr(src.y, 0), z: finiteOr(src.z, 0) };
}


function quatOf(pose) {
  const src = pose && typeof pose === "object" ? pose : {};
  return sanitizeQuat({ x: src.qx, y: src.qy, z: src.qz, w: src.qw });
}


function isIdentityQuat(q) {
  return Math.abs(q.x) < 1e-12 && Math.abs(q.y) < 1e-12 &&
    Math.abs(q.z) < 1e-12 && Math.abs(Math.abs(q.w) - 1) < 1e-12;
}


function effectiveCfQuat(pose, pos, focusPos) {
  const q = quatOf(pose);
  if (!isIdentityQuat(q)) return q;
  return quatLookRotation({
    x: focusPos.x - pos.x,
    y: focusPos.y - pos.y,
    z: focusPos.z - pos.z,
  }, null);
}

function clampDuration(duration) {
  const d = Number(duration);
  if (!Number.isFinite(d)) return CAM_INTERP_LIMITS.minDuration;
  return Math.min(CAM_INTERP_LIMITS.maxDuration,
    Math.max(CAM_INTERP_LIMITS.minDuration, d));
}

let _nextInterpId = 1;


export function createInterpolation(args) {
  const { fromCF, fromFocus, toCF, toFocus, duration, easing } =
    args && typeof args === "object" ? args : {};

  const fromPos = posOf(fromCF);
  const fromFocusPos = posOf(fromFocus);
  const toPos = posOf(toCF);
  const toFocusPos = posOf(toFocus);

  const fromQuat = effectiveCfQuat(fromCF, fromPos, fromFocusPos);
  const toQuat = effectiveCfQuat(toCF, toPos, toFocusPos);
  const fromFocusQuat = quatOf(fromFocus);
  const toFocusQuat = quatOf(toFocus);

  const dur = clampDuration(duration);
  const ease = typeof easing === "function" ? easing : easeSmoothstep;

  const pose = (p, q) => ({ x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w });
  const startSample = () => ({
    cf: pose(fromPos, fromQuat),
    focus: pose(fromFocusPos, fromFocusQuat),
    alpha: 0,
    done: false,
    cancelled: false,
  });
  const endSample = () => ({
    cf: pose(toPos, toQuat),
    focus: pose(toFocusPos, toFocusQuat),
    alpha: 1,
    done: true,
    cancelled: false,
  });


  let last = startSample();

  const handle = {
    id: _nextInterpId++,
    duration: dur,
    cancelled: false,
    cancel() {
      handle.cancelled = true;
    },
    sampleAt(t) {
      if (handle.cancelled) {
        return {
          cf: { ...last.cf },
          focus: { ...last.focus },
          alpha: last.alpha,
          done: last.done,
          cancelled: true,
        };
      }
      let tt = Number(t);
      if (Number.isNaN(tt)) tt = 0;

      const clampedT = Math.min(dur, Math.max(0, tt));
      let out;
      if (clampedT >= dur) {
        out = endSample();                                              
      } else if (clampedT === 0) {
        out = startSample();                        
      } else {
        const q = clampedT / dur;
        const k = finiteOr(ease(q), q);

        const lerp = (a, b) => a + (b - a) * k;
        const cfQ = quatSlerp(fromQuat, toQuat, k);
        const foQ = quatSlerp(fromFocusQuat, toFocusQuat, k);
        out = {
          cf: {
            x: lerp(fromPos.x, toPos.x),
            y: lerp(fromPos.y, toPos.y),
            z: lerp(fromPos.z, toPos.z),
            qx: cfQ.x, qy: cfQ.y, qz: cfQ.z, qw: cfQ.w,
          },
          focus: {
            x: lerp(fromFocusPos.x, toFocusPos.x),
            y: lerp(fromFocusPos.y, toFocusPos.y),
            z: lerp(fromFocusPos.z, toFocusPos.z),
            qx: foQ.x, qy: foQ.y, qz: foQ.z, qw: foQ.w,
          },
          alpha: k,
          done: false,
          cancelled: false,
        };
      }
      last = out;
      return {
        cf: { ...out.cf },
        focus: { ...out.focus },
        alpha: out.alpha,
        done: out.done,
        cancelled: out.cancelled,
      };
    },
  };

  return handle;
}

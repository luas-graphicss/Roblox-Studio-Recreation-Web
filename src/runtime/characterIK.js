import { raycastWorkspace } from "../physics/raycast.js";
import {
  clampWeight,
  clampSmoothTime,
  clampPriority,
  smoothFactor,
  IK_MAX_CONTROLS,
} from "../animation/ikSolver.js";

const DEG2RAD = Math.PI / 180;
const HEAD_YAW_LIMIT = 80 * DEG2RAD;
const HEAD_PITCH_LIMIT = 60 * DEG2RAD;
const HEAD_CONE_MARGIN = 15 * DEG2RAD;
const TORSO_FOLLOW = 0.25;
const FOOT_SMOOTH = 0.12;
const ANKLE_LIMIT = 0.5;
const LIMB_PITCH_LIMIT = 2.7;
const RAY_CACHE_EPS = 0.05;
const RAY_CACHE_MS = 150;                                                           
const SCAN_MS = 250;

function live(inst) {
  return !!(
    inst &&
    inst.__isInstance === true &&
    !(typeof inst.isDestroyed === "function" && inst.isDestroyed())
  );
}

function getVec(inst, prop) {
  let v = null;
  try {
    v = inst.getProperty(prop);
  } catch (_) {
    v = null;
  }
  v = v || {};
  return { x: Number(v.x) || 0, y: Number(v.y) || 0, z: Number(v.z) || 0 };
}

function targetWorldPos(t) {
  if (!live(t)) return null;
  if (t.hasProperty && t.hasProperty("Anchored")) return getVec(t, "Position");
  if (t.hasProperty && t.hasProperty("Position")) {
    const p = t.getParent ? t.getParent() : null;
    const base = p && p.hasProperty && p.hasProperty("Position") ? getVec(p, "Position") : { x: 0, y: 0, z: 0 };
    const off = getVec(t, "Position");
    return { x: base.x + off.x, y: base.y + off.y, z: base.z + off.z };
  }
  return null;
}

function normAngle(a) {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

function approx(v) {
  return Math.round(v * 100) / 100;
}

export function createCharacterIK() {
  const sm = {
    footL: 0,
    footR: 0,
    ankleL: 0,
    ankleR: 0,
    root: 0,
    headYaw: 0,
    headPitch: 0,
    limbs: new Map(),                            
  };
  const rayCache = { L: null, R: null };
  let scanAt = 0;
  let scanned = [];

  function scanControls(hum) {
    const now = Date.now();
    if (now - scanAt < SCAN_MS) return scanned;
    scanAt = now;
    const list = [];
    if (live(hum) && typeof hum.getChildren === "function") {
      for (const ch of hum.getChildren()) {
        if (ch.className === "IKControl") list.push(ch);
        else if (ch.className === "Animator" && typeof ch.getChildren === "function") {
          for (const sub of ch.getChildren()) if (sub.className === "IKControl") list.push(sub);
        }
      }
    }

    list.sort((a, b) => clampPriority(a.getProperty("Priority")) - clampPriority(b.getProperty("Priority")));

    if (list.length > IK_MAX_CONTROLS) list.splice(0, list.length - IK_MAX_CONTROLS);
    scanned = list;
    return list;
  }

  function footWorldXZ(cp, rootPos, yaw) {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    return {
      x: rootPos.x + cp.off.x * cy + cp.off.z * sy,
      z: rootPos.z - cp.off.x * sy + cp.off.z * cy,
    };
  }

  function castFoot(side, ws, character, cp, rootPos, yaw, maxOff) {
    const xz = footWorldXZ(cp, rootPos, yaw);
    const now = Date.now();
    const cached = rayCache[side];

    if (cached && now - cached.t < RAY_CACHE_MS && Math.abs(cached.x - xz.x) < RAY_CACHE_EPS && Math.abs(cached.z - xz.z) < RAY_CACHE_EPS) {
      return cached.hit;
    }
    const topY = rootPos.y + cp.off.y + cp.size.y / 2 + maxOff;
    const reach = cp.size.y + maxOff * 2 + 1;
    let hit = null;
    try {
      hit = raycastWorkspace(
        ws,
        { x: xz.x, y: topY, z: xz.z },
        { x: 0, y: -reach, z: 0 },
        { filterType: "Exclude", filterList: character ? [character] : [] },
      );
    } catch (_) {
      hit = null;
    }
    rayCache[side] = { x: xz.x, z: xz.z, hit, t: now };
    return hit;
  }

  function ease(cur, goal, st, dt) {
    return cur + (goal - cur) * smoothFactor(st, dt);
  }


  function update(ctx) {
    const dt = Number.isFinite(ctx.dt) && ctx.dt > 0 ? ctx.dt : 1 / 60;
    const hum = ctx.hum;
    const planted = !ctx.deathQ &&
      live(hum) &&
      hum.getProperty("AutoFootPlanting") !== false &&
      ctx.grounded &&
      (ctx.state === "Running" || ctx.state === "RunningNoPhysics");

    let maxOff = Number(live(hum) ? hum.getProperty("FootPlantingMaxOffset") : 1.5);
    if (!Number.isFinite(maxOff)) maxOff = 1.5;
    maxOff = Math.min(Math.max(maxOff, 0), 10);

    let goalL = 0;
    let goalR = 0;
    let goalAnkleL = 0;
    let goalAnkleR = 0;
    if (planted && ctx.ws && maxOff > 0) {
      const cy = Math.cos(ctx.yaw);
      const sy = Math.sin(ctx.yaw);
      for (const side of ["L", "R"]) {
        const cp = ctx.feet ? ctx.feet[side] : null;
        if (!cp) continue;
        const hit = castFoot(side, ctx.ws, ctx.character, cp, ctx.rootPos, ctx.yaw, maxOff);
        if (!hit || !hit.position) continue;
        const expectedBottom = ctx.rootPos.y + cp.off.y - cp.size.y / 2;
        let drop = hit.position.y - expectedBottom;
        if (Math.abs(drop) > maxOff) drop = 0;
        if (side === "L") goalL = drop;
        else goalR = drop;
        if (hit.normal) {
          const nzLocal = hit.normal.x * sy + hit.normal.z * cy;
          const ankle = Math.max(-ANKLE_LIMIT, Math.min(ANKLE_LIMIT, Math.atan2(-nzLocal, Math.max(hit.normal.y, 0.05))));
          if (side === "L") goalAnkleL = ankle;
          else goalAnkleR = ankle;
        }
      }
    } else {
      rayCache.L = null;
      rayCache.R = null;
    }

    sm.footL = ease(sm.footL, goalL, FOOT_SMOOTH, dt);
    sm.footR = ease(sm.footR, goalR, FOOT_SMOOTH, dt);
    sm.ankleL = ease(sm.ankleL, goalAnkleL, FOOT_SMOOTH, dt);
    sm.ankleR = ease(sm.ankleR, goalAnkleR, FOOT_SMOOTH, dt);

    const rootGoal = Math.min(0, goalL, goalR) * 0.6;
    sm.root = ease(sm.root, rootGoal, FOOT_SMOOTH, dt);


    let headYawGoal = 0;
    let headPitchGoal = 0;
    let headSt = 0.15;
    let headWeight = 0;
    const limbGoals = new Map();                              
    if (!ctx.deathQ && live(hum)) {
      const controls = scanControls(hum);
      const cy = Math.cos(ctx.yaw);
      const sy = Math.sin(ctx.yaw);
      for (const ctl of controls) {
        if (!live(ctl) || ctl.getProperty("Enabled") === false) continue;
        const weight = clampWeight(ctl.getProperty("Weight"));
        if (weight <= 0) continue;
        const tp = targetWorldPos(ctl.getProperty("Target"));
        if (!tp) continue;                                    
        const off = getVec(ctl, "Offset");
        const tx = tp.x + off.x;
        const ty = tp.y + off.y;
        const tz = tp.z + off.z;
        const eff = ctl.getProperty("EndEffector");
        if (!live(eff)) continue;
        const st = clampSmoothTime(ctl.getProperty("SmoothTime"));
        const typeName = String(ctl.getProperty("Type") || "Transform");
        let effName = "";
        try {
          effName = String(eff.getProperty("Name") || "");
        } catch (_) {
          effName = "";
        }

        if (typeName === "LookAt" && /head/i.test(effName)) {
          const hd = ctx.headCp;
          const hx = ctx.rootPos.x + (hd ? hd.off.x * cy + hd.off.z * sy : 0);
          const hy = ctx.rootPos.y + (hd ? hd.off.y : 1.5);
          const hz = ctx.rootPos.z + (hd ? -hd.off.x * sy + hd.off.z * cy : 0);
          const dx = tx - hx;
          const dy = ty - hy;
          const dz = tz - hz;
          let dyaw = normAngle(Math.atan2(dx, dz) - ctx.yaw);
          let dpitch = Math.atan2(dy, Math.max(Math.hypot(dx, dz), 1e-6));
          if (Math.abs(dyaw) > HEAD_YAW_LIMIT + HEAD_CONE_MARGIN || Math.abs(dpitch) > HEAD_PITCH_LIMIT + HEAD_CONE_MARGIN) {
            dyaw = 0;                                                
            dpitch = 0;
          } else {
            dyaw = Math.max(-HEAD_YAW_LIMIT, Math.min(HEAD_YAW_LIMIT, dyaw));
            dpitch = Math.max(-HEAD_PITCH_LIMIT, Math.min(HEAD_PITCH_LIMIT, dpitch));
          }
          headYawGoal = dyaw * weight;
          headPitchGoal = dpitch * weight;
          headSt = Math.max(st, 0.08);
          headWeight = weight;
          continue;
        }

        if ((typeName === "Transform" || typeName === "Position") && ctx.characterParts) {
          const cp = ctx.characterParts.find((c) => c.inst === eff && c.limb);
          if (!cp) continue;
          const chan = cp.limb.kind + ":" + cp.limb.side;
          const px = ctx.rootPos.x + cp.off.x * cy + cp.off.z * sy;
          const py = ctx.rootPos.y + (cp.pivotY != null ? cp.pivotY : cp.off.y + cp.size.y / 2);
          const pz = ctx.rootPos.z - cp.off.x * sy + cp.off.z * cy;
          const wx = tx - px;
          const wy = ty - py;
          const wz = tz - pz;
          const ly = wy;
          const lz = wx * sy + wz * cy;
          let pitchGoal = Math.atan2(-lz, -ly);
          pitchGoal = Math.max(-LIMB_PITCH_LIMIT, Math.min(LIMB_PITCH_LIMIT, pitchGoal));
          const key = chan;
          const prev = sm.limbs.has(key) ? sm.limbs.get(key) : pitchGoal;
          const eased = ease(prev, pitchGoal, st, dt);
          sm.limbs.set(key, eased);
          limbGoals.set(key, { pitch: eased, weight });
        }
      }
    }

    sm.headYaw = ease(sm.headYaw, headYawGoal, headSt, dt);
    sm.headPitch = ease(sm.headPitch, headPitchGoal, headSt, dt);
    for (const key of [...sm.limbs.keys()]) {
      if (!limbGoals.has(key)) {
        const decayed = ease(sm.limbs.get(key), 0, 0.1, dt);
        if (Math.abs(decayed) < 0.01) sm.limbs.delete(key);
        else sm.limbs.set(key, decayed);
      }
    }

    const idle =
      Math.abs(sm.footL) < 0.005 &&
      Math.abs(sm.footR) < 0.005 &&
      Math.abs(sm.root) < 0.005 &&
      Math.abs(sm.ankleL) < 0.005 &&
      Math.abs(sm.ankleR) < 0.005 &&
      Math.abs(sm.headYaw) < 0.005 &&
      Math.abs(sm.headPitch) < 0.005 &&
      limbGoals.size === 0;
    if (idle) return null;

    const out = {
      footDropL: sm.footL,
      footDropR: sm.footR,
      anklePitchL: sm.ankleL,
      anklePitchR: sm.ankleR,
      rootDrop: sm.root,
      head: headWeight > 0 || Math.abs(sm.headYaw) > 0.005 || Math.abs(sm.headPitch) > 0.005
        ? { yawRad: sm.headYaw, pitchRad: sm.headPitch }
        : null,
      limbs: limbGoals,
      key: [
        approx(sm.footL),
        approx(sm.footR),
        approx(sm.root),
        approx(sm.ankleL),
        approx(sm.ankleR),
        approx(sm.headYaw),
        approx(sm.headPitch),
        [...limbGoals.entries()].map(([k, v]) => k + approx(v.pitch) + "w" + approx(v.weight)).join(","),
      ].join("|"),
    };
    return out;
  }

  function reset() {
    sm.footL = 0;
    sm.footR = 0;
    sm.ankleL = 0;
    sm.ankleR = 0;
    sm.root = 0;
    sm.headYaw = 0;
    sm.headPitch = 0;
    sm.limbs.clear();
    rayCache.L = null;
    rayCache.R = null;
    scanAt = 0;
    scanned = [];
  }

  return { update, reset };
}

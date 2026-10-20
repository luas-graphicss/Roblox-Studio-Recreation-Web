import { spherecast, meshPartHasLooseCollision } from "../physics/raycast.js";

const PITCH_MIN = -1.35;
const PITCH_MAX = 1.45;
const LOOK_SENS = 0.0065;                 
const ZOOM_STEP = 1.18;                                
const FP_THRESHOLD = 1.0;                                             
const FP_EXIT_DIST = 4;                                  
const CAMERA_RAY_MAX = 500;                                             
const CAMERA_PAD = 0.4;                                    
const DEFAULT_DIST = 12;
const DEFAULT_PITCH = 0.38;

export function createPlayerCamera() {
  let yaw = 0;
  let pitch = DEFAULT_PITCH;                                              
  let dist = DEFAULT_DIST;
  let targetDist = DEFAULT_DIST;
  let firstPerson = false;
  let orbiting = false;
  let init = false;

  let shiftLock = false;
  let sens = 1;

  let noFirstPerson = false;


  let nearClip = false;


  const pose = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 };
  const focus = { x: 0, y: 0, z: 0 };
  const camPos = { x: 0, y: 0, z: 0 };
  const rayOrigin = { x: 0, y: 0, z: 0 };
  const rayDir = { x: 0, y: 0, z: 0 };


  const rayParams = { filterType: "Exclude", filterList: [], skipInstance: meshPartHasLooseCollision };

  function clampZoom(min, max) {
    const lo = Math.max(0.5, Number(min) || 0.5);
    const hi = Math.max(lo, Number(max) || 128);
    if (!Number.isFinite(targetDist)) targetDist = DEFAULT_DIST;
    targetDist = Math.min(hi, Math.max(lo, targetDist));
    return lo;
  }

  return {
    reset(bodyYaw) {
      yaw = Number(bodyYaw) || 0;
      pitch = DEFAULT_PITCH;
      dist = targetDist = DEFAULT_DIST;
      firstPerson = false;
      orbiting = false;
      shiftLock = false;
      nearClip = false;
      init = false;
    },

    getYaw: () => yaw,
    isFirstPerson: () => firstPerson,
    isNearClip: () => nearClip,
    isOrbiting: () => orbiting,
    setOrbiting(b) { orbiting = !!b; },

    setFirstPerson(b) {
      if (b && !firstPerson) { firstPerson = true; }
      else if (!b && firstPerson) { firstPerson = false; targetDist = Math.max(targetDist, FP_EXIT_DIST); }
    },


    look(dx, dy) {
      if (!orbiting && !firstPerson && !shiftLock) return false;
      yaw -= (Number(dx) || 0) * LOOK_SENS * sens;
      pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch + (Number(dy) || 0) * LOOK_SENS * sens));
      return true;
    },


    setShiftLock(b) { shiftLock = !!b; },
    isShiftLocked: () => shiftLock,
    setSensitivity(v) {
      const n = Number(v);
      sens = Number.isFinite(n) ? Math.min(3, Math.max(0.2, n)) : 1;
    },


    setNoFirstPerson(b) {
      noFirstPerson = !!b;
      if (noFirstPerson && firstPerson) {
        firstPerson = false;
        targetDist = Math.max(targetDist, FP_EXIT_DIST);
      }
    },


    followYaw(targetYaw, dt) {
      if (orbiting || firstPerson || shiftLock) return;
      let d = (Number(targetYaw) || 0) - yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      yaw += d * Math.min(1, (Number(dt) || 0) * 2.5);
    },


    zoom(stepsIn, min, max, lockFirstPerson) {
      if (lockFirstPerson) return;                                                 
      if (stepsIn > 0) targetDist /= ZOOM_STEP;
      else if (stepsIn < 0) targetDist *= ZOOM_STEP;
      const lo = clampZoom(min, max);
      if (stepsIn > 0 && !noFirstPerson && targetDist <= Math.max(lo, FP_THRESHOLD) + 1e-6) {
        firstPerson = true;
      } else if (stepsIn < 0 && firstPerson) {
        firstPerson = false;
        targetDist = Math.max(targetDist, Math.min(FP_EXIT_DIST, Math.max(0.5, Number(max) || 128)));
      }
    },


    update(dt, info) {
      if (info.lockFirstPerson) firstPerson = true;
      if (noFirstPerson) firstPerson = false;                     
      clampZoom(info.minZoom, info.maxZoom);


      if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
      const rootX = Number(info.rootX);
      const rootY = Number(info.rootY);
      const rootZ = Number(info.rootZ);
      if (!Number.isFinite(rootX + rootY + rootZ)) return pose;

      if (!Number.isFinite(focus.x + focus.y + focus.z + camPos.x + camPos.y + camPos.z + dist + targetDist + yaw + pitch)) {
        if (!Number.isFinite(yaw)) yaw = 0;
        if (!Number.isFinite(pitch)) pitch = DEFAULT_PITCH;
        if (!Number.isFinite(targetDist)) targetDist = DEFAULT_DIST;
        if (!Number.isFinite(dist)) dist = targetDist;
        focus.x = rootX; focus.y = rootY + 1.5; focus.z = rootZ;
        camPos.x = rootX; camPos.y = rootY + 1.5; camPos.z = rootZ;
        init = false;
      }


      const kf = init ? 1 - Math.exp(-dt * 18) : 1;
      focus.x += (rootX - focus.x) * kf;
      focus.y += (rootY + 1.5 - focus.y) * kf;
      focus.z += (rootZ + 0 - focus.z) * kf;

      if (firstPerson) {
        const ey = rootY + 1.4;
        const cp = Math.cos(pitch);
        pose.px = rootX; pose.py = ey; pose.pz = rootZ;
        pose.tx = rootX + Math.sin(yaw) * cp * 10;
        pose.ty = ey - Math.sin(pitch) * 10;
        pose.tz = rootZ + Math.cos(yaw) * cp * 10;
        dist = Math.max(0.5, Number(info.minZoom) || 0.5);
        camPos.x = pose.px; camPos.y = pose.py; camPos.z = pose.pz;
        nearClip = false;
        init = true;
        return pose;
      }

      dist += (targetDist - dist) * (init ? 1 - Math.exp(-dt * 10) : 1);


      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      rayDir.x = -Math.sin(yaw) * cp;
      rayDir.y = sp;
      rayDir.z = -Math.cos(yaw) * cp;

      let d = dist;
      if (info.occlude !== false && info.ws) {

        const len = Math.min(d, CAMERA_RAY_MAX);
        rayOrigin.x = focus.x; rayOrigin.y = focus.y; rayOrigin.z = focus.z;
        rayDir.x *= len; rayDir.y *= len; rayDir.z *= len;
        rayParams.filterList.length = 0;
        if (info.character) rayParams.filterList.push(info.character);
        let hit = null;


        try { hit = spherecast(info.ws, rayOrigin, 0.35, rayDir, rayParams); } catch (_) { hit = null; }


        if (hit && Number.isFinite(hit.distance) && hit.distance > 0.05 && hit.distance < d) d = Math.max(0.5, hit.distance - CAMERA_PAD);

        rayDir.x /= len; rayDir.y /= len; rayDir.z /= len;
      }

      const px = focus.x + rayDir.x * d;
      const py = focus.y + rayDir.y * d;
      const pz = focus.z + rayDir.z * d;
      const kc = init ? 1 - Math.exp(-dt * 20) : 1;
      camPos.x += (px - camPos.x) * kc;
      camPos.y += (py - camPos.y) * kc;
      camPos.z += (pz - camPos.z) * kc;


      nearClip = Math.hypot(camPos.x - focus.x, camPos.y - focus.y, camPos.z - focus.z) < 1.2;
      pose.px = camPos.x; pose.py = camPos.y; pose.pz = camPos.z;
      pose.tx = focus.x; pose.ty = focus.y; pose.tz = focus.z;
      init = true;
      return pose;
    },

    getPose: () => pose,
    getDistance: () => dist,


    getPitch: () => pitch,
  };
}

import { buildWaterField } from "../physics/waterPhysics.js";

export const SWIM_ENTER_SUB = 0.6;                                          
export const SWIM_EXIT_SHALLOW = 0.42;                                      
export const SWIM_EXIT_OUT = 0.08;                                 
export const SWIM_FLOAT_SUB = 0.72;                                    
export const SWIM_FLOAT_GAIN = 18;                                            
export const SWIM_FLOAT_MAX = 7;                                    
export const SWIM_ACCEL = 6;                                          
export const SWIM_ENTER_MAX_VY = 8;                                          
export const SWIM_SPLASH_DAMP = 0.35;                                      
export const SWIM_JUMP_SUB_MAX = 0.75;                                         
export const SWIM_UP_RATIO = 0.55;                                                  
export const SWIM_DRY_EXIT_TIME = 0.35;                                                                           


export function createWaterSensor() {
  return { field: null, version: -2 };
}

export function syncWaterSensor(sensor, data) {
  const v = data && Number.isFinite(data.version) ? data.version : -1;
  if (sensor.version !== v) {
    sensor.version = v;
    sensor.field = data ? buildWaterField(data) : null;
  }
  return sensor.field;
}


export function characterSubmersion(field, x, y, z, charHeight, waves) {
  if (!field || !field.hasWater) return 0;
  const h = Number.isFinite(charHeight) && charHeight > 0 ? charHeight : 6;
  const sub = field.sampleSubmersion(x, y, z, h, waves || null);
  return Number.isFinite(sub) ? sub : 0;
}


export function shouldEnterSwim(args) {
  if (!args || args.noControl) return false;
  const st = args.state;
  if (st === "Swimming" || st === "Climbing") return false;
  if (!(Number(args.sub) >= SWIM_ENTER_SUB)) return false;                    
  if (Number(args.vy) > SWIM_ENTER_MAX_VY) return false;                  
  return true;
}


export function swimExitState(args) {
  const sub = Number(args ? args.sub : NaN);
  if (!Number.isFinite(sub)) return "Freefall";                      
  if (args && args.grounded && sub < SWIM_EXIT_SHALLOW) return "Running";
  if (sub <= SWIM_EXIT_OUT) {
    const dry = Number(args ? args.dryFor : NaN);
    if (!Number.isFinite(dry) || dry >= SWIM_DRY_EXIT_TIME) return "Freefall";
  }
  return null;
}


export function canJumpOutOfWater(sub) {
  const s = Number(sub);
  return Number.isFinite(s) && s > 0 && s <= SWIM_JUMP_SUB_MAX;
}


export function swimVerticalTarget(args) {
  const a = args || {};
  const speed = Number.isFinite(a.swimSpeed) && a.swimSpeed > 0 ? a.swimSpeed : 16;
  const mf = Number(a.mf) || 0;
  const pitch = Number.isFinite(a.camPitch) ? a.camPitch : 0;
  let vyT = 0;
  let hasInput = false;
  if (mf !== 0) {
    vyT += mf * -Math.sin(pitch) * speed;
    hasInput = true;
  }
  if (a.up) {
    vyT = Math.max(vyT, speed * SWIM_UP_RATIO);
    hasInput = true;
  }
  if (!hasInput) {

    const sub = Number(a.sub);
    const err = (Number.isFinite(sub) ? sub : SWIM_FLOAT_SUB) - SWIM_FLOAT_SUB;
    vyT = Math.max(-SWIM_FLOAT_MAX, Math.min(SWIM_FLOAT_MAX, err * SWIM_FLOAT_GAIN));
  }
  return Number.isFinite(vyT) ? vyT : 0;
}


export function swimHorizontalScale(mf, ms, camPitch) {
  const f = Number(mf) || 0;
  if (f === 0) return 1;
  const c = Math.abs(Math.cos(Number.isFinite(camPitch) ? camPitch : 0));
  return (Number(ms) || 0) !== 0 ? (c + 1) / 2 : c;
}


export function stepSwimVy(vy, vyT, dt) {
  const v = Number.isFinite(vy) ? vy : 0;
  const t = Number.isFinite(vyT) ? vyT : 0;
  const d = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
  return v + (t - v) * Math.min(1, SWIM_ACCEL * d);
}

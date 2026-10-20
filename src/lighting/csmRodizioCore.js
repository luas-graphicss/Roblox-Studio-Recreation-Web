export const RODIZIO_HOT_RES_MIN = 512;                                      
export const RODIZIO_HOT_RES_MAX = 768;                                      
export const RODIZIO_BUDGET = 1;                                       
export const RODIZIO_BUDGET_BOOST = 2;                                   


export const RODIZIO_SPIN_RAD_PER_S = 0.8;
export const RODIZIO_MAX_GHOSTS = 3;                 

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}


export function rodizioEligible({ flagOn, weak, maxTextures } = {}) {
  return flagOn === true && weak === true && num(maxTextures, 0) >= 16;
}


export function hotCascadeRes(tierRes0) {
  const r = num(tierRes0, RODIZIO_HOT_RES_MAX);
  return Math.max(RODIZIO_HOT_RES_MIN, Math.min(RODIZIO_HOT_RES_MAX, Math.round(r)));
}


export function spinRadPerS({ prevX, prevY, prevZ, fwdX, fwdY, fwdZ, dtMs } = {}) {
  const dt = num(dtMs, 0);
  if (!(dt > 0) || dt > 1000) return 0;
  let ax = num(prevX, 0), ay = num(prevY, 0), az = num(prevZ, 0);
  let bx = num(fwdX, 0), by = num(fwdY, 0), bz = num(fwdZ, 0);
  const la = Math.hypot(ax, ay, az);
  const lb = Math.hypot(bx, by, bz);
  if (la < 1e-6 || lb < 1e-6) return 0;
  ax /= la; ay /= la; az /= la;
  bx /= lb; by /= lb; bz /= lb;
  let d = ax * bx + ay * by + az * bz;
  if (d > 1) d = 1;
  else if (d < -1) d = -1;
  return (Math.acos(d) * 1000) / dt;
}


export function rodizioBudget(spin) {
  return num(spin, 0) >= RODIZIO_SPIN_RAD_PER_S ? RODIZIO_BUDGET_BOOST : RODIZIO_BUDGET;
}


export function planRodizio({ pointer, changed, budget } = {}) {
  const arr = Array.isArray(changed) ? changed : [];
  const len = Math.min(arr.length, RODIZIO_MAX_GHOSTS);
  const grants = [];
  if (len === 0) return { grants, pointer: 0, pending: false };
  let p = Math.round(num(pointer, 0));
  if (p < 0 || p >= len) p = 0;
  let b = Math.max(0, Math.min(RODIZIO_BUDGET_BOOST, Math.round(num(budget, RODIZIO_BUDGET))));
  let changedCount = 0;
  for (let i = 0; i < len; i++) {
    if (arr[i] === true) changedCount++;
  }
  let nextPointer = p;
  for (let k = 0; k < len && b > 0; k++) {
    const i = (p + k) % len;
    if (arr[i] !== true) continue;
    grants.push(i);
    b--;
    nextPointer = (i + 1) % len;
  }
  return { grants, pointer: nextPointer, pending: changedCount > grants.length };
}

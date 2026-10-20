import { bus } from "../core/eventBus.js";

import { registerFrameCallback } from "../core/frameDriver.js";
import { logger as baseLogger } from "../core/logger.js";
import { Events, getService, makeVector3 } from "../datamodel/index.js";
import { getInstancesOfClass } from "../datamodel/classIndex.js";
import { equipAccessory, unequipAccessory, ensureCharacterAttachments, ensureWrapTargets } from "../avatar/accessoryRuntime.js";
import { buildAccessoryInstance, DESC_ACCESSORY_FIELDS, markDescriptionOwned, isDescriptionOwned } from "../avatar/accessoryFactory.js";
import { enumItemFor, ENUM_VALUE_OVERRIDES } from "./input.js";
import { healthbars } from "./healthbars.js";

export const HUMANOID_STATES = Object.freeze([
  "FallingDown", "Ragdoll", "GettingUp", "Jumping", "Swimming", "Freefall",
  "Flying", "Landed", "Running", "RunningNoPhysics", "StrafingNoPhysics",
  "Climbing", "Seated", "PlatformStanding", "Dead", "Physics", "None",
]);
const STATE_SET = new Set(HUMANOID_STATES);

export const HUMANOID_EVENTS = new Set([
  "Died", "HealthChanged", "StateChanged", "Jumping", "FreeFalling",
  "Landed", "Running", "MoveToFinished", "Seated", "Touched",
  "Swimming",                                                      
]);

export const MOVETO_TIMEOUT_MS = 8000;                    
const SCAN_INTERVAL_MS = 500;
const NPC_REACH_DIST = 1.0;
const REGEN_RATE = 0.01;                               


export const LIMITS = Object.freeze({
  WalkSpeed: { min: 0, max: 512, def: 16 },
  JumpPower: { min: 0, max: 1000, def: 50 },
  JumpHeight: { min: 0, max: 200, def: 7.2 },
  Health: { min: 0, max: 1e9, def: 100 },
  MaxHealth: { min: 0, max: 1e9, def: 100 },
});

export function clampNum(v, lim) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lim.def;
  return Math.min(lim.max, Math.max(lim.min, n));
}


let active = false;
let dataModel = null;
let log = baseLogger;
let isPausedFn = null;
let unregisterFrameCallback = null;
let lastTs = 0;
let scanAcc = Infinity;                                
let busOffs = [];
const runtimes = new Map();                           
const barItems = [];                                   

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function stateItem(name) {
  return enumItemFor("HumanoidStateType", name);
}

function characterOf(hum) {
  return hum && typeof hum.getParent === "function" ? hum.getParent() : null;
}

function isPartLike(inst) {
  return !!(inst && typeof inst.hasProperty === "function" && inst.hasProperty("Position") && inst.hasProperty("Size"));
}

export function rootPartOf(model) {
  if (!model || typeof model.findFirstChild !== "function") return null;
  const root =
    model.findFirstChild("HumanoidRootPart") ||
    model.findFirstChild("LowerTorso") ||
    model.findFirstChild("Torso");
  if (root && isPartLike(root)) return root;
  const kids = typeof model.getChildren === "function" ? model.getChildren() : [];
  for (const c of kids) if (isPartLike(c)) return c;
  return null;
}

function emitEvent(rt, type, args) {
  bus.emit("humanoid:event", { humanoid: rt.hum, type, args: args || [] });
}

function attach(hum) {
  let rt = runtimes.get(hum);
  if (rt) return rt;
  rt = {
    hum,
    state: "Running",
    stateEnabled: new Map(),                                    
    isLocal: false,
    vel: { x: 0, y: 0, z: 0 },
    moveTo: null,                               
    scriptMove: null,                                      
    jumpRequested: false,
    lastRunningSpeed: 0,
    lastSwimmingSpeed: 0,             
    diedFired: false,
    parts: null,                                      
  };
  runtimes.set(hum, rt);
  return rt;
}

export function getRuntime(hum) {
  if (!hum || hum.className !== "Humanoid") return null;
  if (!active) return null;
  return runtimes.get(hum) || attach(hum);
}

export function isManagerActive() {
  return active;
}


function setStateInternal(rt, newState) {
  if (rt.state === newState) return;
  const old = rt.state;
  rt.state = newState;
  emitEvent(rt, "StateChanged", [stateItem(old), stateItem(newState)]);
  if (newState === "Jumping") emitEvent(rt, "Jumping", [true]);
  if (old === "Jumping" && newState !== "Jumping") emitEvent(rt, "Jumping", [false]);
  if (newState === "Freefall") emitEvent(rt, "FreeFalling", [true]);
  if (old === "Freefall" && newState !== "Freefall") emitEvent(rt, "FreeFalling", [false]);
  if (newState === "Landed") emitEvent(rt, "Landed", []);

  if (old === "Swimming" && newState !== "Swimming" && rt.lastSwimmingSpeed > 0) {
    rt.lastSwimmingSpeed = 0;
    emitEvent(rt, "Swimming", [0]);
  }
  if (newState === "Seated") {
    const seat = rt.hum.hasProperty("SeatPart") ? rt.hum.getProperty("SeatPart") : undefined;
    emitEvent(rt, "Seated", [true, seat || undefined]);
  }
  if (old === "Seated" && newState !== "Seated") emitEvent(rt, "Seated", [false, undefined]);
  if (newState === "Dead" && !rt.diedFired) {
    rt.diedFired = true;
    emitEvent(rt, "Died", []);
    bus.emit("humanoid:died", { humanoid: rt.hum, character: characterOf(rt.hum) });
  }
}

export function resolveStateName(v) {
  if (v == null) return null;
  if (typeof v === "string") {
    const name = v.startsWith("Enum.") ? v.split(".").pop() : v;
    return STATE_SET.has(name) ? name : null;
  }
  if (typeof v === "number") {
    const ov = ENUM_VALUE_OVERRIDES.HumanoidStateType || {};
    for (const k of Object.keys(ov)) if (ov[k] === v) return k;
    return null;
  }
  if (typeof v === "object" && v.name) {
    return STATE_SET.has(v.name) ? v.name : null;
  }
  return null;
}


export function humChangeState(hum, stateLike) {
  const rt = getRuntime(hum);
  if (!rt) return false;
  const name = resolveStateName(stateLike);
  if (!name) {

    log.warn("Humanoid.ChangeState: estado invalido ignorado: " + String(stateLike && stateLike.name ? stateLike.name : stateLike), { source: "Humanoid" });
    return false;
  }
  if (rt.state === "Dead" && name !== "Dead") {
    log.warn("Humanoid.ChangeState: Humanoid morto nao muda de estado ate o respawn.", { source: "Humanoid" });
    return false;
  }
  if (humGetStateEnabled(hum, name) === false) {
    log.warn("Humanoid.ChangeState: o estado '" + name + "' esta desativado (SetStateEnabled).", { source: "Humanoid" });
    return false;
  }
  setStateInternal(rt, name);
  return true;
}


export function humAutoState(hum, name) {
  const rt = getRuntime(hum);
  if (!rt || !STATE_SET.has(name)) return false;
  if (rt.state === "Dead" && name !== "Dead") return false;
  if (name !== "Dead" && rt.stateEnabled.get(name) === false) return false;
  setStateInternal(rt, name);
  return true;
}

export function humGetState(hum) {
  const rt = getRuntime(hum);
  return rt ? rt.state : "Running";
}

export function humSetStateEnabled(hum, stateLike, enabled) {
  const rt = getRuntime(hum);
  if (!rt) return false;
  const name = resolveStateName(stateLike);
  if (!name) {
    log.warn("Humanoid.SetStateEnabled: estado invalido ignorado.", { source: "Humanoid" });
    return false;
  }
  if (name === "Dead" || name === "None") return false;                    
  rt.stateEnabled.set(name, enabled !== false);
  return true;
}

export function humGetStateEnabled(hum, stateLike) {
  const rt = getRuntime(hum);
  const name = resolveStateName(stateLike);
  if (!rt || !name) return false;
  const v = rt.stateEnabled.get(name);
  return v !== false;
}


export function humMove(hum, dir, relativeToCamera) {
  const rt = getRuntime(hum);
  if (!rt) return;
  const x = dir ? Number(dir.x) || 0 : 0;
  const z = dir ? Number(dir.z) || 0 : 0;
  if (x === 0 && z === 0) {
    rt.scriptMove = null;
    return;
  }
  rt.scriptMove = { x, z, relative: relativeToCamera === true };
}

export function humMoveTo(hum, pos, part) {
  const rt = getRuntime(hum);
  if (!rt) return;
  const p = pos || { x: 0, y: 0, z: 0 };
  const target = {
    x: Number(p.x) || 0,
    y: Number(p.y) || 0,
    z: Number(p.z) || 0,
    part: part && isPartLike(part) ? part : null,
    deadline: nowMs() + MOVETO_TIMEOUT_MS,                                   
  };
  rt.moveTo = target;
  try {
    hum.setProperty("WalkToPoint", makeVector3(target.x, target.y, target.z));
    hum.setProperty("WalkToPart", target.part || null);
  } catch (_) {                              }
}

export function moveToTargetOf(rt) {
  const mt = rt && rt.moveTo;
  if (!mt) return null;
  if (mt.part) {
    const base = mt.part.getParent && !mt.part.getParent() ? null : mt.part.getProperty("Position");
    if (base) {

      return { x: base.x + mt.x, y: base.y + mt.y, z: base.z + mt.z };
    }
  }
  return { x: mt.x, y: mt.y, z: mt.z };
}

export function finishMoveTo(hum, reached) {
  const rt = runtimes.get(hum);
  if (!rt || !rt.moveTo) return;
  rt.moveTo = null;
  try { hum.setProperty("WalkToPart", null); } catch (_) {          }
  emitEvent(rt, "MoveToFinished", [reached === true]);
}

export function humGetMoveVelocity(hum) {
  const rt = getRuntime(hum);
  return rt ? rt.vel : { x: 0, y: 0, z: 0 };
}

export function humSetVelocity(hum, x, y, z) {
  const rt = runtimes.get(hum);
  if (!rt) return;
  rt.vel.x = x; rt.vel.y = y; rt.vel.z = z;
}


export function humRunningSpeed(hum, speed) {
  const rt = runtimes.get(hum);
  if (!rt) return;
  const s = Math.max(0, Number(speed) || 0);
  if (Math.abs(s - rt.lastRunningSpeed) > 0.5 || (s === 0 && rt.lastRunningSpeed > 0)) {
    rt.lastRunningSpeed = s;
    emitEvent(rt, "Running", [s]);
  }
}


export function humSwimmingSpeed(hum, speed) {
  const rt = runtimes.get(hum);
  if (!rt) return;
  const s = Math.max(0, Number(speed) || 0);
  if (Math.abs(s - rt.lastSwimmingSpeed) > 0.5 || (s === 0 && rt.lastSwimmingSpeed > 0)) {
    rt.lastSwimmingSpeed = s;
    emitEvent(rt, "Swimming", [s]);
  }
}

export function humTouched(hum, otherPart, limbPart) {
  const rt = runtimes.get(hum);
  if (!rt) return;
  emitEvent(rt, "Touched", [otherPart, limbPart]);
}


export function humTakeDamage(hum, amount) {
  const rt = getRuntime(hum);
  if (!rt) return;
  let n = Number(amount);
  if (Number.isNaN(n) || n <= 0) return;
  const ch = characterOf(hum);

  if (ch && typeof ch.getChildren === "function" &&
      ch.getChildren().some((c) => c.className === "ForceField")) {
    return;
  }
  const cur = clampNum(hum.getProperty("Health"), LIMITS.Health);
  if (!Number.isFinite(n)) n = cur;                     
  try { hum.setProperty("Health", Math.max(0, cur - n)); } catch (_) {          }
}

export function humAddAccessory(hum, accessory) {
  const rt = getRuntime(hum);
  const ch = rt ? characterOf(hum) : null;
  if (!ch || !accessory || typeof accessory.setParent !== "function") return;
  try {
    ensureCharacterAttachments(ch);
    ensureWrapTargets(ch);
    equipAccessory(ch, accessory);
  } catch (_) {          }
}

export function humRemoveAccessory(accessory) {
  try { unequipAccessory(accessory); } catch (_) {          }
}

export function humApplyDescription(hum, desc) {
  const rt = getRuntime(hum);
  const ch = rt ? characterOf(hum) : null;
  if (!ch || !desc || typeof desc.getProperty !== "function") return;

  const colorProps = [
    ["HeadColor", ["Head"]],
    ["TorsoColor", ["Torso", "UpperTorso", "LowerTorso", "HumanoidRootPart"]],
    ["LeftArmColor", ["Left Arm", "LeftUpperArm", "LeftLowerArm", "LeftHand"]],
    ["RightArmColor", ["Right Arm", "RightUpperArm", "RightLowerArm", "RightHand"]],
    ["LeftLegColor", ["Left Leg", "LeftUpperLeg", "LeftLowerLeg", "LeftFoot"]],
    ["RightLegColor", ["Right Leg", "RightUpperLeg", "RightLowerLeg", "RightFoot"]],
  ];
  for (const [prop, partNames] of colorProps) {
    let c = null;
    try { c = desc.hasProperty && desc.hasProperty(prop) ? desc.getProperty(prop) : null; } catch (_) { c = null; }
    if (!c) continue;
    for (const pn of partNames) {
      const part = ch.findFirstChild && ch.findFirstChild(pn);
      if (part && part.hasProperty && part.hasProperty("Color")) {
        try { part.setProperty("Color", c); } catch (_) {          }
      }
    }
  }


  let autoScale = true;
  try { autoScale = !hum.hasProperty("AutomaticScalingEnabled") || hum.getProperty("AutomaticScalingEnabled") !== false; } catch (_) { autoScale = true; }
  if (autoScale) {
    for (const [dProp, humProps] of [["HeightScale", ["BodyHeightScale"]], ["WidthScale", ["BodyWidthScale", "BodyDepthScale"]]]) {
      let v = null;
      try { v = desc.hasProperty && desc.hasProperty(dProp) ? Number(desc.getProperty(dProp)) : null; } catch (_) { v = null; }
      if (v == null || !Number.isFinite(v) || v <= 0) continue;
      for (const hp of humProps) {
        try { hum.setProperty(hp, v); } catch (_) {          }
      }
    }
  }
  try { applyDescriptionAccessories(ch, desc); } catch (_) {          }
}

function applyDescriptionAccessories(ch, desc) {
  ensureCharacterAttachments(ch);
  ensureWrapTargets(ch);
  for (const acc of ch.getChildren().filter((c) => c.className === "Accessory" && isDescriptionOwned(c))) {
    unequipAccessory(acc);
    acc.setParent(null);
  }
  for (const [field, type] of DESC_ACCESSORY_FIELDS) {
    let id = 0;
    try { id = desc.hasProperty(field) ? Number(desc.getProperty(field)) : 0; } catch (_) { id = 0; }
    if (!Number.isFinite(id) || id <= 0) continue;
    const acc = buildAccessoryInstance({ type, name: `${type}Accessory_${Math.round(id)}`, meshId: `rbxassetid://${Math.round(id)}` });
    markDescriptionOwned(acc);
    const res = equipAccessory(ch, acc);
    if (!res.ok) acc.setParent(null);
  }
}


function onPropertyChanged(p) {
  if (!active || !p || !p.instance) return;
  const inst = p.instance;
  if (inst.className !== "Humanoid") return;
  const rt = runtimes.get(inst);
  if (!rt) return;
  const prop = p.property;
  if (prop === "WalkSpeed" || prop === "JumpPower" || prop === "JumpHeight") {
    const lim = LIMITS[prop];
    const cur = Number(inst.getProperty(prop));
    const c = clampNum(cur, lim);
    if (c !== cur) {
      try { inst.setProperty(prop, c); } catch (_) {          }
    }
    return;
  }
  if (prop === "Jump") {
    if (inst.getProperty("Jump") === true) rt.jumpRequested = true;
    return;
  }
  if (prop === "MaxHealth" || prop === "Health") {
    const maxRaw = Number(inst.getProperty("MaxHealth"));
    const max = clampNum(maxRaw, LIMITS.MaxHealth);
    if (max !== maxRaw) {
      try { inst.setProperty("MaxHealth", max); } catch (_) {          }
      return;                               
    }
    const hRaw = Number(inst.getProperty("Health"));
    const h = Number.isFinite(hRaw) ? Math.min(max, Math.max(0, hRaw)) : 0;
    if (h !== hRaw) {
      try { inst.setProperty("Health", h); } catch (_) {          }
      return;                               
    }
    if (prop === "Health") {
      const oldV = Number(p.oldValue);
      if (!Number.isFinite(oldV) || Math.abs(oldV - h) > 1e-9) {
        emitEvent(rt, "HealthChanged", [h]);
      }
    }
    if (h <= 0 && rt.state !== "Dead") setStateInternal(rt, "Dead");
  }
}



function refreshRuntimes() {
  const ws = dataModel ? getService(dataModel, "Workspace") : null;
  if (!ws) return;
  const found = new Set();


  for (const humanoid of getInstancesOfClass(ws, "Humanoid")) {
    found.add(humanoid);
    attach(humanoid);
  }
  for (const [hum, rt] of runtimes) {
    if (!found.has(hum)) {
      runtimes.delete(hum);
      continue;
    }

    const ch = characterOf(hum);
    rt.parts = null;
    if (ch && typeof ch.getDescendants === "function") {
      rt.parts = ch.getDescendants().filter(isPartLike);
    }
  }
}

function tickRuntime(rt, dt, t) {
  const hum = rt.hum;
  const ch = characterOf(hum);
  if (!ch) return;

  const max = clampNum(hum.getProperty("MaxHealth"), LIMITS.MaxHealth);
  let health = clampNum(hum.getProperty("Health"), LIMITS.Health);


  if (rt.state !== "Dead" && health > 0 && health < max &&
      ch.findFirstChild && ch.findFirstChild("Health")) {
    const nh = Math.min(max, health + max * REGEN_RATE * dt);
    if (nh !== health) {
      try { hum.setProperty("Health", nh); } catch (_) {          }
      health = nh;
    }
  }


  if (rt.moveTo) {
    const target = moveToTargetOf(rt);
    const root = rootPartOf(ch);
    if (!target || !root || rt.state === "Dead") {
      finishMoveTo(hum, false);
    } else {
      const rp = root.getProperty("Position");
      const dx = target.x - rp.x;
      const dz = target.z - rp.z;
      const distSq = dx * dx + dz * dz;
      if (distSq <= NPC_REACH_DIST * NPC_REACH_DIST) {
        rt.vel.x = 0; rt.vel.z = 0;
        finishMoveTo(hum, true);
      } else if (t >= rt.moveTo.deadline) {
        rt.vel.x = 0; rt.vel.z = 0;
        finishMoveTo(hum, false);                                            
      } else if (!rt.isLocal) {
        const dist = Math.sqrt(distSq);
        const speed = clampNum(hum.getProperty("WalkSpeed"), LIMITS.WalkSpeed);
        const step = Math.min(dist, speed * dt);
        if (step > 0 && dist > 1e-6) {
          const mx = (dx / dist) * step;
          const mz = (dz / dist) * step;
          const parts = rt.parts || [];
          for (const part of parts) {
            const pp = part.getProperty("Position");
            try { part.setProperty("Position", makeVector3(pp.x + mx, pp.y, pp.z + mz)); } catch (_) {          }
          }
          rt.vel.x = mx / dt; rt.vel.z = mz / dt;
          humRunningSpeed(hum, speed);
          try { hum._setInternal("MoveDirection", makeVector3(dx / dist, 0, dz / dist)); } catch (_) {          }
        }
      }
    }
  } else if (!rt.isLocal && (rt.vel.x !== 0 || rt.vel.z !== 0)) {
    rt.vel.x = 0; rt.vel.z = 0;
    humRunningSpeed(hum, 0);
  }
}

function collectBarItems() {
  barItems.length = 0;
  for (const [hum, rt] of runtimes) {
    if (rt.isLocal) continue;                                               
    const ch = characterOf(hum);
    if (!ch) continue;
    const head = (ch.findFirstChild && ch.findFirstChild("Head")) || rootPartOf(ch);
    if (!head || !isPartLike(head)) continue;
    const hp = head.getProperty("Position");
    const hs = head.getProperty("Size");
    const max = clampNum(hum.getProperty("MaxHealth"), LIMITS.MaxHealth);
    const health = clampNum(hum.getProperty("Health"), LIMITS.Health);
    let displayType = "DisplayWhenDamaged";
    try { displayType = String(hum.getProperty("HealthDisplayType") || "DisplayWhenDamaged"); } catch (_) {          }
    const showBar = displayType === "AlwaysOn" ? true :
      displayType === "AlwaysOff" ? false : health < max - 1e-6;
    let label = "";
    try { label = String(hum.getProperty("DisplayName") || ""); } catch (_) {          }
    if (!label) label = ch.getName ? ch.getName() : (ch.name || "");
    barItems.push({
      key: hum.id || hum,
      x: hp.x,
      y: hp.y + (hs ? hs.y / 2 : 0.5) + 0.7,
      z: hp.z,
      health,
      maxHealth: max,
      label,
      showBar,
      showLabel: !!label,
      healthDist: Number(hum.hasProperty && hum.hasProperty("HealthDisplayDistance") ? hum.getProperty("HealthDisplayDistance") : 100) || 0,
      nameDist: Number(hum.hasProperty && hum.hasProperty("NameDisplayDistance") ? hum.getProperty("NameDisplayDistance") : 100) || 0,
    });
  }
  return barItems;
}

function tick(ts) {
  if (!active) return;
  if (isPausedFn && isPausedFn()) {
    lastTs = ts;
    return;
  }
  const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000)) || 0;
  lastTs = ts;
  if (dt <= 0) return;

  scanAcc += dt * 1000;
  if (scanAcc >= SCAN_INTERVAL_MS) {
    scanAcc = 0;
    refreshRuntimes();
  }

  const t = nowMs();
  for (const rt of runtimes.values()) {
    try { tickRuntime(rt, dt, t); } catch (e) {
      log.warn("Humanoid runtime: " + ((e && e.message) || e), { source: "Humanoid" });
    }
  }
  healthbars.update(collectBarItems());
}


export const humanoids = {
  isActive: () => active,

  start(opts) {
    if (active) this.stop();
    active = true;
    dataModel = opts.dataModel;
    log = opts.logger || baseLogger;
    isPausedFn = typeof opts.isPaused === "function" ? opts.isPaused : null;
    lastTs = typeof performance !== "undefined" && performance.now ? performance.now() : 0;
    scanAcc = Infinity;
    busOffs.push(bus.on(Events.PropertyChanged, onPropertyChanged));
    healthbars.start();
    unregisterFrameCallback = registerFrameCallback("simulation", tick, "humanoid:runtimes");
  },

  stop() {
    active = false;
    if (unregisterFrameCallback) {
      unregisterFrameCallback();
      unregisterFrameCallback = null;
    }
    for (const off of busOffs) {
      try { off(); } catch (_) {          }
    }
    busOffs = [];
    runtimes.clear();
    healthbars.stop();
    dataModel = null;
    isPausedFn = null;
  },

  registerLocal(hum) {
    const rt = getRuntime(hum);
    if (rt) rt.isLocal = true;
    return rt;
  },
};

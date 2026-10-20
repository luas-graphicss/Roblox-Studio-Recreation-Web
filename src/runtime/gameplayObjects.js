import { bus } from "../core/eventBus.js";

import { registerFrameCallback } from "../core/frameDriver.js";
import { logger as baseLogger } from "../core/logger.js";
import { getProjection } from "../viewport/projection.js";
import { raycastWorkspace } from "../physics/raycast.js";
import { createInstance } from "../datamodel/index.js";
import { makeVector3 } from "../datamodel/types.js";
import { KEYCODE_VALUES } from "./input.js";
import { nativeFn } from "./lua/interpreter.js";
import {
  GRIP_DEFAULTS, orthonormalizeGrip, gripToCFrame, handlePose, rigidMove,
} from "./gripMath.js";
import { eulerDegToQuat, quatToEulerDeg } from "./cframeMath.js";


const MAX_TEXT_LEN = 100;
const MAX_HOLD = 60;
const MAX_ACT_DIST = 1000;
const RATE_MAX = 10;                                                       


const PROX_HZ = 10;                                       
const HOVER_HZ = 30;                                     

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function sanitizeText(s) {
  let t = s == null ? "" : String(s);
  t = t.replace(/[\u0000-\u001f]/g, " ");
  if (t.length > MAX_TEXT_LEN) t = t.slice(0, MAX_TEXT_LEN);
  return t;
}

function keyLabel(name) {
  if (!name) return "E";
  const digits = { Zero: "0", One: "1", Two: "2", Three: "3", Four: "4", Five: "5", Six: "6", Seven: "7", Eight: "8", Nine: "9" };
  if (digits[name]) return digits[name];
  if (name.length === 1) return name.toUpperCase();
  return name;
}


let active = false;
let dm = null;
let getChar = null;
let getPlayer = null;
let im = null;
let log = baseLogger;
let unregisterFrameCallback = null;

let casBound = [];
let boundActivate = false;


let equippedTool = null;
let equippedWeld = null;
let toolActivated = false;
const dropCooldown = new Map();                                                  


let hotbarEl = null;
const slotPool = [];                                      
let hotbarTools = [];                                               
let lastHotbarKey = "";


let hoverCD = null;                              
let lastHoverAt = 0;
let mouseMoved = true;
let lastMouse = { x: -1, y: -1 };
let cursorHost = null;
let savedCursor = "";


let promptContainer = null;
const promptPool = new Map();                         
const shownPrompts = new Set();                                                
let lastProxAt = 0;
let holdState = null;                                        
const promptKeyWasDown = new Map();                                        


const rateBuckets = new Map();                                          

function rateOk(inst, type) {
  const key = inst.id + ":" + type;
  const t = now();
  let arr = rateBuckets.get(key);
  if (!arr) { arr = []; rateBuckets.set(key, arr); }
  while (arr.length && t - arr[0] > 1000) arr.shift();
  if (arr.length >= RATE_MAX) {
    log.warn(`Rate limit: ${type} ignorado em '${inst.name}' (max ${RATE_MAX}/s).`, { source: inst.className });
    return false;
  }
  arr.push(t);
  return true;
}


function workspace() {
  if (!dm) return null;
  const list = dm.getChildren();
  for (const c of list) if (c.className === "Workspace") return c;
  return null;
}

function backpackOf(player) {
  if (!player) return null;
  return player.findFirstChild ? player.findFirstChild("Backpack") : null;
}

function rootOf(char) {
  if (!char) return null;
  return char.findFirstChild("HumanoidRootPart")
    || char.findFirstChild("Torso")
    || char.findFirstChild("LowerTorso")
    || char.getChildren().find((c) => c.hasProperty && c.hasProperty("Position"));
}

function humanoidOf(char) {
  if (!char) return null;
  return char.getChildren().find((c) => c.className === "Humanoid") || null;
}

function rightHandOf(char) {
  if (!char) return null;
  return char.findFirstChild("RightHand") || char.findFirstChild("Right Arm") || rootOf(char);
}

function posOf(inst) {
  try {
    const p = inst.getProperty("Position");
    if (p) return p;
  } catch (_) {            }
  return null;
}

function distance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}


function findClickDetector(inst) {
  let cur = inst;
  let depth = 0;
  while (cur && depth < 6) {
    if (cur.getChildren) {
      const cd = cur.getChildren().find((c) => c.className === "ClickDetector");
      if (cd) return { detector: cd, host: cur };
    }
    cur = cur.getParent ? cur.getParent() : null;
    depth += 1;
  }
  return null;
}


function promptAdornee(prompt) {
  const parent = prompt.getParent ? prompt.getParent() : null;
  if (!parent) return null;
  if (parent.hasProperty && parent.hasProperty("Position")) return parent;
  if (parent.className === "Attachment") {
    const pp = parent.getParent();
    return pp && pp.hasProperty && pp.hasProperty("Position") ? pp : null;
  }
  if (parent.className === "Model") {
    return parent.getDescendants().find((d) => d.hasProperty && d.hasProperty("Position")) || null;
  }
  return null;
}

function fireEvent(inst, type, args) {
  bus.emit("gameplay:event", { instance: inst, type, args: args || [] });
}


function toolHasHandle(tool) {
  return !!(tool.findFirstChild && tool.findFirstChild("Handle"));
}

function listBackpackTools() {
  const player = getPlayer && getPlayer();
  const bp = backpackOf(player);
  const out = [];
  if (bp) for (const c of bp.getChildren()) if (c.className === "Tool") out.push(c);
  return out;
}

function canEquip(char) {
  const hum = humanoidOf(char);
  if (!hum) return false;
  if (num(hum.getProperty("Health"), 0) <= 0) return false;         
  if (hum.getProperty("PlatformStand") === true) return false;
  if (hum.hasProperty("SeatPart") && hum.getProperty("SeatPart")) return false;           
  return true;
}

function equipTool(tool) {
  const char = getChar && getChar();
  if (!char || !tool || tool.className !== "Tool") return;
  if (equippedTool === tool) return;
  if (!canEquip(char)) return;
  if (tool.getProperty("RequiresHandle") === true && !toolHasHandle(tool)) {
    log.warn(`Tool '${tool.name}' nao pode ser equipada: RequiresHandle e true mas nao ha um Handle.`, { source: "Tool" });
    return;
  }
  if (equippedTool) unequipTool(equippedTool);

  tool.setParent(char);
  toolActivated = false;


  const hand = rightHandOf(char);
  const handle = tool.findFirstChild && tool.findFirstChild("Handle");
  if (hand && handle) {
    equippedWeld = createInstance("Weld", { name: "RightGrip", parent: hand });
    try {
      equippedWeld.setProperty("Part0", hand);
      equippedWeld.setProperty("Part1", handle);
    } catch (_) {            }
  }
  equippedTool = tool;
  repositionTool();
  fireEvent(tool, "Equipped", []);
}

function unequipTool(tool) {
  const player = getPlayer && getPlayer();
  const bp = backpackOf(player);
  restoreGripRotations();                                                   
  if (equippedWeld) { try { equippedWeld.destroy(); } catch (_) {            } equippedWeld = null; }
  if (toolActivated) { toolActivated = false; fireEvent(tool, "Deactivated", []); }
  if (bp && tool.getParent && tool.getParent() !== bp) tool.setParent(bp);
  if (equippedTool === tool) equippedTool = null;
  fireEvent(tool, "Unequipped", []);
}

function dropTool(tool) {
  if (!tool || tool.getProperty("CanBeDropped") !== true) return;
  const char = getChar && getChar();
  const ws = workspace();
  restoreGripRotations();                                                   
  if (equippedWeld) { try { equippedWeld.destroy(); } catch (_) {            } equippedWeld = null; }
  if (toolActivated) { toolActivated = false; fireEvent(tool, "Deactivated", []); }
  if (equippedTool === tool) equippedTool = null;

  const handle = tool.findFirstChild && tool.findFirstChild("Handle");
  const root = rootOf(char);
  if (handle && root) {
    const p = posOf(root);
    if (p) { try { handle.setProperty("Position", makeVector3(p.x, p.y, p.z - 3)); } catch (_) {            } }
  }
  dropCooldown.set(tool.id, now() + 1000);
  if (ws) tool.setParent(ws);
  fireEvent(tool, "Unequipped", []);
}


const GRIP_AXIS_EPS = 1e-9;                                         
const GRIP_POS_EPS = 1e-4;                                              
const GRIP_ROT_EPS = 1e-7;                                              


const gripRotOriginal = new Map();                            

function gripAxis(tool, prop, fb) {
  let v = null;
  try { v = tool.getProperty(prop); } catch (_) { v = null; }
  return {
    x: num(v && v.x, fb.x),
    y: num(v && v.y, fb.y),
    z: num(v && v.z, fb.z),
  };
}

function isDefaultGripAxes(f, r, u) {
  const d = GRIP_DEFAULTS;
  return Math.abs(f.x - d.forward.x) < GRIP_AXIS_EPS && Math.abs(f.y - d.forward.y) < GRIP_AXIS_EPS && Math.abs(f.z - d.forward.z) < GRIP_AXIS_EPS
    && Math.abs(r.x - d.right.x) < GRIP_AXIS_EPS && Math.abs(r.y - d.right.y) < GRIP_AXIS_EPS && Math.abs(r.z - d.right.z) < GRIP_AXIS_EPS
    && Math.abs(u.x - d.up.x) < GRIP_AXIS_EPS && Math.abs(u.y - d.up.y) < GRIP_AXIS_EPS && Math.abs(u.z - d.up.z) < GRIP_AXIS_EPS;
}

function rotOf(inst) {
  if (!inst || !inst.hasProperty || !inst.hasProperty("Rotation")) return null;
  try {
    const r = inst.getProperty("Rotation");
    if (r) return { x: num(r.x), y: num(r.y), z: num(r.z) };
  } catch (_) {            }
  return null;
}

function packCF(pos, rotDeg) {

  const q = rotDeg ? eulerDegToQuat(rotDeg.x, rotDeg.y, rotDeg.z) : { x: 0, y: 0, z: 0, w: 1 };
  return { x: pos.x, y: pos.y, z: pos.z, qx: num(q && q.x), qy: num(q && q.y), qz: num(q && q.z), qw: num(q && q.w, 1) };
}

function sameQuat(a, b) {
  const dot = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;
  return 1 - Math.abs(dot) < GRIP_ROT_EPS;
}

function rememberRot(part) {
  if (!gripRotOriginal.has(part)) {
    const r = rotOf(part);
    if (r) gripRotOriginal.set(part, r);
  }
}

function restoreGripRotations() {
  for (const [part, r] of gripRotOriginal) {
    try {
      if (part && part.hasProperty && part.hasProperty("Rotation")) {
        part.setProperty("Rotation", makeVector3(r.x, r.y, r.z));
      }
    } catch (_) {            }
  }
  gripRotOriginal.clear();
}

function writePose(part, cf) {
  try {
    part.setProperty("Position", makeVector3(cf.x, cf.y, cf.z));
    if (part.hasProperty("Rotation")) {
      const e = quatToEulerDeg({ x: cf.qx, y: cf.qy, z: cf.qz, w: cf.qw });
      part.setProperty("Rotation", makeVector3(num(e && e.x), num(e && e.y), num(e && e.z)));
    }
  } catch (_) {            }
}


function repositionTool() {
  if (!equippedTool) return;
  const char = getChar && getChar();
  const hand = rightHandOf(char);
  const handle = equippedTool.findFirstChild && equippedTool.findFirstChild("Handle");
  if (!hand || !handle) return;
  const hp = posOf(hand);
  if (!hp) return;
  const gp = equippedTool.getProperty("GripPos") || { x: 0, y: 0, z: 0 };
  const gf = gripAxis(equippedTool, "GripForward", GRIP_DEFAULTS.forward);
  const gr = gripAxis(equippedTool, "GripRight", GRIP_DEFAULTS.right);
  const gu = gripAxis(equippedTool, "GripUp", GRIP_DEFAULTS.up);

  if (isDefaultGripAxes(gf, gr, gu)) {


    if (gripRotOriginal.size > 0) restoreGripRotations();

    const target = { x: hp.x - num(gp.x), y: hp.y - num(gp.y), z: hp.z - num(gp.z) };
    const cur = posOf(handle);
    if (!cur) return;
    const dx = target.x - cur.x, dy = target.y - cur.y, dz = target.z - cur.z;
    if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4 && Math.abs(dz) < 1e-4) return;

    for (const part of equippedTool.getDescendants()) {
      if (!part.hasProperty || !part.hasProperty("Position")) continue;
      const pp = posOf(part);
      if (!pp) continue;
      try { part.setProperty("Position", makeVector3(pp.x + dx, pp.y + dy, pp.z + dz)); } catch (_) {            }
    }
    return;
  }


  const axes = orthonormalizeGrip({ forward: gf, right: gr, up: gu });
  const gripCF = gripToCFrame({
    pos: { x: num(gp.x), y: num(gp.y), z: num(gp.z) },
    forward: axes.forward, right: axes.right, up: axes.up,
  });
  const handCF = packCF(hp, rotOf(hand));
  const target = handlePose(handCF, gripCF);
  const cur = posOf(handle);
  if (!cur) return;
  const oldHandleCF = packCF(cur, rotOf(handle));


  if (
    Math.abs(target.x - cur.x) < GRIP_POS_EPS &&
    Math.abs(target.y - cur.y) < GRIP_POS_EPS &&
    Math.abs(target.z - cur.z) < GRIP_POS_EPS &&
    sameQuat(oldHandleCF, target)
  ) return;


  for (const part of equippedTool.getDescendants()) {
    if (part === handle) continue;
    if (!part.hasProperty || !part.hasProperty("Position")) continue;
    const pp = posOf(part);
    if (!pp) continue;
    const moved = rigidMove(packCF(pp, rotOf(part)), oldHandleCF, target);
    rememberRot(part);
    writePose(part, moved);
  }
  rememberRot(handle);
  writePose(handle, target);
}

function activateTool(tool) {
  const t = tool || equippedTool;
  if (!t || equippedTool !== t) return;
  if (t.getProperty("Enabled") === false) return;
  if (toolActivated) return;
  toolActivated = true;
  fireEvent(t, "Activated", []);
}

function deactivateTool(tool) {
  const t = tool || equippedTool;
  if (!t || !toolActivated) return;
  toolActivated = false;
  fireEvent(t, "Deactivated", []);
}


function onTouched(p) {
  if (!p || !active) return;
  const char = getChar && getChar();
  const root = rootOf(char);
  if (!root) return;
  const part = p.a === root ? p.b : p.b === root ? p.a : null;
  if (!part) return;

  let cur = part;
  let tool = null;
  let depth = 0;
  while (cur && depth < 5) {
    if (cur.className === "Tool") { tool = cur; break; }
    cur = cur.getParent ? cur.getParent() : null;
    depth += 1;
  }
  if (!tool) return;
  const ws = workspace();
  if (!ws || tool.getParent() !== ws) return;
  if (!toolHasHandle(tool)) return;
  const cd = dropCooldown.get(tool.id);
  if (cd && now() < cd) return;
  dropCooldown.delete(tool.id);
  const player = getPlayer && getPlayer();
  const bp = backpackOf(player);
  if (bp) tool.setParent(bp);
}


function ensureHotbar() {
  if (typeof document === "undefined") return null;
  if (hotbarEl && hotbarEl.parentNode) return hotbarEl;
  hotbarEl = document.createElement("div");
  hotbarEl.className = "rsw-hotbar";
  hotbarEl.style.cssText =
    "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);" +
    "display:flex;gap:6px;z-index:4100;pointer-events:auto;font:600 12px system-ui,sans-serif;";
  document.body.appendChild(hotbarEl);
  return hotbarEl;
}

function makeSlot() {
  const el = document.createElement("div");
  el.style.cssText =
    "position:relative;width:56px;height:56px;border-radius:10px;" +
    "background:rgba(20,22,26,.62);border:2px solid rgba(255,255,255,.18);" +
    "box-shadow:0 2px 6px rgba(0,0,0,.4);cursor:pointer;overflow:hidden;" +
    "display:flex;align-items:center;justify-content:center;color:#fff;";
  const num = document.createElement("div");
  num.style.cssText =
    "position:absolute;left:4px;top:2px;font:700 11px system-ui,sans-serif;" +
    "color:rgba(255,255,255,.85);text-shadow:0 1px 2px rgba(0,0,0,.9);";
  const icon = document.createElement("img");
  icon.style.cssText = "max-width:100%;max-height:100%;display:none;";
  const label = document.createElement("div");
  label.style.cssText =
    "padding:2px;text-align:center;font:600 11px system-ui,sans-serif;" +
    "overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;";
  el.appendChild(num);
  el.appendChild(icon);
  el.appendChild(label);
  const rec = { el, num, icon, label, tool: null };
  el.addEventListener("click", () => { if (rec.tool) toggleEquip(rec.tool); });
  el.addEventListener("mouseenter", () => {
    if (rec.tool) el.title = sanitizeText(rec.tool.getProperty("ToolTip") || "");
  });
  return rec;
}

function toggleEquip(tool) {
  if (equippedTool === tool) unequipTool(tool);
  else equipTool(tool);
}

function refreshHotbar() {

  const tools = listBackpackTools();
  if (equippedTool && !tools.includes(equippedTool)) tools.unshift(equippedTool);
  hotbarTools = tools.slice(0, 10);

  if (hotbarTools.length === 0) {
    if (hotbarEl) hotbarEl.style.display = "none";
    lastHotbarKey = "";
    return;
  }
  const cont = ensureHotbar();
  if (!cont) return;
  cont.style.display = "flex";


  const key = hotbarTools.map((t, i) => `${t.id}:${t === equippedTool ? 1 : 0}:${sanitizeText(t.getProperty("TextureId") || "")}:${sanitizeText(t.name)}`).join("|");
  if (key === lastHotbarKey) return;
  lastHotbarKey = key;

  for (let i = 0; i < hotbarTools.length; i++) {
    const tool = hotbarTools[i];
    let rec = slotPool[i];
    if (!rec) { rec = makeSlot(); slotPool[i] = rec; }
    if (rec.el.parentNode !== cont) cont.appendChild(rec.el);
    rec.el.style.display = "flex";
    rec.tool = tool;
    rec.num.textContent = i === 9 ? "0" : String(i + 1);
    const tex = sanitizeText(tool.getProperty("TextureId") || "");
    if (tex) { rec.icon.src = tex; rec.icon.style.display = "block"; rec.label.style.display = "none"; }
    else { rec.icon.style.display = "none"; rec.label.style.display = "-webkit-box"; rec.label.textContent = tool.name; }
    const on = tool === equippedTool;
    rec.el.style.border = on ? "2px solid #fff" : "2px solid rgba(255,255,255,.18)";
    rec.el.style.background = on ? "rgba(60,120,200,.55)" : "rgba(20,22,26,.62)";
  }

  for (let i = hotbarTools.length; i < slotPool.length; i++) {
    slotPool[i].el.style.display = "none";
    slotPool[i].tool = null;
  }
}

function equipBySlot(index) {
  const tool = hotbarTools[index];
  if (tool) toggleEquip(tool);
}


function screenRay() {
  const proj = getProjection();
  if (!proj || typeof proj.screenToRay !== "function" || !im) return null;
  const m = im.getMouseLocation();
  const host = proj.container;
  if (!host) return null;
  const rect = host.getBoundingClientRect();
  return proj.screenToRay(rect.left + m.x, rect.top + m.y);
}

function castFromMouse() {
  const ray = screenRay();
  const ws = workspace();
  if (!ray || !ws) return null;
  const char = getChar && getChar();
  const params = { filterType: "Exclude", filterList: char ? [char] : [], ignoreWater: true };
  return raycastWorkspace(ws, ray.origin, ray.dir, params);
}

function updateHover() {
  const t = now();
  if (t - lastHoverAt < 1000 / HOVER_HZ) return;
  if (!mouseMoved) return;
  lastHoverAt = t;
  mouseMoved = false;

  const player = getPlayer && getPlayer();
  const char = getChar && getChar();
  const root = rootOf(char);
  let found = null;
  const hit = castFromMouse();
  if (hit && hit.instance) {
    const res = findClickDetector(hit.instance);
    if (res) {
      const maxD = clamp(num(res.detector.getProperty("MaxActivationDistance"), 32), 0, MAX_ACT_DIST);
      const d = root ? distance(posOf(root), hit.position) : 0;
      if (d <= maxD) found = res.detector;
    }
  }
  if (found === hoverCD) return;
  if (hoverCD) fireEvent(hoverCD, "MouseHoverLeave", [player]);
  hoverCD = found;
  setCursor(found ? (sanitizeText(found.getProperty("CursorIcon") || "") || "pointer") : "");
  if (hoverCD) fireEvent(hoverCD, "MouseHoverEnter", [player]);
}

function setCursor(style) {
  const proj = getProjection();
  const host = proj && proj.container;
  if (!host) return;
  if (cursorHost !== host) { cursorHost = host; savedCursor = host.style.cursor || ""; }

  host.style.cursor = style && style.startsWith("rbxasset") ? "pointer" : (style || savedCursor || "");
}

function onClick(rightButton) {
  const player = getPlayer && getPlayer();
  const char = getChar && getChar();
  const root = rootOf(char);
  const hit = castFromMouse();
  if (!hit || !hit.instance) return;
  const res = findClickDetector(hit.instance);
  if (!res) return;
  const maxD = clamp(num(res.detector.getProperty("MaxActivationDistance"), 32), 0, MAX_ACT_DIST);
  const d = root ? distance(posOf(root), hit.position) : 0;
  if (d > maxD) return;                                        
  const type = rightButton ? "RightMouseClick" : "MouseClick";
  if (!rateOk(res.detector, type)) return;
  fireEvent(res.detector, type, [player]);
}


function allPrompts() {
  const ws = workspace();
  if (!ws) return [];
  return ws.getDescendants().filter((d) => d.className === "ProximityPrompt");
}

function hasLineOfSight(fromPos, prompt, adornee) {
  if (prompt.getProperty("RequiresLineOfSight") !== true) return true;
  const target = posOf(adornee);
  if (!fromPos || !target) return true;
  const dir = { x: target.x - fromPos.x, y: target.y - fromPos.y, z: target.z - fromPos.z };
  const ws = workspace();
  const char = getChar && getChar();
  const hit = raycastWorkspace(ws, fromPos, dir, { filterType: "Exclude", filterList: char ? [char, adornee] : [adornee], ignoreWater: true });
  if (!hit) return true;                   

  return hit.distance >= distance(fromPos, target) - 0.5;
}

function ensurePromptContainer() {
  if (typeof document === "undefined") return null;
  const proj = getProjection();
  const host = proj && proj.container;
  if (!host) return null;
  if (promptContainer && promptContainer.parentNode === host) return promptContainer;
  if (promptContainer && promptContainer.parentNode) promptContainer.parentNode.removeChild(promptContainer);
  try {
    const cs = window.getComputedStyle(host);
    if (cs && cs.position === "static") host.style.position = "relative";
  } catch (_) {            }
  promptContainer = document.createElement("div");
  promptContainer.className = "rsw-prompts";
  promptContainer.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:35;";
  host.appendChild(promptContainer);
  return promptContainer;
}

function makePromptEl() {
  const root = document.createElement("div");
  root.style.cssText =
    "position:absolute;left:0;top:0;transform:translate(-50%,-50%);" +
    "display:flex;align-items:center;gap:8px;padding:6px 12px 6px 6px;" +
    "background:rgba(20,22,26,.72);border-radius:24px;" +
    "box-shadow:0 2px 8px rgba(0,0,0,.45);will-change:transform;white-space:nowrap;";
  const keyWrap = document.createElement("div");
  keyWrap.style.cssText = "position:relative;width:34px;height:34px;flex:0 0 auto;";
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ring.setAttribute("width", "34"); ring.setAttribute("height", "34");
  ring.style.cssText = "position:absolute;inset:0;transform:rotate(-90deg);display:none;";
  const ringBg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ringBg.setAttribute("cx", "17"); ringBg.setAttribute("cy", "17"); ringBg.setAttribute("r", "15");
  ringBg.setAttribute("fill", "none"); ringBg.setAttribute("stroke", "rgba(255,255,255,.25)"); ringBg.setAttribute("stroke-width", "3");
  const ringFg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ringFg.setAttribute("cx", "17"); ringFg.setAttribute("cy", "17"); ringFg.setAttribute("r", "15");
  ringFg.setAttribute("fill", "none"); ringFg.setAttribute("stroke", "#fff"); ringFg.setAttribute("stroke-width", "3");
  ringFg.setAttribute("stroke-linecap", "round");
  const circ = 2 * Math.PI * 15;
  ringFg.setAttribute("stroke-dasharray", String(circ));
  ringFg.setAttribute("stroke-dashoffset", String(circ));
  ring.appendChild(ringBg); ring.appendChild(ringFg);
  const keyBadge = document.createElement("div");
  keyBadge.style.cssText =
    "position:absolute;inset:3px;border-radius:7px;background:#fff;color:#16181c;" +
    "display:flex;align-items:center;justify-content:center;font:700 14px system-ui,sans-serif;";
  keyWrap.appendChild(ring); keyWrap.appendChild(keyBadge);
  const texts = document.createElement("div");
  texts.style.cssText = "display:flex;flex-direction:column;line-height:1.15;";
  const action = document.createElement("div");
  action.style.cssText = "color:#fff;font:600 13px system-ui,sans-serif;";
  const object = document.createElement("div");
  object.style.cssText = "color:rgba(255,255,255,.7);font:500 11px system-ui,sans-serif;";
  texts.appendChild(action); texts.appendChild(object);
  root.appendChild(keyWrap); root.appendChild(texts);
  return { root, keyBadge, action, object, ring, ringFg, circ };
}

function setPromptShown(prompt, shown) {
  const was = shownPrompts.has(prompt.id);
  if (shown && !was) { shownPrompts.add(prompt.id); fireEvent(prompt, "PromptShown", []); }
  else if (!shown && was) { shownPrompts.delete(prompt.id); fireEvent(prompt, "PromptHidden", []); }
}

function hidePromptUI(prompt) {
  const rec = promptPool.get(prompt.id);
  if (rec) rec.root.style.display = "none";
}

function triggerPrompt(prompt, player) {
  if (!rateOk(prompt, "Triggered")) return;
  fireEvent(prompt, "Triggered", [player]);
}


function updatePrompts() {
  const t = now();
  if (t - lastProxAt < 1000 / PROX_HZ) { positionPrompts(); return; }
  lastProxAt = t;

  const char = getChar && getChar();
  const root = rootOf(char);
  const fromPos = root ? posOf(root) : null;
  const prompts = allPrompts();


  const candidates = [];
  for (const prompt of prompts) {
    if (prompt.getProperty("Enabled") === false) { setPromptShown(prompt, false); hidePromptUI(prompt); continue; }
    const adornee = promptAdornee(prompt);
    if (!adornee || !fromPos) { setPromptShown(prompt, false); hidePromptUI(prompt); continue; }
    const maxD = clamp(num(prompt.getProperty("MaxActivationDistance"), 10), 0, MAX_ACT_DIST);
    const d = distance(fromPos, posOf(adornee));
    if (d > maxD) { setPromptShown(prompt, false); hidePromptUI(prompt); continue; }
    if (!hasLineOfSight(fromPos, prompt, adornee)) { setPromptShown(prompt, false); hidePromptUI(prompt); continue; }
    candidates.push({ prompt, adornee, d });
  }


  candidates.sort((a, b) => a.d - b.d);
  const globalHidden = new Set();
  let globalShown = false;
  for (const c of candidates) {
    const ex = c.prompt.getProperty("Exclusivity");
    if (ex === "OneGlobally") {
      if (globalShown) globalHidden.add(c.prompt.id);
      else globalShown = true;
    }
  }

  for (const c of candidates) {
    if (globalHidden.has(c.prompt.id)) { setPromptShown(c.prompt, false); hidePromptUI(c.prompt); continue; }
    setPromptShown(c.prompt, true);
    if (c.prompt.getProperty("Style") !== "Custom") drawPrompt(c.prompt, c.adornee);
    else hidePromptUI(c.prompt);
  }
  positionPrompts();
}

function drawPrompt(prompt, adornee) {
  const cont = ensurePromptContainer();
  if (!cont) return;
  let rec = promptPool.get(prompt.id);
  if (!rec) { rec = makePromptEl(); promptPool.set(prompt.id, rec); }
  if (rec.root.parentNode !== cont) cont.appendChild(rec.root);
  rec._adornee = adornee;
  rec.root.style.display = "flex";
  const keyName = prompt.getProperty("KeyboardKeyCode");
  rec.keyBadge.textContent = keyLabel(typeof keyName === "object" && keyName ? keyName.name : keyName);
  const at = sanitizeText(prompt.getProperty("ActionText") || "Interact");
  const ot = sanitizeText(prompt.getProperty("ObjectText") || "");
  if (rec.action.textContent !== at) rec.action.textContent = at;
  rec.object.style.display = ot ? "block" : "none";
  if (ot && rec.object.textContent !== ot) rec.object.textContent = ot;
}


function positionPrompts() {
  const proj = getProjection();
  if (!proj || typeof proj.project !== "function") return;
  for (const [id, rec] of promptPool) {
    if (rec.root.style.display === "none" || !rec._adornee) continue;
    const ap = posOf(rec._adornee);
    if (!ap) { rec.root.style.display = "none"; continue; }
    const sz = (() => { try { return rec._adornee.getProperty("Size"); } catch (_) { return null; } })();
    const topY = ap.y + (sz ? num(sz.y) / 2 + 1 : 2);
    const p = proj.project(ap.x, topY, ap.z);
    if (!p || !p.visible) { rec.root.style.display = "none"; continue; }
    rec.root.style.transform = `translate(${Math.round(p.x)}px,${Math.round(p.y)}px) translate(-50%,-50%)`;
  }
}


function updatePromptKeys() {
  const player = getPlayer && getPlayer();
  for (const [id, rec] of promptPool) {
    if (rec.root.style.display === "none") { promptKeyWasDown.set(id, false); continue; }
    const prompt = findPromptById(id);
    if (!prompt) continue;
    const keyName = prompt.getProperty("KeyboardKeyCode");
    const name = typeof keyName === "object" && keyName ? keyName.name : keyName;
    const code = KEYCODE_VALUES[name] || KEYCODE_VALUES.E;
    const down = !!(im && im.isKeyDown(code));
    const was = promptKeyWasDown.get(id) === true;
    const holdDur = clamp(num(prompt.getProperty("HoldDuration"), 0), 0, MAX_HOLD);

    if (down && !was) {

      if (holdDur <= 0) {
        triggerPrompt(prompt, player);
      } else {
        holdState = { id, startedAt: now(), duration: holdDur };
        fireEvent(prompt, "PromptButtonHoldBegan", [player]);
      }
    } else if (!down && was) {

      if (holdState && holdState.id === id) {
        fireEvent(prompt, "PromptButtonHoldEnded", [player]);
        setRing(rec, 0);
        holdState = null;
      }
    }
    promptKeyWasDown.set(id, down);
  }


  if (holdState) {
    const rec = promptPool.get(holdState.id);
    const prompt = findPromptById(holdState.id);
    if (!rec || !prompt || rec.root.style.display === "none") { holdState = null; }
    else {
      const frac = clamp((now() - holdState.startedAt) / (holdState.duration * 1000), 0, 1);
      setRing(rec, frac);
      if (frac >= 1) {
        triggerPrompt(prompt, getPlayer && getPlayer());
        fireEvent(prompt, "TriggerEnded", [getPlayer && getPlayer()]);
        setRing(rec, 0);
        promptKeyWasDown.set(holdState.id, true);                               
        holdState = null;
      }
    }
  }
}

function setRing(rec, frac) {
  if (!rec || !rec.ring) return;
  if (frac <= 0) { rec.ring.style.display = "none"; return; }
  rec.ring.style.display = "block";
  rec.ringFg.setAttribute("stroke-dashoffset", String(rec.circ * (1 - frac)));
}

function findPromptById(id) {
  const ws = workspace();
  if (!ws) return null;
  return ws.getDescendants().find((d) => d.className === "ProximityPrompt" && d.id === id) || null;
}


function frame() {
  if (!active) return;
  try {
    if (equippedTool) {

      const char = getChar && getChar();
      if (!char || equippedTool.getParent() !== char) {
        const t = equippedTool; equippedTool = null;
        restoreGripRotations();                                      
        if (equippedWeld) { try { equippedWeld.destroy(); } catch (_) {            } equippedWeld = null; }
      } else {
        repositionTool();
      }
    }
    refreshHotbar();
    updateHover();
    updatePrompts();
    updatePromptKeys();
  } catch (e) {
    log.warn(`gameplayObjects: ${(e && e.message) || e}`, { source: "Gameplay" });
  }
}

function onToolCommand(p) {
  if (!p || !active) return;
  if (p.type === "equip" && p.tool) equipTool(p.tool);
  else if (p.type === "unequip") { if (equippedTool) unequipTool(equippedTool); }
  else if (p.type === "activate") activateTool(p.tool);
  else if (p.type === "deactivate") deactivateTool(p.tool);
}

let offs = [];

function bindCas() {
  casBound = [];
  if (!im || typeof im.bindAction !== "function") return;
  const mk = (name, fn, priority, inputs) => {
    try { im.bindAction({ name, callback: nativeFn(fn, name), priority, inputs }); casBound.push(name); }
    catch (_) {            }
  };
  const stateName = (s) => (typeof s === "string" ? s : s && s.name ? s.name : null);


  mk("RswToolActivate", (args) => {
    const st = stateName(args[1]);
    if (equippedTool && equippedTool.getProperty("ManualActivationOnly") !== true) {
      if (st === "Begin") activateTool(equippedTool);
      else if (st === "End" || st === "Cancel") deactivateTool(equippedTool);
    }
    return ["Pass"];
  }, 100, ["MouseButton1"]);


  mk("RswClickLeft", (args) => {
    const st = stateName(args[1]);
    if (st === "Begin") onClick(false);
    return ["Pass"];
  }, 90, ["MouseButton1"]);
  mk("RswClickRight", (args) => {
    const st = stateName(args[1]);
    if (st === "Begin") onClick(true);
    return ["Pass"];
  }, 90, ["MouseButton2"]);


  mk("RswToolDrop", (args) => {
    const st = stateName(args[1]);
    if (st === "Begin" && equippedTool) dropTool(equippedTool);
    return ["Pass"];
  }, 100, ["Backspace"]);


  const digitInputs = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Zero"];
  mk("RswHotbar", (args) => {
    const st = stateName(args[1]);
    const io = args[2];
    const kc = io && io.keyCode;
    const name = typeof kc === "string" ? kc : kc && kc.name ? kc.name : null;
    if (st === "Begin" && name) {
      const idx = digitInputs.indexOf(name);
      if (idx >= 0) equipBySlot(idx);
    }
    return ["Pass"];
  }, 100, digitInputs);
}

function unbindCas() {
  if (im && typeof im.unbindAction === "function") {
    for (const n of casBound) { try { im.unbindAction(n); } catch (_) {            } }
  }
  casBound = [];
}

export const gameplay = {

  start(opts = {}) {
    if (active) this.stop();
    active = true;
    dm = opts.dataModel || null;
    getChar = opts.getCharacter || (() => null);
    getPlayer = opts.getLocalPlayer || (() => null);
    im = opts.inputManager || null;
    log = opts.logger || baseLogger;

    equippedTool = null; equippedWeld = null; toolActivated = false;
    gripRotOriginal.clear();
    hotbarTools = []; lastHotbarKey = "";
    hoverCD = null; lastHoverAt = 0; mouseMoved = true;
    lastProxAt = 0; holdState = null;
    shownPrompts.clear(); promptKeyWasDown.clear(); rateBuckets.clear(); dropCooldown.clear();

    offs = [];
    offs.push(bus.on("gameplay:toolCommand", onToolCommand));
    offs.push(bus.on("physics:touched", onTouched));

    if (typeof window !== "undefined") {
      const onMove = (e) => {
        if (lastMouse.x !== e.clientX || lastMouse.y !== e.clientY) { mouseMoved = true; lastMouse = { x: e.clientX, y: e.clientY }; }
      };
      window.addEventListener("pointermove", onMove, true);
      offs.push(() => window.removeEventListener("pointermove", onMove, true));
    }

    bindCas();
    unregisterFrameCallback = registerFrameCallback("simulation", frame, "gameplayObjects:tools");
  },

  stop() {
    active = false;
    if (unregisterFrameCallback) {
      unregisterFrameCallback();
      unregisterFrameCallback = null;
    }
    unbindCas();
    for (const off of offs) { try { off(); } catch (_) {            } }
    offs = [];

    if (hotbarEl && hotbarEl.parentNode) hotbarEl.parentNode.removeChild(hotbarEl);
    hotbarEl = null; slotPool.length = 0;
    if (promptContainer && promptContainer.parentNode) promptContainer.parentNode.removeChild(promptContainer);
    promptContainer = null; promptPool.clear();
    if (cursorHost) { cursorHost.style.cursor = savedCursor || ""; cursorHost = null; }
    equippedTool = null; equippedWeld = null; toolActivated = false;
    gripRotOriginal.clear();
    hoverCD = null; holdState = null;
    shownPrompts.clear(); promptKeyWasDown.clear(); rateBuckets.clear(); dropCooldown.clear();
    dm = null; getChar = null; getPlayer = null; im = null;
  },


  _repositionTool() { repositionTool(); },
  _dropTool(tool) { dropTool(tool || equippedTool); },
};

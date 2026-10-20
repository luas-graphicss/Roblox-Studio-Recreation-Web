import { sanitizeBoneTransform } from "../assets/skinRegistry.js";            


import {
  quatFromEulerDeg,
  eulerDegFromQuat,
  isIdentityQuat,
  composeBoneCF,
  mulBoneCF,
} from "../animation/boneCFrame.js";


function boneRotationQuat(node) {
  const tr = node.getProperty("TransformRotation");
  if (!tr || (!Number(tr.x) && !Number(tr.y) && !Number(tr.z))) return null;
  const q = quatFromEulerDeg(tr);
  return isIdentityQuat(q) ? null : q;
}
import { bus } from "../core/eventBus.js";


import { generateSecureUuid } from "../cloud/secureTokenGenerator.js";


import { wrapClockTime } from "../lighting/dayNight.js";


import { measureTextBounds, absoluteCanvasSize, layoutAbsoluteContentSize, computeGuiRect, liveGuiViewportSize, GUI_TOPBAR_INSET_Y, NOMINAL_W as GUI_NOMINAL_W, NOMINAL_H as GUI_NOMINAL_H } from "./guiMetrics.js";
import {
  Events,
  PropTypes,
  Enums,
  makeColor,
  makeVector3,
  makeVector2,
  makeUDim,
  makeUDim2,
  getClassDef,
  getService,
  createInstance,
  coerceValue,            
  valuesEqual,            
  makeCFrame,            
  makeRay,            
  collection,                                                 
} from "../datamodel/index.js";
import { LuaTable, LuaFunction, nativeFn, LuaError } from "./lua/interpreter.js";


import { getActivePlaceId, findLink } from "../cloud/cloudPublish.js";
import { Signal } from "./scheduler.js";
import { streaming } from "./streaming.js";                                    
import { createStreamGate } from "./streamingGate.js";                            
import { setWeather as climSetWeather, getCurrentWeather as climGetCurrentWeather, getWindVector as climGetWindVector, stopWeather as climStopWeather, onClimateEvent } from "../climate/climateRuntime.js";            
import * as social from "./social.js";
import * as DS from "./dataServices.js";                                    
import * as monetization from "./monetization.js";                                  
import * as MS from "./memoryStore.js";                                
import * as openCloud from "../cloud/openCloud.js";                                 
import { cameraSys, clampFov, toVerticalFov, fromVerticalFov } from "./cameraSystem.js";            
import {
  dsStatsRecordRequest, dsStatsRecordThrottle, dsStatsQueueEnter, dsStatsQueueLeave,
  dsStatsRecordFailure, dsStatsRecordResponse,
} from "../devconsole/dsStats.js";                                                 
import { project } from "../core/project.js";                                      
import { csgAsyncBuild } from "../core/modelOps.js";                            
import * as locCore from "../datamodel/localization.js";
import { getTestLocale } from "./localization.js";

import {
  ease,
  makeTweenInfo,
  tweenInfoEquals,
  tweenInfoToString,
  resolveEasingStyle,
  resolveEasingDirection,
  easingStyleItem,
  easingDirectionItem,
  playbackStateItem,
  createTweenManager,
} from "./tweens.js";

import {
  createInputManager,
  enumItemFor,
  ENUM_VALUE_OVERRIDES,
} from "./input.js";

import {
  HUMANOID_EVENTS,
  humMove,
  humMoveTo,
  humChangeState,
  humGetState,
  humSetStateEnabled,
  humGetStateEnabled,
  humGetMoveVelocity,
  humTakeDamage,
  humAddAccessory,
  humApplyDescription,
} from "./humanoid.js";

import {
  ensureAnimator,
  animLoadAnimation,
  animGetPlayingTracks,
  animTrackPlay,
  animTrackStop,
  animTrackAdjustSpeed,
  animTrackAdjustWeight,
  animGetTimeOfKeyframe,
} from "./animationTracks.js";

import {
  soundPlay,
  soundPause,
  soundResume,
  soundStop,
  playLocalSound,
  setAudioListener,
  getAudioListener,
} from "../audio/audioEngine.js";

import {
  registerGroup,
  unregisterGroup,
  setCollidable,
  areCollidable,
  getGroups,
  isRegistered,
} from "../physics/collisionGroups.js";
import {
  raycastWorkspace,
  getPartBoundsInBox,
  getPartBoundsInRadius,
  getPartsInPart,
  blockcast,
  spherecast,
  shapecast,
} from "../physics/raycast.js";
import { recordCast, recordOverlap } from "../viewport/spatialQueryDebug.js";
import { partPointToWorld } from "../physics/mathUtils.js";


import { queryBoxCandidates } from "../physics/sceneQueryIndex.js";
import { boundsOverlap, createWorldBounds } from "../physics/worldBounds.js";
import { writeAxisAlignedPartBounds } from "../physics/partBoundsWriter.js";



const touchingSelfBounds = createWorldBounds();
const touchingOtherBounds = createWorldBounds();
const touchingCandidates = [];


import {
  QUAT_IDENTITY,
  sanitizeQuat,
  quatFromEulerXYZ,
  quatFromEulerYXZ,
  quatFromAxisAngle,
  quatToEulerXYZ,
  quatToEulerYXZ,
  quatToMatrix,
  quatFromMatrixRows,
  quatToAxisAngle,
  quatFromBasis,
  quatLookRotation,
  quatSlerp,
  eulerDegToQuat,
  quatToEulerDeg,
  quatMultiply,
  quatConjugate,
  rotateVecByQuat,
} from "./cframeMath.js";

import { gripToCFrame, cframeToGrip } from "./gripMath.js";


import { JOINT_CLASSES, breakJoints, makeJoints, createNetworkOwnershipStore } from "./partJoints.js";
import { partMass, resizePart } from "./partMass.js";


import { meshRegistry } from "../assets/meshRegistry.js";


const networkOwners = createNetworkOwnershipStore();

import { createInterpolation } from "./cameraInterp.js";

import { network, sanitizeRemoteArgs } from "./network.js";

import { createPathfinder, hasActivePaths, PF_LIMITS } from "./pathfinding.js";

import { createPathfindingWatcher } from "./pathfindingWatcher.js";

import { terrainStore } from "../terrain/terrainStore.js";
import {
  VOXEL_SIZE as TERRAIN_VOXEL_SIZE,
  materialIndexByName as terrainMaterialIndex,
  hasMaterialName as isTerrainMaterialName,
} from "../terrain/materials.js";

import { fillBlockVoxels, regionToBox, expandRegionToGrid, TERRAIN_FILL_MAX_SPAN } from "../terrain/terrainFill.js";

const num = (v) => (typeof v === "number" ? v : Number(v) || 0);

function fmtNum(n) {
  if (typeof n !== "number") return String(n);
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}


function terrainScriptFill(kind, a) {
  const data = terrainStore.getData();
  if (!data) return;
  const V = TERRAIN_VOXEL_SIZE;
  const enumNameOf = (v) => (v && v.__ud === "EnumItem" ? String(v.name) : String(v == null ? "" : v));
  const clampSpan = (v) => Math.min(TERRAIN_FILL_MAX_SPAN, Math.max(0, num(v)));
  const matIdxOf = (v) => {
    const nm = enumNameOf(v);
    if (nm === "Air") return -1;                                     
    if (!isTerrainMaterialName(nm)) {


      throw new LuaError(
        "Terrain fill: material inv\u00e1lido (" + (nm || "nil") +
        ") \u2014 use um material de terreno, ex.: Enum.Material.Water, Rock, Grass.",
      );
    }
    return terrainMaterialIndex(nm);
  };
  const write = (vx, vy, vz, m) => {
    if (m < 0) data.set(vx, vy, vz, 0, 0);                     
    else data.set(vx, vy, vz, m, 1);
  };
  if (kind === "Clear") {
    data.clear();
  } else if (kind === "FillBlock") {
    const cf = a[1] || {};
    const size = a[2] || {};
    const m = matIdxOf(a[3]);
    const cx = num(cf.x), cy = num(cf.y), cz = num(cf.z);
    const sx = clampSpan(size.x), sy = clampSpan(size.y), sz = clampSpan(size.z);
    if (!(sx > 0 && sy > 0 && sz > 0)) return;
    if (!Number.isFinite(cx + cy + cz)) return;                   


    fillBlockVoxels(cx, cy, cz, sx, sy, sz, cfQuat(cf), (vx, vy, vz) => write(vx, vy, vz, m));
  } else if (kind === "FillBall") {
    const c = a[1] || {};
    const r = clampSpan(a[2]);
    const m = matIdxOf(a[3]);
    if (!(r > 0)) return;
    const cx = num(c.x), cy = num(c.y), cz = num(c.z);
    if (!Number.isFinite(cx + cy + cz)) return;
    for (let z = Math.floor((cz - r) / V); z <= Math.floor((cz + r) / V); z++) {
      for (let y = Math.floor((cy - r) / V); y <= Math.floor((cy + r) / V); y++) {
        for (let x = Math.floor((cx - r) / V); x <= Math.floor((cx + r) / V); x++) {
          const dx = (x + 0.5) * V - cx;
          const dy = (y + 0.5) * V - cy;
          const dz = (z + 0.5) * V - cz;
          if (dx * dx + dy * dy + dz * dz <= r * r) write(x, y, z, m);
        }
      }
    }
  } else if (kind === "FillRegion") {


    const region = a[1];
    if (!region || region.__ud !== "Region3") {
      throw new LuaError("Terrain:FillRegion \u2014 o 1\u00ba argumento deve ser um Region3 (use Region3.new(min, max)).");
    }
    const res = num(a[2]);
    if (res !== V) {

      throw new LuaError("Terrain:FillRegion \u2014 resolution deve ser " + V + " (grade de voxels do terreno).");
    }
    const m = matIdxOf(a[3]);
    const box = regionToBox(region.min, region.max);
    if (!box) return;                                                
    const sx = clampSpan(box.sx), sy = clampSpan(box.sy), sz = clampSpan(box.sz);
    if (!(sx > 0 && sy > 0 && sz > 0)) return;
    if (!Number.isFinite(box.cx + box.cy + box.cz)) return;
    fillBlockVoxels(box.cx, box.cy, box.cz, sx, sy, sz, null, (vx, vy, vz) => write(vx, vy, vz, m));
  } else {
    throw new LuaError("Terrain:" + kind + " n\u00e3o \u00e9 suportado.");
  }
  terrainStore.notifyChanged();
}


const V3 = (x, y, z) => ({ __ud: "Vector3", x: num(x), y: num(y), z: num(z) });
const V2 = (x, y) => ({ __ud: "Vector2", x: num(x), y: num(y) });
const COL = (r, g, b) => ({ __ud: "Color3", r: num(r), g: num(g), b: num(b) });


const CF = (x, y, z, q) => {
  const s = q ? sanitizeQuat(q) : QUAT_IDENTITY;
  return { __ud: "CFrame", x: num(x), y: num(y), z: num(z), qx: s.x, qy: s.y, qz: s.z, qw: s.w };
};

const cfQuat = (cf) => sanitizeQuat(
  cf ? { x: cf.qx, y: cf.qy, z: cf.qz, w: cf.qw == null ? 1 : cf.qw } : null,
);

const cfCompose = (a, b) => {
  const qa = cfQuat(a);
  const r = rotateVecByQuat({ x: num(b.x), y: num(b.y), z: num(b.z) }, qa);
  return CF(num(a.x) + r.x, num(a.y) + r.y, num(a.z) + r.z, quatMultiply(qa, cfQuat(b)));
};
const cfInverse = (cf) => {
  const qi = quatConjugate(cfQuat(cf));
  const r = rotateVecByQuat({ x: -num(cf.x), y: -num(cf.y), z: -num(cf.z) }, qi);
  return CF(r.x, r.y, r.z, qi);
};
const UD = (s, o) => ({ __ud: "UDim", scale: num(s), offset: num(o) });
const UD2 = (xs, xo, ys, yo) => ({
  __ud: "UDim2", xScale: num(xs), xOffset: num(xo), yScale: num(ys), yOffset: num(yo),
});

const RAY = (o, d) => ({
  __ud: "Ray",
  origin: { x: num(o && o.x), y: num(o && o.y), z: num(o && o.z) },
  direction: { x: num(d && d.x), y: num(d && d.y), z: num(d && d.z) },
});

const REGION3 = (mn, mx) => ({
  __ud: "Region3",
  min: { x: num(mn && mn.x), y: num(mn && mn.y), z: num(mn && mn.z) },
  max: { x: num(mx && mx.x), y: num(mx && mx.y), z: num(mx && mx.z) },
});
const BC = (name) => ({ __ud: "BrickColor", name: String(name) });
const FONT = (family, weight, style) => ({
  __ud: "Font",
  family: String(family),
  weight: weight != null ? String(weight) : "Regular",
  style: style != null ? String(style) : "Normal",
});
const NSKP = (time, value, envelope) => ({
  __ud: "NumberSequenceKeypoint", time: num(time), value: num(value), envelope: num(envelope),
});
const NSEQ = (keypoints) => ({ __ud: "NumberSequence", keypoints: keypoints || [] });
const CSKP = (time, color) => ({ __ud: "ColorSequenceKeypoint", time: num(time), value: color });
const CSEQ = (keypoints) => ({ __ud: "ColorSequence", keypoints: keypoints || [] });

const EVENT_NAMES = new Set([
  "ChildAdded", "ChildRemoved", "Changed", "AncestryChanged", "Destroying",
  "DescendantAdded", "DescendantRemoving",
  "AttributeChanged",            

  "Touched", "TouchEnded", "MouseClick", "Activated", "MouseButton1Click",


  "Ended", "Played", "Paused", "Resumed", "Stopped", "Loaded",

  "PlayerAdded", "PlayerRemoving", "CharacterAdded", "CharacterRemoving",

  "PlayerRemoved", "Chatted", "Idled", "CharacterAppearanceLoaded", "OnTeleport",
  "PlayerMembershipChanged", "MessageReceived", "OnIncomingMessage", "OnBubbleAdded",
  "PersistentLoaded",
]);


for (const e of HUMANOID_EVENTS) EVENT_NAMES.add(e);


for (const e of ["AnimationPlayed", "KeyframeReached", "DidLoop"]) EVENT_NAMES.add(e);


const GAMEPLAY_EVENT_NAMES = new Set([
  "Equipped", "Unequipped", "Activated", "Deactivated",
  "MouseClick", "RightMouseClick", "MouseHoverEnter", "MouseHoverLeave",
  "Triggered", "TriggerEnded", "PromptButtonHoldBegan", "PromptButtonHoldEnded",
  "PromptShown", "PromptHidden",
  "DragStart", "DragContinue", "DragEnd",


  "MouseButton1Down", "MouseButton1Up", "MouseDrag",


  "MouseButton1Click",


  "Focused", "FocusLost",
]);
for (const e of GAMEPLAY_EVENT_NAMES) EVENT_NAMES.add(e);


const guiFocusState = { box: null };
bus.on("gameplay:event", (p) => {
  if (!p || !p.instance) return;
  if (p.type === "Focused") guiFocusState.box = p.instance;
  else if (p.type === "FocusLost" && guiFocusState.box === p.instance) guiFocusState.box = null;
});


const AUDIO_EVENT_NAMES = new Set(["Ended", "Played", "Paused", "Resumed", "Stopped", "Loaded"]);


AUDIO_EVENT_NAMES.add("DidLoop");
EVENT_NAMES.add("DidLoop");


const PLAYER_SOCIAL_EVENTS = new Set(["Chatted", "Idled", "CharacterAppearanceLoaded", "OnTeleport", "PlayerMembershipChanged"]);
const CHAT_EVENTS = new Set(["MessageReceived", "OnIncomingMessage", "OnBubbleAdded", "Triggered"]);


const SERVER_ONLY_SERVICES = new Set(["ServerScriptService", "ServerStorage"]);


const VALUE_OBJECT_CLASSES = new Set([
  "StringValue", "BoolValue", "IntValue", "NumberValue", "ObjectValue",
  "Color3Value", "BrickColorValue", "Vector3Value", "CFrameValue", "RayValue",
  "IntConstrainedValue", "DoubleConstrainedValue",
]);


function inferAttributeType(value) {
  const t = typeof value;
  if (t === "string") return "string";
  if (t === "boolean") return "boolean";
  if (t === "number") return "number";
  if (value && typeof value === "object") {
    switch (value.__ud) {
      case "Vector3": return "Vector3";
      case "Vector2": return "Vector2";
      case "Color3": return "Color3";
      case "UDim": return "UDim";
      case "UDim2": return "UDim2";
      case "CFrame": return "CFrame";
      case "NumberRange": return "NumberRange";
      case "Rect": return "Rect";
      case "BrickColor": return "BrickColor";
      case "Font": return "Font";
      case "NumberSequence": return "NumberSequence";
      case "ColorSequence": return "ColorSequence";
      default: return null;
    }
  }
  return null;
}


function attrValueFromLua(type, value) {
  switch (type) {
    case "string": case "boolean": case "number": return value;
    case "Vector3": return { x: num(value.x), y: num(value.y), z: num(value.z) };
    case "CFrame": {                                                   
      const q = cfQuat(value);
      return { x: num(value.x), y: num(value.y), z: num(value.z), qx: q.x, qy: q.y, qz: q.z, qw: q.w };
    }
    case "Vector2": return { x: num(value.x), y: num(value.y) };
    case "Color3": return { r: num(value.r), g: num(value.g), b: num(value.b) };
    case "UDim": return { scale: num(value.scale), offset: num(value.offset) };
    case "UDim2": return { xScale: num(value.xScale), xOffset: num(value.xOffset), yScale: num(value.yScale), yOffset: num(value.yOffset) };
    case "NumberRange": return { min: num(value.min), max: num(value.max) };
    case "Rect": return { minX: num(value.minX), minY: num(value.minY), maxX: num(value.maxX), maxY: num(value.maxY) };
    case "BrickColor": return String(value && value.name != null ? value.name : value);
    case "Font": return String(value && value.family != null ? value.family : value);
    case "NumberSequence":
      return { keypoints: (value.keypoints || []).map((k) => ({ time: num(k.time), value: num(k.value), envelope: num(k.envelope) })) };
    case "ColorSequence":
      return { keypoints: (value.keypoints || []).map((k) => ({ time: num(k.time), color: { r: num(k.value.r), g: num(k.value.g), b: num(k.value.b) } })) };
    default: return value;
  }
}


function attrValueToLua(type, value) {
  switch (type) {
    case "string": case "boolean": case "number": return value;
    case "Vector3": return V3(value.x, value.y, value.z);
    case "CFrame": return CF(value.x, value.y, value.z,
      value.qw == null ? null : { x: value.qx, y: value.qy, z: value.qz, w: value.qw });
    case "Vector2": return V2(value.x, value.y);
    case "Color3": return COL(value.r, value.g, value.b);
    case "UDim": return UD(value.scale, value.offset);
    case "UDim2": return UD2(value.xScale, value.xOffset, value.yScale, value.yOffset);
    case "NumberRange": return { __ud: "NumberRange", min: value.min, max: value.max };
    case "Rect": return { __ud: "Rect", minX: value.minX, minY: value.minY, maxX: value.maxX, maxY: value.maxY };
    case "BrickColor": return BC(value);
    case "Font": return FONT(value);
    case "NumberSequence": return NSEQ((value.keypoints || []).map((k) => NSKP(k.time, k.value, k.envelope)));
    case "ColorSequence": return CSEQ((value.keypoints || []).map((k) => CSKP(k.time, COL(k.color.r, k.color.g, k.color.b))));
    default: return value;
  }
}


function luaToSerializable(v, depth, seen, label) {
  label = label || "valor";
  depth = depth || 0;
  if (depth > DS.DS_LIMITS.jsonMaxDepth) {
    throw new LuaError(`${label}: profundidade máxima de ${DS.DS_LIMITS.jsonMaxDepth} níveis excedida.`);
  }
  if (v === undefined || v === null) return null;
  const t = typeof v;
  if (t === "number") {
    if (!Number.isFinite(v)) throw new LuaError(`${label}: números NaN/Infinity não são serializáveis.`);
    return v;
  }
  if (t === "string" || t === "boolean") return v;
  if (t === "function" || (v && v.__native)) throw new LuaError(`${label}: funções não podem ser salvas/serializadas.`);
  if (v && v.__isInstance) throw new LuaError(`${label}: Instances não podem ser salvas/serializadas.`);
  if (v && typeof v.__ud === "string") throw new LuaError(`${label}: userdata (${v.__ud}) não pode ser salvo/serializado.`);
  if (v instanceof LuaTable) {
    seen = seen || new Set();
    if (seen.has(v)) throw new LuaError(`${label}: referência circular detectada.`);
    seen.add(v);
    const out = luaTableToJs(v, depth, seen, label);
    seen.delete(v);
    return out;
  }
  throw new LuaError(`${label}: tipo não serializável.`);
}

function luaTableToJs(t, depth, seen, label) {
  const len = t.length();
  const keys = [...t.map.keys()];
  const extra = keys.filter((k) => !(typeof k === "number" && Number.isInteger(k) && k >= 1 && k <= len));

  if (extra.length === 0) {
    const arr = [];
    for (let i = 1; i <= len; i++) arr.push(luaToSerializable(t.rawget(i), depth + 1, seen, label));
    return arr;
  }

  const obj = {};
  for (let i = 1; i <= len; i++) {
    const val = t.rawget(i);
    if (val !== undefined && val !== null) obj[String(i)] = luaToSerializable(val, depth + 1, seen, label);
  }
  for (const k of keys) {
    if (typeof k === "number" && Number.isInteger(k) && k >= 1 && k <= len) continue;
    if (typeof k !== "string" && typeof k !== "number") {
      throw new LuaError(`${label}: chaves de tabela devem ser strings ou números.`);
    }
    const val = t.map.get(k);
    if (val === undefined || val === null) continue;
    obj[String(k)] = luaToSerializable(val, depth + 1, seen, label);
  }
  return obj;
}


function serializableToLua(v, depth) {
  depth = depth || 0;
  if (depth > DS.DS_LIMITS.jsonMaxDepth) {
    throw new LuaError(`JSON: profundidade máxima de ${DS.DS_LIMITS.jsonMaxDepth} níveis excedida.`);
  }
  if (v === null || v === undefined) return undefined;
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean") return v;
  if (Array.isArray(v)) {
    const tbl = new LuaTable();
    v.forEach((item, i) => {
      const lv = serializableToLua(item, depth + 1);
      if (lv !== undefined) tbl.rawset(i + 1, lv);
    });
    return tbl;
  }
  if (t === "object") {
    const tbl = new LuaTable();
    for (const k of Object.keys(v)) {
      const lv = serializableToLua(v[k], depth + 1);
      if (lv !== undefined) tbl.rawset(k, lv);
    }
    return tbl;
  }
  return undefined;
}


function* awaitPromise(promise) {
  const box = { done: false, value: undefined, error: null };
  Promise.resolve(promise).then(
    (val) => { box.value = val; box.done = true; },
    (err) => { box.error = err; box.done = true; },
  );
  while (!box.done) yield { kind: "wait", seconds: 0 };
  if (box.error) {
    throw box.error instanceof LuaError
      ? box.error
      : new LuaError(box.error && box.error.message ? box.error.message : String(box.error));
  }
  return box.value;
}

function generateGuidV4(wrapInBraces) {
  const uuid = generateSecureUuid().toUpperCase();
  return wrapInBraces ? `{${uuid}}` : uuid;
}

function urlEncodeRfc3986(str) {
  return encodeURIComponent(String(str)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

const HTTP_STATUS_TEXT = {
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
  301: "Moved Permanently", 302: "Found", 304: "Not Modified",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
  408: "Request Timeout", 429: "Too Many Requests", 500: "Internal Server Error",
  502: "Bad Gateway", 503: "Service Unavailable",
};
function httpStatusText(code) { return HTTP_STATUS_TEXT[code] || "Unknown"; }

const DS_MAX_QUEUE = 30;                                                               

export function createBridge(options = {}) {
  const dataModel = options.dataModel;
  const scheduler = options.scheduler;
  const logger = options.logger || null;
  const getMode = options.getMode || (() => "run");

  const getPhysics = options.getPhysics || (() => null);

  const context = options.context === "client" ? "client" : "server";

  const playtestApi = options.playtest || null;

  const subs = [];                                       
  const moduleCache = new Map();                                             
  const moduleLoading = new Set();                                           
  const instSignals = new WeakMap();                                    
  const markerSignals = new WeakMap();                                                 


  const bindableOnInvoke = new Map();
  const bindableDepth = new Map();

  const tweenManager = createTweenManager({ scheduler, logger, dataModel });
  scheduler.onTweens = (dt) => tweenManager.step(dt);

  const inputManager = createInputManager({ scheduler, logger, dataModel, getMode });
  scheduler.onInput = (dt) => inputManager.step(dt);
  let interp = null;


  const runService = { __ud: "Service", serviceName: "RunService" };

  function arrayToTable(arr) {
    const t = new LuaTable();
    arr.forEach((v, i) => t.rawset(i + 1, v));
    return t;
  }


  function makeEnumItem(enumName, name, idx) {
    const ov = ENUM_VALUE_OVERRIDES[enumName];
    if (ov && ov[name] != null) return enumItemFor(enumName, name);
    return { __ud: "EnumItem", enumType: enumName, name, value: idx };
  }


  function actionInfoTable(info) {
    if (!info) return undefined;
    const t = new LuaTable();
    t.rawset("priorityLevel", info.priority);
    t.rawset("createTouchButton", !!info.createTouchButton);
    t.rawset("inputTypes", arrayToTable(info.inputItems.map((it) => enumItemFor(it.enumType, it.name))));

    if (info.title != null) t.rawset("title", String(info.title));
    return t;
  }

  function isA(inst, target) {
    let c = inst.className;
    while (c) {
      if (c === target) return true;
      const def = getClassDef(c);
      c = def && def.extends;
    }
    return false;
  }

  function getPropType(inst, key) {
    const e = inst._props && inst._props.get(key);
    return e && e.def ? e.def.type : null;
  }


  function convertOut(type, value) {
    if (value === null || value === undefined) return undefined;
    switch (type) {
      case PropTypes.Vector3: return V3(value.x, value.y, value.z);
      case PropTypes.Vector2: return V2(value.x, value.y);
      case PropTypes.Color: return COL(value.r, value.g, value.b);
      case PropTypes.UDim: return UD(value.scale, value.offset);
      case PropTypes.UDim2: return UD2(value.xScale, value.xOffset, value.yScale, value.yOffset);
      case PropTypes.NumberRange: return { __ud: "NumberRange", min: value.min, max: value.max };            
      case PropTypes.Rect: return { __ud: "Rect", minX: value.minX, minY: value.minY, maxX: value.maxX, maxY: value.maxY };            
      case PropTypes.CFrame:                                        
        return CF(value.x, value.y, value.z,
          value.qw == null ? null : { x: value.qx, y: value.qy, z: value.qz, w: value.qw });
      case PropTypes.Ray: return RAY(value.origin, value.direction);            
      default: return value;                                               
    }
  }

  function convertIn(type, value) {
    if (value === undefined || value === null) return null;
    switch (type) {
      case PropTypes.Vector3:
        return makeVector3(num(value.x), num(value.y), num(value.z));
      case PropTypes.Vector2:
        return makeVector2(num(value.x), num(value.y));
      case PropTypes.Color:
        return makeColor(num(value.r), num(value.g), num(value.b));
      case PropTypes.UDim:
        return makeUDim(num(value.scale), num(value.offset));
      case PropTypes.UDim2:
        return makeUDim2(num(value.xScale), num(value.xOffset), num(value.yScale), num(value.yOffset));
      case PropTypes.NumberRange:            
        return typeof value === "number"
          ? { min: value, max: value }
          : { min: num(value.min), max: num(value.max) };
      case PropTypes.Rect:            
        return { minX: num(value.minX), minY: num(value.minY), maxX: num(value.maxX), maxY: num(value.maxY) };
      case PropTypes.CFrame: {                                      
        const q = cfQuat(value);
        return makeCFrame(num(value.x), num(value.y), num(value.z), q.x, q.y, q.z, q.w);
      }
      case PropTypes.Ray:            
        return makeRay(value.origin || {}, value.direction || {});
      case PropTypes.Enum:
        return value && value.__ud === "EnumItem" ? value.name : value;
      default:
        return value;
    }
  }


  function signalFor(inst, eventName) {
    let map = instSignals.get(inst);
    if (!map) { map = new Map(); instSignals.set(inst, map); }
    if (map.has(eventName)) return map.get(eventName);
    const sig = streamGate.gateSignal(new Signal(scheduler, eventName), inst);
    map.set(eventName, sig);
    let off = null;
    if (inst.className === "Humanoid" && HUMANOID_EVENTS.has(eventName)) {



      off = bus.on("humanoid:event", (p) => {
        if (p && p.humanoid === inst && p.type === eventName) {
          sig.fire(Array.isArray(p.args) ? p.args : []);
        }
      });
    } else if (inst.className === "AnimationTrack" && (eventName === "Stopped" || eventName === "Ended" || eventName === "KeyframeReached" || eventName === "DidLoop")) {


      off = bus.on("animtrack:event", (p) => {
        if (p && p.track === inst && p.type === eventName) {
          sig.fire(Array.isArray(p.args) ? p.args : []);
        }
      });
    } else if (inst.className === "Animator" && eventName === "AnimationPlayed") {

      off = bus.on("animtrack:event", (p) => {
        if (p && p.animator === inst && p.type === eventName) {
          sig.fire(Array.isArray(p.args) ? p.args : []);
        }
      });
    } else if (inst.className === "ClimateService" && (eventName === "WeatherChanged" || eventName === "WindChanged")) {

      off = onClimateEvent((type, a, b) => {
        if (type !== eventName) return;
        if (type === "WindChanged") {
          sig.fire([makeVector3(a.x, a.y, a.z), makeVector3(b.x, b.y, b.z)]);
        } else {
          sig.fire([a, b]);
        }
      });
    } else if (eventName === "ChildAdded") {
      const offBus = bus.on(Events.ChildAdded, (p) => { if (p.parent === inst) sig.fire([p.child]); });

      const offStream = context === "client" ? bus.on("streaming:clientDiff", (p) => {
        if (!p || p.clientId !== streamClientId()) return;
        for (const ch of p.streamedIn) { try { if (ch && ch.getParent && ch.getParent() === inst) sig.fire([ch]); } catch (_) {            } }
      }) : null;
      off = () => { offBus(); if (offStream) offStream(); };
    } else if (eventName === "ChildRemoved") {
      const offBus = bus.on(Events.ChildRemoved, (p) => { if (p.parent === inst) sig.fire([p.child]); });

      const offStream = context === "client" ? bus.on("streaming:clientDiff", (p) => {
        if (!p || p.clientId !== streamClientId()) return;
        for (const ch of p.streamedOut) { try { if (ch && ch.getParent && ch.getParent() === inst) sig.fire([ch]); } catch (_) {            } }
      }) : null;
      off = () => { offBus(); if (offStream) offStream(); };
    } else if (eventName === "Changed") {
      off = bus.on(Events.PropertyChanged, (p) => {
        if (p.instance !== inst) return;

        if (VALUE_OBJECT_CLASSES.has(inst.className) && p.property === "Value") {
          sig.fire([valueObjectOut(inst)]);
        } else {
          sig.fire([p.property]);
        }
      });
    } else if (eventName === "AttributeChanged") {

      off = bus.on(Events.AttributeChanged, (p) => { if (p.instance === inst) sig.fire([p.name]); });
    } else if (eventName === "AncestryChanged") {
      off = bus.on(Events.ParentChanged, (p) => { if (p.instance === inst) sig.fire([p.instance, p.newParent]); });
    } else if (eventName === "Destroying") {
      off = bus.on(Events.Destroying, (p) => { if (p.instance === inst) sig.fire([]); });
    } else if (eventName === "DescendantAdded") {
      const offBus = bus.on(Events.ChildAdded, (p) => { if (p.parent && p.parent !== inst && isDescendantOf(p.parent, inst)) sig.fire([p.child]); });

      const offStream = context === "client" ? bus.on("streaming:clientDiff", (p) => {
        if (!p || p.clientId !== streamClientId()) return;
        for (const ch of p.streamedIn) { try { if (ch && isDescendantOf(ch, inst)) sig.fire([ch]); } catch (_) {            } }
      }) : null;
      off = () => { offBus(); if (offStream) offStream(); };
    } else if (eventName === "DescendantRemoving") {


      off = context === "client" ? bus.on("streaming:clientDiff", (p) => {
        if (!p || p.clientId !== streamClientId()) return;
        for (const ch of p.streamedOut) { try { if (ch && isDescendantOf(ch, inst)) sig.fire([ch]); } catch (_) {            } }
      }) : undefined;
    } else if (eventName === "PersistentLoaded" && inst.className === "Workspace") {
      off = bus.on("streaming:persistentLoaded", (p) => {
        if (!p) return;
        if (context === "client" && p.clientId !== streamClientId()) return;
        sig.fire([p.player || undefined]);
      });
    } else if (eventName === "Touched") {


      off = bus.on("physics:touched", (p) => {
        if (p.a === inst) { if (!streamHusk(p.b)) sig.fire([p.b]); }
        else if (p.b === inst) { if (!streamHusk(p.a)) sig.fire([p.a]); }
      });
    } else if (eventName === "TouchEnded") {
      off = bus.on("physics:touchEnded", (p) => {
        if (p.a === inst) { if (!streamHusk(p.b)) sig.fire([p.b]); }
        else if (p.b === inst) { if (!streamHusk(p.a)) sig.fire([p.a]); }
      });
    } else if (inst.className === "Team" && (eventName === "PlayerAdded" || eventName === "PlayerRemoved")) {
      off = bus.on("teams:event", (p) => {
        if (p && p.team === inst && p.type === eventName) sig.fire(Array.isArray(p.args) ? p.args : []);
      });
    } else if (inst.className === "Player" && PLAYER_SOCIAL_EVENTS.has(eventName)) {
      off = bus.on("player:event", (p) => {
        if (p && p.instance === inst && p.type === eventName) sig.fire(Array.isArray(p.args) ? p.args : []);
      });
    } else if ((inst.className === "TextChannel" || inst.className === "TextChatService" || inst.className === "TextChatCommand") && CHAT_EVENTS.has(eventName)) {
      off = bus.on("chat:event", (p) => {
        if (p && p.instance === inst && p.type === eventName) sig.fire(Array.isArray(p.args) ? p.args : []);
      });
    } else if (eventName === "PlayerAdded" || eventName === "PlayerRemoving") {

      const evt = eventName === "PlayerAdded" ? "playtest:playerAdded" : "playtest:playerRemoving";
      off = bus.on(evt, (p) => {
        if (inst.className === "Players" && p && p.player) sig.fire([p.player]);
      });
    } else if (eventName === "CharacterAdded" || eventName === "CharacterRemoving") {

      const evt = eventName === "CharacterAdded" ? "playtest:characterAdded" : "playtest:characterRemoving";
      off = bus.on(evt, (p) => {
        if (p && p.player === inst && p.character) sig.fire([p.character]);
      });
    } else if (AUDIO_EVENT_NAMES.has(eventName)) {


      off = bus.on("audio:event", (p) => {
        if (p && p.instance === inst && p.type === eventName) {
          if (eventName === "DidLoop") sig.fire([String(p.soundId || ""), num(p.loops, 0)]);
          else sig.fire([String(p.soundId || "")]);
        }
      });
    } else if (GAMEPLAY_EVENT_NAMES.has(eventName)) {


      off = bus.on("gameplay:event", (p) => {
        if (p && p.instance === inst && p.type === eventName) {
          sig.fire(Array.isArray(p.args) ? p.args : []);
        }
      });
    } else if (eventName === "AutoTranslateWillRun" && inst.className === "LocalizationService") {
      off = bus.on("localization:autoTranslateWillRun", (p) => {
        sig.fire([p && p.gui ? p.gui : undefined]);
      });
    }

    if (off) subs.push(off);
    return sig;
  }


  function markerSignalFor(inst, markerName) {
    let map = markerSignals.get(inst);
    if (!map) { map = new Map(); markerSignals.set(inst, map); }
    if (map.has(markerName)) return map.get(markerName);
    const sig = new Signal(scheduler, "MarkerReached:" + markerName);
    map.set(markerName, sig);


    const off = bus.on("anim:marker", (p) => {
      if (p && p.instanceId === inst.id && p.name === markerName) {
        sig.fire([p.param != null ? p.param : ""]);
      }
    });
    subs.push(off);
    return sig;
  }

  function isDescendantOf(node, ancestor) {
    let p = node;
    while (p) {
      if (p === ancestor) return true;
      p = p.getParent ? p.getParent() : null;
    }
    return false;
  }


  function isUnderServerOnly(node) {
    let p = node;
    while (p) {
      if (SERVER_ONLY_SERVICES.has(p.className)) return true;
      p = p.getParent ? p.getParent() : null;
    }
    return false;
  }

  function serverOnlyHidden(node) {
    if (context !== "client" || !node || node.__isInstance !== true) return false;
    if (isUnderServerOnly(node)) return true;


    return !streamLoadedHere(node);
  }

  const streamGate = createStreamGate({
    context,
    getLocalPlayer: () => (playtestApi && playtestApi.getLocalPlayer ? playtestApi.getLocalPlayer() : null),
  });
  function streamClientId() { return streamGate.clientId(); }
  function streamLoadedHere(node) { return streamGate.loadedHere(node); }
  function streamHusk(inst) { return streamGate.isHusk(inst); }


  const CLIENT_OWNED_CLASSES = new Set(["Camera", "PlayerGui", "Backpack", "PlayerScripts", "StarterGear"]);
  const authorityWarned = new Set();

  function clientOwns(inst) {
    const lp = playtestApi && playtestApi.getLocalPlayer ? playtestApi.getLocalPlayer() : null;
    const ch = playtestApi && playtestApi.getCharacter ? playtestApi.getCharacter() : null;
    let p = inst;
    while (p) {
      if (p.__netContext === "client") return true;
      if (CLIENT_OWNED_CLASSES.has(p.className)) return true;
      if (lp && p === lp) return true;
      if (ch && p === ch) return true;
      p = p.getParent ? p.getParent() : null;
    }
    return false;
  }


  function clientCanMutate(inst, action) {
    if (context !== "client") return true;
    if (clientOwns(inst)) return true;
    const k = String(inst.id) + "|" + action;
    if (!authorityWarned.has(k) && logger) {
      authorityWarned.add(k);
      logger.warn(
        `O Client n\u00e3o pode alterar "${inst.name}" (objeto replicado do Server). A altera\u00e7\u00e3o foi ignorada \u2014 use RemoteEvent/RemoteFunction para solicitar ao Server.`,
      );
    }
    return false;
  }

  function propChangedSignal(inst, propName) {
    const sig = streamGate.gateSignal(new Signal(scheduler, "PropChanged:" + propName), inst);

    if (propName.startsWith("Attribute_")) {
      const attrName = propName.slice("Attribute_".length);
      const offAttr = bus.on(Events.AttributeChanged, (p) => {
        if (p.instance === inst && p.name === attrName) sig.fire([]);
      });
      subs.push(offAttr);
      return sig;
    }
    const off = bus.on(Events.PropertyChanged, (p) => {
      if (p.instance === inst && p.property === propName) sig.fire([]);
    });
    subs.push(off);
    return sig;
  }


  function attributeChangedSignal(inst, attrName) {
    const sig = streamGate.gateSignal(new Signal(scheduler, "AttrChanged:" + attrName), inst);
    const off = bus.on(Events.AttributeChanged, (p) => {
      if (p.instance === inst && p.name === attrName) sig.fire([]);
    });
    subs.push(off);
    return sig;
  }


  function valueObjectOut(inst) {
    if (inst.className === "BrickColorValue") return BC(inst.getProperty("Value"));
    if (inst.className === "ObjectValue") {
      const ref = inst.getProperty("Value");
      return ref && !ref._destroyed ? ref : undefined;
    }
    return convertOut(getPropType(inst, "Value"), inst.getProperty("Value"));
  }


  const collectionSignals = new Map();                             
  function collectionTagSignal(tag, dir) {
    const k = dir + "|" + tag;
    let sig = collectionSignals.get(k);
    if (sig) return sig;
    sig = new Signal(scheduler, "Collection:" + k);
    collectionSignals.set(k, sig);
    const evt = dir === "added" ? "collection:added" : "collection:removed";
    const off = bus.on(evt, (p) => {
      if (p && p.tag === tag && !serverOnlyHidden(p.instance)) sig.fire([p.instance]);
    });
    subs.push(off);
    return sig;
  }


  function collectionServiceIndex(inst, key) {
    switch (key) {
      case "AddTag":
        return nativeFn((a) => {
          const target = a[1];
          if (target && target.addTag && clientCanMutate(target, "AddTag")) target.addTag(String(a[2]));
          return [];
        }, "AddTag");
      case "RemoveTag":
        return nativeFn((a) => {
          const target = a[1];
          if (target && target.removeTag && clientCanMutate(target, "RemoveTag")) target.removeTag(String(a[2]));
          return [];
        }, "RemoveTag");
      case "HasTag":
        return nativeFn((a) => [!!(a[1] && a[1].hasTag && a[1].hasTag(String(a[2])))], "HasTag");
      case "GetTags":
        return nativeFn((a) => [arrayToTable(a[1] && a[1].getTags ? a[1].getTags() : [])], "GetTags");
      case "GetTagged":
        return nativeFn((a) => {
          const res = collection.getTagged(String(a[1]));
          if (res.truncated && logger) logger.warn(`CollectionService:GetTagged("${a[1]}") truncado em 100000 inst\u00e2ncias.`);
          return [arrayToTable(res.instances.filter((i) => !serverOnlyHidden(i)))];
        }, "GetTagged");
      case "GetAllTags":
        return nativeFn(() => [arrayToTable(collection.getAllTags())], "GetAllTags");
      case "GetInstanceAddedSignal":
        return nativeFn((a) => [collectionTagSignal(String(a[1]), "added")], "GetInstanceAddedSignal");
      case "GetInstanceRemovedSignal":
        return nativeFn((a) => [collectionTagSignal(String(a[1]), "removed")], "GetInstanceRemovedSignal");
      default:
        return undefined;
    }
  }


  function destroyInstance(inst) {
    if (inst.isLocked && inst.isLocked()) {
      throw new LuaError(`N\u00e3o \u00e9 permitido destruir uma inst\u00e2ncia protegida (${inst.className})`);
    }
    if (!clientCanMutate(inst, "destroy")) return;                         
    inst.destroy();
  }


  const physicsService = { __ud: "Service", serviceName: "PhysicsService" };


  const dataStoreService = { __ud: "Service", serviceName: "DataStoreService" };
  const httpService = { __ud: "Service", serviceName: "HttpService" };
  const messagingService = { __ud: "Service", serviceName: "MessagingService" };
  const teleportService = { __ud: "Service", serviceName: "TeleportService" };
  const teleportInitFailed = new Signal(scheduler, "TeleportInitFailed");
  const msgTopics = new Map();                        
  const dsQueueDepth = new Map();                                       
  let httpEnabledOverride = null;                                                 


  const cloudService = { __ud: "Service", serviceName: "CloudService" };
  subs.push(bus.on("cloud:openCloudMessage", (p) => {
    if (!p || context === "client") return;
    const set = msgTopics.get(String(p.topic || ""));
    if (!set || !set.size) return;
    const sent = Date.now() / 1000;
    for (const handler of [...set]) {
      const data = new LuaTable();
      data.rawset("Data", serializableToLua(p.data));
      data.rawset("Sent", sent);
      scheduler.spawnFn(handler.cb, [data], "OpenCloud:" + p.topic);
    }
  }));


  const marketplaceService = { __ud: "Service", serviceName: "MarketplaceService" };
  const badgeService = { __ud: "Service", serviceName: "BadgeService" };
  const gamePassService = { __ud: "Service", serviceName: "GamePassService" };
  const promptGamePassFinishedSignal = new Signal(scheduler, "PromptGamePassPurchaseFinished");
  const promptProductFinishedSignal = new Signal(scheduler, "PromptProductPurchaseFinished");
  const promptPurchaseFinishedSignal = new Signal(scheduler, "PromptPurchaseFinished");
  let processReceiptFn = null;
  subs.push(bus.on(monetization.MonetizationEvents.GamePassPromptFinished, (p) => {
    if (p && p.player) promptGamePassFinishedSignal.fire([p.player, p.id, p.wasPurchased === true]);
  }));
  subs.push(bus.on(monetization.MonetizationEvents.ProductPromptFinished, (p) => {
    if (p && p.player) promptProductFinishedSignal.fire([p.player, p.id, p.wasPurchased === true]);
  }));
  subs.push(bus.on(monetization.MonetizationEvents.AssetPromptFinished, (p) => {
    if (p && p.player) promptPurchaseFinishedSignal.fire([p.player, p.id, p.wasPurchased === true]);
  }));


  const pathfindingService = { __ud: "Service", serviceName: "PathfindingService" };


  let pfGeometryVersion = 1;
  const pfPathsById = new Map();                                                    

  function pfIsBasePart(inst) {
    return (
      inst && inst.__isInstance === true && typeof inst.hasProperty === "function" &&
      inst.hasProperty("Size") && inst.hasProperty("Position") && inst.hasProperty("CanCollide")
    );
  }

  function pfPartAABB(inst) {
    const pos = inst.getProperty("Position") || { x: 0, y: 0, z: 0 };
    const size = inst.getProperty("Size") || { x: 1, y: 1, z: 1 };
    const hx = Math.abs(num(size.x)) / 2, hy = Math.abs(num(size.y)) / 2, hz = Math.abs(num(size.z)) / 2;
    return {
      minX: num(pos.x) - hx, maxX: num(pos.x) + hx,
      minY: num(pos.y) - hy, maxY: num(pos.y) + hy,
      minZ: num(pos.z) - hz, maxZ: num(pos.z) + hz,
    };
  }

  function pfAttachmentWorld(att) {
    if (!att || !att.__isInstance) return null;
    const local = att.getProperty("Position") || { x: 0, y: 0, z: 0 };
    const parent = typeof att.getParent === "function" ? att.getParent() : null;
    if (parent && pfIsBasePart(parent)) {
      const pp = parent.getProperty("Position") || { x: 0, y: 0, z: 0 };
      return { x: num(pp.x) + num(local.x), y: num(pp.y) + num(local.y), z: num(pp.z) + num(local.z) };
    }
    return { x: num(local.x), y: num(local.y), z: num(local.z) };
  }


  function pfGetGeometry() {
    const ws = getService(dataModel, "Workspace");
    const parts = [], modifiers = [], links = [];
    if (!ws || typeof ws.getDescendants !== "function") return { parts, modifiers, links };
    const all = ws.getDescendants();
    for (const inst of all) {
      const cls = inst.className;
      if (cls === "PathfindingModifier") {
        const parent = typeof inst.getParent === "function" ? inst.getParent() : null;
        if (parent && pfIsBasePart(parent)) {
          const box = pfPartAABB(parent);
          box.passThrough = inst.getProperty("PassThrough") !== false;
          box.label = String(inst.getProperty("Label") || "");
          const c = inst.getProperty("Costs");
          box.costs = c && typeof c === "object" ? c : {};
          modifiers.push(box);
        }
        continue;
      }
      if (cls === "PathfindingLink") {
        const a0 = pfAttachmentWorld(inst.getProperty("Attachment0"));
        const a1 = pfAttachmentWorld(inst.getProperty("Attachment1"));
        if (a0 && a1) {
          links.push({
            x0: a0.x, y0: a0.y, z0: a0.z, x1: a1.x, y1: a1.y, z1: a1.z,
            label: String(inst.getProperty("Label") || ""),
            bidir: inst.getProperty("IsBidirectional") !== false,
          });
        }
        continue;
      }
      if (pfIsBasePart(inst)) {
        const canCollide = inst.getProperty("CanCollide") === true;
        const anchored = inst.hasProperty("Anchored") ? inst.getProperty("Anchored") === true : true;


        if (!canCollide) continue;
        if (!anchored && pfIsCharacterPart(inst)) continue;
        const box = pfPartAABB(inst);
        box.id = String(inst.id || "");                                                   
        box.canCollide = true;
        box.anchored = anchored;
        box.dynamic = !anchored;
        if (!anchored) {
          const v = inst.hasProperty("AssemblyLinearVelocity") ? inst.getProperty("AssemblyLinearVelocity") : null;
          box.vx = v ? num(v.x) : 0;
          box.vy = v ? num(v.y) : 0;
          box.vz = v ? num(v.z) : 0;
        }
        box.material = inst.hasProperty("Material") ? inst.getProperty("Material") : "Plastic";
        box.isTruss = cls === "TrussPart";
        parts.push(box);
      }
    }
    return { parts, modifiers, links };
  }
  const pf = createPathfinder({ getGeometry: pfGetGeometry, getGeometryVersion: () => pfGeometryVersion });

  function pfWarn(m) { svcLog("warn", m, "PathfindingService"); }
  function pfVecArg(v) {
    if (v && typeof v === "object") return { x: num(v.x), y: num(v.y), z: num(v.z) };
    return { x: 0, y: 0, z: 0 };
  }

  function pfReadAgentParams(t) {
    const out = {};
    if (!t || typeof t.rawget !== "function") return out;
    for (const k of [
      "AgentRadius", "AgentHeight", "AgentCanJump", "AgentCanClimb", "AgentJumpHeight", "AgentMaxSlope", "WaypointSpacing",


      "AgentAutoRepath", "AgentRepathCooldown",
    ]) {
      const v = t.rawget(k);
      if (v !== undefined && v !== null) out[k] = v;
    }
    const costs = t.rawget("Costs");
    if (costs && costs.map instanceof Map) {
      const c = {};
      for (const [ck, cv] of costs.map) {
        if (typeof ck === "string" && typeof cv === "number") c[ck] = cv;                                    
      }
      out.Costs = c;
    }
    return out;
  }
  function pfStatusItem(name) {
    const idx = Enums.PathStatus.indexOf(name);
    return makeEnumItem("PathStatus", name, idx < 0 ? 5 : idx);
  }
  function pfActionItem(name) {
    const idx = Enums.PathWaypointAction.indexOf(name);
    return makeEnumItem("PathWaypointAction", name, idx < 0 ? 0 : idx);
  }


  let pfWatchSeq = 1;
  const pfWatchedPaths = new Map();                           
  let pfHbConn = null;                                                  


  function pfIsCharacterPart(inst) {
    try {
      let cur = typeof inst.getParent === "function" ? inst.getParent() : null;
      let depth = 0;
      while (cur && depth++ < 6) {
        if (cur.className === "Model" && typeof cur.getChildren === "function") {
          const kids = cur.getChildren();
          for (let i = 0; i < kids.length; i++) {
            if (kids[i] && kids[i].className === "Humanoid") return true;
          }
        }
        cur = typeof cur.getParent === "function" ? cur.getParent() : null;
      }
    } catch (_) {                                     }
    return false;
  }
  function pfLimitNum(name, def) {
    const v = PF_LIMITS && PF_LIMITS[name];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : def;
  }


  function pfDynamicGeometry() {
    const parts = [];
    const ws = getService(dataModel, "Workspace");
    if (!ws || typeof ws.getDescendants !== "function") return { parts, modifiers: [], links: [] };
    const dynRadius = pfLimitNum("dynamicRadius", 128);
    const maxDyn = pfLimitNum("maxDynamicParts", 64);

    const centers = [];
    for (const p of pfWatchedPaths.values()) {
      const wps = p._waypoints || [];
      if (!wps.length) continue;
      const stride = Math.max(1, Math.floor(wps.length / 8));
      for (let i = 0; i < wps.length; i += stride) centers.push(wps[i]);
      centers.push(wps[wps.length - 1]);
    }
    if (!centers.length) return { parts, modifiers: [], links: [] };
    const all = ws.getDescendants();
    for (const inst of all) {
      if (parts.length >= maxDyn) break;
      if (!pfIsBasePart(inst)) continue;
      if (inst.getProperty("CanCollide") !== true) continue;
      const anchored = inst.hasProperty("Anchored") ? inst.getProperty("Anchored") === true : true;
      if (anchored) continue;
      if (pfIsCharacterPart(inst)) continue;
      const box = pfPartAABB(inst);
      const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2, cz = (box.minZ + box.maxZ) / 2;
      let near = false;
      for (let i = 0; i < centers.length; i++) {
        const c = centers[i];
        if (Math.abs(cx - num(c.x)) <= dynRadius && Math.abs(cy - num(c.y)) <= dynRadius && Math.abs(cz - num(c.z)) <= dynRadius) { near = true; break; }
      }
      if (!near) continue;
      box.id = String(inst.id || "");
      box.canCollide = true;
      box.anchored = false;
      box.dynamic = true;
      const v = inst.hasProperty("AssemblyLinearVelocity") ? inst.getProperty("AssemblyLinearVelocity") : null;
      box.vx = v ? num(v.x) : 0;
      box.vy = v ? num(v.y) : 0;
      box.vz = v ? num(v.z) : 0;
      parts.push(box);
    }
    return { parts, modifiers: [], links: [] };
  }
  function pfPathMeta(path) {
    const meta = path._meta || {};
    return {
      agent: path._agent,
      start: meta.start || null,
      finish: meta.finish || null,
      dynamic: path._autoRepath === true,

      repaths: path._repathCount || 0,
    };
  }


  function pfScheduleRepath(watchKey, reason, info) {
    const path = pfWatchedPaths.get(watchKey);
    if (!path || path._repathing || path._autoRepath !== true || !path._meta || !path._meta.finish) return;
    const wps = path._waypoints || [];
    const idx = info && typeof info.index === "number" ? info.index : 0;
    const fromWp = wps.length ? wps[Math.max(0, Math.min(idx - 1, wps.length - 1))] : null;
    const from = fromWp ? { x: num(fromWp.x), y: num(fromWp.y), z: num(fromWp.z) } : path._meta.start;
    if (!from) return;
    const reasonStr = String(reason || "Blocked");
    path._repathing = true;
    scheduler.spawnGen(
      (function* () {
        try {
          yield* pfComputeInto(path, from, path._meta.finish);
          path._repathCount++;


          try {
            if (path._activeId != null && typeof pf.noteRepath === "function") pf.noteRepath(path._activeId);
          } catch (_) {                                         }
          path._recomputed.fire([reasonStr, path._waypoints ? path._waypoints.length : 0]);
        } catch (err) {
          pfWarn("auto-repath falhou: " + err);
        } finally {
          path._repathing = false;
        }
      })(),
      { name: "PathfindingRepath" },
    );
  }
  const pfWatcher = createPathfindingWatcher({
    pathfinder: pf,
    getGeometry: pfDynamicGeometry,
    limits: PF_LIMITS,
    now: () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()),


    onDirty: (dirtyBoxes) => {
      pfGeometryVersion++;
      if (typeof pf.invalidateCacheRegion === "function" && Array.isArray(dirtyBoxes)) {
        for (let i = 0; i < dirtyBoxes.length; i++) {
          try { pf.invalidateCacheRegion(dirtyBoxes[i]); } catch (_) { break; }
        }
      }
    },
    onBlocked: (key, index) => { const p = pfWatchedPaths.get(key); if (p) p._blocked.fire([index]); },
    onUnblocked: (key, index) => { const p = pfWatchedPaths.get(key); if (p) p._unblocked.fire([index]); },
    onCoreBlocked: (id, index) => { const p = pfPathsById.get(id); if (p) p._blocked.fire([index]); },
    onCoreUnblocked: (id, index) => { const p = pfPathsById.get(id); if (p) p._unblocked.fire([index]); },
    requestRepath: pfScheduleRepath,
    warn: pfWarn,
  });


  const pfWatcherTickFn = nativeFn((a) => {
    try {
      if (!pfWatcher.hasPaths() || !hasActivePaths()) return [];
      pfWatcher.tick(num(a && a[0]));
    } catch (_) {                                                            }
    return [];
  }, "PathfindingWatcherTick");


  function pfWatcherSetLoop(on) {
    if (on && !pfHbConn) {
      pfHbConn = scheduler.heartbeat.connect(pfWatcherTickFn);
    } else if (!on && pfHbConn) {
      const conn = pfHbConn;
      pfHbConn = null;
      try {
        const off = typeof conn.rawget === "function" ? conn.rawget("Disconnect") : null;
        if (off) scheduler.spawnFn(off, [], "PathfindingWatcherOff");
      } catch (_) {                                                 }
    }
  }

  subs.push(() => {
    try {
      pfWatcherSetLoop(false);
      pfWatcher.reset();
      pfWatchedPaths.clear();
    } catch (_) {                            }
  });
  function pfMakePath(agentRaw) {
    return {
      __ud: "Path",
      _agent: agentRaw || {},
      _status: "NoPath",
      _waypoints: [],
      _blocked: new Signal(scheduler, "Path.Blocked"),
      _unblocked: new Signal(scheduler, "Path.Unblocked"),


      _recomputed: new Signal(scheduler, "Path.Recomputed"),
      _autoRepath: !!(agentRaw && agentRaw.AgentAutoRepath === true),
      _repathCount: 0,
      _repathing: false,
      _watchKey: pfWatchSeq++,
      _meta: null,                                                             
      _activeId: null,
    };
  }


  function pfRegister(path) {
    if (path._activeId != null) { pf.unregisterActivePath(path._activeId); pfPathsById.delete(path._activeId); path._activeId = null; }
    pfWatchedPaths.delete(path._watchKey);
    pfWatcher.unregisterPath(path._watchKey);
    if (path._waypoints && path._waypoints.length > 0) {
      path._activeId = pf.registerActivePath(path._waypoints, path._status, pfPathMeta(path));
      pfPathsById.set(path._activeId, path);
      pfWatchedPaths.set(path._watchKey, path);


      let cooldownSec;
      try {
        if (typeof pf.normalizeAgentParams === "function") cooldownSec = pf.normalizeAgentParams(path._agent).AgentRepathCooldown;
      } catch (_) { cooldownSec = undefined; }
      if (cooldownSec === undefined && typeof path._agent.AgentRepathCooldown === "number") cooldownSec = path._agent.AgentRepathCooldown;
      pfWatcher.registerPath(path._watchKey, {
        waypoints: path._waypoints,
        autoRepath: path._autoRepath === true,
        cooldownSec,
        meta: pfPathMeta(path),
      });
    }
    pfWatcherSetLoop(pfWatchedPaths.size > 0);
  }

  function* pfComputeInto(path, startV, finishV) {
    const start = pfVecArg(startV), finish = pfVecArg(finishV);
    const res = yield* pf.computePath(path._agent, start, finish, pfWarn);
    path._status = res.status;
    path._waypoints = res.waypoints || [];
    path._meta = { start, finish };                                  
    pfRegister(path);
    return res;
  }
  const pfComputeAsyncFn = nativeFn(function* (a) {
    yield* pfComputeInto(a[0], a[1], a[2]);
    return [];
  }, "ComputeAsync", true);
  const pfGetWaypointsFn = nativeFn((a) => {
    const self = a[0];
    const t = new LuaTable();
    self._waypoints.forEach((w, i) => {
      t.rawset(i + 1, { __ud: "PathWaypoint", x: w.x, y: w.y, z: w.z, action: w.action || "Walk", label: w.label || "" });
    });
    return [t];
  }, "GetWaypoints");
  const pfCheckOcclusionFn = nativeFn(function* (a) {
    const self = a[0];
    const startIndex = typeof a[1] === "number" ? a[1] : 0;
    yield { kind: "wait", seconds: 0 };                              
    return [pf.checkOcclusion(self._waypoints, startIndex)];
  }, "CheckOcclusionAsync", true);
  function pathIndex(obj, key) {
    if (key === "Status") return pfStatusItem(obj._status);
    if (key === "ComputeAsync") return pfComputeAsyncFn;
    if (key === "GetWaypoints") return pfGetWaypointsFn;
    if (key === "CheckOcclusionAsync") return pfCheckOcclusionFn;
    if (key === "Blocked") return obj._blocked;
    if (key === "Unblocked") return obj._unblocked;

    if (key === "Recomputed") return obj._recomputed;
    if (key === "IsDynamic") return obj._autoRepath === true;
    if (key === "RepathCount") return obj._repathCount || 0;
    return undefined;
  }
  function pathWaypointIndex(obj, key) {
    if (key === "Position") return V3(obj.x, obj.y, obj.z);
    if (key === "Action") return pfActionItem(obj.action || "Walk");
    if (key === "Label") return obj.label || "";
    return undefined;
  }
  function pathfindingServiceIndex(key) {
    if (key === "CreatePath") {
      return nativeFn((a) => [pfMakePath(pfReadAgentParams(a[1]))], "CreatePath");
    }
    if (key === "FindPathAsync") {

      return nativeFn(function* (a) {
        const path = pfMakePath({});
        yield* pfComputeInto(path, a[1], a[2]);
        return [path];
      }, "FindPathAsync", true);
    }
    return undefined;
  }


  function pfOnWorkspaceChange() {
    pfGeometryVersion++;
    if (!hasActivePaths()) return;
    pf.reevaluateActive(
      (id, index) => { const p = pfPathsById.get(id); if (p) p._blocked.fire([index]); },
      (id, index) => { const p = pfPathsById.get(id); if (p) p._unblocked.fire([index]); },
    );
  }
  const PF_REL_PROPS = new Set([
    "Position", "Size", "Rotation", "CFrame", "CanCollide", "Anchored",
    "Material", "PassThrough", "Costs", "Label", "IsBidirectional",
  ]);
  subs.push(bus.on(Events.PropertyChanged, (p) => { if (p && PF_REL_PROPS.has(p.property)) pfOnWorkspaceChange(); }));
  subs.push(bus.on(Events.ChildAdded, () => pfOnWorkspaceChange()));
  subs.push(bus.on(Events.ChildRemoved, () => pfOnWorkspaceChange()));
  subs.push(bus.on(Events.Destroying, () => pfOnWorkspaceChange()));

  function svcLog(level, message, source) {
    if (logger && typeof logger[level] === "function") logger[level](message, { source: source || "DataStoreService" });
  }
  function gameSettingsObj() {
    try { return project.getSettings(); } catch (_) { return null; }
  }
  function studioApiAccessEnabled() {
    const s = gameSettingsObj();
    return !!(s && s.general && s.general.studioAccessToApis === true);
  }
  function httpEnabledValue() {
    if (httpEnabledOverride !== null) return httpEnabledOverride;
    const s = gameSettingsObj();
    return !!(s && s.security && s.security.allowHttp === true);
  }
  function assertDataStoreAccess() {
    if (context === "client") throw new LuaError("DataStore can't be accessed from client");
    if (getMode() === "edit") {
      throw new LuaError("DataStores só podem ser acessados durante o Playtest. Dê Play/Run para testar.");
    }
    if (!studioApiAccessEnabled()) {
      throw new LuaError("Studio access to APIs is not allowed.  Enable it by going to Game Settings > Security.");
    }
  }


  function makeDataStore(name, scope, ordered) {
    const nm = String(name);
    const sc = scope == null ? "global" : String(scope);
    if (nm.length === 0 || nm.length > DS.DS_LIMITS.maxNameLen) {
      throw new LuaError(`Nome de DataStore inválido (1..${DS.DS_LIMITS.maxNameLen} caracteres).`);
    }
    if (sc.length > DS.DS_LIMITS.maxScopeLen) {
      throw new LuaError(`Scope de DataStore inválido (máx ${DS.DS_LIMITS.maxScopeLen} caracteres).`);
    }
    return { __ud: ordered ? "OrderedDataStore" : "GlobalDataStore", name: nm, scope: sc, ordered: !!ordered };
  }
  function dsValidateKey(key) {
    if (typeof key !== "string") throw new LuaError("DataStore: a chave deve ser uma string.");
    if (key.length === 0 || key.length > DS.DS_LIMITS.maxKeyLen) {
      throw new LuaError(`DataStore: chave inválida (1..${DS.DS_LIMITS.maxKeyLen} caracteres).`);
    }
    return key;
  }
  function dsValidateValue(store, luaVal) {
    const js = luaToSerializable(luaVal, 0, null, "DataStore");
    if (store.ordered) {
      if (typeof js !== "number" || !Number.isInteger(js) || js < 0) {
        throw new LuaError("OrderedDataStore: o valor deve ser um inteiro não-negativo.");
      }
    }
    if (DS.valueByteSize(js) > DS.DS_LIMITS.maxValueBytes) {
      throw new LuaError(`DataStore: valor excede o limite de ${DS.DS_LIMITS.maxValueBytes} bytes (4MB).`);
    }
    return js;
  }
  function luaUserIdsToArray(t) {
    if (!t) return [];
    return luaTableToArray(t).map(Number).filter((n) => Number.isFinite(n));
  }
  function keyInfoToLua(info) {
    const t = new LuaTable();
    if (!info) return t;
    t.rawset("Version", info.version);
    t.rawset("CreatedTime", info.createdTime);
    t.rawset("UpdatedTime", info.updatedTime);
    const ids = (info.userIds || []).slice();
    t.rawset("GetUserIds", nativeFn(() => [arrayToTable(ids)], "GetUserIds"));
    t.rawset("GetMetadata", nativeFn(() => [new LuaTable()], "GetMetadata"));
    return t;
  }

  function* consumeBudgetOrQueue(rt) {
    if (DS.tryConsumeBudget(rt)) return;
    dsStatsRecordThrottle();
    const depth = (dsQueueDepth.get(rt) || 0) + 1;
    dsQueueDepth.set(rt, depth);
    dsStatsQueueEnter();
    svcLog("warn", `Orçamento de requisições esgotado para ${rt}; requisição enfileirada (throttling).`, "DataStoreService");
    try {
      if (depth > DS_MAX_QUEUE) {
        throw new LuaError(`DataStore: fila cheia para ${rt}; requisição descartada.`);
      }
      let waited = 0;
      while (!DS.tryConsumeBudget(rt)) {
        yield { kind: "wait", seconds: 1 };
        waited += 1;
        if (waited >= DS.DS_LIMITS.queueTimeoutSec) {
          throw new LuaError(`DataStore: tempo limite de ${DS.DS_LIMITS.queueTimeoutSec}s na fila (${rt}).`);
        }
      }
    } finally {
      dsQueueDepth.set(rt, Math.max(0, (dsQueueDepth.get(rt) || 1) - 1));
      dsStatsQueueLeave();
    }
  }


  function* throttleKeyCooldown(store, key) {
    const age = DS.keyWriteAgeSec(store.name, store.scope, key);
    if (age < DS.DS_LIMITS.keyCooldownSec) {
      const remaining = DS.DS_LIMITS.keyCooldownSec - age;
      svcLog("warn", `Chave "${key}" escrita novamente em menos de ${DS.DS_LIMITS.keyCooldownSec}s; enfileirada por ${remaining.toFixed(1)}s (throttling).`, "DataStoreService");
      yield { kind: "wait", seconds: remaining };
    }
  }
  function makeKeyPages(keys, pageSize) {
    return { __ud: "DataStoreKeyPages", items: keys.slice(), pageSize, cursor: 0, kind: "keys" };
  }
  function makeSortedPages(pairs, pageSize) {
    return { __ud: "DataStorePages", items: pairs.slice(), pageSize, cursor: 0, kind: "sorted" };
  }
  function pagesIndex(obj, key) {
    switch (key) {
      case "IsFinished":
        return obj.cursor >= obj.items.length;
      case "GetCurrentPage":
        return nativeFn(() => {
          const slice = obj.items.slice(obj.cursor, obj.cursor + obj.pageSize);
          const t = new LuaTable();
          slice.forEach((it, i) => {
            const e = new LuaTable();
            if (obj.kind === "sorted") { e.rawset("key", it.key); e.rawset("value", it.value); }
            else { e.rawset("KeyName", it); }
            t.rawset(i + 1, e);
          });
          return [t];
        }, "GetCurrentPage");
      case "AdvanceToNextPageAsync":
        return nativeFn(function* () {
          yield { kind: "wait", seconds: 0 };
          if (obj.cursor + obj.pageSize < obj.items.length) obj.cursor += obj.pageSize;
          else obj.cursor = obj.items.length;
          return [];
        }, "AdvanceToNextPageAsync", true);
      default:
        return undefined;
    }
  }
  function dataStoreServiceIndex(key) {
    switch (key) {
      case "GetDataStore":
        return nativeFn((a) => { assertDataStoreAccess(); return [makeDataStore(a[1], a[2], false)]; }, "GetDataStore");
      case "GetOrderedDataStore":
        return nativeFn((a) => { assertDataStoreAccess(); return [makeDataStore(a[1], a[2], true)]; }, "GetOrderedDataStore");
      case "GetGlobalDataStore":
        return nativeFn(() => { assertDataStoreAccess(); return [makeDataStore("GlobalDataStore", "global", false)]; }, "GetGlobalDataStore");
      case "GetRequestBudgetForRequestType":
        return nativeFn((a) => {
          const rt = a[1] && a[1].__ud === "EnumItem" ? a[1].name : String(a[1] == null ? "" : a[1]);
          return [DS.getBudget(rt)];
        }, "GetRequestBudgetForRequestType");
      default:
        return undefined;
    }
  }


  function dsInstrument(kind, gen) {
    return function* (a) {
      dsStatsRecordRequest(kind);
      const t0 = Date.now();
      try {
        const res = yield* gen(a);
        dsStatsRecordResponse(Date.now() - t0);
        return res;
      } catch (e) {
        dsStatsRecordFailure(e && e.message ? e.message : String(e));
        throw e;
      }
    };
  }
  function dataStoreObjectIndex(store, key) {
    switch (key) {
      case "GetAsync":
        return nativeFn(dsInstrument("Get", function* (a) {
          const k = dsValidateKey(a[1]);
          yield* consumeBudgetOrQueue("GetAsync");
          const v = yield* awaitPromise(DS.dsGet(store.name, store.scope, k));
          return [serializableToLua(v)];
        }), "GetAsync", true);
      case "SetAsync":
        return nativeFn(dsInstrument("Set", function* (a) {
          const k = dsValidateKey(a[1]);
          const js = dsValidateValue(store, a[2]);
          const userIds = luaUserIdsToArray(a[3]);
          yield* throttleKeyCooldown(store, k);
          yield* consumeBudgetOrQueue("SetIncrementAsync");
          const res = yield* awaitPromise(DS.dsSet(store.name, store.scope, k, js, userIds));
          DS.markKeyWrite(store.name, store.scope, k);
          return [res.version];
        }), "SetAsync", true);
      case "UpdateAsync":
        return nativeFn(dsInstrument("Update", function* (a) {
          const k = dsValidateKey(a[1]);
          const fn = a[2];
          if (!fn || !(fn.__native || fn instanceof LuaFunction)) {
            throw new LuaError("UpdateAsync: o segundo argumento deve ser uma função.");
          }
          yield* throttleKeyCooldown(store, k);
          yield* consumeBudgetOrQueue("SetIncrementAsync");
          const cur = yield* awaitPromise(DS.dsGet(store.name, store.scope, k));
          const info = yield* awaitPromise(DS.dsGetKeyInfo(store.name, store.scope, k));
          const ret = yield* interp.call(fn, [serializableToLua(cur), keyInfoToLua(info)], 0);
          const newVal = Array.isArray(ret) ? ret[0] : ret;
          if (newVal === undefined || newVal === null) {
            svcLog("info", `UpdateAsync em "${k}" cancelado (transform retornou nil).`, "DataStoreService");
            return [undefined];
          }
          const js = dsValidateValue(store, newVal);
          const res = yield* awaitPromise(DS.dsSet(store.name, store.scope, k, js, null));
          DS.markKeyWrite(store.name, store.scope, k);
          return [serializableToLua(js), res.version];
        }), "UpdateAsync", true);
      case "IncrementAsync":
        return nativeFn(dsInstrument("Increment", function* (a) {
          const k = dsValidateKey(a[1]);
          const delta = a[2] == null ? 1 : Number(a[2]);
          if (!Number.isFinite(delta)) throw new LuaError("IncrementAsync: delta deve ser um número.");
          yield* throttleKeyCooldown(store, k);
          yield* consumeBudgetOrQueue("SetIncrementAsync");
          const cur = yield* awaitPromise(DS.dsGet(store.name, store.scope, k));
          if (cur !== null && typeof cur !== "number") {
            throw new LuaError("IncrementAsync: o valor existente não é um número.");
          }
          const next = (typeof cur === "number" ? cur : 0) + delta;
          if (store.ordered && (!Number.isInteger(next) || next < 0)) {
            throw new LuaError("OrderedDataStore: resultado deve ser inteiro não-negativo.");
          }
          const res = yield* awaitPromise(DS.dsSet(store.name, store.scope, k, next, null));
          DS.markKeyWrite(store.name, store.scope, k);
          return [next, res.version];
        }), "IncrementAsync", true);
      case "RemoveAsync":
        return nativeFn(dsInstrument("Remove", function* (a) {
          const k = dsValidateKey(a[1]);
          yield* consumeBudgetOrQueue("SetIncrementAsync");
          const old = yield* awaitPromise(DS.dsRemove(store.name, store.scope, k));
          return [serializableToLua(old)];
        }), "RemoveAsync", true);
      case "ListKeysAsync":
        return nativeFn(dsInstrument("List", function* (a) {
          const prefix = a[1] == null ? "" : String(a[1]);
          const pageSize = a[2] == null ? 50 : Math.max(1, Math.floor(Number(a[2]) || 50));
          yield* consumeBudgetOrQueue("ListAsync");
          const keys = yield* awaitPromise(DS.dsListKeys(store.name, store.scope, prefix));
          return [makeKeyPages(keys, pageSize)];
        }), "ListKeysAsync", true);
      case "GetSortedAsync":
        if (!store.ordered) return undefined;
        return nativeFn(dsInstrument("GetSorted", function* (a) {
          const ascending = a[1] === true;
          const pageSize = a[2] == null ? 50 : Math.max(1, Math.floor(Number(a[2]) || 50));
          const minV = a[3] == null ? null : Number(a[3]);
          const maxV = a[4] == null ? null : Number(a[4]);
          yield* consumeBudgetOrQueue("GetSortedAsync");
          const all = yield* awaitPromise(DS.dsGetAll(store.name, store.scope));
          let pairs = all.filter((p) => typeof p.value === "number");
          if (minV !== null) pairs = pairs.filter((p) => p.value >= minV);
          if (maxV !== null) pairs = pairs.filter((p) => p.value <= maxV);
          pairs.sort((x, y) => (ascending ? x.value - y.value : y.value - x.value));
          return [makeSortedPages(pairs, pageSize)];
        }), "GetSortedAsync", true);
      default:
        return undefined;
    }
  }


  function assertHttpRequest() {
    if (context === "client") throw new LuaError("HttpService can't be accessed from client");
    if (!httpEnabledValue()) {
      throw new LuaError("Http requests are not enabled. Enable HttpService.HttpEnabled in Game Settings > Security.");
    }
  }
  function* httpRequestSim(url, method, body) {
    const mock = DS.mockHttp.lookup(url);
    const cfg = DS.mockHttp.getConfig();
    const latency = mock ? mock.latencyMs : cfg.defaultLatencyMs;
    yield { kind: "wait", seconds: Math.max(0, latency || 0) / 1000 };
    if (!mock) {
      throw new LuaError(cfg.defaultError || "HttpError: requisição externa não permitida (registre no Mock HTTP).");
    }
    return { status: mock.status, statusMessage: httpStatusText(mock.status), headers: mock.headers || {}, body: mock.body };
  }
  function httpServiceIndex(key) {
    switch (key) {
      case "HttpEnabled":
        return httpEnabledValue();
      case "JSONEncode":
        return nativeFn((a) => [JSON.stringify(luaToSerializable(a[1], 0, null, "JSONEncode"))], "JSONEncode");
      case "JSONDecode":
        return nativeFn((a) => {
          const s = String(a[1] == null ? "" : a[1]);
          const size = typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length;
          if (size > DS.DS_LIMITS.jsonMaxBytes) {
            throw new LuaError(`JSONDecode: payload excede o limite de ${DS.DS_LIMITS.jsonMaxBytes} bytes.`);
          }
          let parsed;
          try { parsed = JSON.parse(s); } catch (e) { throw new LuaError(`JSONDecode: JSON inválido (${e && e.message ? e.message : "erro"}).`); }
          return [serializableToLua(parsed, 0)];
        }, "JSONDecode");
      case "GenerateGUID":
        return nativeFn((a) => [generateGuidV4(a[1] !== false)], "GenerateGUID");
      case "UrlEncode":
        return nativeFn((a) => [urlEncodeRfc3986(a[1])], "UrlEncode");
      case "GetAsync":
        return nativeFn(function* (a) {
          assertHttpRequest();
          const res = yield* httpRequestSim(String(a[1]), "GET", null);
          return [res.body];
        }, "GetAsync", true);
      case "PostAsync":
        return nativeFn(function* (a) {
          assertHttpRequest();
          const res = yield* httpRequestSim(String(a[1]), "POST", a[2] == null ? "" : String(a[2]));
          return [res.body];
        }, "PostAsync", true);
      case "RequestAsync":
        return nativeFn(function* (a) {
          assertHttpRequest();
          const opts = a[1];
          const url = opts && opts.rawget ? String(opts.rawget("Url") || opts.rawget("url") || "") : "";
          const method = opts && opts.rawget ? String(opts.rawget("Method") || "GET") : "GET";
          const bodyVal = opts && opts.rawget ? opts.rawget("Body") : null;
          const res = yield* httpRequestSim(url, method.toUpperCase(), bodyVal == null ? null : String(bodyVal));
          const t = new LuaTable();
          t.rawset("Success", res.status >= 200 && res.status < 300);
          t.rawset("StatusCode", res.status);
          t.rawset("StatusMessage", res.statusMessage);
          const hdr = new LuaTable();
          for (const hk of Object.keys(res.headers || {})) hdr.rawset(hk, String(res.headers[hk]));
          t.rawset("Headers", hdr);
          t.rawset("Body", res.body);
          return [t];
        }, "RequestAsync", true);
      default:
        return undefined;
    }
  }


  function validateTopic(topic) {
    const tp = String(topic == null ? "" : topic);
    if (tp.length === 0 || tp.length > DS.DS_LIMITS.topicMaxLen) {
      throw new LuaError(`MessagingService: tópico inválido (1..${DS.DS_LIMITS.topicMaxLen} caracteres).`);
    }
    return tp;
  }
  function assertMessaging() {
    if (context === "client") throw new LuaError("MessagingService can't be accessed from client");
  }
  function messagingServiceIndex(key) {
    switch (key) {
      case "SubscribeAsync":
        return nativeFn(function* (a) {
          assertMessaging();
          const topic = validateTopic(a[1]);
          const cb = a[2];
          if (!cb) throw new LuaError("SubscribeAsync: callback obrigatório.");
          let set = msgTopics.get(topic);
          if (!set) { set = new Set(); msgTopics.set(topic, set); }
          if (set.size >= DS.DS_LIMITS.maxSubscriptionsPerTopic) {
            throw new LuaError(`SubscribeAsync: limite de ${DS.DS_LIMITS.maxSubscriptionsPerTopic} assinaturas no tópico atingido.`);
          }
          const handler = { cb };
          set.add(handler);
          yield { kind: "wait", seconds: 0.05 };
          const conn = new LuaTable();
          conn.__ud = "RBXScriptConnection";
          conn.rawset("Connected", true);
          conn.rawset("Disconnect", nativeFn(() => { set.delete(handler); conn.rawset("Connected", false); return []; }, "Disconnect"));
          conn.rawset("disconnect", conn.rawget("Disconnect"));
          return [conn];
        }, "SubscribeAsync", true);
      case "PublishAsync":
        return nativeFn(function* (a) {
          assertMessaging();
          const topic = validateTopic(a[1]);
          const js = luaToSerializable(a[2], 0, null, "PublishAsync");
          if (DS.valueByteSize(js) > DS.DS_LIMITS.msgMaxBytes) {
            throw new LuaError(`PublishAsync: mensagem excede ${DS.DS_LIMITS.msgMaxBytes} bytes (1KB).`);
          }
          const set = msgTopics.get(topic);
          yield { kind: "wait", seconds: 0.05 };
          if (set && set.size) {
            const sent = Date.now() / 1000;
            for (const handler of [...set]) {
              const data = new LuaTable();
              data.rawset("Data", serializableToLua(js));
              data.rawset("Sent", sent);
              scheduler.spawnFn(handler.cb, [data], "Messaging:" + topic);
            }
          }
          return [];
        }, "PublishAsync", true);
      default:
        return undefined;
    }
  }


  function assertCloud() {
    if (context === "client") throw new LuaError("CloudService can't be accessed from client");
  }
  function cloudServiceIndex(key) {
    switch (key) {
      case "RequestAsync":
        return nativeFn(function* (a) {
          assertCloud();
          const token = a[1] == null ? "" : String(a[1]);
          const url = a[2] == null ? "" : String(a[2]);
          const method = a[3] == null ? "GET" : String(a[3]);
          let bodyStr = null;
          if (a[4] != null) {
            if (typeof a[4] === "string") bodyStr = a[4];
            else bodyStr = JSON.stringify(luaToSerializable(a[4], 0, null, "RequestAsync"));
          }
          const res = yield* awaitPromise(openCloud.requestAsync({ token, url, method, body: bodyStr }));
          const t = new LuaTable();
          t.rawset("Success", res.status >= 200 && res.status < 300);
          t.rawset("StatusCode", res.status);
          t.rawset("StatusMessage", res.statusMessage || "");
          const hdr = new LuaTable();
          for (const hk of Object.keys(res.headers || {})) hdr.rawset(hk, String(res.headers[hk]));
          t.rawset("Headers", hdr);
          t.rawset("Body", res.body == null ? "" : String(res.body));
          return [t];
        }, "RequestAsync", true);
      case "GetRateLimitRemainingAsync":
        return nativeFn(function* (a) {
          assertCloud();
          const remaining = yield* awaitPromise(openCloud.rateLimitRemaining(a[1] == null ? "" : String(a[1])));
          return [Number(remaining) || 0];
        }, "GetRateLimitRemainingAsync", true);
      default:
        return undefined;
    }
  }


  function teleportServiceIndex(key) {
    switch (key) {
      case "Teleport":
      case "TeleportAsync":
        return nativeFn(function* (a) {
          const placeId = a[1] == null ? "?" : a[1];
          svcLog("info", `[TeleportService] Teleport simulado para place ${placeId}`, "TeleportService");
          yield { kind: "wait", seconds: 0.05 };
          return [];
        }, "Teleport", true);
      case "GetLocalPlayerTeleportData":
        return nativeFn(() => {
          const d = DS.getTeleportData();
          return [d == null ? undefined : serializableToLua(d)];
        }, "GetLocalPlayerTeleportData");
      case "TeleportInitFailed":
        return teleportInitFailed;
      default:
        return undefined;
    }
  }


  const memoryStoreService = { __ud: "Service", serviceName: "MemoryStoreService" };
  const insertService = { __ud: "Service", serviceName: "InsertService" };
  const chatService = { __ud: "Service", serviceName: "Chat" };
  let playersChattedSignal = null;
  function getPlayersChattedSignal() {
    if (playersChattedSignal) return playersChattedSignal;
    playersChattedSignal = new Signal(scheduler, "PlayerChatted");
    subs.push(bus.on("player:event", (p) => {
      if (p && p.type === "Chatted" && p.instance) {
        playersChattedSignal.fire([p.instance, ...(p.args || [])]);
      }
    }));
    return playersChattedSignal;
  }


  subs.push(bus.on("coregui:fireResetBindable", () => {
    const cb = social.getCoreParam("ResetButtonCallback");
    if (cb && cb.__isInstance === true && cb.className === "BindableEvent") {
      signalFor(cb, "Event").fire([]);
    }
  }));

  function msName(v, method) {
    const s = String(v == null ? "" : v).trim();
    if (!s || s.length > MS.MS_LIMITS.maxNameLen) throw new LuaError(`${method}: nome de store inv\u00e1lido`);
    return s;
  }
  function msKey(v, method) {
    const k = MS.validateKey(v);
    if (!k) throw new LuaError(`${method}: chave inv\u00e1lida (1 a ${MS.MS_LIMITS.maxKeyLen} caracteres)`);
    return k;
  }
  function msTtl(v, method) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) {
      throw new LuaError(`${method}: expiration deve ser um n\u00famero de segundos (1 a ${MS.MS_LIMITS.maxTtlSec})`);
    }
    return MS.clampTtl(n);
  }
  function msValue(v, method) {
    const js = luaToSerializable(v, 0, null, "MemoryStore");
    if (!MS.valueSizeOk(js)) throw new LuaError(`${method}: item excede o limite de 32KB do MemoryStore`);
    return js;
  }
  function* msThrottle(method) {
    if (!MS.tryConsumeRequest()) {
      throw new LuaError(`MemoryStore: limite de requisi\u00e7\u00f5es excedido em ${method} (throttled)`);
    }
    yield { kind: "wait", seconds: 0.02 };
  }
  function memoryStoreServiceIndex(key) {
    switch (key) {
      case "GetHashMap":
        return nativeFn((a) => [{ __ud: "MemoryStoreHashMap", name: msName(a[1], "GetHashMap") }], "GetHashMap");
      case "GetSortedMap":
        return nativeFn((a) => [{ __ud: "MemoryStoreSortedMap", name: msName(a[1], "GetSortedMap") }], "GetSortedMap");
      case "GetQueue":
        return nativeFn((a) => {
          const invis = a[2] === undefined ? 30 : Math.max(1, Math.min(3600, Math.floor(num(a[2]) || 30)));
          return [{ __ud: "MemoryStoreQueue", name: msName(a[1], "GetQueue"), invisibilityTimeout: invis }];
        }, "GetQueue");
      default:
        return undefined;
    }
  }
  function* msUpdate(kind, self, a) {
    const k = msKey(a[1], "UpdateAsync");
    const fn = a[2];
    if (typeof fn !== "function" && !(fn instanceof LuaFunction) && !(fn && fn.__native)) {
      throw new LuaError("UpdateAsync: o segundo argumento deve ser uma fun\u00e7\u00e3o");
    }
    const ttl = msTtl(a[3], "UpdateAsync");
    yield* msThrottle("UpdateAsync");
    const cur = kind === "hash" ? MS.hashGet(self.name, k) : MS.sortedGet(self.name, k);
    const ret = yield* interp.call(fn, [cur === null ? undefined : serializableToLua(cur)], 0);
    const newVal = Array.isArray(ret) ? ret[0] : ret;
    if (newVal === undefined || newVal === null) return [undefined];
    const js = msValue(newVal, "UpdateAsync");
    if (kind === "hash") MS.hashSet(self.name, k, js, ttl);
    else MS.sortedSet(self.name, k, js, ttl);
    return [serializableToLua(js)];
  }
  function memoryHashIndex(key) {
    switch (key) {
      case "SetAsync":
        return nativeFn(function* (a) {
          const k = msKey(a[1], "SetAsync");
          const js = msValue(a[2], "SetAsync");
          const ttl = msTtl(a[3], "SetAsync");
          yield* msThrottle("SetAsync");
          MS.hashSet(a[0].name, k, js, ttl);
          return [true];
        }, "SetAsync", true);
      case "GetAsync":
        return nativeFn(function* (a) {
          const k = msKey(a[1], "GetAsync");
          yield* msThrottle("GetAsync");
          const v = MS.hashGet(a[0].name, k);
          return [v === null ? undefined : serializableToLua(v)];
        }, "GetAsync", true);
      case "UpdateAsync":
        return nativeFn(function* (a) {
          return yield* msUpdate("hash", a[0], a);
        }, "UpdateAsync", true);
      case "RemoveAsync":
        return nativeFn(function* (a) {
          const k = msKey(a[1], "RemoveAsync");
          yield* msThrottle("RemoveAsync");
          MS.hashRemove(a[0].name, k);
          return [];
        }, "RemoveAsync", true);
      default:
        return undefined;
    }
  }
  function memorySortedIndex(key) {
    switch (key) {
      case "SetAsync":
        return nativeFn(function* (a) {
          const k = msKey(a[1], "SetAsync");
          const js = msValue(a[2], "SetAsync");
          const ttl = msTtl(a[3], "SetAsync");
          const sortKey = a[4] === undefined ? undefined : (typeof a[4] === "number" ? a[4] : String(a[4]));
          yield* msThrottle("SetAsync");
          MS.sortedSet(a[0].name, k, js, ttl, sortKey);
          return [true];
        }, "SetAsync", true);
      case "GetAsync":
        return nativeFn(function* (a) {
          const k = msKey(a[1], "GetAsync");
          yield* msThrottle("GetAsync");
          const v = MS.sortedGet(a[0].name, k);
          return [v === null ? undefined : serializableToLua(v)];
        }, "GetAsync", true);
      case "UpdateAsync":
        return nativeFn(function* (a) {
          return yield* msUpdate("sorted", a[0], a);
        }, "UpdateAsync", true);
      case "RemoveAsync":
        return nativeFn(function* (a) {
          const k = msKey(a[1], "RemoveAsync");
          yield* msThrottle("RemoveAsync");
          MS.sortedRemove(a[0].name, k);
          return [];
        }, "RemoveAsync", true);
      case "GetRangeAsync":
        return nativeFn(function* (a) {
          const dir = a[1] && a[1].__ud === "EnumItem" ? a[1].name : (a[1] == null ? "Ascending" : String(a[1]));
          const count = Math.max(1, Math.min(MS.MS_LIMITS.maxRangeCount, Math.floor(num(a[2]) || 1)));
          const lower = a[3] == null ? null : String(a[3]);
          const upper = a[4] == null ? null : String(a[4]);
          yield* msThrottle("GetRangeAsync");
          const arr = MS.sortedRange(a[0].name, dir, count, lower, upper);
          const t = new LuaTable();
          arr.forEach((it, i) => {
            const row = new LuaTable();
            row.rawset("key", it.key);
            row.rawset("value", serializableToLua(it.value));
            t.rawset(i + 1, row);
          });
          return [t];
        }, "GetRangeAsync", true);
      default:
        return undefined;
    }
  }
  function memoryQueueIndex(key) {
    switch (key) {
      case "AddAsync":
        return nativeFn(function* (a) {
          const js = msValue(a[1], "AddAsync");
          const ttl = msTtl(a[2], "AddAsync");
          const priority = a[3] === undefined ? 0 : (num(a[3]) || 0);
          yield* msThrottle("AddAsync");
          return [MS.queueAdd(a[0].name, js, ttl, priority)];
        }, "AddAsync", true);
      case "ReadAsync":
        return nativeFn(function* (a) {
          const count = Math.max(1, Math.min(MS.MS_LIMITS.maxReadCount, Math.floor(num(a[1]) || 1)));
          const allOrNothing = a[2] === true;
          const waitTimeout = a[3] === undefined ? 0 : Math.max(0, num(a[3]) || 0);
          yield* msThrottle("ReadAsync");
          let waited = 0;
          for (;;) {
            const res = MS.queueRead(a[0].name, count, allOrNothing, a[0].invisibilityTimeout);
            if (res.items.length) {
              const items = new LuaTable();
              res.items.forEach((v, i) => items.rawset(i + 1, serializableToLua(v)));
              const ids = new LuaTable();
              res.ids.forEach((id, i) => ids.rawset(i + 1, id));
              return [items, ids];
            }
            if (waited >= waitTimeout) return [undefined, undefined];
            yield { kind: "wait", seconds: 0.25 };
            waited += 0.25;
          }
        }, "ReadAsync", true);
      case "RemoveAsync":
        return nativeFn(function* (a) {
          yield* msThrottle("RemoveAsync");
          const ids = a[1] instanceof LuaTable ? luaTableToArray(a[1]).map(String) : [String(a[1])];
          MS.queueRemove(a[0].name, ids);
          return [];
        }, "RemoveAsync", true);
      default:
        return undefined;
    }
  }
  function insertServiceIndex(key) {
    if (key === "LoadAsset") {
      return nativeFn(function* (a) {
        if (context !== "server") {
          throw new LuaError("InsertService:LoadAsset s\u00f3 pode ser usado no Server");
        }
        const id = Math.floor(num(a[1]) || 0);
        yield { kind: "wait", seconds: 0.05 };
        const model = createInstance("Model", { name: "Asset_" + id });
        if (!model) throw new LuaError("LoadAsset: n\u00e3o foi poss\u00edvel criar o Model");
        const part = createInstance("Part", { name: "AssetPlaceholder", parent: model });
        if (part) {
          part.setProperty("Size", makeVector3(4, 4, 4));
          part.setProperty("Anchored", true);
        }
        svcLog("info", `[InsertService] LoadAsset(${id}) retornou um placeholder (asset simulado).`, "InsertService");
        return [model];
      }, "LoadAsset", true);
    }
    return undefined;
  }
  function chatServiceIndex(key) {
    if (key === "Chat") {
      return nativeFn((a) => {
        svcLog("info", `[Chat] ${a[2] === undefined ? "" : String(a[2])}`, "Chat");
        return [];
      }, "Chat");
    }
    if (key === "InternalClientGUI") {
      return nativeFn(() => [undefined], "InternalClientGUI");
    }
    return undefined;
  }


  function cameraFovMode(inst) {
    let m = "Vertical";
    try { m = String(inst.getProperty("FieldOfViewMode") || "Vertical"); } catch (_) { m = "Vertical"; }
    return m;
  }
  function cameraFovValue(inst) {
    let f = 70;
    try { f = clampFov(inst.getProperty("FieldOfView")); } catch (_) { f = 70; }
    return f;
  }
  function cameraIndex(inst, key) {
    switch (key) {
      case "DiagonalFieldOfView": {
        const vp = cameraSys.getViewportSize();
        const vertical = toVerticalFov(cameraFovValue(inst), cameraFovMode(inst), vp.w, vp.h);
        return fromVerticalFov(vertical, "Diagonal", vp.w, vp.h);
      }
      case "MaxAxisFieldOfView": {
        const vp = cameraSys.getViewportSize();
        const vertical = toVerticalFov(cameraFovValue(inst), cameraFovMode(inst), vp.w, vp.h);
        return fromVerticalFov(vertical, "MaxAxis", vp.w, vp.h);
      }
      case "InterpolationFinished":
        return signalFor(inst, "InterpolationFinished");
      case "GetRenderCFrame":
        return nativeFn((a) => {
          const p = cameraSys.getLastRenderPose();
          if (p) {

            return [CF(p.px, p.py, p.pz, quatLookRotation(
              { x: p.tx - p.px, y: p.ty - p.py, z: p.tz - p.pz }, null,
            ))];
          }
          let cf = null;
          try { cf = a[0].getProperty("CFrame"); } catch (_) { cf = null; }
          return [CF(cf ? cf.x : 0, cf ? cf.y : 0, cf ? cf.z : 0,
            cf && cf.qw != null ? { x: cf.qx, y: cf.qy, z: cf.qz, w: cf.qw } : null)];
        }, "GetRenderCFrame");
      case "ScreenPointToRay":
      case "ViewportPointToRay":
        return nativeFn((a) => {
          const r = cameraSys.screenPointToRay(num(a[1], 0), num(a[2], 0), num(a[3], 0));
          return [RAY(r.origin, r.direction)];
        }, key);
      case "WorldToScreenPoint":
      case "WorldToViewportPoint":
        return nativeFn((a) => {
          const v = a[1] || {};
          const r = cameraSys.worldToScreenPoint({ x: num(v.x, 0), y: num(v.y, 0), z: num(v.z, 0) });
          return [V3(r.x, r.y, r.z), r.visible === true];
        }, key);
      case "GetPartsObscuringTarget":
        return nativeFn((a) => {
          const pts = a[1] instanceof LuaTable ? luaTableToArray(a[1]) : [];
          const ig = a[2] instanceof LuaTable ? luaTableToArray(a[2]) : [];
          const castPoints = [];
          for (const p of pts) {
            if (p && Number.isFinite(Number(p.x))) {
              castPoints.push({ x: num(p.x, 0), y: num(p.y, 0), z: num(p.z, 0) });
            }
          }
          const ignore = ig.filter((i) => i && i.__isInstance === true);
          const ws = getService(dataModel, "Workspace");
          return [arrayToTable(cameraSys.getPartsObscuringTarget(ws, castPoints, ignore))];
        }, "GetPartsObscuringTarget");
      case "ZoomToExtents":
        return nativeFn((a) => {
          const c = a[1] || {};
          const s = a[2] || {};
          cameraSys.zoomToExtents(
            a[0],
            { x: num(c.x, 0), y: num(c.y, 0), z: num(c.z, 0) },
            { x: num(s.x, 4), y: num(s.y, 4), z: num(s.z, 4) },
          );
          return [];
        }, "ZoomToExtents");
      case "Interpolate":
        return nativeFn((a) => {
          const cam = a[0];
          const cfT = a[1] || {};
          const foT = a[2] || {};
          const dur = Math.min(10, Math.max(0.05, num(a[3], 1)));
          let cf0 = null;
          let fo0 = null;
          try { cf0 = cam.getProperty("CFrame"); fo0 = cam.getProperty("Focus"); } catch (_) {            }
          const s0 = {
            px: num(cf0 && cf0.x, 0), py: num(cf0 && cf0.y, 0), pz: num(cf0 && cf0.z, 0),
            tx: num(fo0 && fo0.x, 0), ty: num(fo0 && fo0.y, 0), tz: num(fo0 && fo0.z, 0),
          };
          const s1 = {
            px: num(cfT.x, s0.px), py: num(cfT.y, s0.py), pz: num(cfT.z, s0.pz),
            tx: num(foT.x, s0.tx), ty: num(foT.y, s0.ty), tz: num(foT.z, s0.tz),
          };


          const q0 = cfQuat(cf0);
          const g0 = cfQuat(fo0);
          const q1 = cfQuat(cfT);
          const g1 = cfQuat(foT);
          const interp = createInterpolation({
            fromCF: { x: s0.px, y: s0.py, z: s0.pz, qx: q0.x, qy: q0.y, qz: q0.z, qw: q0.w },
            fromFocus: { x: s0.tx, y: s0.ty, z: s0.tz, qx: g0.x, qy: g0.y, qz: g0.z, qw: g0.w },
            toCF: { x: s1.px, y: s1.py, z: s1.pz, qx: q1.x, qy: q1.y, qz: q1.z, qw: q1.w },
            toFocus: { x: s1.tx, y: s1.ty, z: s1.tz, qx: g1.x, qy: g1.y, qz: g1.z, qw: g1.w },
            duration: dur,
          });

          const reg = cameraIndex._activeInterp144 || (cameraIndex._activeInterp144 = new WeakMap());
          const prev = reg.get(cam);
          if (prev && typeof prev.cancel === "function") prev.cancel();
          reg.set(cam, interp);
          const enumName = (v) => (v && v.__ud === "EnumItem" ? String(v.name) : String(v == null ? "" : v));
          let camType0 = null;
          try { camType0 = enumName(cam.getProperty("CameraType")); } catch (_) {            }
          let lastWrite = null;


          const interrupted = () => {
            if (interp.cancelled) return true;
            try {
              if (enumName(cam.getProperty("CameraType")) !== camType0) return true;
              if (lastWrite) {
                const cur = cam.getProperty("CFrame");
                if (!cur
                  || Math.abs(num(cur.x) - lastWrite.x) > 1e-3
                  || Math.abs(num(cur.y) - lastWrite.y) > 1e-3
                  || Math.abs(num(cur.z) - lastWrite.z) > 1e-3) return true;
              }
            } catch (_) {            }
            return false;
          };
          const settle = () => {
            if (reg.get(cam) === interp) reg.delete(cam);
          };
          scheduler.spawnGen((function* () {
            let t = 0;
            while (t < dur) {
              if (interrupted()) { interp.cancel(); settle(); return []; }
              const s = interp.sampleAt(t);
              try {
                cam.setProperty("CFrame", makeCFrame(s.cf.x, s.cf.y, s.cf.z, s.cf.qx, s.cf.qy, s.cf.qz, s.cf.qw));
                cam.setProperty("Focus", makeCFrame(s.focus.x, s.focus.y, s.focus.z, s.focus.qx, s.focus.qy, s.focus.qz, s.focus.qw));
                lastWrite = { x: num(s.cf.x), y: num(s.cf.y), z: num(s.cf.z) };
              } catch (_) {            }
              const dt = yield { kind: "wait", seconds: 0.03 };
              t += Array.isArray(dt) ? Math.max(0.005, num(dt[0], 0.03)) : 0.03;
            }
            if (interrupted()) { interp.cancel(); settle(); return []; }
            const sEnd = interp.sampleAt(dur);
            try {
              cam.setProperty("CFrame", makeCFrame(sEnd.cf.x, sEnd.cf.y, sEnd.cf.z, sEnd.cf.qx, sEnd.cf.qy, sEnd.cf.qz, sEnd.cf.qw));
              cam.setProperty("Focus", makeCFrame(sEnd.focus.x, sEnd.focus.y, sEnd.focus.z, sEnd.focus.qx, sEnd.focus.qy, sEnd.focus.qz, sEnd.focus.qw));
            } catch (_) {            }
            settle();
            signalFor(cam, "InterpolationFinished").fire([]);
            return [];
          })(), { name: "Camera.Interpolate" });
          return [];
        }, "Interpolate");
      default:
        return undefined;
    }
  }


  function playerArg(v, method) {
    if (!v || v.__isInstance !== true || v.className !== "Player") {
      throw new LuaError(`${method}: o primeiro argumento deve ser um Player`);
    }
    return v;
  }
  function playerUserId(player) {
    const v = Number(player.getProperty("UserId"));
    return Number.isFinite(v) ? v : 0;
  }
  function playerNameByUserId(userId) {
    const players = getService(dataModel, "Players");
    if (players && players.getChildren) {
      for (const p of players.getChildren()) {
        if (p.className === "Player" && Number(p.getProperty("UserId")) === Number(userId)) {
          const dn = p.getProperty("DisplayName");
          return dn ? String(dn) : p.name;
        }
      }
    }
    return "User " + userId;
  }
  function productInfoToLua(info, productId) {
    const t = new LuaTable();
    if (productId != null) t.rawset("ProductId", Number(productId));
    t.rawset("Name", info.Name);
    t.rawset("Description", info.Description);
    t.rawset("PriceInRobux", info.PriceInRobux);
    t.rawset("IconImageAssetId", info.IconImageAssetId);
    t.rawset("Created", info.Created);
    t.rawset("Updated", info.Updated);
    return t;
  }
  function makeProductPages(products) {
    const pages = new LuaTable();
    pages.rawset("IsFinished", true);
    pages.rawset("GetCurrentPage", nativeFn(() => {
      const t = new LuaTable();
      products.forEach((p, i) => {
        t.rawset(i + 1, productInfoToLua(monetization.getProductInfo(p.id, "Product"), p.id));
      });
      return [t];
    }, "GetCurrentPage"));
    pages.rawset("AdvanceToNextPageAsync", nativeFn(function* () {
      yield { kind: "wait", seconds: 0.02 };
      throw new LuaError("AdvanceToNextPageAsync: n\u00e3o h\u00e1 mais p\u00e1ginas.");
    }, "AdvanceToNextPageAsync", true));
    return pages;
  }
  function registerProcessReceipt(fn) {
    processReceiptFn = fn || null;
    if (!fn) {
      monetization.setReceiptProcessor(null);
      return;
    }
    monetization.setReceiptProcessor((receipt) => new Promise((resolve) => {
      const gen = (function* () {
        const t = new LuaTable();
        t.rawset("PurchaseId", receipt.PurchaseId);
        t.rawset("PlayerId", receipt.PlayerId);
        t.rawset("ProductId", receipt.ProductId);
        t.rawset("CurrencySpent", receipt.CurrencySpent);
        t.rawset("CurrencyType", receipt.CurrencyType);
        try {
          const ret = yield* interp.call(fn, [t], 0);
          const v = Array.isArray(ret) ? ret[0] : ret;
          if (v && v.__ud === "EnumItem") resolve(v.name);
          else if (typeof v === "string") resolve(v);
          else resolve("NotProcessedYet");
        } catch (e) {
          svcLog("warn", `ProcessReceipt lan\u00e7ou um erro: ${e && e.message ? e.message : e}`, "MarketplaceService");
          resolve("Error");
        }
      })();
      scheduler.spawnGen(gen, { name: "ProcessReceipt" });
    }));
  }
  function marketplaceServiceIndex(key) {
    switch (key) {
      case "PromptGamePassPurchase":
        return nativeFn((a) => {
          const player = playerArg(a[1], "PromptGamePassPurchase");
          monetization.promptGamePassPurchase(player, Number(a[2]));
          return [];
        }, "PromptGamePassPurchase");
      case "PromptProductPurchase":
        return nativeFn((a) => {
          const player = playerArg(a[1], "PromptProductPurchase");
          monetization.promptProductPurchase(player, Number(a[2]));
          return [];
        }, "PromptProductPurchase");
      case "PromptPurchase":
        return nativeFn((a) => {
          const player = playerArg(a[1], "PromptPurchase");
          monetization.promptAssetPurchase(player, Number(a[2]));
          return [];
        }, "PromptPurchase");
      case "UserOwnsGamePassAsync":
        return nativeFn(function* (a) {
          const owns = yield* awaitPromise(monetization.userOwnsPassAsync(Number(a[1]), Number(a[2])));
          return [owns === true];
        }, "UserOwnsGamePassAsync", true);
      case "GetProductInfo":
        return nativeFn(function* (a) {
          const infoType = a[2] && a[2].__ud === "EnumItem" ? a[2].name : (a[2] == null ? "Asset" : String(a[2]));
          const info = monetization.getProductInfo(Number(a[1]), infoType);
          if (!info) throw new LuaError(`GetProductInfo: item ${a[1]} n\u00e3o encontrado neste jogo`);
          yield { kind: "wait", seconds: 0.03 };
          return [productInfoToLua(info, Number(a[1]))];
        }, "GetProductInfo", true);
      case "GetDeveloperProductsAsync":
        return nativeFn(function* () {
          yield { kind: "wait", seconds: 0.03 };
          return [makeProductPages(monetization.getProducts())];
        }, "GetDeveloperProductsAsync", true);
      case "ProcessReceipt":
        if (context !== "server") {
          throw new LuaError("ProcessReceipt n\u00e3o \u00e9 acess\u00edvel a partir do Client (LocalScript)");
        }
        return processReceiptFn || undefined;
      case "PromptGamePassPurchaseFinished":
        return promptGamePassFinishedSignal;
      case "PromptProductPurchaseFinished":
        return promptProductFinishedSignal;
      case "PromptPurchaseFinished":
        return promptPurchaseFinishedSignal;
      default:
        return undefined;
    }
  }
  function badgeServiceIndex(key) {
    switch (key) {
      case "AwardBadge":
        return nativeFn(function* (a) {
          if (context !== "server") {
            throw new LuaError("AwardBadge s\u00f3 pode ser chamado a partir do Server");
          }
          const userId = Number(a[1]);
          const ok = yield* awaitPromise(monetization.awardBadgeAsync(userId, Number(a[2]), playerNameByUserId(userId)));
          return [ok === true];
        }, "AwardBadge", true);
      case "UserHasBadgeAsync":
        return nativeFn(function* (a) {
          const has = yield* awaitPromise(monetization.userHasBadgeAsync(Number(a[1]), Number(a[2])));
          return [has === true];
        }, "UserHasBadgeAsync", true);
      case "GetBadgeInfoAsync":
        return nativeFn(function* (a) {
          const badge = monetization.findBadge(Number(a[1]));
          if (!badge) throw new LuaError(`GetBadgeInfoAsync: badge ${a[1]} n\u00e3o encontrado neste jogo`);
          yield { kind: "wait", seconds: 0.03 };
          const t = new LuaTable();
          t.rawset("Name", badge.name);
          t.rawset("Description", badge.description || "");
          t.rawset("IconImageId", badge.icon || "");
          t.rawset("IsEnabled", badge.enabled !== false);
          return [t];
        }, "GetBadgeInfoAsync", true);
      default:
        return undefined;
    }
  }
  function gamePassServiceIndex(key) {
    if (key === "PlayerHasPass") {
      return nativeFn(function* (a) {
        const player = playerArg(a[1], "PlayerHasPass");
        const owns = yield* awaitPromise(monetization.userOwnsPassAsync(playerUserId(player), Number(a[2])));
        return [owns === true];
      }, "PlayerHasPass", true);
    }
    return undefined;
  }

  function getServiceByName(name) {

    if (context === "client" && SERVER_ONLY_SERVICES.has(name)) {
      throw new LuaError(`'${name}' n\u00e3o \u00e9 acess\u00edvel a partir do Client (LocalScript)`);
    }
    const real = getService(dataModel, name);
    if (real) return real;
    if (name === "RunService") return runService;
    if (name === "PhysicsService") return physicsService;
    if (name === "DataStoreService") return dataStoreService;            
    if (name === "HttpService") return httpService;            
    if (name === "MessagingService") return messagingService;            
    if (name === "TeleportService") return teleportService;            
    if (name === "PathfindingService") return pathfindingService;            
    if (name === "MarketplaceService") return marketplaceService;            
    if (name === "BadgeService") return badgeService;            
    if (name === "GamePassService") return gamePassService;            
    if (name === "MemoryStoreService") {                            
      if (context === "client") {
        throw new LuaError("'MemoryStoreService' n\u00e3o \u00e9 acess\u00edvel a partir do Client (LocalScript)");
      }
      return memoryStoreService;
    }
    if (name === "InsertService") return insertService;            
    if (name === "Chat") return chatService;                     
    if (name === "CloudService") {                            
      if (context === "client") {
        throw new LuaError("'CloudService' n\u00e3o \u00e9 acess\u00edvel a partir do Client (LocalScript)");
      }
      return cloudService;
    }
    throw new LuaError(`'${name}' n\u00e3o \u00e9 um Service v\u00e1lido`);
  }


  function luaTableToArray(t) {
    const out = [];
    if (!t || typeof t.rawget !== "function") return out;
    for (let i = 1; i <= 1000; i++) {
      const v = t.rawget(i);
      if (v === undefined || v === null) break;
      out.push(v);
    }
    return out;
  }


  function physicsServiceIndex(key) {
    switch (key) {
      case "RegisterCollisionGroup":
      case "CreateCollisionGroup":
        return nativeFn((a) => {
          const res = registerGroup(String(a[1]));
          if (!res.ok) throw new LuaError(res.error);
          return [];
        }, "RegisterCollisionGroup");
      case "UnregisterCollisionGroup":
      case "RemoveCollisionGroup":
        return nativeFn((a) => {
          const res = unregisterGroup(String(a[1]));
          if (!res.ok) throw new LuaError(res.error);
          return [];
        }, "UnregisterCollisionGroup");
      case "CollisionGroupSetCollidable":
        return nativeFn((a) => {
          const res = setCollidable(String(a[1]), String(a[2]), a[3] === true);
          if (!res.ok) throw new LuaError(res.error);
          return [];
        }, "CollisionGroupSetCollidable");
      case "CollisionGroupsAreCollidable":
        return nativeFn((a) => [areCollidable(String(a[1]), String(a[2]))], "CollisionGroupsAreCollidable");
      case "IsCollisionGroupRegistered":
        return nativeFn((a) => [isRegistered(String(a[1]))], "IsCollisionGroupRegistered");
      case "GetRegisteredCollisionGroups":
        return nativeFn(() => {
          const t = new LuaTable();
          getGroups().forEach((name, i) => t.rawset(i + 1, name));
          return [t];
        }, "GetRegisteredCollisionGroups");
      default:
        return undefined;
    }
  }


  const REMOTE_TIMEOUT_S = 10;                                                    

  function localPlayerOrNil() {
    return (playtestApi && playtestApi.getLocalPlayer ? playtestApi.getLocalPlayer() : null) || undefined;
  }




  function* awaitTicket(ticket, inst, methodName) {
    let waited = 0;
    while (!ticket.done) {
      if (waited >= REMOTE_TIMEOUT_S) {
        ticket.cancel();
        throw new LuaError(
          `RemoteFunction "${inst.name}": ${methodName} excedeu o timeout de ${REMOTE_TIMEOUT_S}s \u2014 chamada cancelada (thread desbloqueada).`,
        );
      }
      yield { kind: "wait", seconds: 0.05 };
      waited += 0.05;
    }
    if (ticket.error) throw new LuaError(ticket.error);
    return ticket.results || [];
  }

  function assertPlayerArg(v, methodName) {
    if (!v || v.__isInstance !== true || v.className !== "Player") {
      throw new LuaError(`${methodName}: o primeiro argumento deve ser um Player`);
    }
    return v;
  }

  function remoteEventIndex(inst, key) {
    if (key === "OnServerEvent") {
      if (context === "client") throw new LuaError("OnServerEvent s\u00f3 existe no Server (use OnClientEvent no LocalScript)");
      const sig = signalFor(inst, "OnServerEvent");
      network.registerRemoteSignal(inst, "server", sig);
      return sig;
    }
    if (key === "OnClientEvent") {
      if (context !== "client") throw new LuaError("OnClientEvent s\u00f3 existe no Client (use OnServerEvent no Script)");
      const sig = signalFor(inst, "OnClientEvent");


      if (!sig.__streamRxWrapped) {
        sig.__streamRxWrapped = true;
        const rawFire = sig.fire.bind(sig);
        sig.fire = (args) => rawFire(streamGate.receiveArgs(args));
      }


      network.registerRemoteSignal(inst, "client", sig, () => localPlayerOrNil() || null);
      return sig;
    }
    if (key === "FireServer") {
      return nativeFn((a) => {
        if (context !== "client") throw new LuaError("FireServer s\u00f3 pode ser chamado pelo Client (LocalScript)");
        network.fireServer(inst, localPlayerOrNil(), sanitizeRemoteArgs(a.slice(1)));
        return [];
      }, "FireServer");
    }
    if (key === "FireClient") {
      return nativeFn((a) => {
        if (context === "client") throw new LuaError("FireClient s\u00f3 pode ser chamado pelo Server (anti-exploit)");
        const player = assertPlayerArg(a[1], "FireClient");
        network.fireClient(inst, player, sanitizeRemoteArgs(a.slice(2)), false);
        return [];
      }, "FireClient");
    }
    if (key === "FireAllClients") {
      return nativeFn((a) => {
        if (context === "client") throw new LuaError("FireAllClients s\u00f3 pode ser chamado pelo Server (anti-exploit)");
        const lp = localPlayerOrNil();

        if (lp) network.fireClient(inst, lp, sanitizeRemoteArgs(a.slice(1)), true);
        return [];
      }, "FireAllClients");
    }
    return undefined;
  }

  function remoteFunctionIndex(inst, key) {
    if (key === "OnServerInvoke" || key === "OnClientInvoke") {
      return network.getInvokeCallback(inst, key === "OnServerInvoke" ? "server" : "client");
    }
    if (key === "InvokeServer") {
      return nativeFn(function* (a) {
        if (context !== "client") throw new LuaError("InvokeServer s\u00f3 pode ser chamado pelo Client (LocalScript)");
        const ticket = network.invoke(inst, "server", sanitizeRemoteArgs(a.slice(1)), localPlayerOrNil());
        const res = yield* awaitTicket(ticket, inst, "InvokeServer");

        return streamGate.receiveArgs(res || []);
      }, "InvokeServer", true);
    }
    if (key === "InvokeClient") {
      return nativeFn(function* (a) {
        if (context === "client") throw new LuaError("InvokeClient s\u00f3 pode ser chamado pelo Server (anti-exploit)");
        const player = assertPlayerArg(a[1], "InvokeClient");
        const ticket = network.invoke(inst, "client", sanitizeRemoteArgs(a.slice(2)), player);
        return yield* awaitTicket(ticket, inst, "InvokeClient");
      }, "InvokeClient", true);
    }
    return undefined;
  }

  function bindableEventIndex(inst, key) {


    if (key === "Event") return signalFor(inst, "Event");
    if (key === "Fire") {
      return nativeFn((a) => {
        signalFor(inst, "Event").fire(sanitizeRemoteArgs(a.slice(1)));
        return [];
      }, "Fire");
    }
    return undefined;
  }

  function bindableFunctionIndex(inst, key) {
    if (key === "OnInvoke") return bindableOnInvoke.get(inst);
    if (key === "Invoke") {
      return nativeFn(function* (a) {
        const fn = bindableOnInvoke.get(inst);
        if (!fn) {
          throw new LuaError(`BindableFunction "${inst.name}": OnInvoke n\u00e3o est\u00e1 definido neste contexto`);
        }

        const depth = (bindableDepth.get(inst) || 0) + 1;
        if (depth > 16) {
          throw new LuaError(`BindableFunction "${inst.name}": recurs\u00e3o infinita de Invoke detectada (limite 16)`);
        }
        bindableDepth.set(inst, depth);
        let res;
        try {
          res = yield* interp.call(fn, outArgs(sanitizeRemoteArgs(a.slice(1))), 0);
        } finally {
          bindableDepth.set(inst, (bindableDepth.get(inst) || 1) - 1);
        }
        return sanitizeRemoteArgs(res || []);
      }, "Invoke", true);
    }
    return undefined;
  }


  const csgRate = { tokens: 12, max: 12, refillPerSec: 2, last: Date.now() };
  function csgRateConsume() {
    const now = Date.now();
    const elapsed = (now - csgRate.last) / 1000;
    csgRate.last = now;
    csgRate.tokens = Math.min(csgRate.max, csgRate.tokens + elapsed * csgRate.refillPerSec);
    if (csgRate.tokens < 1) {
      throw new LuaError("Rate limit de CSG excedido (UnionAsync/SubtractAsync chamados rápido demais).");
    }
    csgRate.tokens -= 1;
  }
  function csgFidName(v) {
    if (v && v.__ud === "EnumItem") return v.name;
    if (typeof v === "string" && v) return v;
    return undefined;
  }
  function* csgYieldBuild(self, methodName, opts) {
    if (!self || !pfIsBasePart(self)) throw new LuaError(`${methodName} só pode ser chamado em uma BasePart`);
    csgRateConsume();
    svcLog("info", `Processing CSG (${methodName})...`, "GeometryService");
    yield { kind: "wait", seconds: 0 };
    let union;
    try {
      union = csgAsyncBuild(self, opts.others, { subtract: opts.subtract, collisionFidelity: opts.cf, renderFidelity: opts.rf });
    } catch (err) {
      throw new LuaError(`${methodName} falhou: ${err && err.message ? err.message : err}`);
    }
    return [union];
  }

  const METHODS = {
    GetService: nativeFn((a) => [getServiceByName(String(a[1]))], "GetService"),
    UnionAsync: nativeFn(function* (a) {
      return yield* csgYieldBuild(a[0], "UnionAsync", {
        others: luaTableToArray(a[1]),
        subtract: false,
        cf: csgFidName(a[2]),
        rf: csgFidName(a[3]),
      });
    }, "UnionAsync", true),
    SubtractAsync: nativeFn(function* (a) {
      return yield* csgYieldBuild(a[0], "SubtractAsync", {
        others: luaTableToArray(a[1]),
        subtract: true,
        cf: csgFidName(a[2]),
        rf: csgFidName(a[3]),
      });
    }, "SubtractAsync", true),
    IntersectAsync: nativeFn(function* (a) {
      const self = a[0];
      if (self && self.className === "GeometryService") {
        const p1 = a[1];
        const p2 = a[2];
        return yield* csgYieldBuild(p1, "IntersectAsync", {
          others: [p2],
          subtract: false,
          cf: csgFidName(a[3]),
          rf: csgFidName(a[4]),
        });
      }
      return yield* csgYieldBuild(self, "IntersectAsync", {
        others: luaTableToArray(a[1]),
        subtract: false,
        cf: csgFidName(a[2]),
        rf: csgFidName(a[3]),
      });
    }, "IntersectAsync", true),
    FindService: nativeFn((a) => { try { return [getServiceByName(String(a[1]))]; } catch { return [undefined]; } }, "FindService"),
    FindFirstChild: nativeFn((a) => {
      const c = a[0].findFirstChild(String(a[1]), !!a[2]) || undefined;

      if (c && serverOnlyHidden(c)) return [undefined];
      return [c];
    }, "FindFirstChild"),
    FindFirstChildOfClass: nativeFn((a) => {
      const c = a[0].getChildren().find((ch) => ch.className === String(a[1]) && !serverOnlyHidden(ch));
      return [c || undefined];
    }, "FindFirstChildOfClass"),
    FindFirstChildWhichIsA: nativeFn((a) => {
      const c = a[0].getChildren().find((ch) => isA(ch, String(a[1])) && !serverOnlyHidden(ch));
      return [c || undefined];
    }, "FindFirstChildWhichIsA"),
    FindFirstAncestor: nativeFn((a) => {
      let p = streamHusk(a[0]) ? null : a[0].getParent();
      while (p) { if (p.name === String(a[1])) return [p]; p = p.getParent(); }
      return [undefined];
    }, "FindFirstAncestor"),
    FindFirstAncestorOfClass: nativeFn((a) => {
      let p = streamHusk(a[0]) ? null : a[0].getParent();
      while (p) { if (p.className === String(a[1])) return [p]; p = p.getParent(); }
      return [undefined];
    }, "FindFirstAncestorOfClass"),
    WaitForChild: nativeFn(function* (a) {
      const self = a[0];
      const name = String(a[1]);
      const timeout = a[2] !== undefined ? num(a[2]) : undefined;
      let waited = 0;
      let warnedYield = false;
      for (;;) {
        const c = self.findFirstChild(name);
        if (c && !serverOnlyHidden(c)) return [c];
        if (timeout !== undefined && waited >= timeout) return [undefined];
        if (timeout === undefined && !warnedYield && waited >= 5) {
          warnedYield = true;
          let full = String(self.name);
          try {
            const segs = [];
            let anc = self;
            while (anc && anc !== dataModel) { segs.unshift(anc.name); anc = anc.getParent(); }
            if (segs.length) full = segs.join(".");
          } catch (_) {            }
          svcLog("warn", "Infinite yield possible on '" + full + ":WaitForChild(\"" + name + "\")'", "Script");
        }
        yield { kind: "wait", seconds: 0.05 };
        waited += 0.05;
      }
    }, "WaitForChild", true),
    GetChildren: nativeFn((a) => [arrayToTable(a[0].getChildren().filter((ch) => !serverOnlyHidden(ch)))], "GetChildren"),
    GetDescendants: nativeFn((a) => [arrayToTable(a[0].getDescendants().filter((d) => !serverOnlyHidden(d)))], "GetDescendants"),
    GetFullName: nativeFn((a) => {
      if (streamHusk(a[0])) return [String(a[0].name)];
      const parts = [];
      let p = a[0];
      while (p && p !== dataModel) { parts.unshift(p.name); p = p.getParent(); }
      return [parts.join(".")];
    }, "GetFullName"),
    IsA: nativeFn((a) => [isA(a[0], String(a[1]))], "IsA"),
    IsDescendantOf: nativeFn((a) => [streamHusk(a[0]) ? a[0] === a[1] : isDescendantOf(a[0], a[1])], "IsDescendantOf"),

    IsAncestorOf: nativeFn((a) => [!!(a[1] && a[1].__isInstance) && !streamHusk(a[1]) && isDescendantOf(a[1], a[0])], "IsAncestorOf"),
    GetDebugId: nativeFn((a) => {
      const scope = Math.max(4, Math.min(64, Math.floor(num(a[1]) || 32)));
      const raw = String(a[0].id || "0");
      return [raw.length > scope ? raw.slice(0, scope) : raw];
    }, "GetDebugId"),
    FindFirstAncestorWhichIsA: nativeFn((a) => {
      let anc = streamHusk(a[0]) ? null : a[0].getParent();
      while (anc) {
        if (isA(anc, String(a[1]))) return [anc];
        anc = anc.getParent();
      }
      return [undefined];
    }, "FindFirstAncestorWhichIsA"),
    FindFirstDescendant: nativeFn((a) => {
      const name = String(a[1]);
      const d = a[0].getDescendants().find((x) => x.name === name && !serverOnlyHidden(x));
      return [d || undefined];
    }, "FindFirstDescendant"),
    GetTouchingParts: nativeFn((a) => {
      const self = a[0];
      if (!self.hasProperty || !self.hasProperty("Size") || !self.hasProperty("Position")) {
        return [arrayToTable([])];
      }
      const ws = getService(dataModel, "Workspace");
      if (!ws) return [arrayToTable([])];


      if (!writeAxisAlignedPartBounds(touchingSelfBounds, self)) return [arrayToTable([])];
      const out = [];
      const indexedCandidateCount = queryBoxCandidates(ws, touchingSelfBounds, touchingCandidates);
      const candidates = indexedCandidateCount === null ? ws.getDescendants() : touchingCandidates;
      const candidateCount = indexedCandidateCount === null
        ? candidates.length
        : indexedCandidateCount;
      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
        const inst = candidates[candidateIndex];
        if (out.length >= 200) break;
        if (inst === self || !inst.hasProperty || !inst.hasProperty("Size") || !inst.hasProperty("Position")) continue;
        if (inst.className === "Terrain") continue;
        if (inst.hasProperty("CanTouch") && inst.getProperty("CanTouch") === false) continue;
        if (serverOnlyHidden(inst)) continue;
        if (!writeAxisAlignedPartBounds(touchingOtherBounds, inst)) continue;
        if (boundsOverlap(touchingOtherBounds, touchingSelfBounds)) out.push(inst);
      }
      return [arrayToTable(out)];
    }, "GetTouchingParts"),
    GetCamera: nativeFn((a) => {
      if (a[0].className !== "Workspace") {
        throw new LuaError("GetCamera: dispon\u00edvel apenas no Workspace");
      }
      const cam = a[0].getChildren().find((c) => c.className === "Camera");
      return [cam || undefined];
    }, "GetCamera"),






    GetMass: nativeFn((a) => {
      const self = a[0];
      if (!self || self.__isInstance !== true || !isA(self, "BasePart")) {
        throw new LuaError("GetMass: dispon\u00edvel apenas em BasePart");
      }
      const size = self.getProperty("Size") || { x: 0, y: 0, z: 0 };
      const shape = self.hasProperty("Shape") ? self.getProperty("Shape") : undefined;
      const material = self.hasProperty("Material") ? self.getProperty("Material") : undefined;
      const cls = self.className;


      let solid = null;
      if (cls === "UnionOperation" || cls === "NegateOperation" || cls === "IntersectOperation") {


        const csg = self._csgMesh && typeof self._csgMesh === "object" ? self._csgMesh : null;
        const hasRecipe = Array.isArray(self._sourceParts) && self._sourceParts.length > 0;
        const imp =
          !hasRecipe && self._importedSolid && typeof self._importedSolid === "object" && self._importedSolid.boxOnly !== true
            ? self._importedSolid
            : null;
        if (csg || imp) {
          solid = {
            volume: imp ? imp.volume : null,
            positions: csg ? csg.positions : null,
            baseSize: (csg && csg.baseSize) || (imp && imp.baseSize) || null,
          };
        }
      } else if (cls === "MeshPart") {


        const fidelity = self.hasProperty("CollisionFidelity") ? self.getProperty("CollisionFidelity") : "Default";
        if (fidelity !== "Box") {
          const meshId = self.hasProperty("MeshId") ? self.getProperty("MeshId") : "";
          const info = meshId ? meshRegistry.get(meshId) : null;
          const col = info && info.collision ? info.collision : null;
          if (col) {
            const wantDecomp = fidelity === "Default" || fidelity === "PreciseConvexDecomposition";
            solid = {
              normalizedVolume:
                wantDecomp && Number.isFinite(col.volume) && col.volume > 0 ? col.volume : null,
              normalizedBoxes: wantDecomp && Array.isArray(col.boxes) && col.boxes.length ? col.boxes : null,
              normalizedHull: col.hull || null,
            };
          }
        }
      }
      return [partMass({ size, shape, className: cls, material, solid })];
    }, "GetMass"),
    Resize: nativeFn((a) => {
      const self = a[0];
      if (!self || self.__isInstance !== true || !isA(self, "BasePart")) {
        throw new LuaError("Resize: dispon\u00edvel apenas em BasePart");
      }
      if (!clientCanMutate(self, "Resize")) return [false];
      const normalId = a[1] && a[1].__ud === "EnumItem" ? a[1].name : a[1];
      const res = resizePart({
        size: self.getProperty("Size") || { x: 0, y: 0, z: 0 },
        position: self.getProperty("Position") || { x: 0, y: 0, z: 0 },
        normalId,
        delta: num(a[2]),
        shape: self.hasProperty("Shape") ? self.getProperty("Shape") : undefined,
      });
      if (!res.ok) return [false];
      self.setProperty("Size", V3(res.size.x, res.size.y, res.size.z));
      self.setProperty("Position", V3(res.position.x, res.position.y, res.position.z));
      return [true];
    }, "Resize"),
    BreakJoints: nativeFn((a) => {
      const self = a[0];
      if (!self || self.__isInstance !== true || !isA(self, "BasePart")) {
        throw new LuaError("BreakJoints: dispon\u00edvel apenas em BasePart");
      }
      if (!clientCanMutate(self, "BreakJoints")) return [];
      breakJoints(self, {
        getDescendants: () => (typeof dataModel.getDescendants === "function" ? dataModel.getDescendants() : []),
        getProperty: (i, n) => (i && i.hasProperty && i.hasProperty(n) ? i.getProperty(n) : undefined),
        createInstance: () => null,
        destroy: (i) => { if (i && !(i.isLocked && i.isLocked())) destroyInstance(i); },
        touchingParts: () => [],
      });
      return [];
    }, "BreakJoints"),
    MakeJoints: nativeFn((a) => {
      const self = a[0];
      if (!self || self.__isInstance !== true || !isA(self, "BasePart")) {
        throw new LuaError("MakeJoints: dispon\u00edvel apenas em BasePart");
      }
      if (!clientCanMutate(self, "MakeJoints")) return [];
      const boxOf = (inst) => {
        const pos = inst.getProperty("Position") || { x: 0, y: 0, z: 0 };
        const size = inst.getProperty("Size") || { x: 0, y: 0, z: 0 };
        return {
          minX: pos.x - size.x / 2, maxX: pos.x + size.x / 2,
          minY: pos.y - size.y / 2, maxY: pos.y + size.y / 2,
          minZ: pos.z - size.z / 2, maxZ: pos.z + size.z / 2,
        };
      };
      makeJoints(self, {
        getDescendants: () => (typeof dataModel.getDescendants === "function" ? dataModel.getDescendants() : []),
        getProperty: (i, n) => (i && i.hasProperty && i.hasProperty(n) ? i.getProperty(n) : undefined),


        createInstance: (cls, props) => {
          const inst = createInstance(cls, { name: cls, parent: self });
          if (inst && props) {
            for (const k of Object.keys(props)) {
              if (inst.hasProperty && inst.hasProperty(k)) inst.setProperty(k, props[k]);
            }
          }
          return inst;
        },
        destroy: (i) => { if (i && !(i.isLocked && i.isLocked())) destroyInstance(i); },


        touchingParts: (part) => {
          if (!part.hasProperty || !part.hasProperty("Size") || !part.hasProperty("Position")) return [];
          const ws = getService(dataModel, "Workspace");
          if (!ws) return [];
          const b = boxOf(part);
          const out = [];
          for (const inst of ws.getDescendants()) {
            if (out.length >= 200) break;
            if (inst === part || !inst.hasProperty || !inst.hasProperty("Size") || !inst.hasProperty("Position")) continue;
            if (inst.className === "Terrain") continue;
            if (inst.hasProperty("CanTouch") && inst.getProperty("CanTouch") === false) continue;
            if (serverOnlyHidden(inst)) continue;
            const o = boxOf(inst);
            if (o.minX <= b.maxX && o.maxX >= b.minX && o.minY <= b.maxY && o.maxY >= b.minY && o.minZ <= b.maxZ && o.maxZ >= b.minZ) {
              out.push(inst);
            }
          }
          return out;
        },
      });
      return [];
    }, "MakeJoints"),
    GetNetworkOwner: nativeFn((a) => {
      const self = a[0];
      if (!self || self.__isInstance !== true || !isA(self, "BasePart")) {
        throw new LuaError("GetNetworkOwner: dispon\u00edvel apenas em BasePart");
      }
      const owner = networkOwners.get(self);
      return [owner || undefined];                                
    }, "GetNetworkOwner"),
    SetNetworkOwner: nativeFn((a) => {
      const self = a[0];
      if (!self || self.__isInstance !== true || !isA(self, "BasePart")) {
        throw new LuaError("SetNetworkOwner: dispon\u00edvel apenas em BasePart");
      }
      if (context === "client") {
        throw new LuaError("SetNetworkOwner: s\u00f3 o Server pode definir network ownership (anti-exploit)");
      }
      const anchored = self.hasProperty("Anchored") ? self.getProperty("Anchored") === true : false;
      if (anchored) {
        throw new LuaError("SetNetworkOwner: n\u00e3o \u00e9 poss\u00edvel definir network ownership de uma part Anchored (o Server \u00e9 sempre o dono)");
      }
      const v = a[1];
      if (v === undefined || v === null) {
        networkOwners.set(self, null);                                     
        return [];
      }
      if (v.__isInstance !== true || v.className !== "Player") {
        throw new LuaError("SetNetworkOwner: o argumento deve ser um Player ou nil");
      }
      networkOwners.set(self, v);
      return [];
    }, "SetNetworkOwner"),


    Emit: nativeFn((a) => {
      const self = a[0];
      if (self && self.className === "ParticleEmitter") {
        const raw = a[1] !== undefined ? num(a[1]) : 16;
        const count = Math.max(0, Math.min(500, Math.floor(raw)));
        if (count > 0) bus.emit("effects:emit", { instance: self, count });
      }
      return [];
    }, "Emit"),


    GetMinutesAfterMidnight: nativeFn((a) => {
      const self = a[0];
      if (!self || self.className !== "Lighting") {
        throw new LuaError("GetMinutesAfterMidnight: dispon\u00edvel apenas no Lighting");
      }
      return [wrapClockTime(num(self.getProperty("ClockTime"))) * 60];
    }, "GetMinutesAfterMidnight"),



    SetMinutesAfterMidnight: nativeFn((a) => {
      const self = a[0];
      if (!self || self.className !== "Lighting") {
        throw new LuaError("SetMinutesAfterMidnight: dispon\u00edvel apenas no Lighting");
      }
      const minutes = a[1] !== undefined ? num(a[1]) : 0;
      self.setProperty("ClockTime", wrapClockTime(minutes / 60));
      return [];
    }, "SetMinutesAfterMidnight"),


    SetTextureOffset: nativeFn((a) => {
      const self = a[0];
      if (self && self.className === "Beam") {
        const raw = a[1] !== undefined ? num(a[1]) : 0;
        const offset = ((raw % 1) + 1) % 1;
        bus.emit("effects:beamTextureOffset", { instance: self, offset });
      }
      return [];
    }, "SetTextureOffset"),

    Play: nativeFn((a) => {
      const self = a[0];
      if (self && self.className === "Sound") soundPlay(self);
      return [];
    }, "Play"),
    Pause: nativeFn((a) => {
      const self = a[0];
      if (self && self.className === "Sound") soundPause(self);
      return [];
    }, "Pause"),
    Resume: nativeFn((a) => {
      const self = a[0];
      if (self && self.className === "Sound") soundResume(self);
      return [];
    }, "Resume"),
    Stop: nativeFn((a) => {
      const self = a[0];
      if (self && self.className === "Sound") soundStop(self);
      return [];
    }, "Stop"),
    SetListener: nativeFn((a) => {
      const self = a[0];
      if (self && self.className === "SoundService") setAudioListener(a[1], a[2]);
      return [];
    }, "SetListener"),
    GetListener: nativeFn((a) => {
      const self = a[0];
      if (!self || self.className !== "SoundService") return [];
      const l = getAudioListener();
      return [l.type];
    }, "GetListener"),


    PlayLocalSound: nativeFn((a) => {
      const self = a[0];
      const snd = a[1];
      if (self && self.className === "SoundService" && snd && snd.className === "Sound") {
        playLocalSound(snd);
      }
      return [];
    }, "PlayLocalSound"),
    Destroy: nativeFn((a) => { destroyInstance(a[0]); return []; }, "Destroy"),
    Remove: nativeFn((a) => { destroyInstance(a[0]); return []; }, "Remove"),
    Clone: nativeFn((a) => {
      const c = a[0].clone() || undefined;

      if (c && context === "client") c.__netContext = "client";
      return [c];
    }, "Clone"),
    ClearAllChildren: nativeFn((a) => {
      for (const ch of a[0].getChildren().slice()) {

        if (!(ch.isLocked && ch.isLocked()) && clientCanMutate(ch, "destroy")) ch.destroy();
      }
      return [];
    }, "ClearAllChildren"),
    GetPropertyChangedSignal: nativeFn((a) => [propChangedSignal(a[0], String(a[1]))], "GetPropertyChangedSignal"),

    GetAttribute: nativeFn((a) => {
      const inst = a[0];
      const name = String(a[1]);
      const type = inst.getAttributeType ? inst.getAttributeType(name) : null;
      if (!type) return [undefined];
      return [attrValueToLua(type, inst.getAttribute(name))];
    }, "GetAttribute"),
    SetAttribute: nativeFn((a) => {
      const inst = a[0];
      const name = String(a[1]);
      const value = a[2];
      if (!clientCanMutate(inst, "SetAttribute")) return [];
      if (value === undefined || value === null) {
        if (inst.removeAttribute) inst.removeAttribute(name);
        return [];
      }
      const type = inferAttributeType(value);
      if (!type) {
        throw new LuaError(`SetAttribute("${name}"): tipo de valor n\u00e3o suportado para atributo.`);
      }
      const res = inst.setAttribute(name, type, attrValueFromLua(type, value));
      if (!res.ok) throw new LuaError(`SetAttribute("${name}"): ${res.error}`);
      return [];
    }, "SetAttribute"),
    GetAttributes: nativeFn((a) => {
      const t = new LuaTable();
      for (const { name, type, value } of a[0].getAttributesList()) {
        t.rawset(name, attrValueToLua(type, value));
      }
      return [t];
    }, "GetAttributes"),
    GetAttributeChangedSignal: nativeFn((a) => [attributeChangedSignal(a[0], String(a[1]))], "GetAttributeChangedSignal"),

    AddTag: nativeFn((a) => {
      if (!clientCanMutate(a[0], "AddTag")) return [];
      a[0].addTag(String(a[1]));
      return [];
    }, "AddTag"),
    RemoveTag: nativeFn((a) => {
      if (!clientCanMutate(a[0], "RemoveTag")) return [];
      a[0].removeTag(String(a[1]));
      return [];
    }, "RemoveTag"),
    HasTag: nativeFn((a) => [a[0].hasTag(String(a[1]))], "HasTag"),
    GetTags: nativeFn((a) => [arrayToTable(a[0].getTags())], "GetTags"),
    GetActor: nativeFn(() => [undefined], "GetActor"),
  };


  function mockUserId(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 1000000007;
    return 1000000 + (h % 9000000);
  }

  function buildPlaceholderRig() {
    const model = createInstance("Model", { name: "HumanoidModel" });
    const root = createInstance("Part", { name: "HumanoidRootPart", parent: model });
    if (root) root.setProperty("Size", makeVector3(2, 2, 1));
    const head = createInstance("Part", { name: "Head", parent: model });
    if (head) head.setProperty("Size", makeVector3(2, 1, 1));
    createInstance("Humanoid", { name: "Humanoid", parent: model });
    return model;
  }

  function makeMouseMock() {
    const t = new LuaTable();
    t.rawset("X", 0);
    t.rawset("Y", 0);
    t.rawset("Hit", CF(0, 0, 0));
    t.rawset("Target", undefined);
    t.rawset("UnitRay", RAY({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }));
    return t;
  }

  function rpToOpts(rp) {
    if (!rp || rp.__ud !== "RaycastParams") return null;
    if (rp.bruteForceAllSlow) svcLog("warn", "RaycastParams.BruteForceAllSlow ativo: consulta espacial sem otimizacoes (lento).", "SpatialQuery");
    return {
      filterType: rp.filterType,
      filterList: rp.list,
      ignoreWater: rp.ignoreWater,
      collisionGroup: rp.collisionGroup,
      respectCanCollide: rp.respectCanCollide,
    };
  }
  function opToOpts(op) {
    if (!op || op.__ud !== "OverlapParams") return null;
    if (op.bruteForceAllSlow) svcLog("warn", "OverlapParams.BruteForceAllSlow ativo: consulta espacial sem otimizacoes (lento).", "SpatialQuery");
    return {
      filterType: op.filterType,
      filterList: op.list,
      includeList: op.includeList,
      excludeList: op.excludeList,
      collisionGroup: op.collisionGroup,
      respectCanCollide: op.respectCanCollide,
      maxParts: op.maxParts,
      tolerance: op.tolerance,
    };
  }


  function withStreamSkip(opts) {
    const o = opts || {};
    o.skipInstance = (i) => serverOnlyHidden(i);
    return o;
  }
  function wrapRaycastResult(hit) {
    if (hit && hit.instance && serverOnlyHidden(hit.instance)) hit = null;
    if (!hit) return [undefined];
    return [{
      __ud: "RaycastResult",
      instance: hit.instance,
      position: hit.position,
      normal: hit.normal,
      material: hit.material,
      distance: hit.distance,
    }];
  }
  function spatialQueryMethod(inst, key) {
    const partPos = (p) => (p && typeof p.getProperty === "function" ? p.getProperty("Position") : null);
    const partSize = (p) => (p && typeof p.getProperty === "function" ? p.getProperty("Size") : null);
    const centers = (res) => (Array.isArray(res) ? res.map((r) => (r && typeof r.getProperty === "function" ? r.getProperty("Position") : null)) : []);
    if (key === "Raycast") return nativeFn((a) => { const hit = raycastWorkspace(inst, a[1], a[2], withStreamSkip(rpToOpts(a[3] && a[3].__ud === "RaycastParams" ? a[3] : null))); recordCast("ray", a[1], a[2], null, hit); return wrapRaycastResult(hit); }, "Raycast");
    if (key === "Blockcast") return nativeFn((a) => { const hit = blockcast(inst, a[1], a[2], a[3], withStreamSkip(rpToOpts(a[4] && a[4].__ud === "RaycastParams" ? a[4] : null))); recordCast("block", a[1], a[3], { size: a[2] }, hit); return wrapRaycastResult(hit); }, "Blockcast");
    if (key === "Spherecast") return nativeFn((a) => { const hit = spherecast(inst, a[1], a[2], a[3], withStreamSkip(rpToOpts(a[4] && a[4].__ud === "RaycastParams" ? a[4] : null))); recordCast("sphere", a[1], a[3], { radius: num(a[2]) }, hit); return wrapRaycastResult(hit); }, "Spherecast");
    if (key === "Shapecast") return nativeFn((a) => { const hit = shapecast(inst, a[1], a[2], withStreamSkip(rpToOpts(a[3] && a[3].__ud === "RaycastParams" ? a[3] : null))); recordCast("shape", partPos(a[1]), a[2], { size: partSize(a[1]) }, hit); return wrapRaycastResult(hit); }, "Shapecast");
    if (key === "GetPartBoundsInBox") return nativeFn((a) => { const res = getPartBoundsInBox(inst, a[1], a[2], withStreamSkip(opToOpts(a[3] && a[3].__ud === "OverlapParams" ? a[3] : null))); recordOverlap("obox", a[1], { size: a[2] }, centers(res)); return [arrayToTable(res.filter((i) => !serverOnlyHidden(i)))]; }, "GetPartBoundsInBox");
    if (key === "GetPartBoundsInRadius") return nativeFn((a) => { const res = getPartBoundsInRadius(inst, a[1], a[2], withStreamSkip(opToOpts(a[3] && a[3].__ud === "OverlapParams" ? a[3] : null))); recordOverlap("oradius", a[1], { radius: num(a[2]) }, centers(res)); return [arrayToTable(res.filter((i) => !serverOnlyHidden(i)))]; }, "GetPartBoundsInRadius");
    if (key === "GetPartsInPart") return nativeFn((a) => { const res = getPartsInPart(inst, a[1], withStreamSkip(opToOpts(a[2] && a[2].__ud === "OverlapParams" ? a[2] : null))); recordOverlap("obox", partPos(a[1]), { size: partSize(a[1]) }, centers(res)); return [arrayToTable(res.filter((i) => !serverOnlyHidden(i)))]; }, "GetPartsInPart");
    return undefined;
  }


  function partRotationQuat(p) {
    const r = p.getProperty("Rotation") || { x: 0, y: 0, z: 0 };
    return eulerDegToQuat(num(r.x), num(r.y), num(r.z));
  }


  function modelBaseParts(model) {
    const out = [];
    if (!model || typeof model.getDescendants !== "function") return out;
    for (const d of model.getDescendants()) {
      if (d && !d._destroyed && pfIsBasePart(d) && !streamHusk(d)) out.push(d);
    }
    return out;
  }

  function validPrimaryPart(model) {
    const pp = model.hasProperty && model.hasProperty("PrimaryPart")
      ? model.getProperty("PrimaryPart")
      : null;
    if (!pp || pp._destroyed || !isA(pp, "BasePart") || !isDescendantOf(pp, model)) return null;
    return pp;
  }


  function modelBoundingBox(model) {
    const pp = validPrimaryPart(model);
    const fq = pp ? partRotationQuat(pp) : { ...QUAT_IDENTITY };
    const fpos = pp ? (pp.getProperty("Position") || { x: 0, y: 0, z: 0 }) : null;
    const fi = quatConjugate(fq);
    let min = null;
    let max = null;
    for (const part of modelBaseParts(model)) {
      const pos = part.getProperty("Position") || { x: 0, y: 0, z: 0 };
      const size = part.getProperty("Size") || { x: 0, y: 0, z: 0 };
      const half = {
        x: Math.abs(num(size.x)) / 2,
        y: Math.abs(num(size.y)) / 2,
        z: Math.abs(num(size.z)) / 2,
      };
      const rq = quatMultiply(fi, partRotationQuat(part));
      const rel = fpos
        ? rotateVecByQuat({ x: num(pos.x) - num(fpos.x), y: num(pos.y) - num(fpos.y), z: num(pos.z) - num(fpos.z) }, fi)
        : { x: num(pos.x), y: num(pos.y), z: num(pos.z) };
      const ex = rotateVecByQuat({ x: half.x, y: 0, z: 0 }, rq);
      const ey = rotateVecByQuat({ x: 0, y: half.y, z: 0 }, rq);
      const ez = rotateVecByQuat({ x: 0, y: 0, z: half.z }, rq);
      const hx = Math.abs(ex.x) + Math.abs(ey.x) + Math.abs(ez.x);
      const hy = Math.abs(ex.y) + Math.abs(ey.y) + Math.abs(ez.y);
      const hz = Math.abs(ex.z) + Math.abs(ey.z) + Math.abs(ez.z);
      if (!min) {
        min = { x: rel.x - hx, y: rel.y - hy, z: rel.z - hz };
        max = { x: rel.x + hx, y: rel.y + hy, z: rel.z + hz };
      } else {
        min.x = Math.min(min.x, rel.x - hx);
        min.y = Math.min(min.y, rel.y - hy);
        min.z = Math.min(min.z, rel.z - hz);
        max.x = Math.max(max.x, rel.x + hx);
        max.y = Math.max(max.y, rel.y + hy);
        max.z = Math.max(max.z, rel.z + hz);
      }
    }
    if (!min) return { cframe: CF(0, 0, 0, fq), size: { x: 0, y: 0, z: 0 } };
    const cRel = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
    let cWorld = cRel;
    if (fpos) {
      const w = rotateVecByQuat(cRel, fq);
      cWorld = { x: num(fpos.x) + w.x, y: num(fpos.y) + w.y, z: num(fpos.z) + w.z };
    }
    return {
      cframe: CF(cWorld.x, cWorld.y, cWorld.z, fq),
      size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
    };
  }
  function instanceIndex(inst, key, line) {
    if (typeof key !== "string") return undefined;
    if (key === "Parent") {
      if (streamHusk(inst)) return undefined;
      return inst.getParent() || undefined;
    }
    if (key === "ClassName") return inst.className;

    if (key === "Value" && VALUE_OBJECT_CLASSES.has(inst.className)) {
      if (inst.className === "ObjectValue") {
        const ref = inst.getProperty("Value");
        if (ref && ref._destroyed) { inst.setProperty("Value", null); return undefined; }
        return ref || undefined;
      }
      if (inst.className === "BrickColorValue") return BC(inst.getProperty("Value"));
    }

    if (key === "TeamColor" && (inst.className === "Player" || inst.className === "Team")) {
      return BC(inst.getProperty("TeamColor"));
    }
    if (key === "Team" && inst.className === "Player") {
      const t = inst.getProperty("Team");
      if (t && t._destroyed) { inst.setProperty("Team", null); return undefined; }
      return t || undefined;
    }
    if (inst.className === "LocalizationTable") {
      if (key === "DevelopmentLanguageCode") return String(inst.getProperty("SourceLocaleId") || "");
      if (key === "Contents") return undefined;
    }


    if (key === "PrimaryPart" && isA(inst, "Model")) {
      const pp = inst.getProperty("PrimaryPart");
      if (!pp) return undefined;
      if (pp._destroyed || !isA(pp, "BasePart") || !isDescendantOf(pp, inst)) {
        inst.setProperty("PrimaryPart", null);
        return undefined;
      }
      return pp;
    }


    if (key === "TextBounds" && isA(inst, "TextLabel")) {
      const b = measureTextBounds(inst);
      return V2(b.x, b.y);
    }


    if (key === "AbsoluteCanvasSize" && inst.className === "ScrollingFrame") {
      const c = absoluteCanvasSize(inst);
      return V2(c.x, c.y);
    }


    if (key === "AbsoluteContentSize" && (inst.className === "UIListLayout" || inst.className === "UIGridLayout")) {
      const c = layoutAbsoluteContentSize(inst);
      return V2(c.x, c.y);
    }


    if ((key === "AbsoluteSize" || key === "AbsolutePosition") && inst.className === "ScreenGui") {


      const live = liveGuiViewportSize();
      const ignoreInset = inst.hasProperty("IgnoreGuiInset") && inst.getProperty("IgnoreGuiInset") === true;
      const guiInset = live && !ignoreInset ? GUI_TOPBAR_INSET_Y : 0;
      if (key === "AbsolutePosition") return V2(0, guiInset);
      return V2(live ? live.w : GUI_NOMINAL_W, (live ? live.h : GUI_NOMINAL_H) - guiInset);
    }
    if ((key === "AbsoluteSize" || key === "AbsolutePosition") && isA(inst, "Frame")) {
      const r = computeGuiRect(inst);
      if (r) return key === "AbsoluteSize" ? V2(r.w, r.h) : V2(r.x, r.y);
    }
    if (inst.hasProperty(key)) {
      return convertOut(getPropType(inst, key), inst.getProperty(key));
    }

    if (inst.className === "TweenService") {
      if (key === "Create") {
        return nativeFn((a) => {
          const tbl = a[3];
          if (!(tbl instanceof LuaTable)) {
            throw new LuaError("TweenService:Create espera uma table de propriedades como terceiro argumento");
          }
          const props = [];
          for (const [k, v] of tbl.map) props.push({ name: k, value: v });
          return [tweenManager.create(a[1], a[2], props)];
        }, "Create");
      }
      if (key === "GetValue") {
        return nativeFn((a) => {
          const style = resolveEasingStyle(a[2]);
          const dir = resolveEasingDirection(a[3]);
          return [ease(style, dir, num(a[1]))];
        }, "GetValue");
      }
    }

    if (inst.className === "UserInputService") {
      const im = inputManager;
      switch (key) {
        case "GetKeysPressed":
          return nativeFn(() => [arrayToTable(im.getKeysPressed())], "GetKeysPressed");
        case "GetMouseButtonsPressed":
          return nativeFn(() => [arrayToTable(im.getMouseButtonsPressed())], "GetMouseButtonsPressed");
        case "GetMouseLocation":
          return nativeFn(() => { const p = im.getMouseLocation(); return [V2(p.x, p.y)]; }, "GetMouseLocation");
        case "GetMouseDelta":
          return nativeFn(() => { const d = im.getMouseDelta(); return [V2(d.x, d.y)]; }, "GetMouseDelta");
        case "IsKeyDown":
          return nativeFn((a) => [im.isKeyDown(a[1])], "IsKeyDown");
        case "IsMouseButtonPressed":
          return nativeFn((a) => [im.isMouseButtonPressed(a[1])], "IsMouseButtonPressed");
        case "GetFocusedTextBox":
          return nativeFn(() => [im.getFocusedTextBox() || undefined], "GetFocusedTextBox");
        case "GetGamepadConnected":
          return nativeFn((a) => [im.getGamepadConnected(a[1])], "GetGamepadConnected");
        case "GetConnectedGamepads":
          return nativeFn(() => [arrayToTable(im.getConnectedGamepads())], "GetConnectedGamepads");
        case "GetGamepadState":
          return nativeFn((a) => [arrayToTable(im.getGamepadState(a[1]))], "GetGamepadState");
        case "SendKeyAction":
          return nativeFn((a) => { im.sendKeyAction(a[1], a[2]); return []; }, "SendKeyAction");
        default:
          break;
      }
      const uisSig = inputManager.uisSignal(key);
      if (uisSig) return uisSig;
    }

    if (inst.className === "ContextActionService") {
      const im = inputManager;
      switch (key) {
        case "BindAction":
          return nativeFn((a) => {
            im.bindAction({ name: a[1], callback: a[2], createTouchButton: a[3] === true, inputs: a.slice(4) });
            return [];
          }, "BindAction");
        case "BindActionAtPriority":
          return nativeFn((a) => {
            im.bindAction({ name: a[1], callback: a[2], createTouchButton: a[3] === true, priority: a[4], inputs: a.slice(5) });
            return [];
          }, "BindActionAtPriority");
        case "UnbindAction":
          return nativeFn((a) => { im.unbindAction(a[1]); return []; }, "UnbindAction");
        case "UnbindAllActions":
          return nativeFn(() => { im.unbindAllActions(); return []; }, "UnbindAllActions");
        case "GetBoundActionInfo":
          return nativeFn((a) => [actionInfoTable(im.getBoundActionInfo(a[1]))], "GetBoundActionInfo");
        case "GetAllBoundActionInfo":
          return nativeFn(() => {
            const t = new LuaTable();
            for (const info of im.getAllBoundActionInfo()) t.rawset(info.name, actionInfoTable(info));
            return [t];
          }, "GetAllBoundActionInfo");
        case "CallFunction":
          return nativeFn(function* (a) {
            const act = im.getAction(a[1]);
            if (!act) throw new LuaError("CallFunction: a action '" + String(a[1]) + "' n\u00e3o est\u00e1 vinculada");
            return yield* interp.call(act.callback, [act.name, ...a.slice(2)], 0);
          }, "CallFunction", true);
        case "SetTitle":


          return nativeFn((a) => {
            im.setActionTitle(a[1], a[2]);
            return [];
          }, "SetTitle");
        default:
          break;
      }
      const casSig = inputManager.casSignal(key);
      if (casSig) return casSig;
    }

    if (inst.className === "TextBox") {
      if (key === "CaptureFocus") {
        return nativeFn((a) => { inputManager.setFocusedTextBox(a[0]); return []; }, "CaptureFocus");
      }
      if (key === "ReleaseFocus") {
        return nativeFn((a) => {
          if (inputManager.getFocusedTextBox() === a[0]) inputManager.setFocusedTextBox(null);
          return [];
        }, "ReleaseFocus");
      }
      if (key === "IsFocused") {
        return nativeFn((a) => [inputManager.getFocusedTextBox() === a[0]], "IsFocused");
      }
    }


    if (key === "CFrame" && inst.hasProperty("Position")) {
      const p = inst.getProperty("Position") || { x: 0, y: 0, z: 0 };
      if (inst.hasProperty("Rotation")) {
        const r = inst.getProperty("Rotation") || { x: 0, y: 0, z: 0 };
        return CF(p.x, p.y, p.z, eulerDegToQuat(num(r.x), num(r.y), num(r.z)));
      }
      return CF(p.x, p.y, p.z);
    }

    if (key === "Velocity" && inst.hasProperty("AssemblyLinearVelocity")) {
      return convertOut(PropTypes.Vector3, inst.getProperty("AssemblyLinearVelocity"));
    }
    if (key === "RotVelocity" && inst.hasProperty("AssemblyAngularVelocity")) {
      return convertOut(PropTypes.Vector3, inst.getProperty("AssemblyAngularVelocity"));
    }

    if (inst.className === "Bone" && key === "Transform") {
      const bt = sanitizeBoneTransform(inst.getProperty("Transform"));


      const q = boneRotationQuat(inst);
      if (!q) return CF(bt.x, bt.y, bt.z);
      return CF(bt.x, bt.y, bt.z, { x: q.qx, y: q.qy, z: q.qz, w: q.qw });
    }
    if (inst.className === "Bone" && (key === "WorldCFrame" || key === "WorldPosition")) {
      let wx = 0;
      let wy = 0;
      let wz = 0;


      let acc = null;
      let node = inst;
      let guard = 0;
      while (node && node.hasProperty && !node.hasProperty("Anchored") && guard < 64) {
        guard += 1;
        let lx = 0;
        let ly = 0;
        let lz = 0;
        if (node.hasProperty("Position")) {
          const lp = node.getProperty("Position") || { x: 0, y: 0, z: 0 };
          lx = Number(lp.x) || 0;
          ly = Number(lp.y) || 0;
          lz = Number(lp.z) || 0;
          wx += lx;
          wy += ly;
          wz += lz;
        }
        let lq = null;
        if (node.className === "Bone") {
          const bt = sanitizeBoneTransform(node.getProperty("Transform"));
          lx += bt.x;
          ly += bt.y;
          lz += bt.z;
          wx += bt.x;
          wy += bt.y;
          wz += bt.z;
          lq = boneRotationQuat(node);
        }
        if (lq || acc) {
          const below = acc || { x: wx - lx, y: wy - ly, z: wz - lz, qx: 0, qy: 0, qz: 0, qw: 1 };
          acc = mulBoneCF(composeBoneCF({ x: lx, y: ly, z: lz }, lq), below);
        }
        node = node.getParent();
      }
      if (!acc) {
        if (node && node.hasProperty && node.hasProperty("Position")) {
          const wp = partPointToWorld(node, { x: wx, y: wy, z: wz });
          wx = wp.x;
          wy = wp.y;
          wz = wp.z;
        }
        return key === "WorldCFrame" ? CF(wx, wy, wz) : V3(wx, wy, wz);
      }
      let world = acc;
      if (node && node.hasProperty && node.hasProperty("Position")) {


        const hp = node.getProperty("Position") || { x: 0, y: 0, z: 0 };
        const hr = (node.hasProperty("Rotation") ? node.getProperty("Rotation") : null) || { x: 0, y: 0, z: 0 };
        const hq = sanitizeQuat(eulerDegToQuat(Number(hr.x) || 0, Number(hr.y) || 0, Number(hr.z) || 0));
        world = mulBoneCF(
          { x: Number(hp.x) || 0, y: Number(hp.y) || 0, z: Number(hp.z) || 0, qx: hq.x, qy: hq.y, qz: hq.z, qw: hq.w },
          acc,
        );
      }
      return key === "WorldCFrame"
        ? CF(world.x, world.y, world.z, { x: world.qx, y: world.qy, z: world.qz, w: world.qw })
        : V3(world.x, world.y, world.z);
    }
    if (inst.className === "Bone" && key === "GetRelativeTransform") {
      return nativeFn(() => {
        const bt = sanitizeBoneTransform(inst.getProperty("Transform"));

        const q = boneRotationQuat(inst);
        if (!q) return [CF(bt.x, bt.y, bt.z)];
        return [CF(bt.x, bt.y, bt.z, { x: q.qx, y: q.qy, z: q.qz, w: q.qw })];
      }, key);
    }
    if (inst.className === "Bone" && key === "GetRelativeTransformAll") {
      return nativeFn(() => {
        let ax = 0;
        let ay = 0;
        let az = 0;


        let acc = null;
        let node = inst;
        let guard = 0;
        while (node && node.className === "Bone" && guard < 64) {
          guard += 1;
          const bt = sanitizeBoneTransform(node.getProperty("Transform"));
          ax += bt.x;
          ay += bt.y;
          az += bt.z;
          const lq = boneRotationQuat(node);
          if (lq || acc) {
            const below = acc || { x: ax - bt.x, y: ay - bt.y, z: az - bt.z, qx: 0, qy: 0, qz: 0, qw: 1 };
            acc = mulBoneCF(composeBoneCF({ x: bt.x, y: bt.y, z: bt.z }, lq), below);
          }
          node = node.getParent();
        }
        if (!acc) return [CF(ax, ay, az)];
        return [CF(acc.x, acc.y, acc.z, { x: acc.qx, y: acc.qy, z: acc.qz, w: acc.qw })];
      }, key);
    }
    if (key === "WorldPosition" && inst.className === "Attachment") {
      const parent = inst.getParent();
      const local = inst.getProperty("Position") || { x: 0, y: 0, z: 0 };
      if (parent && parent.hasProperty && parent.hasProperty("Position")) {
        const wp = partPointToWorld(parent, local);
        return V3(wp.x, wp.y, wp.z);
      }
      return V3(local.x, local.y, local.z);
    }


    if ((key === "Axis" || key === "SecondaryAxis") && inst.className === "Attachment") {
      const o = inst.getProperty("Orientation") || { x: 0, y: 0, z: 0 };
      const base = key === "Axis" ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
      const v = rotateVecByQuat(base, eulerDegToQuat(num(o.x), num(o.y), num(o.z)));
      return V3(v.x, v.y, v.z);
    }


    if ((key === "CurrentAngle" || key === "AngularSpeed") && inst.className === "HingeConstraint") {
      const pw = getPhysics();
      const st = pw && typeof pw.constraintState === "function" ? pw.constraintState(inst) : null;
      if (!st) return 0;
      const raw = key === "CurrentAngle" ? st.currentAngle : st.angularSpeed;
      return Number.isFinite(Number(raw)) ? Number(raw) : 0;
    }
    if (inst.className === "Workspace" && (key === "Raycast" || key === "Blockcast" || key === "Spherecast" || key === "Shapecast" || key === "GetPartBoundsInBox" || key === "GetPartBoundsInRadius" || key === "GetPartsInPart")) {
      const m = spatialQueryMethod(inst, key);
      if (m) return m;
    }

    if (inst.className === "Terrain" && (key === "FillBlock" || key === "FillBall" || key === "FillRegion" || key === "Clear")) {
      return nativeFn((a) => {
        terrainScriptFill(key, a);
        return [];
      }, key);
    }
    if ((key === "ApplyImpulse" || key === "ApplyImpulseAtPosition" || key === "ApplyAngularImpulse") && inst.hasProperty("Anchored")) {
      return nativeFn((a) => {
        const pw = getPhysics();
        if (!pw) return [];                                                  
        if (key === "ApplyImpulse") pw.applyImpulse(a[0], a[1]);
        else if (key === "ApplyImpulseAtPosition") pw.applyImpulseAtPosition(a[0], a[1], a[2]);
        else pw.applyAngularImpulse(a[0], a[1]);
        return [];
      }, key);
    }
    if (key === "GetMarkerReachedSignal" && isA(inst, "KeyframeSequence")) {
      return nativeFn((a) => [markerSignalFor(a[0], String(a[1]))], "GetMarkerReachedSignal");
    }

    if (inst.className === "Teams" && key === "GetTeams") {
      return nativeFn(() => [arrayToTable(inst.getChildren().filter((c) => c.className === "Team"))], "GetTeams");
    }
    if (inst.className === "Team" && key === "GetPlayers") {
      return nativeFn(() => [arrayToTable(social.teamPlayers(inst))], "GetPlayers");
    }
    if (inst.className === "Players") {
      if (key === "NumPlayers") {
        return inst.getChildren().filter((c) => c.className === "Player").length;
      }
      if (key === "PlayerChatted") return getPlayersChattedSignal();            
      if (key === "GetPlayerByUserId") {
        return nativeFn((a) => {
          if (typeof a[1] !== "number" || !Number.isFinite(a[1])) return [undefined];
          for (const p of inst.getChildren()) {
            if (p.className === "Player" && Number(p.getProperty("UserId")) === a[1]) return [p];
          }
          return [undefined];
        }, "GetPlayerByUserId");
      }
      if (key === "GetUserIdFromNameAsync") {
        return nativeFn((a) => [mockUserId(String(a[1] || ""))], "GetUserIdFromNameAsync");
      }
      if (key === "GetNameFromUserIdAsync") {
        return nativeFn((a) => ["Player" + (Number(a[1]) || 0)], "GetNameFromUserIdAsync");
      }
      if (key === "GetUserThumbnailAsync") {
        return nativeFn((a) => ["rbxthumb://type=AvatarHeadShot&id=" + (Number(a[1]) || 0) + "&w=150&h=150", true], "GetUserThumbnailAsync");
      }
      if (key === "CreateHumanoidModelFromUserId") {
        return nativeFn(() => [buildPlaceholderRig()], "CreateHumanoidModelFromUserId");
      }
      if (key === "CreateHumanoidModelFromDescription") {
        return nativeFn(() => [buildPlaceholderRig()], "CreateHumanoidModelFromDescription");
      }
    }
    if (inst.className === "Player") {
      switch (key) {
        case "Kick":
          return nativeFn((a) => {
            if (context === "client") throw new LuaError("Player:Kick s\u00f3 pode ser chamado no Server (anti-exploit)");
            bus.emit("playtest:kick", { player: inst, message: String(a[1] || "") });
            return [];
          }, "Kick");
        case "Move":
          return nativeFn((a) => {
            const ch = inst.getProperty("Character");
            const hum = ch ? ch.getChildren().find((c) => c.className === "Humanoid") : null;
            if (hum && clientCanMutate(hum, "Move")) humMove(hum, a[1], a[2] === true);
            return [];
          }, "Move");
        case "DistanceFromCharacter":
          return nativeFn((a) => {
            const ch = inst.getProperty("Character");
            const root = ch ? (ch.findFirstChild("HumanoidRootPart") || ch.findFirstChild("Head")) : null;
            const pos = root ? root.getProperty("Position") : null;
            const pt = a[1];
            if (!pos || !pt) return [0];
            const dx = num(pt.x) - pos.x, dy = num(pt.y) - pos.y, dz = num(pt.z) - pos.z;
            return [Math.sqrt(dx * dx + dy * dy + dz * dz)];
          }, "DistanceFromCharacter");
        case "GetMouse":
          return nativeFn(() => [makeMouseMock()], "GetMouse");
        case "GetJoinData":
          return nativeFn(() => {
            const t = new LuaTable();
            t.rawset("SourcePlaceId", 0);
            t.rawset("SourceGameId", 0);
            t.rawset("TeleportData", undefined);
            return [t];
          }, "GetJoinData");
        case "IsFriendsWith":
          return nativeFn(() => [false], "IsFriendsWith");
        case "GetFriendsOnline":
          return nativeFn(() => [arrayToTable([])], "GetFriendsOnline");
        case "HasAppearanceLoaded":
          return nativeFn(() => [inst.getProperty("CharacterAppearanceLoaded") === true], "HasAppearanceLoaded");
        case "GetRankInGroup":
          return nativeFn(() => [0], "GetRankInGroup");
        case "GetRoleInGroup":
          return nativeFn(() => ["Guest"], "GetRoleInGroup");
        case "IsInGroup":
          return nativeFn(() => [false], "IsInGroup");
        case "LoadCharacterWithHumanoidDescription":
          return nativeFn(() => {
            const ch = playtestApi && playtestApi.loadCharacter ? playtestApi.loadCharacter() : null;
            return [ch || undefined];
          }, "LoadCharacterWithHumanoidDescription");

        case "RequestStreamAroundAsync":
          return nativeFn(function* (a) {
            const pt = a[1];

            const pos = pt && typeof pt.x === "number" && typeof pt.y === "number" && typeof pt.z === "number"
              ? { x: num(pt.x), y: num(pt.y), z: num(pt.z) }
              : null;

            const timeout = Math.max(0.1, Math.min(10, a[2] !== undefined ? num(a[2]) : 10));
            const res = streaming.requestStreamAround(inst, pos);
            if (!res.ok) throw new LuaError("RequestStreamAroundAsync: " + res.error);
            if (res.immediate) return [];
            let waited = 0;
            for (;;) {
              if (streaming.isAreaLoaded(res.clientId, res.pos)) {
                streaming.markRequestDone(res.clientId, true);
                return [];
              }
              if (waited >= timeout) {
                streaming.markRequestDone(res.clientId, false);
                throw new LuaError("RequestStreamAroundAsync: timeout de " + timeout + "s ao carregar a \u00e1rea pedida.");
              }
              yield { kind: "wait", seconds: 0.1 };
              waited += 0.1;
            }
          }, "RequestStreamAroundAsync", true);
        case "AddReplicationFocus":
          return nativeFn((a) => {
            if (context !== "server") throw new LuaError("AddReplicationFocus s\u00f3 pode ser chamado pelo Server.");
            const res = streaming.addReplicationFocus(inst, a[1]);
            if (!res.ok) throw new LuaError("AddReplicationFocus: " + res.error);
            return [];
          }, "AddReplicationFocus");
        case "RemoveReplicationFocus":
          return nativeFn((a) => {
            if (context !== "server") throw new LuaError("RemoveReplicationFocus s\u00f3 pode ser chamado pelo Server.");
            streaming.removeReplicationFocus(inst, a[1]);
            return [];
          }, "RemoveReplicationFocus");
        default:
          break;
      }
    }

    if (inst.className === "Model" && (key === "AddPersistentPlayer" || key === "RemovePersistentPlayer" || key === "GetPersistentPlayers")) {
      return nativeFn((a) => {
        if (key === "GetPersistentPlayers") return [arrayToTable(streaming.getPersistentPlayers(inst))];
        if (context !== "server") throw new LuaError(key + " s\u00f3 pode ser chamado pelo Server.");
        const res = key === "AddPersistentPlayer"
          ? streaming.addPersistentPlayer(inst, a[1])
          : streaming.removePersistentPlayer(inst, a[1]);
        if (!res.ok) throw new LuaError(key + ": " + res.error);
        return [];
      }, key);
    }


    if (inst.className === "TextBox") {
      if (key === "CaptureFocus") {
        return nativeFn(() => {
          if (guiFocusState.box && guiFocusState.box !== inst && !guiFocusState.box._destroyed) {
            bus.emit("gameplay:event", { instance: guiFocusState.box, type: "FocusLost", args: [false] });
          }
          if (guiFocusState.box !== inst) {
            bus.emit("gameplay:event", { instance: inst, type: "Focused", args: [] });
          }
          return [];
        }, "CaptureFocus");
      }
      if (key === "ReleaseFocus") {
        return nativeFn((a) => {
          if (guiFocusState.box === inst) {
            bus.emit("gameplay:event", { instance: inst, type: "FocusLost", args: [a[1] === true] });
          }
          return [];
        }, "ReleaseFocus");
      }
      if (key === "IsFocused") {
        return nativeFn(() => [guiFocusState.box === inst], "IsFocused");
      }
    }

    if (isA(inst, "Model")) {
      if (key === "GetBoundingBox") {
        return nativeFn(() => {
          const box = modelBoundingBox(inst);
          return [box.cframe, V3(box.size.x, box.size.y, box.size.z)];
        }, "GetBoundingBox");
      }
      if (key === "GetExtentsSize") {
        return nativeFn(() => {
          const box = modelBoundingBox(inst);
          return [V3(box.size.x, box.size.y, box.size.z)];
        }, "GetExtentsSize");
      }
      if (key === "SetPrimaryPartCFrame") {
        return nativeFn((a) => {
          const cf = a[1];
          if (!cf || cf.__ud !== "CFrame") {
            throw new LuaError("Model:SetPrimaryPartCFrame() espera um CFrame como argumento");
          }
          const pp = validPrimaryPart(inst);
          if (!pp) {
            throw new LuaError("Model:SetPrimaryPartCFrame() failed because no PrimaryPart has been set, or the PrimaryPart no longer exists. Please set Model.PrimaryPart before using this.");
          }
          if (!clientCanMutate(inst, "SetPrimaryPartCFrame")) return [];
          const cur = pp.getProperty("Position") || { x: 0, y: 0, z: 0 };
          const curCF = CF(num(cur.x), num(cur.y), num(cur.z), partRotationQuat(pp));

          const delta = cfCompose(cf, cfInverse(curCF));
          for (const part of modelBaseParts(inst)) {
            const pos = part.getProperty("Position") || { x: 0, y: 0, z: 0 };
            const ncf = cfCompose(delta, CF(num(pos.x), num(pos.y), num(pos.z), partRotationQuat(part)));
            const e = quatToEulerDeg(cfQuat(ncf));
            part.setProperty("Position", makeVector3(num(ncf.x), num(ncf.y), num(ncf.z)));
            part.setProperty("Rotation", makeVector3(num(e.x), num(e.y), num(e.z)));
          }
          return [];
        }, "SetPrimaryPartCFrame");
      }
      if (key === "BreakJoints") {
        return nativeFn(() => {
          if (!clientCanMutate(inst, "BreakJoints")) return [];
          const parts = new Set(modelBaseParts(inst));
          if (!parts.size) return [];


          const all = typeof dataModel.getDescendants === "function" ? dataModel.getDescendants() : [];
          for (const j of all) {
            if (!j || j._destroyed || JOINT_CLASSES.indexOf(j.className) === -1) continue;
            if (j.isLocked && j.isLocked()) continue;
            const p0 = j.getProperty("Part0");
            const p1 = j.getProperty("Part1");
            if ((p0 && parts.has(p0)) || (p1 && parts.has(p1))) destroyInstance(j);
          }
          return [];
        }, "BreakJoints");
      }
    }
    if (inst.className === "StarterGui") {
      if (key === "SetCoreGuiEnabled") {
        return nativeFn((a) => {
          const t = a[1] && a[1].__ud === "EnumItem" ? a[1].name : String(a[1]);
          social.setCoreGuiEnabled(t, a[2] !== false);
          return [];
        }, "SetCoreGuiEnabled");
      }
      if (key === "GetCoreGuiEnabled") {
        return nativeFn((a) => {
          const t = a[1] && a[1].__ud === "EnumItem" ? a[1].name : String(a[1]);
          return [social.getCoreGuiEnabled(t)];
        }, "GetCoreGuiEnabled");
      }
      if (key === "SetCore") {
        return nativeFn((a) => {
          const name = String(a[1]);


          if (name === "ResetButtonCallback") {
            const v = a[2];
            const ok = v === false || v === true ||
              (v && v.__isInstance === true && v.className === "BindableEvent");
            if (!ok) {
              throw new LuaError('SetCore("ResetButtonCallback"): use false, true ou um BindableEvent');
            }
          }
          social.setCoreParam(name, a[2]);

          if (name === "ChatActive") bus.emit("coregui:chatActive", { active: a[2] === true });
          if (name === "TopbarEnabled") bus.emit("coregui:topbar", { enabled: a[2] !== false });

          if (name === "ResetButtonCallback") bus.emit("coregui:resetButton", {});
          return [];
        }, "SetCore");
      }
      if (key === "GetCore") {
        return nativeFn((a) => {
          const name = String(a[1]);
          const v = social.getCoreParam(name);
          if (v !== null) return [v];

          if (name === "TopbarEnabled") return [true];
          if (name === "ChatActive") return [false];
          if (name === "ResetButtonCallback") return [true];
          return [undefined];
        }, "GetCore");
      }
    }

    if (key === "UniqueId") {
      const src = String(inst.id || "");
      let h1 = 0x811c9dc5;
      let h2 = 0x01000193;
      for (let i = 0; i < src.length; i++) {
        h1 = ((h1 ^ src.charCodeAt(i)) * 16777619) >>> 0;
        h2 = (h2 + src.charCodeAt(i) * 31) >>> 0;
      }
      const hex = (n) => n.toString(16).padStart(8, "0");
      return hex(h1) + hex(h2) + hex((h1 ^ h2) >>> 0) + hex((h1 + h2) >>> 0);
    }
    if (inst.className === "Workspace" && key === "DistributedGameTime") {
      return scheduler.clock;
    }
    if (inst.className === "ReplicatedFirst" && key === "RemoveDefaultLoadingScreen") {
      return nativeFn(() => {

        bus.emit("coregui:removeLoadingScreen", {});
        svcLog("info", "Tela de loading padr\u00e3o removida.", "ReplicatedFirst");
        return [];
      }, "RemoveDefaultLoadingScreen");
    }
    if (inst.className === "PlayerGui") {
      if (key === "GetTopbarTransparency") return nativeFn(() => [0], "GetTopbarTransparency");
      if (key === "SetTopbarTransparency") return nativeFn(() => [], "SetTopbarTransparency");
    }
    if (inst.className === "TextChatService" && key === "SendAsync") {
      return nativeFn((a) => {
        const lp = playtestApi && playtestApi.getLocalPlayer ? playtestApi.getLocalPlayer() : null;
        social.chat.sendFromPlayer(lp, String(a[1] || ""));
        return [];
      }, "SendAsync");
    }
    if (inst.className === "TextChannel") {
      if (key === "SendAsync") {
        return nativeFn((a) => {
          const lp = playtestApi && playtestApi.getLocalPlayer ? playtestApi.getLocalPlayer() : null;
          social.chat.sendFromPlayer(lp, String(a[1] || ""));
          return [];
        }, "SendAsync");
      }
      if (key === "DisplaySystemMessage") {
        return nativeFn((a) => {
          social.chat.sendSystem(String(a[1] || ""));
          bus.emit("chat:event", { instance: inst, type: "MessageReceived", args: [String(a[1] || "")] });
          return [];
        }, "DisplaySystemMessage");
      }
    }

    if (inst.className === "Players") {
      if (key === "LocalPlayer") {

        const lp = playtestApi && playtestApi.getLocalPlayer ? playtestApi.getLocalPlayer() : null;
        return context === "client" && lp ? lp : undefined;
      }
      if (key === "GetPlayers") {
        return nativeFn(
          () => [arrayToTable(inst.getChildren().filter((c) => c.className === "Player"))],
          "GetPlayers",
        );
      }
      if (key === "CreateLocalPlayer") {
        return nativeFn(() => {
          const p = playtestApi && playtestApi.createLocalPlayer ? playtestApi.createLocalPlayer() : null;
          return [p || undefined];
        }, "CreateLocalPlayer");
      }
      if (key === "GetPlayerFromCharacter") {
        return nativeFn((a) => {
          const ch = a[0];
          for (const p of inst.getChildren()) {
            if (p.className === "Player" && p.getProperty("Character") === ch) return [p];
          }
          return [undefined];
        }, "GetPlayerFromCharacter");
      }
    }
    if ((inst.className === "Player" || inst.className === "StarterPlayer") && key === "LoadCharacter") {
      return nativeFn(() => {
        const ch = playtestApi && playtestApi.loadCharacter ? playtestApi.loadCharacter() : null;
        return [ch || undefined];
      }, "LoadCharacter");
    }

    if (inst.className === "Tool") {
      if (key === "Grip") {


        const cf = gripToCFrame({
          pos: inst.getProperty("GripPos") || { x: 0, y: 0, z: 0 },
          forward: inst.getProperty("GripForward") || { x: 0, y: 0, z: -1 },
          right: inst.getProperty("GripRight") || { x: 1, y: 0, z: 0 },
          up: inst.getProperty("GripUp") || { x: 0, y: 1, z: 0 },
        });
        return CF(cf.x, cf.y, cf.z, { x: cf.qx, y: cf.qy, z: cf.qz, w: cf.qw });
      }
      if (key === "Activate") {
        return nativeFn(() => {
          bus.emit("gameplay:toolCommand", { type: "activate", tool: inst });
          return [];
        }, "Activate");
      }
      if (key === "Deactivate") {
        return nativeFn(() => {
          bus.emit("gameplay:toolCommand", { type: "deactivate", tool: inst });
          return [];
        }, "Deactivate");
      }
    }

    if (inst.className === "ClimateService") {
      const climRoot = () => {
        let n = inst;
        let guard = 0;
        while (n && typeof n.getParent === "function" && n.getParent() && guard < 100) {
          n = n.getParent();
          guard += 1;
        }
        return n;
      };
      const weatherArg = (v) => {
        if (typeof v === "string") return v;
        if (v && typeof v.Name === "string") return v.Name;
        if (v && typeof v.get === "function") {
          const n = v.get("Name");
          if (typeof n === "string") return n;
        }
        return String(v);
      };
      if (key === "SetWeather") {
        return nativeFn((a) => {
          if (!clientCanMutate(inst, "SetWeather")) return [];
          const t = weatherArg(a[1]);
          const res = climSetWeather(climRoot(), t, typeof a[2] === "number" ? a[2] : undefined, typeof a[3] === "number" ? a[3] : undefined);
          if (!res.ok) throw new LuaError(`SetWeather: WeatherType invalido "${t}"`);
          return [];
        }, "SetWeather");
      }
      if (key === "GetCurrentWeather") {
        return nativeFn(() => [climGetCurrentWeather()], "GetCurrentWeather");
      }
      if (key === "GetWindVector") {
        return nativeFn(() => {
          const w = climGetWindVector(climRoot());
          return [makeVector3(w.x, w.y, w.z)];
        }, "GetWindVector");
      }
      if (key === "StopWeather") {
        return nativeFn(() => {
          if (!clientCanMutate(inst, "StopWeather")) return [];
          climStopWeather(climRoot());
          return [];
        }, "StopWeather");
      }
    }


    if (inst.className === "Humanoid") {
      if (key === "Move") {
        return nativeFn((a) => {

          if (!clientCanMutate(inst, "Move")) return [];
          humMove(inst, a[1], a[2] === true);
          return [];
        }, "Move");
      }
      if (key === "MoveTo") {
        return nativeFn((a) => {
          if (!clientCanMutate(inst, "MoveTo")) return [];
          humMoveTo(inst, a[1], a[2]);
          return [];
        }, "MoveTo");
      }
      if (key === "TakeDamage") {
        return nativeFn((a) => {
          if (!clientCanMutate(inst, "TakeDamage")) return [];
          humTakeDamage(inst, a[1]);
          return [];
        }, "TakeDamage");
      }
      if (key === "ChangeState") {
        return nativeFn((a) => {
          if (!clientCanMutate(inst, "ChangeState")) return [];
          humChangeState(inst, a[1]);
          return [];
        }, "ChangeState");
      }
      if (key === "GetState") {
        return nativeFn(() => [enumItemFor("HumanoidStateType", humGetState(inst))], "GetState");
      }
      if (key === "SetStateEnabled") {
        return nativeFn((a) => {
          if (!clientCanMutate(inst, "SetStateEnabled")) return [];
          humSetStateEnabled(inst, a[1], a[2] !== false);
          return [];
        }, "SetStateEnabled");
      }
      if (key === "GetStateEnabled") {
        return nativeFn((a) => [humGetStateEnabled(inst, a[1])], "GetStateEnabled");
      }
      if (key === "GetMoveVelocity") {
        return nativeFn(() => {
          const v = humGetMoveVelocity(inst);
          return [makeVector3(v.x, v.y, v.z)];
        }, "GetMoveVelocity");
      }
      if (key === "AddAccessory") {
        return nativeFn((a) => {
          if (!clientCanMutate(inst, "AddAccessory")) return [];
          humAddAccessory(inst, a[1]);
          return [];
        }, "AddAccessory");
      }
      if (key === "ApplyDescription") {
        return nativeFn((a) => {
          if (!clientCanMutate(inst, "ApplyDescription")) return [];
          humApplyDescription(inst, a[1]);
          return [];
        }, "ApplyDescription");
      }
      if (key === "LoadAnimation") {


        return nativeFn((a) => {
          const animator = ensureAnimator(inst);
          const track = animator ? animLoadAnimation(animator, a[1]) : null;
          if (!track) throw new LuaError("LoadAnimation espera uma Animation");
          return [track];
        }, "LoadAnimation");
      }
      if (key === "EquipTool") {


        return nativeFn((a) => {
          if (!clientCanMutate(inst, "EquipTool")) return [];
          bus.emit("gameplay:toolCommand", { type: "equip", humanoid: inst, tool: a[1] });
          return [];
        }, "EquipTool");
      }
      if (key === "UnequipTools") {
        return nativeFn(() => {
          if (!clientCanMutate(inst, "UnequipTools")) return [];
          bus.emit("gameplay:toolCommand", { type: "unequip", humanoid: inst });
          return [];
        }, "UnequipTools");
      }
    }

    if (inst.className === "Animator") {
      if (key === "LoadAnimation") {
        return nativeFn((a) => {
          const track = animLoadAnimation(inst, a[1]);
          if (!track) throw new LuaError("LoadAnimation espera uma Animation");
          return [track];
        }, "LoadAnimation");
      }
      if (key === "GetPlayingAnimationTracks") {
        return nativeFn(() => [arrayToTable(animGetPlayingTracks(inst))], "GetPlayingAnimationTracks");
      }
    }
    if (inst.className === "AnimationTrack") {
      if (key === "Play") {
        return nativeFn((a) => { animTrackPlay(inst, a[1], a[2], a[3]); return []; }, "Play");
      }
      if (key === "Stop") {
        return nativeFn((a) => { animTrackStop(inst, a[1]); return []; }, "Stop");
      }
      if (key === "AdjustSpeed") {
        return nativeFn((a) => { animTrackAdjustSpeed(inst, a[1]); return []; }, "AdjustSpeed");
      }
      if (key === "AdjustWeight") {
        return nativeFn((a) => { animTrackAdjustWeight(inst, a[1], a[2]); return []; }, "AdjustWeight");
      }
      if (key === "GetTimeOfKeyframe") {
        return nativeFn((a) => {
          const t = animGetTimeOfKeyframe(inst, a[1]);
          if (t == null) throw new LuaError(`GetTimeOfKeyframe: keyframe "${String(a[1] == null ? "" : a[1])}" não encontrado`);
          return [t];
        }, "GetTimeOfKeyframe");
      }
    }
    if (inst.className === "Workspace" && key === "CurrentCamera") {
      const cam = inst.getChildren().find((c) => c.className === "Camera");
      return cam || undefined;
    }

    if (inst.className === "Camera") {
      const r = cameraIndex(inst, key);
      if (r !== undefined) return r;
    }

    if (inst.className === "CollectionService") {
      const r = collectionServiceIndex(inst, key);
      if (r !== undefined) return r;
    }

    if (inst.className === "RemoteEvent") {
      const r = remoteEventIndex(inst, key);
      if (r !== undefined) return r;
    } else if (inst.className === "RemoteFunction") {
      const r = remoteFunctionIndex(inst, key);
      if (r !== undefined) return r;
    } else if (inst.className === "BindableEvent") {
      const r = bindableEventIndex(inst, key);
      if (r !== undefined) return r;
    } else if (inst.className === "BindableFunction") {
      const r = bindableFunctionIndex(inst, key);
      if (r !== undefined) return r;
    }
    if (inst.className === "LocalizationService") {
      const locResult = localizationServiceIndex(inst, key);
      if (locResult !== undefined) return locResult;
    }
    if (inst.className === "LocalizationTable") {
      const locResult = localizationTableIndex(inst, key);
      if (locResult !== undefined) return locResult;
    }

    if (inst.className === "DataModel") {
      if (key === "IsLoaded") {


        return nativeFn(() => [true], "IsLoaded");
      }
      if (key === "BindToClose") {
        return nativeFn((a) => {
          if (context === "client") {
            throw new LuaError("BindToClose s\u00f3 pode ser chamado no Server (Script)");
          }
          const fn = a[1];
          if (fn == null) {
            throw new LuaError("BindToClose espera uma fun\u00e7\u00e3o como argumento");
          }
          closeCallbacks.push(fn);
          return [];
        }, "BindToClose");
      }
    }
    if (METHODS[key]) return METHODS[key];
    if (EVENT_NAMES.has(key)) return signalFor(inst, key);
    const child = inst.findFirstChild(key);
    if (child) {


      if (serverOnlyHidden(child)) {
        if (isUnderServerOnly(child)) {
          throw new LuaError(`'${child.name}' n\u00e3o \u00e9 acess\u00edvel a partir do Client (LocalScript)`);
        }
        throw new LuaError(`${key} n\u00e3o \u00e9 um membro v\u00e1lido de ${inst.className} "${inst.name}" (stream-out)`);
      }
      return child;
    }
    throw new LuaError(`${key} n\u00e3o \u00e9 um membro v\u00e1lido de ${inst.className} "${inst.name}"`);
  }


  const closeCallbacks = [];

  function instanceSetIndex(inst, key, value, line) {

    if (inst.className === "PackageLink") {
      throw new LuaError("PackageLink n\u00e3o pode ser editado por scripts durante o Playtest");
    }
    if (streamHusk(inst) && !clientOwns(inst)) {
      const hk = String(inst.id) + "|stream:" + key;
      if (!authorityWarned.has(hk) && logger) {
        authorityWarned.add(hk);
        logger.warn(`"${inst.name}" n\u00e3o est\u00e1 carregado neste Client (stream-out do streaming). A altera\u00e7\u00e3o de ${key} foi ignorada.`);
      }
      return;
    }

    if (inst.className === "Camera") {
      if (key === "CameraType") {


        const tname = value && value.__ud === "EnumItem" ? String(value.name) : String(value);
        if (tname === "Scriptable" || tname === "Fixed") {
          const p = cameraSys.getLastRenderPose();
          if (p) cameraSys.writeCameraProps(inst, p, true);
        }

      }
      if (key === "FieldOfView") {

        inst.setProperty("FieldOfView", clampFov(num(value, 70)));
        return;
      }
      if (key === "DiagonalFieldOfView" || key === "MaxAxisFieldOfView") {
        const vp = cameraSys.getViewportSize();
        const srcMode = key === "DiagonalFieldOfView" ? "Diagonal" : "MaxAxis";
        const vertical = toVerticalFov(num(value, 70), srcMode, vp.w, vp.h);
        const curMode = cameraFovMode(inst);
        inst.setProperty("FieldOfView", clampFov(fromVerticalFov(vertical, curMode, vp.w, vp.h)));
        return;
      }
      if (key === "HeadScale") {
        inst.setProperty("HeadScale", Math.min(10, Math.max(0.1, num(value, 1))));
        return;
      }
    }

    if (inst.className === "RemoteFunction" && (key === "OnServerInvoke" || key === "OnClientInvoke")) {
      const side = key === "OnServerInvoke" ? "server" : "client";
      if ((side === "client") !== (context === "client")) {
        throw new LuaError(`${key} s\u00f3 pode ser definido no ${side === "client" ? "Client (LocalScript)" : "Server (Script)"}`);
      }
      network.setInvokeCallback(inst, side, value || null);
      return;
    }
    if (inst.className === "BindableFunction" && key === "OnInvoke") {
      if (value === undefined || value === null) bindableOnInvoke.delete(inst);
      else bindableOnInvoke.set(inst, value);
      return;
    }

    if (!clientCanMutate(inst, "set:" + key)) return;
    if (inst.className === "LocalizationTable") {
      if (key === "Contents") throw new LuaError("Contents \u00e9 interno; use GetEntries/SetEntries/SetEntry");
      if (key === "DevelopmentLanguageCode") {
        inst.setProperty("SourceLocaleId", String(value == null ? "" : value));
        return;
      }
    }
    if (key === "Parent") {
      const target = value === undefined || value === null ? null : value;
      if (inst.isLocked && inst.isLocked()) {
        throw new LuaError(`N\u00e3o \u00e9 permitido reparentar uma inst\u00e2ncia protegida (${inst.className})`);
      }
      inst.setParent(target);
      return;
    }

    if (key === "Velocity" && inst.hasProperty("AssemblyLinearVelocity")) {
      inst.setProperty("AssemblyLinearVelocity", convertIn(PropTypes.Vector3, value));
      return;
    }
    if (key === "RotVelocity" && inst.hasProperty("AssemblyAngularVelocity")) {
      inst.setProperty("AssemblyAngularVelocity", convertIn(PropTypes.Vector3, value));
      return;
    }

    if (key === "Value" && inst.className === "BrickColorValue") {
      const name = value && value.__ud === "BrickColor" ? value.name
        : value && value.__ud === "EnumItem" ? value.name
        : String(value);
      if (!inst.setProperty("Value", name)) {
        throw new LuaError("Value inv\u00e1lido para BrickColorValue (use BrickColor.new ou um nome v\u00e1lido)");
      }
      return;
    }
    if (key === "Value" && (inst.className === "IntConstrainedValue" || inst.className === "DoubleConstrainedValue")) {
      let n = num(value);
      const mn = num(inst.getProperty("MinValue"));
      const mx = num(inst.getProperty("MaxValue"));
      if (n < mn) n = mn;
      if (n > mx) n = mx;
      inst.setProperty("Value", n);
      return;
    }


    if (key === "PrimaryPart" && isA(inst, "Model")) {
      const target = value === undefined || value === null ? null : value;
      if (target !== null && (target.__isInstance !== true || !isA(target, "BasePart"))) {
        throw new LuaError("PrimaryPart deve ser uma BasePart (ou nil)");
      }
      inst.setProperty("PrimaryPart", target && target._destroyed ? null : target);
      return;
    }


    if (inst.className === "Tool" && key === "Grip") {
      if (!value || value.__ud !== "CFrame") {
        throw new LuaError(`Grip deve receber um valor CFrame`);
      }
      const g = cframeToGrip(value);
      inst.setProperty("GripPos", makeVector3(num(g.pos.x), num(g.pos.y), num(g.pos.z)));
      inst.setProperty("GripForward", makeVector3(num(g.forward.x), num(g.forward.y), num(g.forward.z)));
      inst.setProperty("GripRight", makeVector3(num(g.right.x), num(g.right.y), num(g.right.z)));
      inst.setProperty("GripUp", makeVector3(num(g.up.x), num(g.up.y), num(g.up.z)));
      return;
    }






    if (inst.className === "Bone" && key === "Transform" && value && value.__ud === "CFrame") {
      const cq = cfQuat(value);
      const bq = { qx: cq.x, qy: cq.y, qz: cq.z, qw: cq.w };
      inst.setProperty("Transform", sanitizeBoneTransform({
        x: num(value.x),
        y: num(value.y),
        z: num(value.z),
        qx: bq.qx,
        qy: bq.qy,
        qz: bq.qz,
        qw: bq.qw,
      }));
      const e = isIdentityQuat(bq) ? { x: 0, y: 0, z: 0 } : eulerDegFromQuat(bq);
      const er = sanitizeBoneTransform(e);
      inst.setProperty("TransformRotation", makeVector3(er.x, er.y, er.z));
      return;
    }


    if (inst.className === "Attachment" && key === "SecondaryAxis") {
      if (!value || value.__ud !== "Vector3") {
        throw new LuaError("SecondaryAxis deve receber um Vector3");
      }
      const vy = { x: num(value.x), y: num(value.y), z: num(value.z) };
      const yl = Math.sqrt(vy.x * vy.x + vy.y * vy.y + vy.z * vy.z);
      if (!(yl > 1e-9)) return;                                         
      const y = { x: vy.x / yl, y: vy.y / yl, z: vy.z / yl };
      const o = inst.getProperty("Orientation") || { x: 0, y: 0, z: 0 };
      const x0 = rotateVecByQuat({ x: 1, y: 0, z: 0 }, eulerDegToQuat(num(o.x), num(o.y), num(o.z)));
      const dxy = x0.x * y.x + x0.y * y.y + x0.z * y.z;
      let xv = { x: x0.x - dxy * y.x, y: x0.y - dxy * y.y, z: x0.z - dxy * y.z };
      const xl = Math.sqrt(xv.x * xv.x + xv.y * xv.y + xv.z * xv.z);
      if (xl > 1e-9) {
        xv = { x: xv.x / xl, y: xv.y / xl, z: xv.z / xl };
      } else {

        const t = Math.abs(y.x) < 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
        const dt = t.x * y.x + t.y * y.y + t.z * y.z;
        const p = { x: t.x - dt * y.x, y: t.y - dt * y.y, z: t.z - dt * y.z };
        const pl = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) || 1;
        xv = { x: p.x / pl, y: p.y / pl, z: p.z / pl };
      }
      const e = quatToEulerDeg(quatFromBasis(xv, y));
      inst.setProperty("Orientation", makeVector3(e.x, e.y, e.z));
      return;
    }

    if (inst.className === "HingeConstraint" && (key === "CurrentAngle" || key === "AngularSpeed")) {
      throw new LuaError(`${key} \u00e9 uma propriedade somente leitura de HingeConstraint`);
    }


    if (inst.className === "Player" && key === "Team") {
      social.assignPlayerToTeam(inst, value || null);
      return;
    }
    if (key === "TeamColor" && (inst.className === "Player" || inst.className === "Team" || inst.className === "SpawnLocation")) {
      const name = value && value.__ud === "BrickColor" ? value.name
        : value && value.__ud === "EnumItem" ? value.name
        : String(value);
      if (inst.className === "Player") { social.assignPlayerTeamColor(inst, name); return; }
      if (!inst.setProperty("TeamColor", name)) {
        throw new LuaError("TeamColor inv\u00e1lido (use BrickColor.new ou um nome v\u00e1lido)");
      }
      if (inst.className === "Team") social.bumpTeamCache();
      return;
    }
    if (key === "CFrame" && !inst.hasProperty("CFrame") && inst.hasProperty("Position")) {
      if (!value || value.__ud !== "CFrame") {
        throw new LuaError(`CFrame deve receber um valor CFrame`);
      }
      inst.setProperty("Position", makeVector3(num(value.x), num(value.y), num(value.z)));

      if (inst.hasProperty("Rotation")) {
        const e = quatToEulerDeg(cfQuat(value));
        inst.setProperty("Rotation", makeVector3(e.x, e.y, e.z));
      }
      return;
    }
    if (!inst.hasProperty(key)) {
      throw new LuaError(`${key} n\u00e3o \u00e9 um membro v\u00e1lido de ${inst.className} "${inst.name}"`);
    }
    const type = getPropType(inst, key);
    const raw = convertIn(type, value);


    const __rawSafe =
      inst.className === "Bone" && (key === "Transform" || key === "TransformRotation") && raw && typeof raw === "object"
        ? sanitizeBoneTransform(raw)
        : raw;


    const __rawFinal =
      key === "Reflectance" && typeof __rawSafe === "number"
        ? Math.max(0, Math.min(1, Number.isFinite(__rawSafe) ? __rawSafe : 0))
        : __rawSafe;
    const ok = inst.setProperty(key, __rawFinal);
    if (!ok) {


      const entry = inst._props ? inst._props.get(key) : null;
      const res = entry && !entry.def.readOnly ? coerceValue(entry.def.type, raw, entry.def) : { ok: false };
      const unchanged = !!(res.ok && valuesEqual(entry.def.type, entry.value, res.value));
      if (!unchanged) {
        throw new LuaError(`N\u00e3o foi poss\u00edvel atribuir a propriedade ${key} em ${inst.className}`);
      }
    }
  }


  function vector3Index(v, key) {
    switch (key) {
      case "X": return v.x;
      case "Y": return v.y;
      case "Z": return v.z;
      case "Magnitude": return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      case "Unit": {
        const m = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
        return V3(v.x / m, v.y / m, v.z / m);
      }
      case "Dot": return nativeFn((a) => [a[0].x * a[1].x + a[0].y * a[1].y + a[0].z * a[1].z], "Dot");
      case "Cross": return nativeFn((a) => {
        const u = a[0], w = a[1];
        return [V3(u.y * w.z - u.z * w.y, u.z * w.x - u.x * w.z, u.x * w.y - u.y * w.x)];
      }, "Cross");
      case "Lerp": return nativeFn((a) => {
        const u = a[0], w = a[1], t = num(a[2]);
        return [V3(u.x + (w.x - u.x) * t, u.y + (w.y - u.y) * t, u.z + (w.z - u.z) * t)];
      }, "Lerp");
      default: return undefined;
    }
  }


  function cframeIndex(cf, key) {
    switch (key) {
      case "X": return cf.x;
      case "Y": return cf.y;
      case "Z": return cf.z;
      case "Position": case "p": return V3(cf.x, cf.y, cf.z);
      case "Rotation": return CF(0, 0, 0, cfQuat(cf));
      case "RightVector": case "XVector": {
        const v = rotateVecByQuat({ x: 1, y: 0, z: 0 }, cfQuat(cf));
        return V3(v.x, v.y, v.z);
      }
      case "UpVector": case "YVector": {
        const v = rotateVecByQuat({ x: 0, y: 1, z: 0 }, cfQuat(cf));
        return V3(v.x, v.y, v.z);
      }
      case "ZVector": {
        const v = rotateVecByQuat({ x: 0, y: 0, z: 1 }, cfQuat(cf));
        return V3(v.x, v.y, v.z);
      }
      case "LookVector": {
        const v = rotateVecByQuat({ x: 0, y: 0, z: -1 }, cfQuat(cf));
        return V3(v.x, v.y, v.z);
      }
      case "Inverse": return nativeFn((a) => [cfInverse(a[0])], "Inverse");
      case "Lerp": return nativeFn((a) => {
        const s = a[0], g = a[1], t = num(a[2]);
        return [CF(
          s.x + (num(g.x) - s.x) * t,
          s.y + (num(g.y) - s.y) * t,
          s.z + (num(g.z) - s.z) * t,
          quatSlerp(cfQuat(s), cfQuat(g), t),
        )];
      }, "Lerp");
      case "ToWorldSpace": return nativeFn((a) => [cfCompose(a[0], a[1])], "ToWorldSpace");
      case "ToObjectSpace": return nativeFn((a) => [cfCompose(cfInverse(a[0]), a[1])], "ToObjectSpace");
      case "PointToWorldSpace": return nativeFn((a) => {
        const r = rotateVecByQuat({ x: num(a[1] && a[1].x), y: num(a[1] && a[1].y), z: num(a[1] && a[1].z) }, cfQuat(a[0]));
        return [V3(a[0].x + r.x, a[0].y + r.y, a[0].z + r.z)];
      }, "PointToWorldSpace");
      case "PointToObjectSpace": return nativeFn((a) => {
        const qi = quatConjugate(cfQuat(a[0]));
        const r = rotateVecByQuat({
          x: num(a[1] && a[1].x) - a[0].x,
          y: num(a[1] && a[1].y) - a[0].y,
          z: num(a[1] && a[1].z) - a[0].z,
        }, qi);
        return [V3(r.x, r.y, r.z)];
      }, "PointToObjectSpace");
      case "VectorToWorldSpace": return nativeFn((a) => {
        const r = rotateVecByQuat({ x: num(a[1] && a[1].x), y: num(a[1] && a[1].y), z: num(a[1] && a[1].z) }, cfQuat(a[0]));
        return [V3(r.x, r.y, r.z)];
      }, "VectorToWorldSpace");
      case "VectorToObjectSpace": return nativeFn((a) => {
        const r = rotateVecByQuat(
          { x: num(a[1] && a[1].x), y: num(a[1] && a[1].y), z: num(a[1] && a[1].z) },
          quatConjugate(cfQuat(a[0])),
        );
        return [V3(r.x, r.y, r.z)];
      }, "VectorToObjectSpace");
      case "ToEulerAnglesXYZ": return nativeFn((a) => {
        const e = quatToEulerXYZ(cfQuat(a[0]));
        return [e.x, e.y, e.z];
      }, "ToEulerAnglesXYZ");
      case "ToOrientation": return nativeFn((a) => {
        const e = quatToEulerYXZ(cfQuat(a[0]));
        return [e.x, e.y, e.z];
      }, "ToOrientation");
      case "ToAxisAngle": return nativeFn((a) => {
        const r = quatToAxisAngle(cfQuat(a[0]));
        return [V3(r.axis.x, r.axis.y, r.axis.z), r.angle];
      }, "ToAxisAngle");
      case "GetComponents": case "components": return nativeFn((a) => {
        const s = a[0];
        const m = quatToMatrix(cfQuat(s));
        return [s.x, s.y, s.z, m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]];
      }, "GetComponents");
      default: return undefined;
    }
  }

  function colorIndex(v, key) {
    switch (key) {
      case "R": return v.r;
      case "G": return v.g;
      case "B": return v.b;
      case "Lerp": return nativeFn((a) => {
        const u = a[0], w = a[1], t = num(a[2]);
        return [COL(u.r + (w.r - u.r) * t, u.g + (w.g - u.g) * t, u.b + (w.b - u.b) * t)];
      }, "Lerp");
      default: return undefined;
    }
  }


  const renderBinds = new Map();
  let renderDispatcherOn = false;
  function ensureRenderDispatcher() {
    if (renderDispatcherOn) return;
    renderDispatcherOn = true;
    scheduler.renderStepped.connect(nativeFn((args) => {
      const ordered = [...renderBinds.values()].sort((x, y) => x.priority - y.priority);
      for (const b of ordered) {
        scheduler.spawnFn(b.fn, args.slice(), "RenderStep:" + b.name);
      }
      return [];
    }, "RenderStepDispatcher"));
  }
  function runServiceIndex(key) {
    switch (key) {
      case "Heartbeat": return scheduler.heartbeat;
      case "Stepped": return scheduler.stepped;
      case "RenderStepped": return scheduler.renderStepped;

      case "IsClient": return nativeFn(() => [context === "client"], "IsClient");
      case "IsServer": return nativeFn(() => [context !== "client"], "IsServer");

      case "IsEdit": return nativeFn(() => [getMode() === "edit"], "IsEdit");
      case "IsRunMode": return nativeFn(() => [getMode() === "run"], "IsRunMode");
      case "IsRunning": return nativeFn(() => [getMode() !== "edit"], "IsRunning");
      case "IsStudio": return nativeFn(() => [true], "IsStudio");
      case "BindToRenderStep":
        return nativeFn((a) => {
          const name = String(a[1]);
          const rawPriority = a[2] && a[2].__ud === "EnumItem" ? a[2].value : a[2];
          const priority = rawPriority === undefined ? 2000 : num(rawPriority);
          const fn = a[3];
          if (!fn) throw new LuaError("BindToRenderStep: callback obrigat\u00f3rio");
          if (renderBinds.size >= 64 && !renderBinds.has(name)) {
            throw new LuaError("BindToRenderStep: limite de 64 binds atingido");
          }
          renderBinds.set(name, { name, priority, fn });
          ensureRenderDispatcher();
          return [];
        }, "BindToRenderStep");
      case "UnbindFromRenderStep":
        return nativeFn((a) => {
          renderBinds.delete(String(a[1]));
          return [];
        }, "UnbindFromRenderStep");
      default: return undefined;
    }
  }

  function enumTypeItems(typeName) {
    return Enums[typeName] || null;
  }

  function locTables() {
    return dataModel ? locCore.findLocalizationTables(dataModel) : [];
  }

  function locTableData(tableInst) {
    return locCore.parseContents(tableInst.getProperty("Contents"));
  }

  function locApplyContents(tableInst, data, entries) {
    if (entries.length > locCore.LOC_LIMITS.maxEntries) {
      throw new LuaError(`LocalizationTable: m\u00e1ximo de ${locCore.LOC_LIMITS.maxEntries} entries por tabela`);
    }
    const next = { locales: data.locales, entries };
    if (locCore.localesOf(next).length > locCore.LOC_LIMITS.maxLocales) {
      throw new LuaError(`LocalizationTable: m\u00e1ximo de ${locCore.LOC_LIMITS.maxLocales} locales por tabela`);
    }
    tableInst.setProperty("Contents", locCore.serializeContents(next));
  }

  function locMakeTranslator(localeId, tableInst) {
    return { __ud: "Translator", localeId: locCore.sanitizeLocaleId(localeId) || "en-us", tableInst: tableInst || null };
  }

  function locPlayerLocale(player) {
    if (player && player.hasProperty && player.hasProperty("LocaleId")) {
      const id = locCore.sanitizeLocaleId(player.getProperty("LocaleId"));
      if (id) return id;
    }
    return getTestLocale();
  }

  function locEntryToLua(entry) {
    const t = new LuaTable();
    t.rawset("Key", entry.Key);
    t.rawset("Source", entry.Source);
    t.rawset("Context", entry.Context);
    t.rawset("Example", entry.Example);
    const values = new LuaTable();
    for (const id of Object.keys(entry.Values)) values.rawset(id, entry.Values[id]);
    t.rawset("Values", values);
    return t;
  }

  function locEntriesToLua(entries) {
    const t = new LuaTable();
    for (let i = 0; i < entries.length; i++) t.rawset(i + 1, locEntryToLua(entries[i]));
    return t;
  }

  function locLuaToEntry(value) {
    if (!(value instanceof LuaTable)) return null;
    const values = {};
    const rawValues = value.rawget("Values");
    if (rawValues instanceof LuaTable) {
      for (const [k, v] of rawValues.map) values[String(k)] = v == null ? "" : String(v);
    }
    return locCore.normalizeEntry({
      Key: value.rawget("Key"),
      Source: value.rawget("Source"),
      Context: value.rawget("Context"),
      Example: value.rawget("Example"),
      Values: values,
    });
  }

  function locLoadedTargets(tr) {
    let targets;
    if (tr.tableInst) {
      const dead = typeof tr.tableInst.isDestroyed === "function" && tr.tableInst.isDestroyed();
      targets = dead ? [] : [tr.tableInst];
    } else {
      targets = locTables();
    }
    return targets.map((inst) => {
      const data = locTableData(inst);
      return {
        inst,
        data,
        indexes: locCore.buildIndexes(data),
        sourceLocale: locCore.sanitizeLocaleId(inst.getProperty("SourceLocaleId")) || "en-us",
      };
    });
  }

  function locTranslate(tr, text, context) {
    const source = String(text == null ? "" : text);
    for (const target of locLoadedTargets(tr)) {
      const entry = locCore.findEntryForSource(target.indexes, source, context || "");
      if (!entry) continue;
      if (tr.localeId === target.sourceLocale) return source;
      const value = entry.Values[tr.localeId];
      if (value) return value;
    }
    return source;
  }

  function locFormatByKey(tr, key, argsTable) {
    const k = String(key == null ? "" : key);
    if (!k) throw new LuaError("FormatByKey: key inv\u00e1lida");
    const args = {};
    if (argsTable instanceof LuaTable) {
      for (const [name, value] of argsTable.map) args[String(name)] = value;
    } else if (argsTable != null) {
      throw new LuaError("FormatByKey: args deve ser uma table");
    }
    for (const target of locLoadedTargets(tr)) {
      const entry = target.indexes.byKey.get(k);
      if (!entry) continue;
      const pattern = entry.Values[tr.localeId] || entry.Source;
      try {
        return locCore.formatMessage(pattern, args, {
          localeId: tr.localeId,
          translate: (txt) => locTranslate(tr, txt, ""),
        });
      } catch (err) {
        throw new LuaError(`${err && err.message ? err.message : err} (key "${k}")`);
      }
    }
    throw new LuaError(`FormatByKey: key "${k}" n\u00e3o encontrada na LocalizationTable`);
  }

  function translatorIndex(obj, key) {
    switch (key) {
      case "LocaleId":
        return obj.localeId;
      case "Translate":
      case "RobloxOnlyTranslate":
        return nativeFn((a) => {
          const ctx = a[1] && a[1].className ? locCore.instancePath(a[1]) : "";
          return [locTranslate(a[0], a[2], ctx)];
        }, key);
      case "FormatByKey":
        return nativeFn((a) => [locFormatByKey(a[0], a[1], a[2])], "FormatByKey");
      default:
        return undefined;
    }
  }

  function localizationServiceIndex(inst, key) {
    switch (key) {
      case "GetTranslatorForPlayer":
      case "GetTranslatorForPlayerAsync":
        return nativeFn((a) => [locMakeTranslator(locPlayerLocale(a[1]), null)], key);
      case "GetTranslatorForLocaleAsync":
        return nativeFn((a) => {
          const id = locCore.sanitizeLocaleId(a[1]);
          if (!id) throw new LuaError(`GetTranslatorForLocaleAsync: locale inv\u00e1lido "${String(a[1])}"`);
          return [locMakeTranslator(id, null)];
        }, "GetTranslatorForLocaleAsync");
      case "GetTableEntries":
        return nativeFn((a) => {
          const target = a[1] && a[1].className ? a[1] : null;
          const path = target ? locCore.instancePath(target) : "";
          const out = [];
          for (const tableInst of locTables()) {
            for (const entry of locTableData(tableInst).entries) {
              if (!target || locCore.contextAppliesTo(entry.Context, path)) out.push(entry);
            }
          }
          return [locEntriesToLua(out)];
        }, "GetTableEntries");
      case "GetCountryRegionForPlayerAsync":
        return nativeFn((a) => [locCore.regionForLocale(locPlayerLocale(a[1]))], "GetCountryRegionForPlayerAsync");
      case "PromptGamePassPurchase":
        return nativeFn(() => {
          svcLog("warn", "LocalizationService:PromptGamePassPurchase() \u00e9 um placeholder sem efeito.", "LocalizationService");
          return [];
        }, "PromptGamePassPurchase");
      case "AutoTranslateWillRun":
        return signalFor(inst, "AutoTranslateWillRun");
      default:
        return undefined;
    }
  }

  function localizationTableIndex(inst, key) {
    switch (key) {
      case "GetEntries":
        return nativeFn((a) => [locEntriesToLua(locTableData(a[0]).entries)], "GetEntries");
      case "SetEntries":
        return nativeFn((a) => {
          if (!(a[1] instanceof LuaTable)) throw new LuaError("SetEntries: esperado uma table de entries");
          const entries = [];
          const seen = new Set();
          for (const item of luaTableToArray(a[1])) {
            const entry = locLuaToEntry(item);
            if (!entry) continue;
            const id = locCore.entryId(entry);
            if (seen.has(id)) continue;
            seen.add(id);
            entries.push(entry);
          }
          locApplyContents(a[0], locTableData(a[0]), entries);
          return [];
        }, "SetEntries");
      case "GetTranslator":
        return nativeFn((a) => {
          const id = locCore.sanitizeLocaleId(a[1]);
          if (!id) throw new LuaError(`GetTranslator: locale inv\u00e1lido "${String(a[1])}"`);
          return [locMakeTranslator(id, a[0])];
        }, "GetTranslator");
      case "SetEntry":
        return nativeFn((a) => {
          const base = locCore.normalizeEntry({ Key: a[1], Source: a[2], Context: a[3], Values: {} });
          if (!base) throw new LuaError("SetEntry: Source \u00e9 obrigat\u00f3rio");
          const localeId = locCore.sanitizeLocaleId(a[4]);
          if (!localeId) throw new LuaError(`SetEntry: locale inv\u00e1lido "${String(a[4])}"`);
          const text = locCore.sanitizeText(a[5]);
          const data = locTableData(a[0]);
          const id = locCore.entryId(base);
          let entry = data.entries.find((e) => locCore.entryId(e) === id);
          if (!entry) {
            entry = base;
            data.entries.push(entry);
          }
          if (text) entry.Values[localeId] = text;
          else delete entry.Values[localeId];
          locApplyContents(a[0], data, data.entries);
          return [];
        }, "SetEntry");
      case "RemoveEntry":
        return nativeFn((a) => {
          const base = locCore.normalizeEntry({ Key: a[1], Source: a[2], Context: a[3], Values: {} });
          if (!base) throw new LuaError("RemoveEntry: Source \u00e9 obrigat\u00f3rio");
          const data = locTableData(a[0]);
          const id = locCore.entryId(base);
          locApplyContents(a[0], data, data.entries.filter((e) => locCore.entryId(e) !== id));
          return [];
        }, "RemoveEntry");
      case "RemoveTargetLocale":
        return nativeFn((a) => {
          const localeId = locCore.sanitizeLocaleId(a[1]);
          if (!localeId) throw new LuaError(`RemoveTargetLocale: locale inv\u00e1lido "${String(a[1])}"`);
          const data = locTableData(a[0]);
          data.locales = data.locales.filter((l) => l.id !== localeId);
          for (const entry of data.entries) delete entry.Values[localeId];
          locApplyContents(a[0], data, data.entries);
          return [];
        }, "RemoveTargetLocale");
      default:
        return undefined;
    }
  }


  const bridge = {
    isUserdata(v) {
      return (
        v != null && typeof v === "object" && !(v instanceof LuaTable) &&
        (v.__isInstance === true || typeof v.__ud === "string")
      );
    },
    typeName(v) {
      if (!v || typeof v !== "object") return "userdata";
      if (v.__isInstance) return "Instance";
      switch (v.__ud) {
        case "Signal": return "RBXScriptSignal";
        case "Service": return "Instance";
        case "EnumItem": return "EnumItem";
        case "EnumType": return "Enum";
        case "Enums": return "Enums";
        default: return v.__ud || "userdata";
      }
    },
    getIndexRaw(obj, key, line) {
      if (obj.__isInstance) return instanceIndex(obj, key, line);
      switch (obj.__ud) {
        case "Service":
          if (obj.serviceName === "RunService") return runServiceIndex(key);
          if (obj.serviceName === "PhysicsService") return physicsServiceIndex(key);            
          if (obj.serviceName === "DataStoreService") return dataStoreServiceIndex(key);            
          if (obj.serviceName === "HttpService") return httpServiceIndex(key);            
          if (obj.serviceName === "MessagingService") return messagingServiceIndex(key);            
          if (obj.serviceName === "CloudService") return cloudServiceIndex(key);            
          if (obj.serviceName === "TeleportService") return teleportServiceIndex(key);            
          if (obj.serviceName === "MarketplaceService") return marketplaceServiceIndex(key);            
          if (obj.serviceName === "BadgeService") return badgeServiceIndex(key);            
          if (obj.serviceName === "GamePassService") return gamePassServiceIndex(key);            
          if (obj.serviceName === "MemoryStoreService") return memoryStoreServiceIndex(key);            
          if (obj.serviceName === "InsertService") return insertServiceIndex(key);            
          if (obj.serviceName === "Chat") return chatServiceIndex(key);            
          if (obj.serviceName === "PathfindingService") return pathfindingServiceIndex(key);            
          return undefined;
        case "Translator": return translatorIndex(obj, key);
        case "Path": return pathIndex(obj, key);            
        case "PathWaypoint": return pathWaypointIndex(obj, key);            
        case "GlobalDataStore":            
        case "OrderedDataStore":
          return dataStoreObjectIndex(obj, key);
        case "DataStorePages":            
        case "DataStoreKeyPages":
          return pagesIndex(obj, key);
        case "RaycastParams": {
          if (key === "FilterType") return { __ud: "EnumItem", enumType: "RaycastFilterType", name: obj.filterType };
          if (key === "FilterDescendantsInstances") {
            const t = new LuaTable();
            obj.list.forEach((it, i) => t.rawset(i + 1, it));
            return t;
          }
          if (key === "IgnoreWater") return obj.ignoreWater;
          if (key === "CollisionGroup") return obj.collisionGroup;
          if (key === "AddToFilter") {
            return nativeFn((a) => {
              const v = a[1];
              if (v && v.__isInstance) a[0].list.push(v);
              else for (const it of luaTableToArray(v)) { if (it && it.__isInstance) a[0].list.push(it); }
              return [];
            }, "AddToFilter");
          }
          if (key === "RespectCanCollide") return obj.respectCanCollide === true;
          if (key === "BruteForceAllSlow") return obj.bruteForceAllSlow === true;
          return undefined;
        }
        case "OverlapParams": {
          if (key === "FilterType") return { __ud: "EnumItem", enumType: "RaycastFilterType", name: obj.filterType };
          if (key === "FilterDescendantsInstances") {
            const t = new LuaTable();
            obj.list.forEach((it, i) => t.rawset(i + 1, it));
            return t;
          }
          if (key === "MaxParts") return obj.maxParts;
          if (key === "CollisionGroup") return obj.collisionGroup;
          if (key === "RespectCanCollide") return obj.respectCanCollide === true;
          if (key === "Tolerance") return obj.tolerance;
          if (key === "BruteForceAllSlow") return obj.bruteForceAllSlow === true;
          if (key === "IncludeInstances") {
            if (!obj.includeList) return undefined;
            const t = new LuaTable();
            obj.includeList.forEach((it, i) => t.rawset(i + 1, it));
            return t;
          }
          if (key === "ExcludeInstances") {
            const t = new LuaTable();
            (obj.excludeList || []).forEach((it, i) => t.rawset(i + 1, it));
            return t;
          }
          if (key === "AddToFilter") {
            return nativeFn((a) => {
              const v = a[1];
              if (v && v.__isInstance) a[0].list.push(v);
              else for (const it of luaTableToArray(v)) { if (it && it.__isInstance) a[0].list.push(it); }
              return [];
            }, "AddToFilter");
          }
          return undefined;
        }
        case "RaycastResult": {
          if (key === "Instance") return obj.instance || undefined;
          if (key === "Position") return V3(obj.position.x, obj.position.y, obj.position.z);
          if (key === "Normal") return V3(obj.normal.x, obj.normal.y, obj.normal.z);
          if (key === "Material") return { __ud: "EnumItem", enumType: "Material", name: obj.material };
          if (key === "Distance") return obj.distance;
          return undefined;
        }
        case "Vector3": return vector3Index(obj, key);
        case "Vector2":
          return key === "X" ? obj.x : key === "Y" ? obj.y
            : key === "Magnitude" ? Math.sqrt(obj.x * obj.x + obj.y * obj.y) : undefined;
        case "Color3": return colorIndex(obj, key);
        case "CFrame": return cframeIndex(obj, key);             

        case "BrickColor":
          if (key === "Name") return obj.name;
          if (key === "Color") return COL(0.64, 0.64, 0.64);
          return undefined;
        case "Font":
          if (key === "Family") return obj.family;
          if (key === "Weight") return obj.weight;
          if (key === "Style") return obj.style;
          return undefined;
        case "Ray":
          if (key === "Origin") return V3(obj.origin.x, obj.origin.y, obj.origin.z);
          if (key === "Direction") return V3(obj.direction.x, obj.direction.y, obj.direction.z);
          return undefined;
        case "Region3": {

          if (key === "CFrame") {
            return CF((obj.min.x + obj.max.x) / 2, (obj.min.y + obj.max.y) / 2, (obj.min.z + obj.max.z) / 2);
          }
          if (key === "Size") return V3(obj.max.x - obj.min.x, obj.max.y - obj.min.y, obj.max.z - obj.min.z);
          if (key === "ExpandToGrid") {
            return nativeFn((aa) => {
              const r = aa[0];
              const g = r && r.__ud === "Region3" ? expandRegionToGrid(r.min, r.max, num(aa[1])) : null;
              if (!g) {
                throw new LuaError("Region3:ExpandToGrid \u2014 use uma resolution num\u00e9rica > 0 (ex.: 4).");
              }
              return [REGION3(g.min, g.max)];
            }, "ExpandToGrid");
          }
          return undefined;
        }
        case "NumberSequence":
        case "ColorSequence":
          if (key === "Keypoints") return arrayToTable(obj.keypoints || []);
          return undefined;
        case "NumberSequenceKeypoint":
          if (key === "Time") return obj.time;
          if (key === "Value") return obj.value;
          if (key === "Envelope") return obj.envelope;
          return undefined;
        case "ColorSequenceKeypoint":
          if (key === "Time") return obj.time;
          if (key === "Value") return obj.value;
          return undefined;
        case "UDim":
          return key === "Scale" ? obj.scale : key === "Offset" ? obj.offset : undefined;
        case "UDim2":
          if (key === "X" || key === "Width") return UD(obj.xScale, obj.xOffset);
          if (key === "Y" || key === "Height") return UD(obj.yScale, obj.yOffset);
          return undefined;
        case "TweenInfo":            
          if (key === "Time") return obj.time;
          if (key === "EasingStyle") return easingStyleItem(obj.easingStyle);
          if (key === "EasingDirection") return easingDirectionItem(obj.easingDirection);
          if (key === "RepeatCount") return obj.repeatCount;
          if (key === "Reverses") return obj.reverses;
          if (key === "DelayTime") return obj.delayTime;
          return undefined;
        case "Tween":            
          if (key === "Instance") return obj.instance;
          if (key === "TweenInfo") return obj.tweenInfo;
          if (key === "PlaybackState") return playbackStateItem(obj.state);
          if (key === "Completed") return obj._completed || undefined;
          if (key === "Play") return nativeFn((a) => { a[0].play(); return []; }, "Play");
          if (key === "Pause") return nativeFn((a) => { a[0].pause(); return []; }, "Pause");
          if (key === "Cancel") return nativeFn((a) => { a[0].cancel(); return []; }, "Cancel");
          return undefined;
        case "NumberRange":            
          return key === "Min" ? obj.min : key === "Max" ? obj.max : undefined;
        case "Rect":            
          if (key === "Min") return V2(obj.minX, obj.minY);
          if (key === "Max") return V2(obj.maxX, obj.maxY);
          if (key === "Width") return obj.maxX - obj.minX;
          if (key === "Height") return obj.maxY - obj.minY;
          return undefined;
        case "InputObject": {            
          if (key === "UserInputType") return enumItemFor("UserInputType", obj.userInputType);
          if (key === "KeyCode") return enumItemFor("KeyCode", obj.keyCode || "Unknown");
          if (key === "UserInputState") return enumItemFor("UserInputState", obj.userInputState);
          if (key === "Position") return V3(obj.position.x, obj.position.y, obj.position.z);
          if (key === "Delta") return V3(obj.delta.x, obj.delta.y, obj.delta.z);
          return undefined;
        }
        case "EnumItem":
          if (key === "Name") return obj.name;
          if (key === "Value") return obj.value;
          if (key === "EnumType") return { __ud: "EnumType", enumName: obj.enumType };
          return undefined;
        case "MemoryStoreHashMap":
          return memoryHashIndex(key);            
        case "MemoryStoreSortedMap":
          return memorySortedIndex(key);            
        case "MemoryStoreQueue":
          return memoryQueueIndex(key);            
        case "EnumType": {
          if (key === "GetEnumItems") {
            return nativeFn(() => {
              const items = enumTypeItems(obj.enumName) || [];
              return [arrayToTable(items.map((nm, i) => makeEnumItem(obj.enumName, nm, i)))];                           
            }, "GetEnumItems");
          }
          const items = enumTypeItems(obj.enumName);
          if (items && items.includes(key)) {
            return makeEnumItem(obj.enumName, key, items.indexOf(key));                           
          }


          throw new LuaError(
            String(key) + ' is not a valid member of "Enum.' + String(obj.enumName) + '"',
          );
        }
        case "Enums": {
          if (enumTypeItems(key)) return { __ud: "EnumType", enumName: key };
          if (key === "GetEnums") {
            return nativeFn(() => [arrayToTable(Object.keys(Enums).map((nm) => ({ __ud: "EnumType", enumName: nm })))], "GetEnums");
          }


          throw new LuaError(String(key) + ' is not a valid member of "Enums"');
        }
        case "Signal": {
          if (key === "Connect" || key === "connect" || key === "ConnectParallel") {
            return nativeFn((a) => [a[0].connect(a[1])], "Connect");
          }
          if (key === "Once") {
            return nativeFn((a) => {
              const sig = a[0]; const fn = a[1];
              const conn = sig.connect(nativeFn((b) => {
                const d = conn.rawget("Disconnect"); if (d) d.fn([]);
                return interp.call ? undefined : undefined;
              }, "once_wrap"));

              const realConn = sig.connect(fn);
              return [realConn];
            }, "Once");
          }
          if (key === "Wait") {
            return nativeFn(function* (a) {
              const sig = a[0];
              const seq = sig._fireSeq;


              const g0 = typeof sig.connGen === "function" ? sig.connGen() : 0;
              while (sig._fireSeq === seq || (typeof sig.connGen === "function" && sig.connGen() !== g0)) {
                yield { kind: "wait", seconds: 0 };
              }
              return sig._lastArgs.slice();
            }, "Wait", true);
          }
          return undefined;
        }
        default:
          return undefined;
      }
    },
    getIndex(obj, key, line) {

      return bridge.getIndexRaw(obj, key, line);
    },
    setIndex(obj, key, value, line) {
      if (obj.__isInstance) { instanceSetIndex(obj, key, value, line); return; }

      if (obj.__ud === "Service" && obj.serviceName === "HttpService" && key === "HttpEnabled") {
        httpEnabledOverride = value === true; return;
      }

      if (obj.__ud === "Service" && obj.serviceName === "MarketplaceService") {
        if (key === "ProcessReceipt") {
          if (context !== "server") {
            throw new LuaError("ProcessReceipt s\u00f3 pode ser definido a partir do Server");
          }
          if (value != null && typeof value !== "function" && !(value instanceof LuaFunction)) {
            throw new LuaError("ProcessReceipt deve ser uma fun\u00e7\u00e3o");
          }
          registerProcessReceipt(value == null ? null : value);
          return;
        }
        throw new LuaError(`${key} n\u00e3o \u00e9 um membro atribu\u00edvel de MarketplaceService`);
      }

      if (obj.__ud === "RaycastParams") {
        if (key === "FilterType") {
          obj.filterType = value && value.__ud === "EnumItem" ? value.name : String(value);
          return;
        }
        if (key === "FilterDescendantsInstances") {
          obj.list = luaTableToArray(value).filter((it) => it && it.__isInstance);
          return;
        }
        if (key === "IgnoreWater") { obj.ignoreWater = value === true; return; }
        if (key === "CollisionGroup") { obj.collisionGroup = String(value); return; }
        if (key === "RespectCanCollide") { obj.respectCanCollide = value === true; return; }
        if (key === "BruteForceAllSlow") { obj.bruteForceAllSlow = value === true; return; }
        throw new LuaError(`${key} n\u00e3o \u00e9 um membro v\u00e1lido de RaycastParams`);
      }
      if (obj.__ud === "OverlapParams") {
        if (key === "FilterType") { obj.filterType = value && value.__ud === "EnumItem" ? value.name : String(value); return; }
        if (key === "FilterDescendantsInstances") { obj.list = luaTableToArray(value).filter((it) => it && it.__isInstance); return; }
        if (key === "MaxParts") { obj.maxParts = Math.max(0, Math.floor(Number(value) || 0)); return; }
        if (key === "CollisionGroup") { obj.collisionGroup = String(value); return; }
        if (key === "RespectCanCollide") { obj.respectCanCollide = value === true; return; }
        if (key === "Tolerance") { obj.tolerance = Number(value) || 0; return; }
        if (key === "BruteForceAllSlow") { obj.bruteForceAllSlow = value === true; return; }
        if (key === "IncludeInstances") { obj.includeList = value == null ? null : luaTableToArray(value).filter((it) => it && it.__isInstance); return; }
        if (key === "ExcludeInstances") { obj.excludeList = luaTableToArray(value).filter((it) => it && it.__isInstance); return; }
        throw new LuaError(`${key} n\u00e3o \u00e9 um membro v\u00e1lido de OverlapParams`);
      }
      throw new LuaError(`N\u00e3o \u00e9 poss\u00edvel atribuir a ${bridge.typeName(obj)}`);
    },
    arith(op, a, b) {
      const av = a && a.__ud, bv = b && b.__ud;
      if (av === "Vector3" || bv === "Vector3") {
        if (op === "unm" && av === "Vector3") return V3(-a.x, -a.y, -a.z);
        if (av === "Vector3" && bv === "Vector3") {
          if (op === "+") return V3(a.x + b.x, a.y + b.y, a.z + b.z);
          if (op === "-") return V3(a.x - b.x, a.y - b.y, a.z - b.z);
          if (op === "*") return V3(a.x * b.x, a.y * b.y, a.z * b.z);
          if (op === "/") return V3(a.x / b.x, a.y / b.y, a.z / b.z);
          return undefined;
        }
        const vec = av === "Vector3" ? a : b;
        const sc = av === "Vector3" ? Number(b) : Number(a);
        if (op === "*") return V3(vec.x * sc, vec.y * sc, vec.z * sc);
        if (op === "/" && av === "Vector3") return V3(a.x / sc, a.y / sc, a.z / sc);
        return undefined;
      }
      if (av === "Vector2" || bv === "Vector2") {
        if (op === "unm" && av === "Vector2") return V2(-a.x, -a.y);
        if (av === "Vector2" && bv === "Vector2") {
          if (op === "+") return V2(a.x + b.x, a.y + b.y);
          if (op === "-") return V2(a.x - b.x, a.y - b.y);
        }
        const vec = av === "Vector2" ? a : b;
        const sc = av === "Vector2" ? Number(b) : Number(a);
        if (op === "*") return V2(vec.x * sc, vec.y * sc);
        if (op === "/" && av === "Vector2") return V2(a.x / sc, a.y / sc);
        return undefined;
      }

      if (av === "CFrame" && bv === "CFrame") {
        if (op === "*") return cfCompose(a, b);
        return undefined;
      }
      if (av === "CFrame" && bv === "Vector3") {
        if (op === "*") {
          const r = rotateVecByQuat(b, cfQuat(a));
          return V3(a.x + r.x, a.y + r.y, a.z + r.z);
        }
        if (op === "+") return CF(a.x + b.x, a.y + b.y, a.z + b.z, cfQuat(a));
        if (op === "-") return CF(a.x - b.x, a.y - b.y, a.z - b.z, cfQuat(a));
      }
      return undefined;
    },
    eq(a, b) {
      const ao = a && typeof a === "object", bo = b && typeof b === "object";
      if (ao && a.__ud === "EnumItem") {
        if (bo && b.__ud === "EnumItem") return a.enumType === b.enumType && a.name === b.name;
        if (typeof b === "string") return a.name === b;
      }
      if (bo && b.__ud === "EnumItem" && typeof a === "string") return b.name === a;
      if (!ao || !bo || a.__ud !== b.__ud) return undefined;
      switch (a.__ud) {
        case "Vector3": return a.x === b.x && a.y === b.y && a.z === b.z;
        case "CFrame": {                                                
          if (a.x !== b.x || a.y !== b.y || a.z !== b.z) return false;
          const qa = cfQuat(a), qb = cfQuat(b);
          const dot = qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w;
          return Math.abs(dot) > 1 - 1e-9;
        }
        case "Vector2": return a.x === b.x && a.y === b.y;
        case "Color3": return a.r === b.r && a.g === b.g && a.b === b.b;
        case "UDim": return a.scale === b.scale && a.offset === b.offset;
        case "UDim2": return a.xScale === b.xScale && a.xOffset === b.xOffset && a.yScale === b.yScale && a.yOffset === b.yOffset;
        case "TweenInfo": return tweenInfoEquals(a, b);            
        case "NumberRange": return a.min === b.min && a.max === b.max;            
        case "Rect": return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;            
        default: return undefined;
      }
    },
    tostring(v) {
      if (v == null || typeof v !== "object") return undefined;
      if (v instanceof LuaTable) return undefined;
      if (v.__isInstance) return v.name;
      switch (v.__ud) {
        case "Vector3": return `${fmtNum(v.x)}, ${fmtNum(v.y)}, ${fmtNum(v.z)}`;
        case "Vector2": return `${fmtNum(v.x)}, ${fmtNum(v.y)}`;
        case "Color3": return `${fmtNum(v.r)}, ${fmtNum(v.g)}, ${fmtNum(v.b)}`;
        case "CFrame": {                                                   
          const m = quatToMatrix(cfQuat(v));
          return [v.x, v.y, v.z, ...m].map(fmtNum).join(", ");
        }
        case "UDim": return `${fmtNum(v.scale)}, ${fmtNum(v.offset)}`;
        case "UDim2": return `{${fmtNum(v.xScale)}, ${fmtNum(v.xOffset)}}, {${fmtNum(v.yScale)}, ${fmtNum(v.yOffset)}}`;
        case "EnumItem": return `Enum.${v.enumType}.${v.name}`;
        case "EnumType": return `Enum.${v.enumName}`;
        case "Enums": return "Enum";
        case "Service": return v.serviceName;
        case "Signal": return "Signal " + v.name;
        case "RaycastParams": return "RaycastParams";
        case "OverlapParams": return "OverlapParams";
        case "RaycastResult": return `RaycastResult{${v.instance ? v.instance.name : "nil"} @ ${fmtNum(v.distance)}}`;
        case "TweenInfo": return tweenInfoToString(v);            
        case "Tween": return "Tween";            
        case "NumberRange": return `${fmtNum(v.min)} ${fmtNum(v.max)}`;            
        case "Rect": return `${fmtNum(v.minX)}, ${fmtNum(v.minY)}, ${fmtNum(v.maxX)}, ${fmtNum(v.maxY)}`;            
        case "BrickColor": return v.name;            
        case "Font": return v.family;            
        case "Ray": return `Origin: {${fmtNum(v.origin.x)}, ${fmtNum(v.origin.y)}, ${fmtNum(v.origin.z)}}, Direction: {${fmtNum(v.direction.x)}, ${fmtNum(v.direction.y)}, ${fmtNum(v.direction.z)}}`;            
        default: return undefined;
      }
    },


    install(interpreter) {
      interp = interpreter;
      interp.bridge = bridge;


      if (streamGate.isClient && typeof interpreter.setIdentityHook === "function") {
        interpreter.setIdentityHook(streamGate.identityHook);
      }


      inputManager.setLuaCall((fn, fnArgs) => interp.call(fn, fnArgs, 0));

      interp.setGlobal("game", dataModel);
      interp.setGlobal("Game", dataModel);


      if (context === "server" && dataModel && typeof dataModel._setInternal === "function") {
        dataModel._setInternal("JobId", generateGuidV4());
        dataModel._setInternal("PlaceId", Number(getActivePlaceId() || 0) || 0);
        try {
          findLink().then((link) => {
            if (link && typeof dataModel._setInternal === "function") {
              if (link.universe) dataModel._setInternal("GameId", Number(link.universe.id) || 0);
              if (link.place) dataModel._setInternal("PlaceId", Number(link.place.id) || 0);
            }
          }).catch(() => {                                          });
        } catch (_) {                                             }
      }
      const ws = getService(dataModel, "Workspace");
      if (ws) {
        interp.setGlobal("workspace", ws);
        interp.setGlobal("Workspace", ws);
      }
      interp.setGlobal("Enum", { __ud: "Enums" });


      const v3lib = new LuaTable();
      v3lib.rawset("new", nativeFn((a) => [V3(a[0], a[1], a[2])], "Vector3.new"));
      v3lib.rawset("zero", V3(0, 0, 0));
      v3lib.rawset("one", V3(1, 1, 1));
      v3lib.rawset("xAxis", V3(1, 0, 0));
      v3lib.rawset("yAxis", V3(0, 1, 0));
      v3lib.rawset("zAxis", V3(0, 0, 1));
      interp.setGlobal("Vector3", v3lib);


      const v2lib = new LuaTable();
      v2lib.rawset("new", nativeFn((a) => [V2(a[0], a[1])], "Vector2.new"));
      interp.setGlobal("Vector2", v2lib);


      const collib = new LuaTable();
      collib.rawset("new", nativeFn((a) => [COL(a[0] || 0, a[1] || 0, a[2] || 0)], "Color3.new"));
      collib.rawset("fromRGB", nativeFn((a) => [COL(num(a[0]) / 255, num(a[1]) / 255, num(a[2]) / 255)], "Color3.fromRGB"));
      collib.rawset("fromHSV", nativeFn((a) => {
        const h = num(a[0]), s = num(a[1]), v = num(a[2]);
        const i = Math.floor(h * 6); const f = h * 6 - i;
        const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
        const r = [v, q, p, p, t, v][i % 6], g = [t, v, v, q, p, p][i % 6], b = [p, p, t, v, v, q][i % 6];
        return [COL(r, g, b)];
      }, "Color3.fromHSV"));
      interp.setGlobal("Color3", collib);


      const bclib = new LuaTable();
      bclib.rawset("new", nativeFn((a) => {
        const v = a[0];
        const name = typeof v === "string" && Enums.BrickColorName.includes(v) ? v : "Medium stone grey";
        return [BC(name)];
      }, "BrickColor.new"));
      interp.setGlobal("BrickColor", bclib);


      const fontlib = new LuaTable();
      fontlib.rawset("new", nativeFn((a) => [FONT(a[0], a[1] && a[1].name, a[2] && a[2].name)], "Font.new"));
      interp.setGlobal("Font", fontlib);


      const raylib = new LuaTable();
      raylib.rawset("new", nativeFn((a) => [RAY(a[0] || { x: 0, y: 0, z: 0 }, a[1] || { x: 0, y: 0, z: 0 })], "Ray.new"));
      interp.setGlobal("Ray", raylib);


      const r3lib = new LuaTable();
      r3lib.rawset("new", nativeFn((a) => [REGION3(a[0], a[1])], "Region3.new"));
      interp.setGlobal("Region3", r3lib);


      const nslib = new LuaTable();
      nslib.rawset("new", nativeFn((a) => {
        if (typeof a[0] === "number" && a[1] === undefined) return [NSEQ([NSKP(0, a[0], 0), NSKP(1, a[0], 0)])];
        if (typeof a[0] === "number") return [NSEQ([NSKP(0, a[0], 0), NSKP(1, num(a[1]), 0)])];
        const kps = luaTableToArray(a[0]).map((k) => NSKP(num(k.time), num(k.value), num(k.envelope)));
        return [NSEQ(kps)];
      }, "NumberSequence.new"));
      interp.setGlobal("NumberSequence", nslib);
      const nskplib = new LuaTable();
      nskplib.rawset("new", nativeFn((a) => [NSKP(num(a[0]), num(a[1]), a[2] != null ? num(a[2]) : 0)], "NumberSequenceKeypoint.new"));
      interp.setGlobal("NumberSequenceKeypoint", nskplib);


      const cslib = new LuaTable();
      cslib.rawset("new", nativeFn((a) => {
        if (a[0] && a[0].__ud === "Color3" && a[1] === undefined) return [CSEQ([CSKP(0, a[0]), CSKP(1, a[0])])];
        if (a[0] && a[0].__ud === "Color3") return [CSEQ([CSKP(0, a[0]), CSKP(1, a[1])])];
        const kps = luaTableToArray(a[0]).map((k) => CSKP(num(k.time), k.value));
        return [CSEQ(kps)];
      }, "ColorSequence.new"));
      interp.setGlobal("ColorSequence", cslib);
      const cskplib = new LuaTable();
      cskplib.rawset("new", nativeFn((a) => [CSKP(num(a[0]), a[1])], "ColorSequenceKeypoint.new"));
      interp.setGlobal("ColorSequenceKeypoint", cskplib);


      const cflib = new LuaTable();
      cflib.rawset("new", nativeFn((a) => {

        if (a[0] && a[0].__ud === "Vector3" && a[1] && a[1].__ud === "Vector3") {
          const eye = a[0], tgt = a[1];
          return [CF(eye.x, eye.y, eye.z, quatLookRotation(
            { x: tgt.x - eye.x, y: tgt.y - eye.y, z: tgt.z - eye.z }, null,
          ))];
        }

        if (a[0] && a[0].__ud === "Vector3") return [CF(a[0].x, a[0].y, a[0].z)];


        if (typeof a[11] === "number") {
          return [CF(a[0] || 0, a[1] || 0, a[2] || 0, quatFromMatrixRows([
            num(a[3]), num(a[4]), num(a[5]),
            num(a[6]), num(a[7]), num(a[8]),
            num(a[9]), num(a[10]), num(a[11]),
          ]))];
        }

        if (typeof a[3] === "number") {
          return [CF(a[0] || 0, a[1] || 0, a[2] || 0,
            { x: num(a[3]), y: num(a[4]), z: num(a[5]), w: num(a[6]) })];
        }

        return [CF(a[0] || 0, a[1] || 0, a[2] || 0)];
      }, "CFrame.new"));
      cflib.rawset("Angles", nativeFn((a) =>
        [CF(0, 0, 0, quatFromEulerXYZ(num(a[0]), num(a[1]), num(a[2])))], "CFrame.Angles"));
      cflib.rawset("fromEulerAnglesXYZ", nativeFn((a) =>
        [CF(0, 0, 0, quatFromEulerXYZ(num(a[0]), num(a[1]), num(a[2])))], "CFrame.fromEulerAnglesXYZ"));
      cflib.rawset("fromOrientation", nativeFn((a) =>
        [CF(0, 0, 0, quatFromEulerYXZ(num(a[0]), num(a[1]), num(a[2])))], "CFrame.fromOrientation"));
      cflib.rawset("fromEulerAnglesYXZ", nativeFn((a) =>
        [CF(0, 0, 0, quatFromEulerYXZ(num(a[0]), num(a[1]), num(a[2])))], "CFrame.fromEulerAnglesYXZ"));
      cflib.rawset("fromAxisAngle", nativeFn((a) =>
        [CF(0, 0, 0, quatFromAxisAngle(a[0] || { x: 0, y: 1, z: 0 }, num(a[1])))], "CFrame.fromAxisAngle"));
      cflib.rawset("lookAt", nativeFn((a) => {
        const eye = a[0] || { x: 0, y: 0, z: 0 };
        const tgt = a[1] || { x: 0, y: 0, z: 0 };
        return [CF(num(eye.x), num(eye.y), num(eye.z), quatLookRotation({
          x: num(tgt.x) - num(eye.x),
          y: num(tgt.y) - num(eye.y),
          z: num(tgt.z) - num(eye.z),
        }, a[2] || null))];
      }, "CFrame.lookAt"));
      cflib.rawset("fromMatrix", nativeFn((a) => {
        const p = a[0] || { x: 0, y: 0, z: 0 };
        return [CF(num(p.x), num(p.y), num(p.z), quatFromBasis(a[1], a[2], a[3] || null))];
      }, "CFrame.fromMatrix"));
      cflib.rawset("identity", Object.freeze(CF(0, 0, 0)));                       
      interp.setGlobal("CFrame", cflib);


      const udlib = new LuaTable();
      udlib.rawset("new", nativeFn((a) => [UD(a[0] || 0, a[1] || 0)], "UDim.new"));
      interp.setGlobal("UDim", udlib);
      const ud2lib = new LuaTable();
      ud2lib.rawset("new", nativeFn((a) => [UD2(a[0] || 0, a[1] || 0, a[2] || 0, a[3] || 0)], "UDim2.new"));
      ud2lib.rawset("fromScale", nativeFn((a) => [UD2(a[0] || 0, 0, a[1] || 0, 0)], "UDim2.fromScale"));
      ud2lib.rawset("fromOffset", nativeFn((a) => [UD2(0, a[0] || 0, 0, a[1] || 0)], "UDim2.fromOffset"));
      interp.setGlobal("UDim2", ud2lib);


      const instlib = new LuaTable();
      instlib.rawset("new", nativeFn((a) => {
        const cls = String(a[0]);
        const inst = createInstance(cls);
        if (!inst) throw new LuaError(`N\u00e3o \u00e9 poss\u00edvel criar uma Instance do tipo "${cls}"`);

        if (context === "client") inst.__netContext = "client";
        if (a[1] && a[1].__isInstance) inst.setParent(inInst(a[1]));
        return [inst];
      }, "Instance.new"));
      interp.setGlobal("Instance", instlib);


      const rplib = new LuaTable();
      rplib.rawset("new", nativeFn(() => [{
        __ud: "RaycastParams",
        filterType: "Exclude",
        list: [],
        ignoreWater: false,
        collisionGroup: "Default",
        respectCanCollide: false,
        bruteForceAllSlow: false,
      }], "RaycastParams.new"));
      interp.setGlobal("RaycastParams", rplib);
      const oplib = new LuaTable();
      oplib.rawset("new", nativeFn(() => [{
        __ud: "OverlapParams",
        filterType: "Exclude",
        list: [],
        includeList: null,
        excludeList: [],
        maxParts: 0,
        collisionGroup: "Default",
        respectCanCollide: false,
        tolerance: 0,
        bruteForceAllSlow: false,
      }], "OverlapParams.new"));
      interp.setGlobal("OverlapParams", oplib);


      const tilib = new LuaTable();
      tilib.rawset("new", nativeFn((a) => [makeTweenInfo(a[0], a[1], a[2], a[3], a[4], a[5])], "TweenInfo.new"));
      interp.setGlobal("TweenInfo", tilib);
      const nrlib = new LuaTable();
      nrlib.rawset("new", nativeFn((a) => {
        const mn = num(a[0]);
        const mx = a[1] === undefined || a[1] === null ? mn : num(a[1]);
        return [{ __ud: "NumberRange", min: mn, max: mx }];
      }, "NumberRange.new"));
      interp.setGlobal("NumberRange", nrlib);
      const rectlib = new LuaTable();
      rectlib.rawset("new", nativeFn((a) => {
        if (a[0] && a[0].__ud === "Vector2") {
          const mn = a[0]; const mx = a[1] && a[1].__ud === "Vector2" ? a[1] : { x: 0, y: 0 };
          return [{ __ud: "Rect", minX: mn.x, minY: mn.y, maxX: mx.x, maxY: mx.y }];
        }
        return [{ __ud: "Rect", minX: num(a[0]), minY: num(a[1]), maxX: num(a[2]), maxY: num(a[3]) }];
      }, "Rect.new"));
      interp.setGlobal("Rect", rectlib);


      interp.setGlobal("require", nativeFn(function* (a) {
        const target = a[0];
        if (!target || target.__isInstance !== true) {
          throw new LuaError("require espera uma inst\u00e2ncia de ModuleScript");
        }
        if (target.className !== "ModuleScript") {
          throw new LuaError(
            `N\u00e3o \u00e9 poss\u00edvel dar require em um ${target.className}; apenas ModuleScript`,
          );
        }


        if (context === "client" && isUnderServerOnly(target)) {
          throw new LuaError(
            `O ModuleScript '${target.name}' est\u00e1 em um container s\u00f3 do Server (ServerScriptService/ServerStorage) e n\u00e3o pode ser requerido pelo Client`,
          );
        }
        if (moduleCache.has(target)) return [moduleCache.get(target)];
        if (moduleLoading.has(target)) {
          throw new LuaError(`Requested module '${target.name}' was required recursively`);
        }
        moduleLoading.add(target);
        const src = target.hasProperty("Source") ? target.getProperty("Source") : "";
        let ast;
        try {
          ast = interp.compile(String(src || ""));
        } catch (e) {
          moduleLoading.delete(target);
          throw new LuaError(`${target.name}: ${e.message}`);
        }
        let vals;
        try {
          vals = yield* interp.run(ast, { script: target });
        } catch (e) {
          moduleLoading.delete(target);
          throw e;
        }
        moduleLoading.delete(target);
        if (!vals || vals.length === 0 || vals[0] === undefined) {
          throw new LuaError(`Module '${target.name}' did not return a value`);
        }
        moduleCache.set(target, vals[0]);
        return [vals[0]];
      }, "require", true));
    },


    scriptValue(inst) {
      return inst;
    },


    getInputManager() {
      return inputManager;
    },


    runCloseCallbacks() {
      if (!closeCallbacks.length || !interp) return;
      const cbs = closeCallbacks.splice(0);
      for (const cb of cbs) {
        try {
          const gen = interp.call(cb, [], 0);
          let steps = 0;
          let it = gen && typeof gen.next === "function" ? gen.next() : { done: true };
          while (!it.done && ++steps < 10000) it = gen.next();
          if (!it.done && logger) {
            logger.warn("game:BindToClose — callback n\u00e3o terminou dentro do or\u00e7amento do Stop (task.wait longos n\u00e3o s\u00e3o aguardados).", { source: "Studio" });
          }
        } catch (e) {
          if (logger) logger.error("game:BindToClose — " + ((e && e.message) || e), { source: "Studio" });
        }
      }
    },

    dispose() {
      closeCallbacks.length = 0;                                                
      for (const off of subs) {
        try { off(); } catch (e) {              }
      }
      subs.length = 0;
      moduleCache.clear();
      moduleLoading.clear();
      bindableOnInvoke.clear();            
      bindableDepth.clear();
      tweenManager.dispose();            
      if (scheduler) scheduler.onTweens = null;
      inputManager.dispose();            
      if (scheduler) scheduler.onInput = null;
      authorityWarned.clear();
    },
  };

  return bridge;
}

import { bus } from "../core/eventBus.js";

import { registerFrameCallback } from "../core/frameDriver.js";
import { logger as baseLogger } from "../core/logger.js";
import {
  Events,
  createInstance,
  getService,
  makeVector3,
  makeColor,
} from "../datamodel/index.js";
import { getRigTemplate } from "../avatar/rigs.js";
import { project } from "../core/project.js";
import { nativeFn } from "./lua/interpreter.js";
import {
  autoTranslateGuiRoots,
  getTestLocale,
  reapplyTranslations,
  resetPlaytestState,
  syncServiceLocales,
} from "./localization.js";
import { createPlayerCamera } from "./characterCamera.js";
import { createLeaderstatsHud } from "./leaderstats.js";            
import { createLocomotion } from "./locomotion.js";
import { terrainStore } from "../terrain/terrainStore.js";                               
import { VOXEL_SIZE } from "../terrain/materials.js";            
import { createTerrainSampler, syncTerrainSampler, groundAt as terrainGroundAt, ceilingAt as terrainCeilingAt, wallPushAt as terrainWallPushAt } from "../terrain/terrainCollision.js";            
import { animationTracks, animClipPoseFor } from "./animationTracks.js";             

import {
  createWaterSensor,
  syncWaterSensor,
  characterSubmersion,
  shouldEnterSwim,
  swimExitState,
  swimVerticalTarget,
  swimHorizontalScale,
  canJumpOutOfWater,
  stepSwimVy,
  SWIM_SPLASH_DAMP,
  SWIM_EXIT_OUT,
} from "./swimming.js";                                                       
import {
  waveStateFromTerrain,             

  waterFlowSpeed,
  WATER_FLOW_DIR_X,
  WATER_FLOW_DIR_Z,
} from "../terrain/waterWaves.js";
import { waveClock } from "../terrain/waveClock.js";             
import { unionSurfaceTopAt, unionHasCollisionMesh } from "../physics/raycast.js";
import { createCharacterIK } from "./characterIK.js";                              
import { colliderEligible, partAabb } from "./characterColliders.js";             
import {
  humanoids,
  humAutoState,
  humRunningSpeed,
  humSwimmingSpeed,             
  humTouched,
  humSetVelocity,
  moveToTargetOf,
  clampNum,
  LIMITS,
} from "./humanoid.js";
import { gameplay } from "./gameplayObjects.js";                                                 
import { dragDetectors } from "./dragDetectors.js";                          
import { touchBehaviors } from "./touchBehaviors.js";                                              
import * as social from "./social.js";                                     
import { coreGui } from "./coregui/coreGui.js";                             
import { screenGuiDom } from "./screenGuiDom.js";                                    
import { cameraSys } from "./cameraSystem.js";                                         

const MIN_RESPAWN_MS = 1000;                                            


const charIK = createCharacterIK();
let ikFeetCache = null;
function ikRigInfo() {
  const parts = characterParts;
  if (!Array.isArray(parts) || !parts.length) {
    return { parts, count: 0, feet: { L: null, R: null }, head: null };
  }
  if (ikFeetCache && ikFeetCache.parts === parts && ikFeetCache.count === parts.length) {
    return ikFeetCache;
  }
  let L = null;
  let R = null;
  let head = null;
  for (const cp of parts) {
    if (cp.limb && cp.limb.kind === "leg") {
      const bottom = cp.off.y - cp.size.y / 2;
      if (cp.limb.side === 1) {
        if (!L || bottom < L.off.y - L.size.y / 2) L = cp;
      } else if (!R || bottom < R.off.y - R.size.y / 2) R = cp;
    } else if (!cp.limb && !head) {
      try {
        if (String(cp.inst.getProperty("Name")) === "Head") head = cp;
      } catch (_) {            }
    }
  }
  ikFeetCache = { parts, count: parts.length, feet: { L, R }, head };
  return ikFeetCache;
}

const CHAR_TURN_SPEED = 12;                                              
const MOVE_ACCEL = 12;                                                       
const COLLIDER_CACHE_MS = 500;                                           
const COLLIDER_RANGE = 250;                                            
const CHAR_RADIUS = 1.0;                                      
const STEP_HEIGHT = 1.1;                                                 
const VOID_Y = -500;
const TOUCH_END_MS = 150;                                          
const LANDED_TIME = 0.06;                                                      
const CLIMB_MARGIN = 0.6;                                                 
const DEATH_TIP_TIME = 0.45;                                          
const SWIM_TILT_MOVING = 1.15;                                         
const SWIM_TILT_IDLE = 0.3;                                             
const SWIM_TILT_RATE = 5;                                              


function isNoControlState(s) {
  return s === "Dead" || s === "Seated" || s === "PlatformStanding" ||
    s === "Physics" || s === "None" || s === "FallingDown" ||
    s === "Ragdoll" || s === "GettingUp";
}


let active = false;
let mode = "edit";
let dataModel = null;
let opts = {};
let stopping = false;
let log = baseLogger;

let localPlayer = null;
let character = null;
let characterParts = [];                                                 


const waterSensor = createWaterSensor();
let waterSub = 0;
let swimDryT = 0;                                                          
let swimFlowX = 0;                                                      
let swimFlowZ = 0;
let swimTilt = 0;
let rootInst = null;                                                         
let hum = null;                                         
let humRt = null;                                            
let footOffset = 3;
let rootPos = { x: 0, y: 50, z: 0 };
let yaw = 0;                    
let vy = 0;
let vel = { x: 0, z: 0 };                                               
let grounded = false;
let movingNow = false;
let trussNear = false;                                       
let groundPart = null;                                          
let stateT = 0;                                                         
let prevTickState = "Running";
let lastMoveDir = { x: 0, z: 0 };

let camera = createPlayerCamera();
let loco = null;                                            
let animateDefaultInst = null;                                                    
let cameraMode = "Classic";                                                       
let fpHidden = new Map();                                             
let lastMouseBehavior = null;

let deathStartedAt = 0;
let deathBreakJoints = true;
let voidKilled = false;
let lastSpawnAt = 0;

let heldKeys = new Set();                                                      


let seatPart = null;                                         
let seatWeld = null;                                                         
const seatCooldowns = new Map();                                            
let vehHud = null;                              
const SEAT_COOLDOWN_MS = 3000;
let inputManager = null;
let casBound = [];                                                   
let usingCas = false;

let respawnTimer = 0;
let unregisterFrameCallback = null;
let lastTs = 0;
let overlayEl = null;
let leaderHud = null;                                                 
let teamsBoard = null;                                              
let firstSpawnDone = false;                                                    
let toolPoseActive = false;                                                                      
const TOOL_HOLD_PITCH = -1.4;                                                   
let offs = [];                                               
let colliders = { list: [], ts: 0 };
const terrainSampler = createTerrainSampler();                                             
let lastApplied = null;
let frameDt = 0.016;                                                  
let frameTouches = new Set();                             
let activeTouches = new Map();                               

function isTypingTarget(t) {
  if (!t) return false;
  const tag = (t.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable === true;
}

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function getStarterPlayer() {
  return dataModel ? getService(dataModel, "StarterPlayer") : null;
}

function starterNumber(prop, fallback) {
  const sp = getStarterPlayer();
  if (sp && sp.hasProperty && sp.hasProperty(prop)) return num(sp.getProperty(prop), fallback);
  return fallback;
}


function starterBool(prop, fallback) {
  const sp = getStarterPlayer();
  if (sp && sp.hasProperty && sp.hasProperty(prop)) return sp.getProperty(prop) !== false;
  return fallback;
}

function starterString(prop, fallback) {
  const sp = getStarterPlayer();
  if (sp && sp.hasProperty && sp.hasProperty(prop)) {
    const v = sp.getProperty(prop);
    return v == null ? fallback : String(v);
  }
  return fallback;
}

function humNumber(prop, fallback) {
  if (!hum || !hum.hasProperty || !hum.hasProperty(prop)) return fallback;
  return num(hum.getProperty(prop), fallback);
}

function zoomLimits() {
  const min = Math.max(0.5, starterNumber("CameraMinZoomDistance", 0.5));
  const max = Math.max(min, starterNumber("CameraMaxZoomDistance", 128));
  return { min, max };
}


function respawnSeconds() {
  let t = 5;
  const players = dataModel ? getService(dataModel, "Players") : null;
  if (players && players.hasProperty && players.hasProperty("RespawnTime")) {
    t = num(players.getProperty("RespawnTime"), 5);
  }
  return Math.min(120, Math.max(1, t));
}

function cloneChildrenInto(container, target, out) {
  if (!container || !target) return;
  for (const ch of container.getChildren()) {
    let c = null;
    try { c = ch.clone(); } catch (_) { c = null; }
    if (!c) continue;
    c.setParent(target);
    if (out) out.push(c);
  }
}

function collectLocalScripts(roots) {
  const found = [];
  for (const root of roots || []) {
    if (!root) continue;
    const all = [root].concat(root.getDescendants ? root.getDescendants() : []);
    for (const inst of all) {
      const isLocal = inst.className === "LocalScript";

      const isClientRc = inst.className === "Script" && inst.hasProperty("RunContext")
        && inst.getProperty("RunContext") === "Client";
      if (!isLocal && !isClientRc) continue;
      if (inst.hasProperty("Disabled") && inst.getProperty("Disabled") === true) continue;
      found.push(inst);
    }
  }
  return found;
}

function runClientScripts(insts) {
  if (insts && insts.length && typeof opts.runClientScripts === "function") {
    opts.runClientScripts(insts);
  }
}

function isDescendantOf(node, ancestor) {
  let p = node;
  while (p) {
    if (p === ancestor) return true;
    p = p.getParent ? p.getParent() : null;
  }
  return false;
}


function limbFor(name) {
  const n = String(name || "");
  const side = n.indexOf("Left") !== -1 ? 1 : n.indexOf("Right") !== -1 ? -1 : 0;
  if (!side) return null;
  if (/Arm|Hand/i.test(n)) return { kind: "arm", side };
  if (/Leg|Foot/i.test(n)) return { kind: "leg", side };
  return null;
}


function createLocalPlayerInternal() {
  if (!active || !dataModel) return null;
  if (localPlayer) return localPlayer;                                      
  const players = getService(dataModel, "Players");
  if (!players) return null;
  const player = createInstance("Player", { name: "LocalPlayer", parent: players });
  if (!player) return null;
  const playerGui = createInstance("PlayerGui", { name: "PlayerGui", parent: player });
  const backpack = createInstance("Backpack", { name: "Backpack", parent: player });
  createInstance("StarterGear", { name: "StarterGear", parent: player });
  const playerScripts = createInstance("PlayerScripts", { name: "PlayerScripts", parent: player });

  const sp = getStarterPlayer();

  if (sp && sp.hasProperty && sp.hasProperty("CameraMode")) {
    const cm = sp.getProperty("CameraMode");
    cameraMode = cm === "LockFirstPerson" || cm === "FirstPerson" ? "LockFirstPerson" : "Classic";
  }
  try { player.setProperty("CameraMode", cameraMode); } catch (_) {            }
  try { player.setProperty("LocaleId", getTestLocale()); } catch (_) {            }


  const cloned = [];
  cloneChildrenInto(sp && sp.findFirstChild("StarterPlayerScripts"), playerScripts, cloned);
  cloneChildrenInto(getService(dataModel, "StarterPack"), backpack, cloned);

  localPlayer = player;


  offs.push(bus.on(Events.PropertyChanged, (p) => {
    if (p && p.instance === localPlayer && p.property === "CameraMode") {
      const v = localPlayer.getProperty("CameraMode");
      cameraMode = v === "LockFirstPerson" || v === "FirstPerson" ? "LockFirstPerson" : "Classic";
    }
  }));

  bus.emit("playtest:playerAdded", { player });
  social.autoAssignTeam(player);
  log.info("LocalPlayer criado.", { source: "Playtest" });


  runClientScripts(collectLocalScripts(cloned));
  return player;
}


const ANIMATE_SOURCE = [
  "-- Script padrao de animacao do Character (Parte 35).",
  "-- A locomocao nativa (Idle/Walk/Run/Jump/Fall/Climb) roda enquanto este",
  "-- script existir. Substitua-o por um 'Animate' proprio em",
  "-- StarterPlayer.StarterCharacterScripts para desativar a animacao padrao.",
].join("\n");
const HEALTH_SOURCE = [
  "-- Script padrao de regeneracao de vida (Parte 35).",
  "-- Regenera 1% de MaxHealth por segundo enquanto este script existir.",
  "-- Delete este script (ou nao o inclua) para desativar a regeneracao.",
].join("\n");

function addDefaultCharacterScripts(model) {
  animateDefaultInst = null;
  if (!model || !model.findFirstChild) return;
  if (!model.findFirstChild("Animate")) {
    const s = createInstance("LocalScript", { name: "Animate", parent: model });
    if (s) {
      try { s.setProperty("Source", ANIMATE_SOURCE); } catch (_) {            }
      animateDefaultInst = s;
    }
  }
  if (!model.findFirstChild("Health")) {
    const s = createInstance("Script", { name: "Health", parent: model });
    if (s) { try { s.setProperty("Source", HEALTH_SOURCE); } catch (_) {            } }
  }
}


function locomotionActive() {
  if (!loco || !animateDefaultInst || !character) return false;
  const p = animateDefaultInst.getParent ? animateDefaultInst.getParent() : null;
  return p === character;
}




function pickSpawnLocation(ws) {


  const rl = localPlayer && localPlayer.getProperty ? localPlayer.getProperty("RespawnLocation") : null;
  if (rl && rl.className === "SpawnLocation" && isDescendantOf(rl, ws)
    && rl.hasProperty && rl.hasProperty("Position") && rl.hasProperty("Size")
    && !(rl.hasProperty("Enabled") && rl.getProperty("Enabled") === false)) {
    return rl;
  }
  const teamColor = localPlayer && localPlayer.getProperty ? localPlayer.getProperty("TeamColor") : null;
  const hasTeam = !!(localPlayer && localPlayer.getProperty && localPlayer.getProperty("Team"));
  const valid = [];
  const fallback = [];
  for (const d of ws.getDescendants()) {
    if (d.className !== "SpawnLocation") continue;
    if (!d.hasProperty || !d.hasProperty("Position") || !d.hasProperty("Size")) continue;
    if (d.hasProperty("Enabled") && d.getProperty("Enabled") === false) continue;
    fallback.push(d);
    const neutral = !d.hasProperty("Neutral") || d.getProperty("Neutral") !== false;
    if (neutral) { valid.push(d); continue; }
    if (hasTeam && d.getProperty("TeamColor") === teamColor) valid.push(d);
  }
  const list = valid.length ? valid : fallback;
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}


function replicateStarterGui(firstSpawn) {
  if (!localPlayer) return [];
  const playerGui = localPlayer.findFirstChild("PlayerGui");
  const starterGui = getService(dataModel, "StarterGui");
  if (!playerGui || !starterGui) return [];
  const out = [];
  for (const src of starterGui.getChildren()) {
    const reset = !(src.hasProperty && src.hasProperty("ResetOnSpawn") && src.getProperty("ResetOnSpawn") === false);
    if (!firstSpawn && !reset) continue;
    if (!firstSpawn && reset) {
      for (const existing of playerGui.getChildren()) {
        if (existing.name === src.name) { try { existing.destroy(); } catch (_) {            } }
      }
    }
    let copy = null;
    try { copy = src.clone(); } catch (_) { copy = null; }
    if (copy) { copy.setParent(playerGui); out.push(copy); }
  }
  autoTranslateGuiRoots(dataModel, out, baseLogger);
  return out;
}


function loadCharacterInternal() {
  if (!active || mode !== "play" || !dataModel) return null;
  if (!localPlayer) createLocalPlayerInternal();
  if (!localPlayer) return null;
  const ws = getService(dataModel, "Workspace");
  if (!ws) return null;


  const sinceSpawn = nowMs() - lastSpawnAt;
  if (lastSpawnAt && sinceSpawn < MIN_RESPAWN_MS) {
    if (!respawnTimer) {
      respawnTimer = setTimeout(() => {
        respawnTimer = 0;
        if (active && !stopping && mode === "play") loadCharacterInternal();
      }, MIN_RESPAWN_MS - sinceSpawn);
    }
    return null;
  }
  lastSpawnAt = nowMs();

  if (respawnTimer) { clearTimeout(respawnTimer); respawnTimer = 0; }


  restoreFpHidden();
  if (character) {
    const old = character;
    character = null;                                   
    characterParts = [];
    rootInst = null; hum = null; humRt = null;
    try { old.destroy(); } catch (_) {            }
  }


  let rigType = "R15";
  try {
    const gs = project && typeof project.getWorkingCopy === "function" ? project.getWorkingCopy() : null;
    const t = gs && gs.avatar && gs.avatar.avatarType;
    if (t === "R6") rigType = "R6";
  } catch (_) {            }
  const tpl = getRigTemplate(rigType) || getRigTemplate("R6");
  if (!tpl) return null;

  const rootDef = tpl.parts.find((p) => p.name === tpl.rootPart) || tpl.parts[0];
  let minY = Infinity;
  for (const p of tpl.parts) minY = Math.min(minY, p.pos[1] - p.size[1] / 2);
  footOffset = rootDef.pos[1] - minY;


  const camPose = !firstSpawnDone && opts && opts.spawnPose && opts.spawnPose.position
    ? opts.spawnPose
    : null;
  const spawnLoc = camPose ? null : pickSpawnLocation(ws);
  if (spawnLoc) {
    const p = spawnLoc.getProperty("Position") || { x: 0, y: 0, z: 0 };
    const s = spawnLoc.getProperty("Size") || { x: 0, y: 0, z: 0 };
    rootPos = { x: p.x, y: p.y + s.y / 2 + footOffset + 0.5, z: p.z };
  } else if (camPose) {
    const p = camPose.position;
    rootPos = { x: num(p.x, 0), y: num(p.y, 50), z: num(p.z, 0) };
  } else {
    rootPos = { x: 0, y: 50, z: 0 };
  }
  yaw = 0; vy = 0; vel.x = 0; vel.z = 0; grounded = false; movingNow = false;
  trussNear = false; groundPart = null; stateT = 0; prevTickState = "Running";
  lastMoveDir = { x: 0, z: 0 };
  deathStartedAt = 0; deathBreakJoints = true; voidKilled = false;
  lastApplied = null;
  activeTouches.clear(); frameTouches.clear();


  if (camPose && camPose.direction) {
    const dx = num(camPose.direction.x, 0);
    const dz = num(camPose.direction.z, 0);
    if (Math.abs(dx) > 1e-6 || Math.abs(dz) > 1e-6) yaw = Math.atan2(dx, dz);
  }
  camera.reset(yaw);
  loco = createLocomotion(rigType);

  const model = createInstance("Model", { name: "Character" });
  if (!model) return null;
  characterParts = [];
  rootInst = null;
  for (const pd of tpl.parts) {
    const part = createInstance("Part", { name: pd.name });
    if (!part) continue;
    const off = {
      x: pd.pos[0] - rootDef.pos[0],
      y: pd.pos[1] - rootDef.pos[1],
      z: pd.pos[2] - rootDef.pos[2],
    };
    try {
      part.setProperty("Size", makeVector3(pd.size[0], pd.size[1], pd.size[2]));
      part.setProperty("Position", makeVector3(rootPos.x + off.x, rootPos.y + off.y, rootPos.z + off.z));
      part.setProperty("Anchored", true);                                     
      if (pd.color) part.setProperty("Color", makeColor(pd.color[0], pd.color[1], pd.color[2]));
      if (pd.transparency != null) part.setProperty("Transparency", pd.transparency);
    } catch (_) {            }
    part.setParent(model);
    if (pd.name === tpl.rootPart) rootInst = part;
    characterParts.push({
      inst: part,
      off,
      size: { x: pd.size[0], y: pd.size[1], z: pd.size[2] },
      limb: limbFor(pd.name),
      pivotY: 0,
      deathSplay: 0,
    });
  }
  if (!rootInst && characterParts.length) rootInst = characterParts[0].inst;


  const pivots = {};
  for (const cp of characterParts) {
    if (!cp.limb) continue;
    const k = cp.limb.kind + cp.limb.side;
    const top = cp.off.y + cp.size.y / 2;
    if (!(k in pivots) || top > pivots[k]) pivots[k] = top;
  }
  for (const cp of characterParts) {
    if (cp.limb) cp.pivotY = pivots[cp.limb.kind + cp.limb.side];
  }


  hum = createInstance("Humanoid", { name: "Humanoid", parent: model });
  if (hum) {
    try {
      hum.setProperty("RigType", rigType);
      hum.setProperty("HipHeight", rigType === "R15" ? 1.35 : 0);
      hum.setProperty("WalkSpeed", starterNumber("CharacterWalkSpeed", 16));
      hum.setProperty("JumpPower", starterNumber("CharacterJumpPower", 50));
      if (hum.hasProperty("JumpHeight")) hum.setProperty("JumpHeight", starterNumber("CharacterJumpHeight", 7.2));

      if (hum.hasProperty("UseJumpPower")) hum.setProperty("UseJumpPower", starterBool("CharacterUseJumpPower", true));
    } catch (_) {            }
    humRt = humanoids.registerLocal(hum);
  } else {
    humRt = null;
  }

  const sp = getStarterPlayer();

  const hd = sp && sp.getChildren().find((c) => c.className === "HumanoidDescription");
  if (hd) {
    let c = null;
    try { c = hd.clone(); } catch (_) { c = null; }
    if (c) c.setParent(model);
  }


  const cloned = [];
  cloneChildrenInto(sp && sp.findFirstChild("StarterCharacterScripts"), model, cloned);
  addDefaultCharacterScripts(model);

  model.setParent(ws);
  character = model;
  colliders.ts = 0;                                              

  try { localPlayer.setProperty("Character", model); } catch (_) {            }
  bus.emit("playtest:characterAdded", { player: localPlayer, character: model });
  log.info(`Character spawnado (${rigType}).`, { source: "Playtest" });

  if (spawnLoc && spawnLoc.hasProperty && spawnLoc.getProperty("AllowTeamChangeOnTouch") === true) {
    const neutral = !spawnLoc.hasProperty("Neutral") || spawnLoc.getProperty("Neutral") !== false;
    if (!neutral) social.assignPlayerTeamColor(localPlayer, spawnLoc.getProperty("TeamColor"));
  }
  const guiClones = replicateStarterGui(!firstSpawnDone);
  firstSpawnDone = true;
  social.applyAutoColor(localPlayer);
  let immuneDur = 10;
  if (spawnLoc && spawnLoc.hasProperty && spawnLoc.hasProperty("Duration")) immuneDur = num(spawnLoc.getProperty("Duration"), 10);
  social.spawnForceField(model, immuneDur);
  try { localPlayer._setInternal("CharacterAppearanceLoaded", true); } catch (_) {            }
  bus.emit("player:event", { instance: localPlayer, type: "CharacterAppearanceLoaded", args: [model] });

  runClientScripts(collectLocalScripts(cloned));
  runClientScripts(collectLocalScripts(guiClones));
  swimTilt = 0; waterSub = 0; swimDryT = 0;                                            
  swimFlowX = 0; swimFlowZ = 0;                                     
  applyTransforms(true);
  return model;
}


function scheduleRespawn() {
  if (respawnTimer) clearTimeout(respawnTimer);
  const ms = Math.max(MIN_RESPAWN_MS, respawnSeconds() * 1000);
  respawnTimer = setTimeout(() => {
    respawnTimer = 0;
    if (active && !stopping && mode === "play") loadCharacterInternal();
  }, ms);
}

function startDeath() {
  if (deathStartedAt || !character) return;
  deathStartedAt = nowMs();
  deathBreakJoints = !hum || hum.getProperty("BreakJointsOnDeath") !== false;

  characterParts.forEach((cp, i) => {
    cp.deathSplay = cp.limb && deathBreakJoints ? ((i % 3) - 1) * 0.55 : 0;
  });
  vel.x = 0; vel.z = 0;
  movingNow = false;
  lastApplied = null;                                 
  log.info(`Character morreu — respawn em ${respawnSeconds()}s.`, { source: "Playtest" });
  scheduleRespawn();
}


function handleCharacterRemoved(old) {
  characterParts = [];
  character = null;
  rootInst = null; hum = null; humRt = null;
  charIK.reset(); ikFeetCache = null;            
  restoreFpHidden();
  bus.emit("playtest:characterRemoving", { player: localPlayer, character: old });
  if (!active || stopping || mode !== "play") return;
  log.info(`Character removido — respawn autom��tico em ${respawnSeconds()}s.`, { source: "Playtest" });
  scheduleRespawn();
}

function installWatchers() {
  offs.push(bus.on(Events.Destroying, (p) => {
    if (active && !stopping && character && p && p.instance === character) handleCharacterRemoved(character);
  }));
  offs.push(bus.on(Events.ChildRemoved, (p) => {
    if (active && !stopping && character && p && p.child === character) handleCharacterRemoved(character);
  }));

  offs.push(bus.on("humanoid:died", (p) => {
    if (active && !stopping && mode === "play" && p && hum && p.humanoid === hum) startDeath();
  }));

  offs.push(bus.on("gameplay:event", (p) => {
    if (!p) return;
    if (p.type === "Equipped") toolPoseActive = true;
    else if (p.type === "Unequipped") toolPoseActive = false;
  }));
}


function refreshColliders() {
  colliders.list = [];
  colliders.ts = nowMs();
  const ws = dataModel ? getService(dataModel, "Workspace") : null;
  if (!ws) return;
  for (const d of ws.getDescendants()) {


    if (!colliderEligible(d)) continue;
    if (character && isDescendantOf(d, character)) continue;

    const p = d.getProperty("Position");
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z) &&
        (Math.abs(p.x - rootPos.x) > COLLIDER_RANGE || Math.abs(p.z - rootPos.z) > COLLIDER_RANGE)) continue;
    colliders.list.push(d);
  }
}

function ensureColliders() {
  if (!colliders.ts || nowMs() - colliders.ts > COLLIDER_CACHE_MS) refreshColliders();
}


const TERRAIN_STEP = 2.25;                                              
const TERRAIN_GROUND_DEPTH = VOXEL_SIZE * 12;                            
const TERRAIN_CEIL_RANGE = VOXEL_SIZE * 4;                            


const MAX_VSTEP = 60;

function activeTerrainData() {
  try {
    const td = terrainStore.getData();
    if (!td || td.isEmpty()) return null;
    return td;
  } catch (_) {
    return null;
  }
}

function terrainInstanceSafe() {
  try {
    return terrainStore.getTerrainInstance();
  } catch (_) {
    return null;
  }
}



function resolveHorizontal() {
  ensureColliders();
  trussNear = false;
  const footY = rootPos.y - footOffset;
  const headY = rootPos.y + footOffset * 0.9;
  for (const part of colliders.list) {
    const b = partAabb(part);
    if (!b) continue;

    if (part.className === "TrussPart" &&
        rootPos.x + CHAR_RADIUS + CLIMB_MARGIN > b.minX && rootPos.x - CHAR_RADIUS - CLIMB_MARGIN < b.maxX &&
        rootPos.z + CHAR_RADIUS + CLIMB_MARGIN > b.minZ && rootPos.z - CHAR_RADIUS - CLIMB_MARGIN < b.maxZ &&
        footY < b.maxY && headY > b.minY) {
      trussNear = true;
    }
    let effMaxY = b.maxY;
    if (part.className === "UnionOperation" && unionHasCollisionMesh(part)) {
      const mt = unionSurfaceTopAt(part, rootPos.x, rootPos.z);
      if (mt === null) continue;
      effMaxY = mt;
    }
    if (effMaxY <= footY + STEP_HEIGHT || b.minY >= headY) continue;
    const ox = Math.min(rootPos.x + CHAR_RADIUS - b.minX, b.maxX - (rootPos.x - CHAR_RADIUS));
    const oz = Math.min(rootPos.z + CHAR_RADIUS - b.minZ, b.maxZ - (rootPos.z - CHAR_RADIUS));
    if (ox <= 0 || oz <= 0) continue;                    
    frameTouches.add(part);
    if (ox < oz) rootPos.x += rootPos.x < (b.minX + b.maxX) / 2 ? -ox : ox;
    else rootPos.z += rootPos.z < (b.minZ + b.maxZ) / 2 ? -oz : oz;
  }


  const td = activeTerrainData();
  if (td) {
    syncTerrainSampler(terrainSampler, td);
    let touchedTerrain = false;
    const bandLo = footY + STEP_HEIGHT + 0.2;
    const heights = [bandLo, (bandLo + headY) * 0.5, headY - 0.2];
    for (let pass = 0; pass < 2; pass++) {
      let pushed = false;
      for (const hy of heights) {
        const p = terrainWallPushAt(terrainSampler, td, rootPos.x, hy, rootPos.z, CHAR_RADIUS);
        if (p) {
          rootPos.x += p.x;
          rootPos.z += p.z;
          touchedTerrain = true;
          pushed = true;
        }
      }
      if (!pushed) break;
    }
    if (touchedTerrain) {
      const ti = terrainInstanceSafe();
      if (ti) frameTouches.add(ti);
    }
  }
}


function resolveVertical(prevRootY) {
  ensureColliders();
  let ground = -Infinity;
  let ceil = Infinity;
  let gPart = null;
  let cPart = null;
  const r = CHAR_RADIUS * 0.8;
  const prevFootY = (Number.isFinite(prevRootY) ? prevRootY : rootPos.y) - footOffset;
  for (const part of colliders.list) {
    const b = partAabb(part);
    if (!b) continue;
    if (rootPos.x + r <= b.minX || rootPos.x - r >= b.maxX) continue;
    if (rootPos.z + r <= b.minZ || rootPos.z - r >= b.maxZ) continue;
    let topY = b.maxY;
    if (part.className === "UnionOperation") {
      const hasMesh = unionHasCollisionMesh(part);
      const ut = hasMesh ? unionSurfaceTopAt(part, rootPos.x, rootPos.z) : null;
      if (hasMesh) {
        if (ut === null) continue;
        topY = ut;
      }
    }
    if (topY <= prevFootY + STEP_HEIGHT) {
      if (topY > ground) { ground = topY; gPart = part; }
    } else if (b.minY >= prevFootY + STEP_HEIGHT) {
      if (b.minY < ceil) { ceil = b.minY; cPart = part; }
    }
  }


  const td = activeTerrainData();
  if (td) {
    syncTerrainSampler(terrainSampler, td);
    const ti = terrainInstanceSafe();
    const stepY = prevFootY + TERRAIN_STEP;


    const newFootY = rootPos.y - footOffset;
    const fallSweep = Math.max(0, prevFootY - newFootY);
    const riseSweep = Math.max(0, newFootY - prevFootY);
    const rc = CHAR_RADIUS * 0.6;
    const samples = [
      [rootPos.x, rootPos.z],
      [rootPos.x - rc, rootPos.z - rc],
      [rootPos.x - rc, rootPos.z + rc],
      [rootPos.x + rc, rootPos.z - rc],
      [rootPos.x + rc, rootPos.z + rc],
    ];
    for (const [sx, sz] of samples) {
      const g = terrainGroundAt(terrainSampler, td, sx, sz, stepY, TERRAIN_GROUND_DEPTH + fallSweep);
      if (g && g.y > ground) { ground = g.y; gPart = ti; }
    }
    const c = terrainCeilingAt(terrainSampler, td, rootPos.x, rootPos.z, stepY, TERRAIN_CEIL_RANGE + riseSweep);
    if (c !== null && c < ceil) { ceil = c; cPart = ti; }
  }
  groundPart = null;
  if (Number.isFinite(ground)) {
    const groundRootY = ground + footOffset;
    if (vy <= 0 && rootPos.y <= groundRootY + 0.001) {
      rootPos.y = groundRootY;
      vy = 0;
      grounded = true;
      groundPart = gPart;
      if (gPart) frameTouches.add(gPart);
    } else if (rootPos.y > groundRootY + 0.05) {
      grounded = false;
    }
  } else {
    grounded = false;
  }

  if (Number.isFinite(ceil) && vy > 0 && rootPos.y + footOffset > ceil) {
    rootPos.y = ceil - footOffset;
    vy = 0;
    if (cPart) frameTouches.add(cPart);
  }
}


function flushTouches(tms) {
  if (!character || !rootInst) { frameTouches.clear(); return; }
  for (const part of frameTouches) {
    if (part.hasProperty && part.hasProperty("CanTouch") && part.getProperty("CanTouch") === false) continue;
    if (!activeTouches.has(part)) {
      bus.emit("physics:touched", { a: rootInst, b: part });
      if (hum) humTouched(hum, part, rootInst);
    }
    activeTouches.set(part, tms);
  }
  for (const [part, last] of activeTouches) {
    const gone = part.getParent && !part.getParent();
    if (!frameTouches.has(part) && (gone || tms - last > TOUCH_END_MS)) {
      activeTouches.delete(part);
      if (!gone) bus.emit("physics:touchEnded", { a: rootInst, b: part });
    }
  }
  frameTouches.clear();
}


function jumpVelocity(gravity) {
  if (!hum) return 50;
  const useJP = hum.getProperty("UseJumpPower") !== false;
  if (useJP) return clampNum(hum.getProperty("JumpPower"), LIMITS.JumpPower);
  return Math.sqrt(2 * Math.max(0, gravity) * clampNum(hum.getProperty("JumpHeight"), LIMITS.JumpHeight));
}


function seatYaw(seat) {
  let ori = null;
  try { ori = seat.getProperty("Orientation"); } catch (_) { ori = null; }
  return ori ? (num(ori.y, 0) * Math.PI) / 180 : 0;
}

function seatOverlap(seat) {
  const a = partAabb(seat);
  if (!a) return false;
  const r = CHAR_RADIUS + 0.6;
  return rootPos.x + r > a.minX && rootPos.x - r < a.maxX &&
    rootPos.z + r > a.minZ && rootPos.z - r < a.maxZ &&
    rootPos.y + footOffset > a.minY && rootPos.y - footOffset < a.maxY + 3;
}

function sitDown(seat, t) {
  seatPart = seat;
  if (hum) {
    try { hum.setProperty("Sit", true); } catch (_) {            }
    try { hum._setInternal("SeatPart", seat); } catch (_) {            }
  }
  try { seat._setInternal("Occupant", hum || null); } catch (_) {            }

  seatWeld = createInstance("Weld", { name: "SeatWeld", parent: seat });
  try { seatWeld.setProperty("Part0", seat); seatWeld.setProperty("Part1", rootInst); } catch (_) {            }
  vy = 0; vel.x = 0; vel.z = 0;
  if (hum) humAutoState(hum, "Seated");
}

function standUp(t) {
  const seat = seatPart;
  if (seatWeld) { try { seatWeld.destroy(); } catch (_) {            } seatWeld = null; }
  if (seat) {
    try { seat._setInternal("Occupant", null); } catch (_) {            }
    if (seat.className === "VehicleSeat") {
      try {
        seat._setInternal("Throttle", 0); seat._setInternal("ThrottleFloat", 0);
        seat._setInternal("Steer", 0); seat._setInternal("SteerFloat", 0);
      } catch (_) {            }
      try {
        seat.setProperty("AssemblyLinearVelocity", makeVector3(0, 0, 0));
        seat.setProperty("AssemblyAngularVelocity", makeVector3(0, 0, 0));
      } catch (_) {            }
    }
    if (typeof t === "number") seatCooldowns.set(seat.id, t + SEAT_COOLDOWN_MS);
  }
  if (hum) {
    try { hum.setProperty("Sit", false); } catch (_) {            }
    try { hum._setInternal("SeatPart", null); } catch (_) {            }
  }
  seatPart = null;
  hideVehHud();
  rootPos.y += 1;
  if (hum) humAutoState(hum, "Running");
}

function pinToSeat(dt) {
  const sp = seatPart.getProperty("Position");
  if (!sp) return;
  const sz = seatPart.getProperty("Size") || { y: 1 };
  const yawS = seatYaw(seatPart);
  rootPos.x = sp.x;
  rootPos.z = sp.z;
  rootPos.y = sp.y + num(sz.y, 1) / 2 + footOffset * 0.4;
  yaw = yawS;
  vy = 0; vel.x = 0; vel.z = 0;
  if (seatPart.className === "VehicleSeat") driveVehicle(seatPart, yawS, dt);
}

function driveVehicle(seat, yawS) {
  const throttle = (heldKeys.has("W") || heldKeys.has("Up") ? 1 : 0) - (heldKeys.has("S") || heldKeys.has("Down") ? 1 : 0);
  const steer = (heldKeys.has("D") || heldKeys.has("Right") ? 1 : 0) - (heldKeys.has("A") || heldKeys.has("Left") ? 1 : 0);
  try {
    seat._setInternal("Throttle", throttle);
    seat._setInternal("ThrottleFloat", throttle);
    seat._setInternal("Steer", steer);
    seat._setInternal("SteerFloat", steer);
  } catch (_) {            }
  const maxSpeed = num(seat.getProperty("MaxSpeed"), 30);
  const turnSpeed = num(seat.getProperty("TurnSpeed"), 1);

  const fx = Math.sin(yawS);
  const fz = Math.cos(yawS);
  const cur = seat.getProperty("AssemblyLinearVelocity") || { x: 0, y: 0, z: 0 };
  try {
    seat.setProperty("AssemblyLinearVelocity", makeVector3(fx * throttle * maxSpeed, num(cur.y, 0), fz * throttle * maxSpeed));
    seat.setProperty("AssemblyAngularVelocity", makeVector3(0, steer * turnSpeed * 2, 0));
  } catch (_) {            }
  if (seat.getProperty("HeadsUpDisplay") !== false) showVehHud(Math.hypot(num(cur.x, 0), num(cur.z, 0)));
  else hideVehHud();
}

function showVehHud(speed) {
  if (typeof document === "undefined") return;
  if (!vehHud) {
    vehHud = document.createElement("div");
    vehHud.className = "rsw-vehicle-hud";
    vehHud.style.cssText =
      "position:fixed;right:18px;bottom:18px;z-index:4100;padding:8px 14px;border-radius:10px;" +
      "background:rgba(20,22,26,.72);color:#fff;font:700 16px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.45);";
    document.body.appendChild(vehHud);
  }
  vehHud.style.display = "block";
  vehHud.textContent = Math.round(speed) + " studs/s";
}

function hideVehHud() {
  if (vehHud) vehHud.style.display = "none";
}


function updateSeats(dt) {
  if (!hum || !rootInst) {
    if (seatPart) { seatWeld = null; seatPart = null; hideVehHud(); }
    return false;
  }
  const t = nowMs();
  if (seatPart) {
    const gone = seatPart.isDestroyed && seatPart.isDestroyed();
    if (gone || heldKeys.has("Space")) { standUp(gone ? undefined : t); return false; }
    pinToSeat(dt);
    return true;
  }

  ensureColliders();
  for (const part of colliders.list) {
    if (part.className !== "Seat" && part.className !== "VehicleSeat") continue;
    if (part.getProperty("Disabled") === true) continue;
    if (part.getProperty("Occupant")) continue;
    const cd = seatCooldowns.get(part.id);
    if (cd && t < cd) continue;
    if (!seatOverlap(part)) continue;
    sitDown(part, t);
    return true;
  }
  return false;
}


function tick(ts) {
  if (!active || mode !== "play") return;
  if (typeof opts.isPaused === "function" && opts.isPaused()) { lastTs = ts; return; }
  let dt = lastTs ? (ts - lastTs) / 1000 : 0;
  lastTs = ts;
  if (dt <= 0) return;
  if (dt > 0.05) dt = 0.05;
  social.chat.tick();                                                     
  const teamsActive = teamsBoard ? teamsBoard.update(localPlayer, dataModel) : false;
  if (leaderHud) {
    if (teamsActive) leaderHud.update(null);
    else leaderHud.update(localPlayer);                                  
  }
  if (!character || characterParts.length === 0) return;

  const ws = getService(dataModel, "Workspace");
  let gravity = 196.2;
  if (ws && ws.hasProperty && ws.hasProperty("Gravity")) gravity = num(ws.getProperty("Gravity"), 196.2);


  if (updateSeats(dt)) {
    flushTouches(nowMs());
    touchBehaviors.update(nowMs());                                                 
    frameDt = dt;
    applyTransforms(true);
    updateCamera(dt);
    return;
  }

  const st = humRt ? humRt.state : "Running";
  if (st !== prevTickState) { stateT = 0; prevTickState = st; }
  stateT += dt;

  const camYawNow = camera.getYaw();
  const walkSpeed = hum ? clampNum(hum.getProperty("WalkSpeed"), LIMITS.WalkSpeed) : 16;
  const autoRotate = !hum || hum.getProperty("AutoRotate") !== false;


  if (hum && st !== "Dead") {
    if (hum.getProperty("PlatformStand") === true) {
      if (st !== "PlatformStanding") humAutoState(hum, "PlatformStanding");
    } else if (st === "PlatformStanding") {
      humAutoState(hum, "Running");
    } else if (hum.getProperty("Sit") === true) {
      if (st !== "Seated") humAutoState(hum, "Seated");
    } else if (st === "Seated") {
      humAutoState(hum, "Running");
    }
  }


  waterSub = 0;
  swimFlowX = 0;
  swimFlowZ = 0;
  {
    const td = terrainStore.getData ? terrainStore.getData() : null;
    const field = syncWaterSensor(waterSensor, td);
    if (field && field.hasWater) {
      const inst = terrainStore.getTerrainInstance ? terrainStore.getTerrainInstance() : null;
      const waves = waveStateFromTerrain(inst, waveClock.time);
      waterSub = characterSubmersion(
        field, rootPos.x, rootPos.y, rootPos.z, footOffset * 2, waves,
      );


      if (waves && waterSub > 0 && typeof field.surfaceYAt === "function") {
        const sy = field.surfaceYAt(rootPos.x, rootPos.y, rootPos.z, waves);
        if (Number.isFinite(sy)) {
          const fs = waterFlowSpeed(waves, sy - rootPos.y);
          swimFlowX = fs * WATER_FLOW_DIR_X;
          swimFlowZ = fs * WATER_FLOW_DIR_Z;
        }
      }
    }


    swimDryT = waterSub <= SWIM_EXIT_OUT ? swimDryT + dt : 0;
    const stPre = humRt ? humRt.state : "Running";
    if (hum && shouldEnterSwim({ state: stPre, noControl: isNoControlState(stPre), sub: waterSub, vy }) &&
        humAutoState(hum, "Swimming")) {
      vy *= SWIM_SPLASH_DAMP;                                              
    }
  }
  const stNow = humRt ? humRt.state : "Running";


  let jumpReq = heldKeys.has("Space");
  if (humRt && humRt.jumpRequested) { jumpReq = true; humRt.jumpRequested = false; }
  if (hum && hum.getProperty("Jump") === true) {
    try { hum._setInternal("Jump", false); } catch (_) {            }
  }


  const noControl = isNoControlState(stNow);


  if ((stNow === "FallingDown" || stNow === "Ragdoll") && stateT >= 1) humAutoState(hum, "GettingUp");
  else if (stNow === "GettingUp" && stateT >= 0.5) humAutoState(hum, "Running");


  let mf = 0;
  let ms = 0;
  if (heldKeys.has("W") || heldKeys.has("Up")) mf += 1;
  if (heldKeys.has("S") || heldKeys.has("Down")) mf -= 1;
  if (heldKeys.has("D") || heldKeys.has("Right")) ms += 1;
  if (heldKeys.has("A") || heldKeys.has("Left")) ms -= 1;


  const camFx = Math.sin(camYawNow);
  const camFz = Math.cos(camYawNow);
  const rightX = -camFz;
  const rightZ = camFx;
  let dx = camFx * mf + rightX * ms;
  let dz = camFz * mf + rightZ * ms;
  let mlen = Math.hypot(dx, dz);


  if (mf !== 0 || ms !== 0) coreGui.cancelClickToMove();
  if (mlen < 0.001 && !noControl) {
    const autoDir = coreGui.getAutoMoveDir(rootPos);
    if (autoDir) { dx = autoDir.x; dz = autoDir.z; mlen = 1; }
  }

  if (mlen < 0.001 && humRt) {

    const sm = humRt.scriptMove;
    if (sm) {
      if (sm.relative) {

        dx = rightX * sm.x - camFx * sm.z;
        dz = rightZ * sm.x - camFz * sm.z;
      } else {
        dx = sm.x;
        dz = sm.z;
      }
      mlen = Math.hypot(dx, dz);
      if (mlen > 1) { dx /= mlen; dz /= mlen; mlen = 1; }
    } else if (humRt.moveTo) {
      const target = moveToTargetOf(humRt);
      if (target) {
        const tx = target.x - rootPos.x;
        const tz = target.z - rootPos.z;
        const tlen = Math.hypot(tx, tz);
        if (tlen > 0.05) { dx = tx / tlen; dz = tz / tlen; mlen = 1; }
      }
    }
  }

  movingNow = mlen > 0.001 && !noControl && stNow !== "Climbing";

  if (movingNow || jumpReq || noControl) coreGui.cancelEmote();
  if (mlen > 0.001) { dx /= Math.max(1, mlen); dz /= Math.max(1, mlen); const l2 = Math.hypot(dx, dz); if (l2 > 0.001) { dx /= l2; dz /= l2; } }


  let climbSpeedNow = 0;
  if (stNow === "Dead") {
    vy -= gravity * dt;
  } else if (stNow === "Climbing") {

    if (!trussNear) {
      humAutoState(hum, grounded ? "Running" : "Freefall");
    } else if (jumpReq && (!humRt || humRt.stateEnabled.get("Jumping") !== false)) {
      vy = jumpVelocity(gravity) * 0.6;
      humAutoState(hum, "Jumping");
    } else {
      const climb = walkSpeed * 0.7;
      vy = mf > 0 ? climb : mf < 0 ? -climb : 0;
      climbSpeedNow = vy;
      if (grounded && mf <= 0) humAutoState(hum, "Running");
    }
  } else if (stNow === "Swimming") {







    if (trussNear && mf > 0 && humAutoState(hum, "Climbing")) {
      vy = 0;
    } else {
      const exitTo = swimExitState({ sub: waterSub, grounded, dryFor: swimDryT });
      if (exitTo) {
        humAutoState(hum, exitTo);
      } else if (jumpReq && canJumpOutOfWater(waterSub) &&
          (!humRt || humRt.stateEnabled.get("Jumping") !== false)) {
        vy = jumpVelocity(gravity) * 0.75;                          
        grounded = false;
        humAutoState(hum, "Jumping");
      } else {
        vy = stepSwimVy(vy, swimVerticalTarget({
          sub: waterSub,
          mf,
          camPitch: camera.getPitch(),
          up: jumpReq,
          swimSpeed: walkSpeed,
        }), dt);
      }
    }
  } else {

    if (trussNear && !noControl && mf > 0 && humAutoState(hum, "Climbing")) {
      vy = 0;
    } else {

      if (jumpReq && grounded && !noControl &&
          (stNow === "Running" || stNow === "Landed") &&
          (!humRt || humRt.stateEnabled.get("Jumping") !== false)) {
        vy = jumpVelocity(gravity);
        grounded = false;
        humAutoState(hum, "Jumping");
      }
      vy -= gravity * dt;
    }
  }


  const swimH = stNow === "Swimming" ? swimHorizontalScale(mf, ms, camera.getPitch()) : 1;
  const targetVx = movingNow ? dx * walkSpeed * swimH : 0;
  const targetVz = movingNow ? dz * walkSpeed * swimH : 0;
  const k = Math.min(1, MOVE_ACCEL * dt);
  vel.x += (targetVx - vel.x) * k;
  vel.z += (targetVz - vel.z) * k;
  if (!movingNow && Math.abs(vel.x) < 0.05 && Math.abs(vel.z) < 0.05) { vel.x = 0; vel.z = 0; }
  rootPos.x += vel.x * dt;
  rootPos.z += vel.z * dt;


  if (stNow === "Swimming" && (swimFlowX !== 0 || swimFlowZ !== 0)) {
    rootPos.x += swimFlowX * dt;
    rootPos.z += swimFlowZ * dt;
  }


  if ((camera.isFirstPerson() || coreGui.isShiftLockActive()) && stNow !== "Dead") {
    yaw = camYawNow;                                               
  } else if (autoRotate && movingNow) {
    const targetYaw = Math.atan2(dx, dz);
    let dyaw = targetYaw - yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const maxTurn = CHAR_TURN_SPEED * dt;
    yaw += Math.abs(dyaw) <= maxTurn ? dyaw : Math.sign(dyaw) * maxTurn;
  }


  resolveHorizontal();

  const prevRootY = rootPos.y;
  let vDy = vy * dt;
  if (vDy > MAX_VSTEP) vDy = MAX_VSTEP;
  else if (vDy < -MAX_VSTEP) vDy = -MAX_VSTEP;
  rootPos.y += vDy;
  resolveVertical(prevRootY);


  const st2 = humRt ? humRt.state : "Running";
  if (humRt && st2 !== "Dead" && st2 !== "Seated" && st2 !== "PlatformStanding" &&
      st2 !== "Physics" && st2 !== "None" && st2 !== "Climbing" && st2 !== "Swimming" &&
      st2 !== "FallingDown" && st2 !== "Ragdoll" && st2 !== "GettingUp") {
    if (st2 === "Jumping" && vy <= 0) humAutoState(hum, "Freefall");
    else if (st2 === "Freefall" && grounded) humAutoState(hum, "Landed");
    else if (st2 === "Landed" && stateT >= LANDED_TIME) humAutoState(hum, "Running");
    else if (st2 === "Running" && !grounded && vy < -4) humAutoState(hum, "Freefall");
  }


  if (hum) {
    const ndx = movingNow ? dx : 0;
    const ndz = movingNow ? dz : 0;
    if (Math.abs(ndx - lastMoveDir.x) > 0.01 || Math.abs(ndz - lastMoveDir.z) > 0.01) {
      lastMoveDir.x = ndx; lastMoveDir.z = ndz;
      try { hum._setInternal("MoveDirection", makeVector3(ndx, 0, ndz)); } catch (_) {            }
    }



    let floorMat = "Air";
    if (grounded) {
      if (groundPart && groundPart.className === "Terrain") floorMat = "Grass";
      else if (groundPart && groundPart.hasProperty && groundPart.hasProperty("Material")) floorMat = String(groundPart.getProperty("Material") || "Plastic");
      else floorMat = "Plastic";
    }
    try {
      if (hum.getProperty("FloorMaterial") !== floorMat) hum._setInternal("FloorMaterial", floorMat);
    } catch (_) {            }
    humSetVelocity(hum, vel.x, vy, vel.z);

    if ((humRt ? humRt.state : stNow) === "Swimming") {
      humSwimmingSpeed(hum, movingNow || Math.abs(vy) > 0.5 ? Math.hypot(vel.x, vy, vel.z) : 0);
    } else if (grounded) humRunningSpeed(hum, movingNow ? Math.hypot(vel.x, vel.z) : 0);
  }


  let fallY = VOID_Y;


  const wsFall = ws;
  if (wsFall && wsFall.hasProperty("FallenPartsDestroyHeight")) {
    const fh = Number(wsFall.getProperty("FallenPartsDestroyHeight"));
    if (Number.isFinite(fh)) fallY = fh;
  }
  if (rootPos.y < fallY && !voidKilled) {
    voidKilled = true;
    if (hum) { try { hum.setProperty("Health", 0); } catch (_) {            } }
    else { const old = character; if (old) { try { old.destroy(); } catch (_) {            } } return; }
  }

  flushTouches(nowMs());
  touchBehaviors.update(nowMs());                                                 
  frameDt = dt;
  applyTransforms(false);
  updateCamera(dt);
}

function applyTransforms(force) {
  if (!character || characterParts.length === 0) return;
  const animOn = locomotionActive();
  const stNow = humRt ? humRt.state : "Running";
  if (animOn) {
    loco.update(frameDt, {
      state: stNow,
      grounded,
      speed: Math.hypot(vel.x, vel.z),
      climbSpeed: stNow === "Climbing" ? vy : 0,
      swimVy: stNow === "Swimming" ? vy : 0,             
    });
  }
  const deathQ = deathStartedAt ? Math.min(1, ((nowMs() - deathStartedAt) / 1000) / DEATH_TIP_TIME) : 0;

  const emotePose = animOn && !deathQ ? coreGui.getEmotePose() : null;


  const clipMix = !deathQ && hum ? animClipPoseFor(hum) : null;


  if (deathQ) swimTilt = 0;
  else {
    const swimNow = stNow === "Swimming";
    const tiltTarget = !swimNow ? 0 :
      (Math.hypot(vel.x, vel.z) > 1 || Math.abs(vy) > 2 ? SWIM_TILT_MOVING : SWIM_TILT_IDLE);
    const dtF = typeof frameDt === "number" && frameDt > 0 ? frameDt : 1 / 60;
    swimTilt += (tiltTarget - swimTilt) * Math.min(1, dtF * SWIM_TILT_RATE);
    if (!swimNow && Math.abs(swimTilt) < 0.01) swimTilt = 0;
  }


  const ikHum = character && character.findFirstChild ? character.findFirstChild("Humanoid") : null;
  const rigInfo = ikRigInfo();
  const ik = charIK.update({
    ws: dataModel ? getService(dataModel, "Workspace") : null,
    character,
    hum: ikHum,
    state: stNow,
    grounded,
    rootPos,
    yaw,
    dt: typeof frameDt === "number" && frameDt > 0 ? frameDt : 1 / 60,
    characterParts,
    feet: rigInfo.feet,
    headCp: rigInfo.head,
    deathQ: deathQ > 0,
  });
  const poseKey = `${rootPos.x.toFixed(3)}|${rootPos.y.toFixed(3)}|${rootPos.z.toFixed(3)}|${yaw.toFixed(3)}|${grounded ? 1 : 0}|${animOn ? loco.poseKey() : "off"}|${(deathQ * 100) | 0}|${(swimTilt * 100) | 0}|${animOn && toolPoseActive ? "T" : "n"}|${ik ? ik.key : "noik"}|${emotePose ? emotePose.key : "noem"}|${clipMix ? clipMix.key : "noclip"}`;
  if (!force && poseKey === lastApplied) return;
  lastApplied = poseKey;

  const bob = animOn && !deathQ ? (emotePose ? emotePose.bob : loco.bob()) : 0;
  const baseY = rootPos.y + bob - (footOffset - 0.8) * deathQ;
  const tipA = deathQ * Math.PI * 0.5 + swimTilt;                           
  const ca = Math.cos(tipA);
  const sa = Math.sin(tipA);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const oriY = (yaw * 180) / Math.PI;
  for (const cp of characterParts) {
    const inst = cp.inst;
    if (!inst || (inst.getParent && !inst.getParent())) continue;
    const ox = cp.off.x;
    let oy = cp.off.y;
    let oz = cp.off.z;
    let pitch = 0;
    if (cp.limb) {
      if (deathQ) pitch = cp.deathSplay || 0;
      else if (animOn && emotePose) {

        pitch = cp.limb.kind === "arm"
          ? (cp.limb.side === 1 ? emotePose.armL : emotePose.armR)
          : (cp.limb.side === 1 ? emotePose.legL : emotePose.legR);
      }
      else if (animOn) pitch = loco.pitchFor(cp.limb);
      else if (!grounded) pitch = cp.limb.kind === "leg" ? 0.5 : -0.85;


      if (animOn && !deathQ && toolPoseActive && cp.limb.kind === "arm" && cp.limb.side === -1) {
        pitch = TOOL_HOLD_PITCH;
      }


      if (clipMix) {
        const cm = clipMix.parts.get(String(inst.name || ""));
        if (cm) pitch += (cm.p - pitch) * cm.w;
      }
      if (ik && !deathQ) {
        const lk = ik.limbs.get(cp.limb.kind + ":" + cp.limb.side);
        if (lk) pitch = pitch + (lk.pitch - pitch) * lk.weight;
        if (cp.limb.kind === "leg") {
          pitch += (cp.limb.side === 1 ? ik.anklePitchL : ik.anklePitchR) * 0.5;
        }
      }
      if (pitch) {
        const py = cp.pivotY || 0;
        const ly = oy - py;
        const lz = oz;
        const c2 = Math.cos(pitch);
        const s2 = Math.sin(pitch);
        oy = py + ly * c2 - lz * s2;
        oz = ly * s2 + lz * c2;
      }
    } else if (clipMix) {


      const cm = clipMix.parts.get(String(inst.name || ""));
      if (cm) pitch = cm.p * cm.w;
    }
    if (ik && !deathQ) {

      if (cp.limb && cp.limb.kind === "leg") {
        oy += cp.limb.side === 1 ? ik.footDropL : ik.footDropR;
      } else {
        oy += ik.rootDrop;
      }
    }
    if (tipA) {


      const ny = oy * ca - oz * sa;
      const nz = oy * sa + oz * ca;
      oy = ny;
      oz = nz;
    }
    const wx = rootPos.x + ox * cy + oz * sy;
    const wz = rootPos.z - ox * sy + oz * cy;


    let yawL = yaw;
    let extraPitch = 0;
    if (ik && ik.head && !deathQ && !cp.limb) {
      let nm = "";
      try {
        nm = String(inst.getProperty("Name") || "");
      } catch (_) {
        nm = "";
      }
      if (nm === "Head") {
        yawL = yaw + ik.head.yawRad;
        extraPitch = -ik.head.pitchRad;
      } else if (/torso/i.test(nm)) {
        yawL = yaw + ik.head.yawRad * 0.25;
      }
    }
    const cyL = yawL === yaw ? cy : Math.cos(yawL);
    const syL = yawL === yaw ? sy : Math.sin(yawL);
    const pt = pitch + tipA + extraPitch;
    let rotX = 0;
    let rotY = (yawL * 180) / Math.PI;
    let rotZ = 0;
    if (pt) {
      const cb = Math.cos(pt);
      const sb = Math.sin(pt);
      const RAD2DEG = 180 / Math.PI;
      rotX = Math.atan2(sb, cyL * cb) * RAD2DEG;
      rotY = Math.asin(Math.max(-1, Math.min(1, syL * cb))) * RAD2DEG;
      rotZ = Math.atan2(-syL * sb, cyL) * RAD2DEG;
    }
    try {
      inst.setProperty("Position", makeVector3(wx, baseY + oy, wz));
      if (inst.hasProperty("Rotation")) inst.setProperty("Rotation", makeVector3(rotX, rotY, rotZ));
      if (inst.hasProperty("Orientation")) inst.setProperty("Orientation", makeVector3(rotX, rotY, rotZ));
    } catch (_) {            }
  }
}


function updateCamera(dt) {
  if (mode !== "play" || !character) return;
  const ws = dataModel ? getService(dataModel, "Workspace") : null;
  const camInst = ws ? ws.getChildren().find((c) => c.className === "Camera") : null;
  const camType = cameraSys.cameraTypeOf(camInst);
  cameraSys.updateFov(camInst);


  if (cameraSys.isScriptedType(camType)) {
    cameraSys.updateScriptedPose({
      camInst,
      camType,
      character,
      rootPos,
      yaw,
      rigPose: camera.getPose(),
      rigDistance: camera.getDistance(),
    });
    cameraSys.clearInvisicam();
    if (fpHidden.size) restoreFpHidden();
    syncMouseBehavior("Default");
    return;
  }

  cameraSys.noteTypeForRig(camType);
  const zl = zoomLimits();

  camera.setNoFirstPerson(camType === "Orbital");

  camera.setShiftLock(coreGui.isShiftLockActive());
  if ((coreGui.getCameraFollowMode() || camType === "Follow") && movingNow &&
      !camera.isOrbiting() && !camera.isFirstPerson() && !coreGui.isShiftLockActive()) {
    camera.followYaw(yaw, dt);
  }

  const subj = cameraSys.subjectPosition(camInst, character, rootPos);
  const occlusionMode = starterString("DevCameraOcclusionMode", "Zoom");
  camera.update(dt, {
    ws,
    character,
    rootX: subj.x,
    rootY: subj.y,
    rootZ: subj.z,
    minZoom: zl.min,
    maxZoom: zl.max,
    lockFirstPerson: camType !== "Orbital" && cameraMode === "LockFirstPerson",
    occlude: occlusionMode !== "Invisicam",
  });

  if (occlusionMode === "Invisicam") cameraSys.applyInvisicam(ws, character, camera.getPose());
  else cameraSys.clearInvisicam();
  applyFirstPersonVisibility();
  syncMouseBehavior();
  syncCurrentCamera();
}


function applyFirstPersonVisibility() {

  if (camera.isFirstPerson() || (typeof camera.isNearClip === "function" && camera.isNearClip())) {
    for (const cp of characterParts) {
      const inst = cp.inst;
      if (!inst || fpHidden.has(inst)) continue;
      fpHidden.set(inst, 0);


      try { inst.setProperty("LocalTransparencyModifier", 1); } catch (_) {            }
    }
  } else if (fpHidden.size) {
    restoreFpHidden();
  }
}

function restoreFpHidden() {
  for (const [inst] of fpHidden) {
    try {
      if (inst.getParent && inst.getParent()) inst.setProperty("LocalTransparencyModifier", 0);
    } catch (_) {            }
  }
  fpHidden.clear();
}


function syncMouseBehavior(forceValue) {

  const desired = forceValue || (camera.isFirstPerson() || coreGui.isShiftLockActive() ? "LockCenter" : camera.isOrbiting() ? "LockCurrentPosition" : "Default");
  if (desired === lastMouseBehavior) return;
  lastMouseBehavior = desired;
  const uis = dataModel ? getService(dataModel, "UserInputService") : null;
  if (uis && uis.hasProperty && uis.hasProperty("MouseBehavior")) {
    try { uis.setProperty("MouseBehavior", desired); } catch (_) {            }
  }
}


function syncCurrentCamera() {
  if (!dataModel) return;
  const ws = getService(dataModel, "Workspace");
  const cam = ws && ws.getChildren().find((c) => c.className === "Camera");
  if (!cam || !cam.hasProperty) return;

  cameraSys.writeCameraProps(cam, camera.getPose(), false);
}

function getCameraPoseInternal() {
  if (!active || mode !== "play" || !character || characterParts.length === 0) return null;

  const ws = dataModel ? getService(dataModel, "Workspace") : null;
  const camInst = ws ? ws.getChildren().find((c) => c.className === "Camera") : null;
  const base = cameraSys.isScriptedType(cameraSys.cameraTypeOf(camInst))
    ? cameraSys.getScriptedPose()
    : camera.getPose();
  return cameraSys.applyShake(base);
}


function keyNameOf(io) {
  const kc = io && io.keyCode;
  if (typeof kc === "string") return kc;
  if (kc && typeof kc === "object" && kc.name) return kc.name;
  return null;
}

function stateNameOf(state) {
  if (typeof state === "string") return state;
  if (state && typeof state === "object" && state.name) return state.name;
  return null;
}

function bindCasActions() {
  inputManager = opts.inputManager || null;
  if (!inputManager || typeof inputManager.bindAction !== "function") return false;
  casBound = [];
  const mk = (name, fn, priority, inputs) => {
    try {
      inputManager.bindAction({ name, callback: nativeFn(fn, name), priority, inputs });
      casBound.push(name);
    } catch (e) {
      log.warn(`Playtest: falha ao vincular action '${name}': ${(e && e.message) || e}`, { source: "Playtest" });
    }
  };


  const moveCb = (args) => {
    const st = stateNameOf(args[1]);
    const key = keyNameOf(args[2]);
    if (key) {
      if (st === "Begin") heldKeys.add(key);
      else if (st === "End" || st === "Cancel") heldKeys.delete(key);
    }
    return ["Pass"];
  };
  mk("RswCharacterForward", moveCb, 2000, ["W", "Up"]);
  mk("RswCharacterBackward", moveCb, 2000, ["S", "Down"]);
  mk("RswCharacterLeft", moveCb, 2000, ["A", "Left"]);
  mk("RswCharacterRight", moveCb, 2000, ["D", "Right"]);
  mk("RswCharacterJump", moveCb, 2000, ["Space"]);


  mk("RswCameraOrbit", (args) => {
    const st = stateNameOf(args[1]);
    if (st === "Begin") camera.setOrbiting(true);
    else if (st === "End" || st === "Cancel") camera.setOrbiting(false);
    return ["Pass"];
  }, 1000, ["MouseButton2"]);
  mk("RswCameraLook", (args) => {
    const io = args[2];

    const sens = coreGui.getSensitivity();
    if (io && io.delta) camera.look(num(io.delta.x, 0) * sens, num(io.delta.y, 0) * sens);
    return ["Pass"];
  }, 1000, ["MouseMovement"]);
  mk("RswCameraZoom", (args) => {
    const io = args[2];
    const z = io && io.position ? num(io.position.z, 0) : 0;
    if (z) {
      const zl = zoomLimits();
      camera.zoom(z > 0 ? 1 : -1, zl.min, zl.max, cameraMode === "LockFirstPerson");
    }
    return ["Pass"];
  }, 1000, ["MouseWheel"]);

  usingCas = casBound.length > 0;
  return usingCas;
}

function unbindCasActions() {
  if (inputManager && typeof inputManager.unbindAction === "function") {
    for (const name of casBound) {
      try { inputManager.unbindAction(name); } catch (_) {            }
    }
  }
  casBound = [];
  usingCas = false;
  inputManager = null;
}


const DOM_KEY_MAP = Object.freeze({
  KeyW: "W", KeyA: "A", KeyS: "S", KeyD: "D", Space: "Space",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
});

function onKeyDown(e) {
  if (!active || mode !== "play") return;
  if (isTypingTarget(e.target)) return;
  const name = DOM_KEY_MAP[e.code];
  if (name) {
    heldKeys.add(name);
    e.preventDefault();
  }
}

function onKeyUp(e) {
  const name = DOM_KEY_MAP[e.code];
  if (name) heldKeys.delete(name);
}

function onMouseDown(e) {
  if (!active || mode !== "play") return;
  if (e.button === 2) { camera.setOrbiting(true); e.preventDefault(); }
}

function onMouseUp(e) {
  if (e.button === 2) camera.setOrbiting(false);
}

function onMouseMove(e) {
  if (!active || mode !== "play") return;
  const sens = coreGui.getSensitivity();            
  camera.look(num(e.movementX, 0) * sens, num(e.movementY, 0) * sens);
}

function onWheel(e) {
  if (!active || mode !== "play") return;
  const zl = zoomLimits();
  camera.zoom(e.deltaY < 0 ? 1 : -1, zl.min, zl.max, cameraMode === "LockFirstPerson");
}

function onContextMenu(e) {
  if (active && mode === "play") e.preventDefault();
}

function onWindowBlur() {
  heldKeys.clear();
  camera.setOrbiting(false);
}

function addDomListeners() {
  if (typeof window === "undefined") return;
  window.addEventListener("blur", onWindowBlur);
  if (usingCas) return;                              
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("wheel", onWheel, { capture: true, passive: true });
  window.addEventListener("contextmenu", onContextMenu, true);
}

function removeDomListeners() {
  if (typeof window === "undefined") return;
  window.removeEventListener("blur", onWindowBlur);
  window.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("keyup", onKeyUp, true);
  window.removeEventListener("mouseup", onMouseUp, true);
  window.removeEventListener("mousedown", onMouseDown, true);
  window.removeEventListener("mousemove", onMouseMove, true);
  window.removeEventListener("wheel", onWheel, { capture: true });
  window.removeEventListener("contextmenu", onContextMenu, true);
}


function focusViewport() {
  if (typeof document === "undefined") return;
  const c = document.querySelector(".rsw-viewport__canvas");
  if (!c) return;
  if (c.getAttribute && !c.getAttribute("tabindex")) {
    try { c.setAttribute("tabindex", "-1"); } catch (_) {            }
  }
  try { c.focus({ preventScroll: true }); } catch (_) { try { c.focus(); } catch (_e) {            } }
}


function buildOverlay() {
  if (typeof document === "undefined" || overlayEl) return;
  const wrap = document.createElement("div");
  wrap.className = "rsw-playtest-overlay";
  Object.assign(wrap.style, {
    position: "fixed", bottom: "60px", left: "50%", transform: "translateX(-50%)",
    display: "flex", gap: "8px", alignItems: "center", zIndex: "4000",
    padding: "6px 10px", borderRadius: "8px",
    background: "rgba(18, 22, 18, 0.82)", border: "1px solid rgba(120, 200, 130, 0.45)",
    font: "12px system-ui, sans-serif", color: "#dfe8df",
  });
  const mkBtn = (label, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    Object.assign(b.style, {
      padding: "5px 10px", borderRadius: "6px", cursor: "pointer",
      background: "rgba(60, 130, 70, 0.35)", color: "#eaf5ea",
      border: "1px solid rgba(140, 210, 150, 0.5)", font: "inherit",
    });
    b.addEventListener("click", (e) => { onClick(e); focusViewport(); });
    return b;
  };
  if (mode === "play") {

    wrap.appendChild(mkBtn("Reset Character", () => {
      if (hum) { try { hum.setProperty("Health", 0); } catch (_) {            } }
      else loadCharacterInternal();
    }));
    const hint = document.createElement("span");
    hint.textContent = "WASD/Setas mover · Espaço pular · Botão direito girar câmera · Scroll zoom (total = 1ª pessoa)";
    Object.assign(hint.style, { opacity: "0.75", margin: "0 4px" });
    wrap.appendChild(hint);
  }
  wrap.appendChild(mkBtn("Return to Edit Mode", () => {
    if (typeof opts.requestStop === "function") opts.requestStop();
  }));
  document.body.appendChild(wrap);
  overlayEl = wrap;
}

function removeOverlay() {
  if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
  overlayEl = null;
}


export const playtest = {

  ensureContainers(dm) {
    const sp = dm ? getService(dm, "StarterPlayer") : null;
    if (!sp) return;
    if (!sp.findFirstChild("StarterPlayerScripts")) {
      createInstance("StarterPlayerScripts", { name: "StarterPlayerScripts", parent: sp });
    }
    if (!sp.findFirstChild("StarterCharacterScripts")) {
      createInstance("StarterCharacterScripts", { name: "StarterCharacterScripts", parent: sp });
    }
  },

  start(options = {}) {
    if (active) this.stop();
    active = true;
    stopping = false;
    mode = options.mode === "play" ? "play" : "run";
    dataModel = options.dataModel || null;
    opts = options;
    log = options.logger || baseLogger;
    localPlayer = null;
    character = null;
    characterParts = [];
    rootInst = null; hum = null; humRt = null;
    loco = null; animateDefaultInst = null;
    charIK.reset(); ikFeetCache = null;            
    heldKeys = new Set();
    toolPoseActive = false;
    yaw = 0; vy = 0; vel = { x: 0, z: 0 }; grounded = false; movingNow = false;
    trussNear = false; groundPart = null; stateT = 0; prevTickState = "Running";
    lastMoveDir = { x: 0, z: 0 };
    deathStartedAt = 0; deathBreakJoints = true; voidKilled = false; lastSpawnAt = 0;
    lastTs = 0; lastApplied = null; frameDt = 0.016;
    frameTouches = new Set(); activeTouches = new Map();
    fpHidden = new Map(); lastMouseBehavior = null;
    colliders = { list: [], ts: 0 };
    cameraMode = "Classic";
    camera.reset(0);
    this.ensureContainers(dataModel);
    resetPlaytestState();
    syncServiceLocales(dataModel);


    if (mode !== "play") buildOverlay();


    humanoids.start({ dataModel, logger: log, isPaused: opts.isPaused });

    animationTracks.start({ dataModel, logger: log, isPaused: opts.isPaused });

    if (mode === "play") {
      installWatchers();
      bindCasActions();
      addDomListeners();
      firstSpawnDone = false;
      social.ensureTextChatDefaults(dataModel);
      social.chat.start({ dataModel, getLocalPlayer: () => localPlayer });
      cameraSys.startSession();                                         


      coreGui.start({
        mode,
        getDataModel: () => dataModel,
        getLocalPlayer: () => localPlayer,
        getCharacter: () => character,
        getCameraPose: () => camera.getPose(),
        resetCharacter: () => {
          if (hum) { try { hum.setProperty("Health", 0); } catch (_) {            } }
          else loadCharacterInternal();
        },
        requestStop: () => {
          if (typeof opts.requestStop === "function") opts.requestStop();
          else playtest.stop();
        },
        logger: log,
      });
      offs.push(bus.on("playtest:kick", (p) => {
        const msg = p && p.message ? p.message : "";
        log.info(`Jogador desconectado (Kick): ${msg}`, { source: "Playtest" });
        if (typeof opts.requestStop === "function") opts.requestStop();
        else playtest.stop();
      }));
      offs.push(bus.on("localization:testLocaleChanged", () => {
        if (!localPlayer) return;
        try { localPlayer.setProperty("LocaleId", getTestLocale()); } catch (_) {            }
        syncServiceLocales(dataModel);
        const playerGui = localPlayer.findFirstChild("PlayerGui");
        if (playerGui) reapplyTranslations(dataModel, playerGui, baseLogger);
      }));

      createLocalPlayerInternal();
      loadCharacterInternal();


      screenGuiDom.start({
        getLocalPlayer: () => localPlayer,
        getInputManager: () => inputManager,
        logger: log,
      });

      gameplay.start({
        dataModel,
        getCharacter: () => character,
        getLocalPlayer: () => localPlayer,
        getCameraPose: () => getCameraPoseInternal(),
        inputManager,
        logger: log,
      });

      dragDetectors.start({
        dataModel,
        getCharacter: () => character,
        getLocalPlayer: () => localPlayer,
        logger: log,
      });


      touchBehaviors.start({
        getCharacter: () => character,
        getHumanoid: () => hum,
        getLocalPlayer: () => localPlayer,
        logger: log,
      });
      focusViewport();
      unregisterFrameCallback = registerFrameCallback("simulation", tick, "playtest:character");
    }
  },

  stop() {
    if (!active && !overlayEl) return;
    stopping = true;
    active = false;
    if (respawnTimer) { clearTimeout(respawnTimer); respawnTimer = 0; }
    if (unregisterFrameCallback) {
      unregisterFrameCallback();
      unregisterFrameCallback = null;
    }
    lastTs = 0;

    syncMouseBehavior("Default");
    restoreFpHidden();
    unbindCasActions();
    removeDomListeners();
    removeOverlay();
    if (leaderHud) { try { leaderHud.destroy(); } catch (_) {            } leaderHud = null; }
    if (teamsBoard) { try { teamsBoard.destroy(); } catch (_) {            } teamsBoard = null; }
    try { coreGui.stop(); } catch (_) {            }                                            
    try { cameraSys.endSession(); } catch (_) {            }                                
    try { screenGuiDom.stop(); } catch (_) {            }                                         
    try { social.chat.stop(); } catch (_) {            }
    try { social.resetCoreGui(); } catch (_) {            }
    firstSpawnDone = false;
    humanoids.stop();
    animationTracks.stop();             

    try { gameplay.stop(); } catch (_) {            }
    try { dragDetectors.stop(); } catch (_) {            }
    try { touchBehaviors.stop(); } catch (_) {            }                                 
    if (seatWeld) { try { seatWeld.destroy(); } catch (_) {            } }
    seatPart = null; seatWeld = null; seatCooldowns.clear(); hideVehHud();
    for (const off of offs) {
      try { off(); } catch (_) {            }
    }
    offs = [];
    heldKeys.clear();
    camera.reset(0);


    localPlayer = null;
    character = null;
    characterParts = [];
    rootInst = null; hum = null; humRt = null;
    loco = null; animateDefaultInst = null;
    charIK.reset(); ikFeetCache = null;            
    colliders = { list: [], ts: 0 };
    activeTouches = new Map();
    frameTouches = new Set();
    dataModel = null;
    opts = {};
    mode = "edit";
    stopping = false;
    log = baseLogger;
    lastMouseBehavior = null;
  },

  isActive: () => active,

  isCameraActive: () => active && mode === "play",
  getLocalPlayer: () => localPlayer,
  getCharacter: () => character,

  getCameraMode: () => (camera.isFirstPerson() ? "FirstPerson" : "ThirdPerson"),
  setCameraMode: (m) => {
    if (m === "FirstPerson") camera.setFirstPerson(true);
    else if (m === "ThirdPerson") camera.setFirstPerson(false);
    else if (m === "LockFirstPerson" || m === "Classic") {
      cameraMode = m;
      if (localPlayer) { try { localPlayer.setProperty("CameraMode", m); } catch (_) {            } }
    }
  },
  createLocalPlayer: () => createLocalPlayerInternal(),
  loadCharacter: () => loadCharacterInternal(),
  getCameraPose: () => getCameraPoseInternal(),

  getCameraFov: () => cameraSys.getRenderFov(),
  getHeldKeys: () => heldKeys,
};

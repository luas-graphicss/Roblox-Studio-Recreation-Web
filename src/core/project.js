import { bus } from "./eventBus.js";
import { logger } from "./logger.js";
import { commands } from "./commands.js";
import { selection } from "./selection.js";
import { readJSON, writeJSON } from "../utils/storage.js";
import { clampNumber, isPlainObject, isString, isBoolean, isFiniteNumber, isOneOf } from "../utils/validate.js";
import { sanitizeName, makeColor, makeVector3 } from "../datamodel/types.js";
import { createInstance, getService } from "../datamodel/index.js";
import { store } from "./state.js";
import { createSecureNumericId } from "./resourceId.js";           

import { deepCloneJsonValue } from "./deepCloneJsonValue.js";
import { Events } from "../datamodel/instance.js";
import { engine, RuntimeEvents } from "../runtime/engine.js";

const PROJECT_KEY = "project";

export const GENRES = Object.freeze([
  "All", "Adventure", "Building", "Comedy", "Fighting", "FPS", "Horror",
  "Medieval", "Military", "Naval", "RPG", "Sci-Fi", "Sports", "Town and City", "Tutorial",
]);
export const WHO_CAN_PLAY = Object.freeze(["Everyone", "Friends", "Group Members", "Private"]);
export const WHO_CAN_EDIT = Object.freeze(["Me", "Team Create"]);
export const PRIVACY = Object.freeze(["Public", "Private", "Friends Only"]);
export const AVATAR_TYPES = Object.freeze(["R6", "R15", "PlayerChoice"]);
export const SCALING = Object.freeze(["Classic", "Proportions"]);
export const COLLISION = Object.freeze(["OuterBox", "InnerBox"]);
export const ANIMATION = Object.freeze(["Standard", "PlayerChoice"]);
export const LIGHTING_TECH = Object.freeze(["Compatibility", "Voxel", "ShadowMap", "Future"]);


export const RANGES = Object.freeze({
  maxPlayers: { min: 1, max: 100 },
  gravity: { min: 0, max: 500 },
  jumpPower: { min: 0, max: 500 },
  walkSpeed: { min: 0, max: 100 },
  brightness: { min: 0, max: 10 },
  respawnTime: { min: 0, max: 60 },
  fogStart: { min: 0, max: 100000 },
  fogEnd: { min: 0, max: 100000 },
});


export const TEXT_LIMITS = Object.freeze({
  name: 50,
  description: 1000,
});


export const MONETIZATION_LIMITS = Object.freeze({
  maxItems: 50,
  nameMax: 50,
  descriptionMax: 200,
  priceMin: 0,
  priceMax: 999999,
});






export function sanitizeFreeText(value, limit) {
  if (!isString(value)) return "";
  const max = isFiniteNumber(limit) && limit > 0 ? Math.floor(limit) : TEXT_LIMITS.description;
  const s = value
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/\r\n?/g, "\n")

    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return s.length > max ? s.slice(0, max) : s;
}


const MONETIZATION_ID_MIN = 100000;
const MONETIZATION_ID_MAX = 999999;

let _monetizationIdSeed = 0;


export function generateMonetizationId(usedIds) {
  let id = createSecureNumericId(MONETIZATION_ID_MIN, MONETIZATION_ID_MAX);
  for (const v of usedIds || []) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= id) id = Math.floor(n);
  }
  _monetizationIdSeed = (_monetizationIdSeed % 7) + 1;
  return id + _monetizationIdSeed;
}

function defaultColor() {
  return { r: 0, g: 0, b: 0 };
}

export function defaultGameSettings() {
  return {
    general: {
      name: "Untitled Place",
      description: "",
      creator: "Me",
      genre: "All",
      maxPlayers: 50,
      icon: "",
      thumbnail: "",
      allowCopying: false,
      studioAccessToApis: false,
    },
    permissions: {
      whoCanPlay: "Everyone",
      whoCanEdit: "Me",
      privacy: "Public",
      allowThirdPartySales: false,
      allowThirdPartyTeleports: false,
    },
    avatar: {
      avatarType: "R15",
      scaling: "Classic",
      collision: "OuterBox",
      animation: "PlayerChoice",
      allowCustomAnimations: true,
      allowCustomFaces: true,
      allowCustomAccessories: true,
    },
    world: {
      gravity: 196.2,
      jumpPower: 50,
      walkSpeed: 16,
      respawnTime: 5,
      lightingTechnology: "ShadowMap",
      ambient: { r: 0, g: 0, b: 0 },
      outdoorAmbient: { r: 0.27, g: 0.27, b: 0.27 },
      brightness: 2,
      globalShadows: true,
      fogEnabled: false,
      fogColor: { r: 0.75, g: 0.75, b: 0.75 },
      fogStart: 0,
      fogEnd: 100000,
    },
    security: {
      allowHttp: false,
      filterEnabled: true,
      purchasesEnabled: false,
      enableAnalytics: false,
    },
    monetization: {
      purchasesEnabled: false,
      premiumBenefits: false,
      passes: [
        { id: 1000101, name: "VIP Pass", description: "Acesso VIP com beneficios exclusivos.", price: 199, icon: "" },
        { id: 1000102, name: "Starter Pack", description: "Pacote inicial para novos jogadores.", price: 99, icon: "" },
      ],
      products: [
        { id: 2000101, name: "100 Coins", description: "Adiciona 100 moedas ao seu saldo.", price: 25, icon: "" },
        { id: 2000102, name: "Revive", description: "Reviva instantaneamente no local.", price: 10, icon: "" },
      ],
      badges: [
        { id: 3000101, name: "Welcome", description: "Entrou no jogo pela primeira vez.", icon: "", enabled: true },
      ],
    },
    places: [
      { name: "Start Place", isStart: true },
    ],
  };
}

function num(v, fallback) {
  return isFiniteNumber(v) ? v : (isFiniteNumber(Number(v)) ? Number(v) : fallback);
}

function colorObj(v, fallback) {
  if (v && typeof v === "object") {
    return {
      r: clampNumber(num(v.r, fallback.r), 0, 1),
      g: clampNumber(num(v.g, fallback.g), 0, 1),
      b: clampNumber(num(v.b, fallback.b), 0, 1),
    };
  }
  return { r: fallback.r, g: fallback.g, b: fallback.b };
}


export function sanitizeGameSettings(input) {
  const d = defaultGameSettings();
  const s = isPlainObject(input) ? input : {};
  const g = isPlainObject(s.general) ? s.general : {};
  const perm = isPlainObject(s.permissions) ? s.permissions : {};
  const av = isPlainObject(s.avatar) ? s.avatar : {};
  const w = isPlainObject(s.world) ? s.world : {};
  const sec = isPlainObject(s.security) ? s.security : {};
  const mon = isPlainObject(s.monetization) ? s.monetization : {};

  const cleanMonItems = (arr, fallback, isBadge) => {
    const src = Array.isArray(arr) ? arr : fallback;
    const used = new Set();
    const out = [];
    for (const it of src.slice(0, MONETIZATION_LIMITS.maxItems)) {
      const name = clampText(it && it.name, MONETIZATION_LIMITS.nameMax, "Item") || "Item";
      const description = sanitizeFreeText(it && it.description, MONETIZATION_LIMITS.descriptionMax);
      const icon = cleanIconRef(it && it.icon);
      let id = Math.floor(num(it && it.id, 0));
      if (!(id > 0) || id > 999999999999 || used.has(id)) id = generateMonetizationId(used);
      used.add(id);
      if (isBadge) {
        out.push({ id, name, description, icon, enabled: isBoolean(it && it.enabled) ? it.enabled : true });
      } else {
        const price = Math.round(clampNumber(num(it && it.price, 0), MONETIZATION_LIMITS.priceMin, MONETIZATION_LIMITS.priceMax));
        out.push({ id, name, description, price, icon });
      }
    }
    return out;
  };
  const cleanPlaces = (arr, fallback) => {
    if (!Array.isArray(arr) || !arr.length) return fallback;
    return arr.slice(0, 50).map((it, i) => ({
      name: sanitizeName(isString(it && it.name) ? it.name : "Place", "Place") || "Place",
      isStart: i === 0 ? true : !!(it && it.isStart),
    }));
  };
  const clampText = (v, limit, fallback) => {
    const fb = fallback != null ? String(fallback) : "";
    const s = isString(v) ? sanitizeName(v, fb) : fb;
    return s.length > limit ? s.slice(0, limit) : s;
  };
  const cleanIconRef = (v) => {
    if (!isString(v)) return "";
    const s = v.replace(/[<>"'\u0000-\u001F\u007F]/g, "").trim();
    return s.length > 300 ? s.slice(0, 300) : s;
  };

  return {
    general: {
      name: clampText(g.name, TEXT_LIMITS.name, d.general.name) || d.general.name,
      description: sanitizeFreeText(g.description, TEXT_LIMITS.description),


      creator: sanitizeName(isString(g.creator) ? g.creator : d.general.creator, d.general.creator) || d.general.creator,
      genre: isOneOf(g.genre, GENRES) ? g.genre : d.general.genre,
      maxPlayers: Math.round(clampNumber(num(g.maxPlayers, d.general.maxPlayers), RANGES.maxPlayers.min, RANGES.maxPlayers.max)),
      icon: cleanIconRef(g.icon),
      thumbnail: cleanIconRef(g.thumbnail),
      allowCopying: isBoolean(g.allowCopying) ? g.allowCopying : d.general.allowCopying,
      studioAccessToApis: isBoolean(g.studioAccessToApis) ? g.studioAccessToApis : d.general.studioAccessToApis,
    },
    permissions: {
      whoCanPlay: isOneOf(perm.whoCanPlay, WHO_CAN_PLAY) ? perm.whoCanPlay : d.permissions.whoCanPlay,
      whoCanEdit: isOneOf(perm.whoCanEdit, WHO_CAN_EDIT) ? perm.whoCanEdit : d.permissions.whoCanEdit,
      privacy: isOneOf(perm.privacy, PRIVACY) ? perm.privacy : d.permissions.privacy,
      allowThirdPartySales: isBoolean(perm.allowThirdPartySales) ? perm.allowThirdPartySales : d.permissions.allowThirdPartySales,
      allowThirdPartyTeleports: isBoolean(perm.allowThirdPartyTeleports) ? perm.allowThirdPartyTeleports : d.permissions.allowThirdPartyTeleports,
    },
    avatar: {
      avatarType: isOneOf(av.avatarType, AVATAR_TYPES) ? av.avatarType : d.avatar.avatarType,
      scaling: isOneOf(av.scaling, SCALING) ? av.scaling : d.avatar.scaling,
      collision: isOneOf(av.collision, COLLISION) ? av.collision : d.avatar.collision,
      animation: isOneOf(av.animation, ANIMATION) ? av.animation : d.avatar.animation,
      allowCustomAnimations: isBoolean(av.allowCustomAnimations) ? av.allowCustomAnimations : d.avatar.allowCustomAnimations,
      allowCustomFaces: isBoolean(av.allowCustomFaces) ? av.allowCustomFaces : d.avatar.allowCustomFaces,
      allowCustomAccessories: isBoolean(av.allowCustomAccessories) ? av.allowCustomAccessories : d.avatar.allowCustomAccessories,
    },
    world: {
      gravity: clampNumber(num(w.gravity, d.world.gravity), RANGES.gravity.min, RANGES.gravity.max),
      jumpPower: clampNumber(num(w.jumpPower, d.world.jumpPower), RANGES.jumpPower.min, RANGES.jumpPower.max),
      walkSpeed: clampNumber(num(w.walkSpeed, d.world.walkSpeed), RANGES.walkSpeed.min, RANGES.walkSpeed.max),
      respawnTime: clampNumber(num(w.respawnTime, d.world.respawnTime), RANGES.respawnTime.min, RANGES.respawnTime.max),
      lightingTechnology: isOneOf(w.lightingTechnology, LIGHTING_TECH) ? w.lightingTechnology : d.world.lightingTechnology,
      ambient: colorObj(w.ambient, d.world.ambient),
      outdoorAmbient: colorObj(w.outdoorAmbient, d.world.outdoorAmbient),
      brightness: clampNumber(num(w.brightness, d.world.brightness), RANGES.brightness.min, RANGES.brightness.max),
      globalShadows: isBoolean(w.globalShadows) ? w.globalShadows : d.world.globalShadows,
      fogEnabled: isBoolean(w.fogEnabled) ? w.fogEnabled : d.world.fogEnabled,
      fogColor: colorObj(w.fogColor, d.world.fogColor),
      fogStart: clampNumber(num(w.fogStart, d.world.fogStart), RANGES.fogStart.min, RANGES.fogStart.max),
      fogEnd: clampNumber(num(w.fogEnd, d.world.fogEnd), RANGES.fogEnd.min, RANGES.fogEnd.max),
    },
    security: {
      allowHttp: isBoolean(sec.allowHttp) ? sec.allowHttp : d.security.allowHttp,
      filterEnabled: isBoolean(sec.filterEnabled) ? sec.filterEnabled : d.security.filterEnabled,
      purchasesEnabled: isBoolean(sec.purchasesEnabled) ? sec.purchasesEnabled : d.security.purchasesEnabled,
      enableAnalytics: isBoolean(sec.enableAnalytics) ? sec.enableAnalytics : d.security.enableAnalytics,
    },
    monetization: {
      purchasesEnabled: isBoolean(mon.purchasesEnabled) ? mon.purchasesEnabled : d.monetization.purchasesEnabled,
      premiumBenefits: isBoolean(mon.premiumBenefits) ? mon.premiumBenefits : d.monetization.premiumBenefits,
      passes: cleanMonItems(mon.passes, d.monetization.passes, false),
      products: cleanMonItems(mon.products, d.monetization.products, false),
      badges: cleanMonItems(mon.badges, d.monetization.badges, true),
    },
    places: cleanPlaces(s.places, d.places),
  };
}

function deepClone(obj) {
  return deepCloneJsonValue(obj);
}

function setStatus(text, transient) {
  bus.emit("status:message", { text: String(text || ""), transient: transient !== false });
}

class ProjectManager {
  constructor() {
    this._settings = defaultGameSettings();
    this._dirty = false;
    this._suppress = false;
    this._running = false;
    this._wired = false;
  }


  getName() {
    return this._settings.general.name;
  }
  isDirty() {
    return this._dirty;
  }
  getSettings() {
    return deepClone(this._settings);
  }


  getWorkingCopy() {
    const copy = deepClone(this._settings);
    const live = this._readWorldFromDataModel();
    copy.world = Object.assign(copy.world, live);
    const players = this._readPlayersFromDataModel();
    if (players) {
      if (isFiniteNumber(players.maxPlayers)) copy.general.maxPlayers = players.maxPlayers;
      if (isFiniteNumber(players.respawnTime)) copy.world.respawnTime = players.respawnTime;
    }
    return copy;
  }


  isRunning() {
    return this._running;
  }


  beginEditSession() {
    return {
      settings: deepClone(this._settings),
      world: this._readWorldFromDataModel(),
      players: this._readPlayersFromDataModel() || {},
    };
  }


  previewLive(draft) {
    const clean = sanitizeGameSettings(draft);
    const wasSuppressed = this._suppress;
    this._suppress = true;
    try {
      this._applyToDataModelDirect(clean);


      this._settings.avatar = deepClone(clean.avatar);
    } catch (e) {
      logger.warn("Project: previewLive falhou: " + (e && e.message));
    }
    this._suppress = wasSuppressed;
  }


  cancelEditSession(session) {
    if (!session) return;
    const wasSuppressed = this._suppress;
    this._suppress = true;
    try {
      this._settings = sanitizeGameSettings(session.settings);
      const gs = deepClone(this._settings);
      gs.world = Object.assign(gs.world, session.world || {});
      if (session.players && isFiniteNumber(session.players.maxPlayers)) gs.general.maxPlayers = session.players.maxPlayers;
      if (session.players && isFiniteNumber(session.players.respawnTime)) gs.world.respawnTime = session.players.respawnTime;
      this._applyToDataModelDirect(gs);
    } catch (e) {
      logger.warn("Project: cancelEditSession falhou: " + (e && e.message));
    }
    this._suppress = wasSuppressed;
    this._emit();
  }


  resetPlayerData() {
    logger.info("Player data reset (simulado).", { source: "Studio" });
    setStatus("Player data reset");
    return true;
  }
  clearAllDataStores() {
    logger.info("All DataStores cleared (simulado).", { source: "Studio" });
    setStatus("DataStores cleared");
    return true;
  }
  forceResetAllPlayers() {
    let n = 0;
    try {
      const dm = this._dm();
      const players = dm ? getService(dm, "Players") : null;
      if (players && players.getChildren) {
        for (const p of players.getChildren()) {
          if (p && typeof p.getProperty === "function") n++;
        }
      }
    } catch (_) {            }
    logger.info("Force reset all players (" + n + ").", { source: "Studio" });
    setStatus("Forced reset of all players");
    return n;
  }


  init() {
    if (this._wired) return;
    this._wired = true;

    const stored = readJSON(PROJECT_KEY, null);
    if (stored && isPlainObject(stored.settings)) {
      this._settings = sanitizeGameSettings(stored.settings);
      this._persist();
    }


    this._suppress = true;
    try {
      this._applyToDataModelDirect(this._settings);
    } catch (e) {
      logger.warn("Project: falha ao aplicar configurações iniciais: " + (e && e.message));
    }
    this._suppress = false;


    const onChange = () => {
      if (this._suppress || this._running) return;
      this.markDirty();
    };
    bus.on(Events.PropertyChanged, onChange);
    bus.on(Events.ChildAdded, onChange);
    bus.on(Events.ChildRemoved, onChange);
    bus.on(Events.ParentChanged, onChange);
    bus.on("command:executed", onChange);
    bus.on("command:undo", onChange);
    bus.on("command:redo", onChange);
    bus.on(RuntimeEvents.ModeChanged, (p) => {
      this._running = !!(p && p.running);
    });

    this._dirty = false;
    this._emit();
    logger.info("ProjectManager inicializado.", { source: "Studio" });
  }

  _dm() {
    try {
      return store.getDataModel();
    } catch (_) {
      return null;
    }
  }

  _readWorldFromDataModel() {
    const out = {};
    const dm = this._dm();
    if (!dm) return out;
    const lighting = getService(dm, "Lighting");
    const ws = getService(dm, "Workspace");
    const sp = getService(dm, "StarterPlayer");
    const readColor = (inst, prop) => {
      if (inst && inst.hasProperty(prop)) {
        const c = inst.getProperty(prop);
        if (c && typeof c === "object") return { r: c.r, g: c.g, b: c.b };
      }
      return null;
    };
    if (lighting) {
      const amb = readColor(lighting, "Ambient");
      if (amb) out.ambient = amb;
      const oamb = readColor(lighting, "OutdoorAmbient");
      if (oamb) out.outdoorAmbient = oamb;
      if (lighting.hasProperty("Brightness")) out.brightness = lighting.getProperty("Brightness");
      if (lighting.hasProperty("Technology")) out.lightingTechnology = lighting.getProperty("Technology");
      if (lighting.hasProperty("GlobalShadows")) out.globalShadows = lighting.getProperty("GlobalShadows");
      const fc = readColor(lighting, "FogColor");
      if (fc) out.fogColor = fc;
      if (lighting.hasProperty("FogStart")) out.fogStart = lighting.getProperty("FogStart");
      if (lighting.hasProperty("FogEnd")) out.fogEnd = lighting.getProperty("FogEnd");
    }
    if (ws && ws.hasProperty("Gravity")) out.gravity = ws.getProperty("Gravity");
    if (sp) {
      if (sp.hasProperty("CharacterWalkSpeed")) out.walkSpeed = sp.getProperty("CharacterWalkSpeed");
      if (sp.hasProperty("CharacterJumpPower")) out.jumpPower = sp.getProperty("CharacterJumpPower");
    }
    return out;
  }


  _readPlayersFromDataModel() {
    const dm = this._dm();
    if (!dm) return null;
    const players = getService(dm, "Players");
    if (!players) return null;
    const out = {};
    if (players.hasProperty("MaxPlayers")) out.maxPlayers = players.getProperty("MaxPlayers");
    if (players.hasProperty("RespawnTime")) out.respawnTime = players.getProperty("RespawnTime");
    return out;
  }


  _applyPlayersFields(dm, gs) {
    const players = getService(dm, "Players");
    if (!players) return;
    if (gs.general && isFiniteNumber(gs.general.maxPlayers) && players.hasProperty("MaxPlayers")) {
      if (typeof players._setInternal === "function") players._setInternal("MaxPlayers", gs.general.maxPlayers);
      else players.setProperty("MaxPlayers", gs.general.maxPlayers);
    }
    if (gs.world && isFiniteNumber(gs.world.respawnTime) && players.hasProperty("RespawnTime")) {
      players.setProperty("RespawnTime", gs.world.respawnTime);
    }
  }


  _applyLightingExtras(lighting, gs) {
    if (!lighting) return;
    if (lighting.hasProperty("GlobalShadows")) lighting.setProperty("GlobalShadows", !!gs.world.globalShadows);
    if (lighting.hasProperty("FogColor")) lighting.setProperty("FogColor", makeColor(gs.world.fogColor.r, gs.world.fogColor.g, gs.world.fogColor.b));

    const fogStart = gs.world.fogEnabled ? gs.world.fogStart : 0;
    const fogEnd = gs.world.fogEnabled ? gs.world.fogEnd : 100000;
    if (lighting.hasProperty("FogStart")) lighting.setProperty("FogStart", fogStart);
    if (lighting.hasProperty("FogEnd")) lighting.setProperty("FogEnd", fogEnd);
  }


  _applyToDataModelDirect(gs) {
    const dm = this._dm();
    if (!dm) return;
    const lighting = getService(dm, "Lighting");
    const ws = getService(dm, "Workspace");
    const sp = getService(dm, "StarterPlayer");
    const set = (inst, prop, val) => {
      if (inst && inst.hasProperty(prop)) {
        try {
          inst.setProperty(prop, val);
        } catch (e) {
          logger.warn("Project: não aplicou " + prop + ": " + (e && e.message));
        }
      }
    };
    if (lighting) {
      set(lighting, "Ambient", makeColor(gs.world.ambient.r, gs.world.ambient.g, gs.world.ambient.b));
      set(lighting, "OutdoorAmbient", makeColor(gs.world.outdoorAmbient.r, gs.world.outdoorAmbient.g, gs.world.outdoorAmbient.b));
      set(lighting, "Brightness", gs.world.brightness);
      set(lighting, "Technology", gs.world.lightingTechnology);
      try { this._applyLightingExtras(lighting, gs); } catch (e) { logger.warn("Project: lighting extras: " + (e && e.message)); }
    }
    if (ws) set(ws, "Gravity", gs.world.gravity);
    if (sp) {
      set(sp, "CharacterWalkSpeed", gs.world.walkSpeed);
      set(sp, "CharacterJumpPower", gs.world.jumpPower);
    }
    try { this._applyPlayersFields(dm, gs); } catch (e) { logger.warn("Project: players fields: " + (e && e.message)); }
  }


  _buildApplyCommand(gs) {
    const dm = this._dm();
    if (!dm) return null;
    const lighting = getService(dm, "Lighting");
    const ws = getService(dm, "Workspace");
    const sp = getService(dm, "StarterPlayer");
    const ops = [];
    const add = (inst, prop, val) => {
      if (inst && inst.hasProperty(prop)) {
        ops.push({ inst, prop, val, old: inst.getProperty(prop) });
      }
    };
    if (lighting) {
      add(lighting, "Ambient", makeColor(gs.world.ambient.r, gs.world.ambient.g, gs.world.ambient.b));
      add(lighting, "OutdoorAmbient", makeColor(gs.world.outdoorAmbient.r, gs.world.outdoorAmbient.g, gs.world.outdoorAmbient.b));
      add(lighting, "Brightness", gs.world.brightness);
      add(lighting, "Technology", gs.world.lightingTechnology);
      add(lighting, "GlobalShadows", !!gs.world.globalShadows);
      add(lighting, "FogColor", makeColor(gs.world.fogColor.r, gs.world.fogColor.g, gs.world.fogColor.b));
      add(lighting, "FogStart", gs.world.fogEnabled ? gs.world.fogStart : 0);
      add(lighting, "FogEnd", gs.world.fogEnabled ? gs.world.fogEnd : 100000);
    }
    if (ws) add(ws, "Gravity", gs.world.gravity);
    if (sp) {
      add(sp, "CharacterWalkSpeed", gs.world.walkSpeed);
      add(sp, "CharacterJumpPower", gs.world.jumpPower);
    }
    const players = getService(dm, "Players");
    if (players && players.hasProperty("RespawnTime")) add(players, "RespawnTime", gs.world.respawnTime);


    if (players && players.hasProperty("MaxPlayers") && gs.general && isFiniteNumber(gs.general.maxPlayers)) {
      const applyMax = (v) =>
        typeof players._setInternal === "function"
          ? players._setInternal("MaxPlayers", v) !== false
          : players.setProperty("MaxPlayers", v) !== false;
      ops.push({ inst: players, prop: "MaxPlayers", val: gs.general.maxPlayers, old: players.getProperty("MaxPlayers"), set: applyMax });
    }
    if (!ops.length) return null;
    return {
      name: "Game Settings",
      do() {
        for (const o of ops) (o.set ? o.set(o.val) : o.inst.setProperty(o.prop, o.val));
        return true;
      },
      undo() {
        for (const o of ops) (o.set ? o.set(o.old) : o.inst.setProperty(o.prop, o.old));
        return true;
      },
    };
  }


  applySettings(input) {
    const clean = sanitizeGameSettings(input);
    this._settings = clean;


    this._suppress = true;
    try {
      const cmd = this._buildApplyCommand(clean);
      if (cmd) commands.execute(cmd);
    } catch (e) {
      logger.warn("Project: falha ao aplicar Game Settings: " + (e && e.message));
    }
    this._suppress = false;

    this._persist();
    this.markDirty();
    this._emit();
    logger.info("Game settings updated.", { source: "Studio" });
    setStatus("Settings saved successfully");
    return clean;
  }

  resetSettings() {
    return this.applySettings(defaultGameSettings());
  }


  beginBulkLoad() {
    this._suppress = true;
  }
  endBulkLoad() {
    this._suppress = false;
  }


  loadSettingsDirect(gs, nameOverride) {
    const clean = sanitizeGameSettings(gs || {});
    if (isString(nameOverride)) {


      const n = sanitizeName(nameOverride, "").slice(0, TEXT_LIMITS.name);
      if (n) clean.general.name = n;
    }
    this._settings = clean;
    const wasSuppressed = this._suppress;
    this._suppress = true;
    try {
      this._applyToDataModelDirect(clean);
    } catch (e) {
      logger.warn("Project: falha ao aplicar configurações carregadas: " + (e && e.message));
    }
    this._suppress = wasSuppressed;
    this._persist();
    this._emit();
    return clean;
  }


  save() {
    this._persist();
    this.markClean();
    logger.info("Game saved successfully (" + this.getName() + ").", { source: "Studio" });
    setStatus("Game saved successfully");
    return true;
  }

  saveAs(rawName) {


    const clean = sanitizeName(isString(rawName) ? rawName : "", "").slice(0, TEXT_LIMITS.name);
    const name = clean || this.getName();
    this._settings.general.name = name;
    this.save();
    return name;
  }

  setName(rawName) {

    const name = sanitizeName(isString(rawName) ? rawName : "", "").slice(0, TEXT_LIMITS.name);
    if (!name) return this.getName();
    this._settings.general.name = name;
    this._emit();
    return name;
  }

  setDescription(rawDesc) {


    this._settings.general.description = sanitizeFreeText(rawDesc, TEXT_LIMITS.description);
    return this._settings.general.description;
  }


  newPlace() {
    if (this._running) {
      try {
        engine.stop();
      } catch (_) {

      }
    }
    const dm = this._dm();
    this._suppress = true;
    try {
      if (dm) {
        const services = dm.getChildren ? dm.getChildren() : [];
        for (const svc of services) {
          const kids = svc.getChildren ? svc.getChildren() : [];
          for (const k of kids.slice()) {


            if (k && k._locked === true) continue;
            try {
              k.destroy();
            } catch (_) {

            }
          }
        }
        this._repopulateWorkspace(dm);
      }
      this._settings = defaultGameSettings();
      this._applyToDataModelDirect(this._settings);
    } catch (e) {
      logger.error("Project: falha ao criar novo lugar: " + (e && e.message), { source: "Studio" });
    }
    this._suppress = false;

    try {
      selection.clear();
    } catch (_) {

    }
    try {
      if (typeof commands.clear === "function") commands.clear();
    } catch (_) {

    }

    this.markClean();
    this._emit();
    logger.info("New place created.", { source: "Studio" });
    setStatus("New place created");
  }

  _repopulateWorkspace(dm) {
    const ws = getService(dm, "Workspace");
    if (!ws) return;


    const hasClass = (parent, className) =>
      parent.getChildren().some((c) => c && c.className === className);
    try {
      if (!hasClass(ws, "Camera")) createInstance("Camera", { name: "Camera", parent: ws });
    } catch (_) {

    }
    try {
      if (!hasClass(ws, "Terrain")) createInstance("Terrain", { name: "Terrain", parent: ws });
    } catch (_) {

    }
    try {
      const base = createInstance("Part", { name: "Baseplate", parent: ws });
      if (base && base.hasProperty("Size")) base.setProperty("Size", makeVector3(512, 20, 512));
      if (base && base.hasProperty("Anchored")) base.setProperty("Anchored", true);
      if (base && base.hasProperty("Position")) base.setProperty("Position", makeVector3(0, -10, 0));


      if (base && base.hasProperty("Color")) base.setProperty("Color", makeColor(0.41, 0.45, 0.42));
      if (base && base.hasProperty("Material")) base.setProperty("Material", "Concrete");
    } catch (_) {

    }


    const sp = getService(dm, "StarterPlayer");
    if (sp) {
      try {
        if (!hasClass(sp, "StarterPlayerScripts")) {
          createInstance("StarterPlayerScripts", { name: "StarterPlayerScripts", parent: sp });
        }
        if (!hasClass(sp, "StarterCharacterScripts")) {
          createInstance("StarterCharacterScripts", { name: "StarterCharacterScripts", parent: sp });
        }
      } catch (_) {

      }
    }
  }


  markDirty() {
    if (this._dirty) return;
    this._dirty = true;
    this._emit();
  }
  markClean() {
    if (!this._dirty) {
      this._emit();
      return;
    }
    this._dirty = false;
    this._emit();
  }

  _persist() {
    try {
      writeJSON(PROJECT_KEY, { version: 1, settings: this._settings });
    } catch (e) {
      logger.warn("Project: não foi possível persistir: " + (e && e.message));
    }
  }

  _emit() {
    bus.emit("project:changed", { name: this.getName(), dirty: this._dirty });
  }
}

export const project = new ProjectManager();
export { setStatus };

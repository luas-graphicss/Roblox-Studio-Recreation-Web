import { bus } from "../core/eventBus.js";
import { deepCloneJsonValue } from "../core/deepCloneJsonValue.js";
import { readJSON, writeJSON } from "../utils/storage.js";
import { isBoolean, isOneOf, isFiniteNumber, isPlainObject } from "../utils/validate.js";
import { isAcceptableAiEndpointSetting } from "../ai/endpointPolicy.js";
import {
  SETTINGS_KEY,
  DEFAULT_SETTINGS,
  SUPPORTED_THEMES,
  SUPPORTED_LANGUAGES,
  CAMERA_SPEED_RANGE,
  MIN_PANEL_SIZE,
  MAX_PANEL_SIZE,
  LAYOUT_REQUIRED_SIZE_FIELDS,
  LAYOUT_OPTIONAL_SIZE_FIELDS,
  LAYOUT_REQUIRED_PANEL_FIELDS,
  LAYOUT_OPTIONAL_PANEL_FIELDS,
  RENDER_QUALITIES,
  EDITOR_THEMES,
  GRID_SIZE_RANGE,
  CAMERA_SENSITIVITY_RANGE,
  PHYSICS_THROTTLE_RANGE,
  MAX_CUSTOM_KEYBINDINGS_STORED,
  ROBUX_BALANCE_RANGE,
  AI_PROVIDER_IDS,
  AI_MAX_TOKENS_RANGE,
  AI_RATE_LIMIT_RANGE,
  AI_TEMPERATURE_RANGE,
  SNAP_RANGE,
  EDITOR_FONT_RANGE,
  EDITOR_TAB_RANGE,
  AUTOSAVE_INTERVAL_RANGE,
  LOADING_SCREEN_SEC_RANGE,
} from "./defaults.js";


const LUAU_TYPE_DEFAULTS = Object.freeze({
  luauTypeChecking: true,                                                
  luauStrictByDefault: false,                                              
});


export const TERRAIN_IMPORT_MAX_VOXELS_RANGE = Object.freeze({ min: 100000, max: 400000000 });
const TERRAIN_IMPORT_DEFAULTS = Object.freeze({
  terrainImportMaxVoxels: 40000000,
});
export const SETTINGS_DEFAULTS = Object.freeze({ ...DEFAULT_SETTINGS, ...LUAU_TYPE_DEFAULTS, ...TERRAIN_IMPORT_DEFAULTS });


function stableStringify(v) {
  if (v == null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + stableStringify(v[k]))
      .join(",") +
    "}"
  );
}


function deepEquals(a, b) {
  if (Object.is(a, b)) return true;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
  return stableStringify(a) === stableStringify(b);
}

function inRange(value, range) {
  return isFiniteNumber(value) && value >= range.min && value <= range.max;
}


function intField(value, range) {
  return inRange(value, range)
    ? { valid: true, value: Math.round(value) }
    : { valid: false, value };
}


const FORBIDDEN_MAP_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);


function isValidLayout(v) {
  if (!isPlainObject(v) || !isPlainObject(v.panels)) return false;
  const okNum = (n) => isFiniteNumber(n) && n >= MIN_PANEL_SIZE && n <= MAX_PANEL_SIZE;
  for (const k of LAYOUT_REQUIRED_SIZE_FIELDS) {
    if (!okNum(v[k])) return false;
  }


  for (const k of LAYOUT_OPTIONAL_SIZE_FIELDS) {
    if (v[k] != null && !okNum(v[k])) return false;
  }
  const p = v.panels;
  for (const k of LAYOUT_REQUIRED_PANEL_FIELDS) {
    if (!isBoolean(p[k])) return false;
  }
  for (const k of LAYOUT_OPTIONAL_PANEL_FIELDS) {
    if (p[k] != null && !isBoolean(p[k])) return false;
  }
  return true;
}


function normalizeLayout(v) {
  const out = {};
  for (const k of LAYOUT_REQUIRED_SIZE_FIELDS) out[k] = v[k];
  for (const k of LAYOUT_OPTIONAL_SIZE_FIELDS) {
    if (v[k] != null) out[k] = v[k];
  }
  const panels = {};
  for (const k of LAYOUT_REQUIRED_PANEL_FIELDS) panels[k] = v.panels[k];
  for (const k of LAYOUT_OPTIONAL_PANEL_FIELDS) {
    if (v.panels[k] != null) panels[k] = v.panels[k];
  }
  out.panels = panels;
  return out;
}


function isValidKeybindingsMap(v) {
  if (!isPlainObject(v)) return false;
  const entries = Object.entries(v);
  if (entries.length > MAX_CUSTOM_KEYBINDINGS_STORED) return false;
  for (const [key, val] of entries) {
    if (typeof key !== "string" || key.length === 0 || key.length > 128) return false;
    if (typeof val !== "string" || val.length > 64) return false;
  }
  return true;
}


function normalizeKeybindings(v) {
  const out = {};
  for (const [key, val] of Object.entries(v)) {
    if (FORBIDDEN_MAP_KEYS.includes(key)) continue;
    out[key] = val;
  }
  return out;
}


function validateField(key, value) {
  switch (key) {
    case "theme":
      return { valid: isOneOf(value, SUPPORTED_THEMES), value };
    case "language":
      return { valid: isOneOf(value, SUPPORTED_LANGUAGES), value };
    case "autosave":
    case "gridVisible":
    case "moveSnapEnabled":
    case "rotateSnapEnabled":
    case "editorWordWrap":
    case "editorMinimap":
    case "physicsShowWireframe":
    case "physicsShowVelocities":
    case "physicsShowContacts":
    case "physicsShowCenterOfMass":
    case "physicsShowJoints":
    case "tooltipsEnabled":
    case "showAxisIndicator":
    case "editorLineNumbers":
    case "cameraSmoothing":
    case "cameraInvertY":
    case "tcAutoFollow":
    case "tcNotifications":
    case "persistRobuxBalance":
    case "editorCodeAssist":
    case "aiEnabled":
    case "aiSendContext":
    case "luauTypeChecking":             
    case "luauStrictByDefault":             
      return { valid: isBoolean(value), value };
    case "robuxDefaultBalance":
      return intField(value, ROBUX_BALANCE_RANGE);                          
    case "terrainImportMaxVoxels":                                                     
      return intField(value, TERRAIN_IMPORT_MAX_VOXELS_RANGE);
    case "tcUserColor":
      return { valid: typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value), value };
    case "loadingScreenMinSec":            
      return { valid: inRange(value, LOADING_SCREEN_SEC_RANGE), value };
    case "renderQuality":
      return { valid: isOneOf(value, RENDER_QUALITIES), value };
    case "editorTheme":
      return { valid: isOneOf(value, EDITOR_THEMES), value };
    case "gridSize":
      return { valid: inRange(value, GRID_SIZE_RANGE), value };
    case "cameraSensitivity":
      return { valid: inRange(value, CAMERA_SENSITIVITY_RANGE), value };
    case "physicsThrottle":
      return { valid: inRange(value, PHYSICS_THROTTLE_RANGE), value };
    case "keybindings":
      return isValidKeybindingsMap(value)
        ? { valid: true, value: normalizeKeybindings(value) }
        : { valid: false, value };
    case "editorFontSize":
      return intField(value, EDITOR_FONT_RANGE);
    case "editorTabSize":
      return intField(value, EDITOR_TAB_RANGE);
    case "autosaveIntervalMin":                                              
      return { valid: inRange(value, AUTOSAVE_INTERVAL_RANGE), value };
    case "moveSnap":
    case "rotateSnap":
      return { valid: inRange(value, SNAP_RANGE), value };
    case "cameraSpeed":
      return { valid: inRange(value, CAMERA_SPEED_RANGE), value };
    case "layout":
      return isValidLayout(value)
        ? { valid: true, value: normalizeLayout(value) }
        : { valid: false, value };
    case "aiProvider":
      return { valid: isOneOf(value, AI_PROVIDER_IDS), value };


    case "aiEndpoint":
      return { valid: isAcceptableAiEndpointSetting(value), value };
    case "aiModel":
      return { valid: typeof value === "string" && value.length <= 128, value };
    case "aiSystemPrompt":
      return { valid: typeof value === "string" && value.length <= 8000, value };
    case "aiMaxTokens":
      return intField(value, AI_MAX_TOKENS_RANGE);
    case "aiTemperature":
      return { valid: inRange(value, AI_TEMPERATURE_RANGE), value };
    case "aiRateLimit":
      return intField(value, AI_RATE_LIMIT_RANGE);
    default:
      return { valid: false, value };
  }
}


export function validateSettingField(key, value) {
  return validateField(key, value);
}


function sanitize(raw) {
  const d = SETTINGS_DEFAULTS;
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of Object.keys(d)) {
    const { valid, value } = validateField(key, source[key]);
    out[key] = deepCloneJsonValue(valid ? value : d[key]);
  }
  return out;
}


export function sanitizeSettings(raw) {
  return sanitize(raw);
}

class Settings {
  constructor() {
    this._values = sanitize(null);                                               
    this._loaded = false;
    this._warnedNotDurable = false;                                           


    this._warnedUnknownGet = new Set();
  }

  load() {
    const stored = readJSON(SETTINGS_KEY);                                 
    this._values = sanitize(stored);
    this._loaded = true;
    this._persist();                                                   
    return this.all();
  }


  all() {
    return deepCloneJsonValue(this._values);
  }


  get(key) {
    if (!Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, key)) {
      if (!this._warnedUnknownGet.has(key) && this._warnedUnknownGet.size < 64) {
        this._warnedUnknownGet.add(key);
        console.warn(`[RSW] Configuração desconhecida lida: "${String(key)}"`);
      }
      return undefined;
    }
    return deepCloneJsonValue(this._values[key]);
  }

  set(key, value) {


    if (!Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, key)) {

      console.warn(`[RSW] Configuração desconhecida ignorada: "${String(key)}"`);
      return false;
    }
    const { valid, value: normalized } = validateField(key, value);
    if (!valid) {

      console.warn(`[RSW] Valor inválido para "${key}" ignorado.`);
      return false;
    }
    if (deepEquals(normalized, this._values[key])) return false;                    
    const prev = this._values[key];
    this._values = { ...this._values, [key]: deepCloneJsonValue(normalized) };
    this._persist();
    bus.emit("settings:changed", { key, value: deepCloneJsonValue(normalized), prev });
    return true;
  }







  reset() {
    const prev = this._values;
    this._values = sanitize(null);
    this._persist();
    for (const key of Object.keys(this._values)) {
      if (!deepEquals(prev[key], this._values[key])) {
        bus.emit("settings:changed", {
          key,
          value: deepCloneJsonValue(this._values[key]),
          prev: prev[key],
        });
      }
    }
    bus.emit("settings:reset", this.all());
    return this.all();
  }

  _persist() {


    const durable = writeJSON(SETTINGS_KEY, this._values);
    if (!durable && !this._warnedNotDurable) {
      this._warnedNotDurable = true;
      console.warn(
        "[RSW] Configurações não estão persistindo no localStorage; mudanças valem só nesta sessão.",
      );
    }
  }
}

export const settings = new Settings();


for (const _key of Object.keys(SETTINGS_DEFAULTS)) {
  const _r = validateField(_key, SETTINGS_DEFAULTS[_key]);
  if (!_r.valid) {
    console.error(
      `[RSW] Padrão INVÁLIDO no próprio domínio: "${_key}" — corrija config/defaults.js|settings.js.`,
    );
  } else if (!deepEquals(_r.value, SETTINGS_DEFAULTS[_key])) {
    console.error(
      `[RSW] Padrão NÃO-normalizado: "${_key}" — o padrão deve ser igual à própria forma normalizada.`,
    );
  }
}

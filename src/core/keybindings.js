import { bus } from "./eventBus.js";
import { logger } from "./logger.js";
import { settings } from "../config/settings.js";

export const KEYBINDING_LAYERS = Object.freeze({
  global: 10,
  plugin: 20,
  playtest: 30,
  viewport: 40,
  scriptEditor: 50,
  dialog: 60,
});

export const MAX_CUSTOM_KEYBINDINGS = 200;


export const PROTECTED_TYPING_COMBOS = Object.freeze(["Ctrl+C", "Ctrl+V", "Ctrl+X"]);


const TYPING_NATIVE_COMBOS = new Set(["Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z", "Ctrl+A"]);


export const MONACO_RESERVED_COMBOS = Object.freeze(new Set([
  "Ctrl+D", "Ctrl+F", "Ctrl+H", "Ctrl+G", "Ctrl+L", "Ctrl+/",
  "Ctrl+[", "Ctrl+]", "Ctrl+Space", "Ctrl+Enter", "Ctrl+Shift+Enter",
  "Ctrl+Shift+K", "Ctrl+Shift+L", "Alt+ArrowUp", "Alt+ArrowDown",
  "Shift+Alt+ArrowUp", "Shift+Alt+ArrowDown", "Shift+Alt+F", "Ctrl+U",
]));

const MODIFIER_KEYS = new Set(["control", "ctrl", "shift", "alt", "meta", "altgraph", "os"]);

const KEY_ALIASES = new Map([
  ["esc", "Escape"], ["escape", "Escape"],
  ["del", "Delete"], ["delete", "Delete"],
  ["backspace", "Backspace"],
  ["space", "Space"], [" ", "Space"], ["spacebar", "Space"],
  ["tab", "Tab"], ["enter", "Enter"], ["return", "Enter"],
  ["up", "ArrowUp"], ["down", "ArrowDown"], ["left", "ArrowLeft"], ["right", "ArrowRight"],
  ["arrowup", "ArrowUp"], ["arrowdown", "ArrowDown"], ["arrowleft", "ArrowLeft"], ["arrowright", "ArrowRight"],
  ["comma", ","], ["plus", "+"], ["minus", "-"], ["slash", "/"],
]);

function canonicalKey(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const low = raw.toLowerCase();
  if (MODIFIER_KEYS.has(low)) return null;
  if (KEY_ALIASES.has(low)) return KEY_ALIASES.get(low);
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(low)) return low.toUpperCase();
  if (/^numpad\d$/.test(low)) return "Numpad" + low.slice(6);
  if (raw.length === 1) return raw.toUpperCase();
  return raw[0].toUpperCase() + raw.slice(1);
}



export function normalizeCombo(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 64) return null;
  const parts = raw.split("+").map((p) => p.trim()).filter((p) => p.length > 0);
  if (!parts.length) return null;
  let ctrl = false, shift = false, alt = false, meta = false;
  let key = null;
  for (const part of parts) {
    const low = part.toLowerCase();
    if (low === "ctrl" || low === "control") ctrl = true;
    else if (low === "shift") shift = true;
    else if (low === "alt") alt = true;
    else if (low === "meta" || low === "cmd" || low === "command") meta = true;
    else {
      const k = canonicalKey(part);
      if (!k || key) return null;
      key = k;
    }
  }
  if (!key) return null;
  const out = [];
  if (ctrl) out.push("Ctrl");
  if (meta) out.push("Meta");
  if (alt) out.push("Alt");
  if (shift) out.push("Shift");
  out.push(key);
  return out.join("+");
}

export function isValidCombo(raw) {
  return normalizeCombo(raw) !== null;
}


export function comboFromEvent(e) {
  if (!e || typeof e.key !== "string") return null;
  const low = e.key.toLowerCase();
  if (MODIFIER_KEYS.has(low) || low === "dead") return null;
  const code = typeof e.code === "string" ? e.code : "";
  let key = null;
  if (/^Numpad[0-9]$/.test(code)) key = code;
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else key = canonicalKey(e.key);
  if (!key) return null;
  const out = [];
  if (e.ctrlKey) out.push("Ctrl");
  if (e.metaKey) out.push("Meta");
  if (e.altKey) out.push("Alt");
  if (e.shiftKey) out.push("Shift");
  out.push(key);
  return out.join("+");
}


export function isTypingTarget(node) {
  if (!node || node.nodeType !== 1) return false;
  const tag = (node.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (node.isContentEditable === true) return true;
  if (typeof node.closest === "function" && node.closest(".monaco-editor")) return true;
  return false;
}


export function isMonacoTarget(node) {
  return !!(
    node &&
    node.nodeType === 1 &&
    typeof node.closest === "function" &&
    node.closest(".monaco-editor")
  );
}


function blockedWhileTyping(combo, e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const key = combo.split("+").pop();
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return false;
  if (key === "Escape") return false;
  return true;
}

function safeBool(fn) {
  try { return fn() !== false; } catch (_e) { return false; }
}

export class KeybindingManager {
  constructor() {
    this._actions = new Map();                   
    this._custom = new Map();                                 
    this._byCombo = new Map();                                  
    this._comboOf = new Map();                                
    this._providers = {
      isDialogOpen: () => false,
      isViewportActive: () => true,
      isScriptEditorActive: () => false,
      isPlaytestRunning: () => false,
    };
    this._capture = null;
    this._target = null;
    this._onKey = this._onKey.bind(this);
    this._onCaptureKey = this._onCaptureKey.bind(this);
  }

  setContextProviders(p) {
    this._providers = { ...this._providers, ...(p || {}) };
  }

  register(def) {
    if (!def || typeof def.id !== "string" || !def.id || def.id.length > 128) return false;
    if (typeof def.run !== "function") return false;
    if (this._actions.has(def.id)) return false;
    let combo = null;
    if (def.combo != null) {
      combo = normalizeCombo(def.combo);
      if (!combo) return false;
    }
    const layer = KEYBINDING_LAYERS[def.layer] != null ? def.layer : "global";
    this._actions.set(def.id, {
      id: def.id,
      label: typeof def.label === "string" && def.label ? def.label : def.id,
      category: typeof def.category === "string" && def.category ? def.category : "Other",
      defaultCombo: combo,
      run: def.run,
      layer,
      enabled: typeof def.enabled === "function" ? def.enabled : null,
      skipWhenTyping: def.skipWhenTyping === true,
      plugin: def.plugin === true,
    });
    this._reindex(def.id);
    return true;
  }


  registerPluginShortcut(def) {
    if (!def) return false;
    const combo = normalizeCombo(def.combo);
    if (!combo) return false;
    const owners = this._byCombo.get(combo);
    if (owners) {
      for (const id of owners) {
        const owner = this._actions.get(id);
        if (owner && !owner.plugin) {
          logger.warn(
            `[Keybindings] Plugin "${def.id}" conflita com o atalho core "${owner.id}" (${combo}); registro ignorado.`,
          );
          return false;
        }
      }
    }
    return this.register({ ...def, combo, layer: "plugin", plugin: true });
  }

  unregister(id) {
    if (!this._actions.has(id)) return false;
    this._actions.delete(id);
    const prev = this._comboOf.get(id);
    if (prev) {
      const s = this._byCombo.get(prev);
      if (s) { s.delete(id); if (!s.size) this._byCombo.delete(prev); }
      this._comboOf.delete(id);
    }
    return true;
  }

  has(id) {
    return this._actions.has(id);
  }

  effectiveCombo(id) {
    const a = this._actions.get(id);
    if (!a) return null;
    if (this._custom.has(id)) {
      const c = this._custom.get(id);
      return c ? c : null;
    }
    return a.defaultCombo;
  }

  isCustomized(id) {
    return this._custom.has(id);
  }

  customCount() {
    return this._custom.size;
  }

  conflictsOf(rawCombo, excludeId) {
    const combo = normalizeCombo(rawCombo);
    if (!combo) return [];
    const s = this._byCombo.get(combo);
    if (!s) return [];
    const out = [];
    for (const id of s) {
      if (id === excludeId) continue;
      const a = this._actions.get(id);
      if (a) out.push({ id: a.id, label: a.label });
    }
    return out;
  }

  setCustom(id, rawCombo, opts) {
    const a = this._actions.get(id);
    if (!a) return { ok: false, error: "unknown-action" };
    let value;
    if (rawCombo == null || rawCombo === "") {
      value = "";              
    } else {
      const combo = normalizeCombo(rawCombo);
      if (!combo) return { ok: false, error: "invalid-combo" };
      value = combo;
    }
    if (!this._custom.has(id) && this._custom.size >= MAX_CUSTOM_KEYBINDINGS) {
      return { ok: false, error: "limit" };
    }
    this._custom.set(id, value);
    this._reindex(id);
    if (!opts || opts.persist !== false) this._persist();
    bus.emit("keybindings:changed", { id, combo: value || null });
    return { ok: true };
  }

  resetCustom(id) {
    if (!this._actions.has(id)) return { ok: false, error: "unknown-action" };
    if (this._custom.has(id)) {
      this._custom.delete(id);
      this._reindex(id);
      this._persist();
      bus.emit("keybindings:changed", { id, combo: this.effectiveCombo(id) });
    }
    return { ok: true };
  }

  resetAllCustom() {
    if (!this._custom.size) return;
    const ids = [...this._custom.keys()];
    this._custom.clear();
    for (const id of ids) this._reindex(id);
    this._persist();
    bus.emit("keybindings:changed", { id: null, combo: null });
  }

  list() {
    const out = [];
    for (const a of this._actions.values()) {
      out.push({
        id: a.id,
        label: a.label,
        category: a.category,
        layer: a.layer,
        defaultCombo: a.defaultCombo,
        combo: this.effectiveCombo(a.id),
        customized: this._custom.has(a.id),
        plugin: a.plugin,
      });
    }
    return out;
  }


  loadFromSettings() {
    const raw = settings.get("keybindings");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    let count = 0;
    for (const [id, combo] of Object.entries(raw)) {
      if (count >= MAX_CUSTOM_KEYBINDINGS) break;
      if (!this._actions.has(id)) continue;
      if (combo === "") {
        this._custom.set(id, "");
        this._reindex(id);
        count += 1;
        continue;
      }
      const norm = typeof combo === "string" ? normalizeCombo(combo) : null;
      if (!norm) continue;
      this._custom.set(id, norm);
      this._reindex(id);
      count += 1;
    }
  }

  _persist() {
    const map = {};
    for (const [id, combo] of this._custom) map[id] = combo;
    settings.set("keybindings", map);
  }

  _reindex(id) {
    const prev = this._comboOf.get(id);
    if (prev) {
      const s = this._byCombo.get(prev);
      if (s) { s.delete(id); if (!s.size) this._byCombo.delete(prev); }
      this._comboOf.delete(id);
    }
    const combo = this.effectiveCombo(id);
    if (combo) {
      let s = this._byCombo.get(combo);
      if (!s) { s = new Set(); this._byCombo.set(combo, s); }
      s.add(id);
      this._comboOf.set(id, combo);
    }
  }


  beginCapture(onDone) {
    this.cancelCapture();
    const t = this._target || (typeof document !== "undefined" ? document : null);
    if (!t) return;
    this._capture = { onDone: typeof onDone === "function" ? onDone : () => {}, target: t };
    t.addEventListener("keydown", this._onCaptureKey, true);
  }

  cancelCapture() {
    this._endCapture(null);
  }

  isCapturing() {
    return !!this._capture;
  }

  _endCapture(result) {
    const c = this._capture;
    if (!c) return;
    this._capture = null;
    c.target.removeEventListener("keydown", this._onCaptureKey, true);
    try { c.onDone(result); } catch (_e) {            }
  }

  _onCaptureKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      this._endCapture(null);
      return;
    }
    const low = typeof e.key === "string" ? e.key.toLowerCase() : "";
    if (MODIFIER_KEYS.has(low)) return;                             
    const combo = comboFromEvent(e);
    if (combo) this._endCapture(combo);
  }


  _layerActive(layer) {
    const p = this._providers;
    switch (layer) {
      case "dialog": return !!p.isDialogOpen();
      case "scriptEditor": return !p.isDialogOpen() && !!p.isScriptEditorActive();
      case "viewport": return !p.isDialogOpen() && !!p.isViewportActive();
      case "playtest": return !!p.isPlaytestRunning();
      case "plugin": return !p.isDialogOpen();
      case "global": return true;
      default: return false;
    }
  }

  _onKey(e) {
    if (this._capture) return;                                               
    if (e.defaultPrevented) return;                                       
    const combo = comboFromEvent(e);
    if (!combo) return;
    const ids = this._byCombo.get(combo);
    if (!ids || !ids.size) return;
    const typing = isTypingTarget(e.target);
    const inMonaco = typing && isMonacoTarget(e.target);
    if (typing) {
      if (PROTECTED_TYPING_COMBOS.includes(combo)) return;                  
      if (TYPING_NATIVE_COMBOS.has(combo)) return;
      if (blockedWhileTyping(combo, e)) return;
    }
    const monacoReserved = inMonaco && MONACO_RESERVED_COMBOS.has(combo);
    const dialogOpen = !!this._providers.isDialogOpen();
    let best = null;
    for (const id of ids) {
      const a = this._actions.get(id);
      if (!a) continue;
      if (dialogOpen && a.layer !== "dialog") continue;
      if (monacoReserved && a.layer !== "scriptEditor") continue;
      if (!this._layerActive(a.layer)) continue;
      if (typing && a.skipWhenTyping) continue;
      if (a.enabled && !safeBool(a.enabled)) continue;
      const pr = KEYBINDING_LAYERS[a.layer] || 0;
      if (!best || pr > best.pr) best = { a, pr };
    }
    if (!best) return;
    e.preventDefault();
    try {
      best.a.run(e);
    } catch (err) {
      logger.warn(`[Keybindings] Ação "${best.a.id}" falhou: ${err && err.message}`);
    }
  }

  init(target) {
    if (this._target) return;
    this._target = target || (typeof document !== "undefined" ? document : null);
    if (this._target) this._target.addEventListener("keydown", this._onKey, false);
  }

  dispose() {
    this.cancelCapture();
    if (this._target) {
      this._target.removeEventListener("keydown", this._onKey, false);
      this._target = null;
    }
  }
}

export const keybindings = new KeybindingManager();

export function initKeybindings(target) {
  keybindings.init(target || (typeof document !== "undefined" ? document : null));
  return keybindings;
}

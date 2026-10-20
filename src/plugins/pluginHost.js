import { bus } from "../core/eventBus.js";

import { deepCloneJsonValue } from "../core/deepCloneJsonValue.js";
import { logger } from "../core/logger.js";
import { store } from "../core/state.js";
import { selection } from "../core/selection.js";
import { commands } from "../core/commands.js";
import { readJSON, writeJSON, remove } from "../utils/storage.js";
import { isInlineSvgSource, parseSvgIconSafely, MAX_SVG_ICON_LENGTH } from "./svgIconSanitizer.js";
import { createInstance, getService, makeColor, makeVector3 } from "../datamodel/index.js";
import { createDockWidget, clearPluginWidgetLayout } from "./dockWidgets.js";
import { BUILTIN_PLUGIN_METAS, getBuiltinInit } from "./builtinPlugins.js";
import { MARKETPLACE_PLUGINS } from "./marketplaceData.js";
import { NotificationService } from "../services/notifications.js";            

export const MAX_PLUGINS = 50;
export const MAX_WIDGETS_PER_PLUGIN = 5;
const MAX_TOOLBARS_PER_PLUGIN = 6;
const MAX_BUTTONS_PER_TOOLBAR = 12;
const MAX_MENUS_PER_PLUGIN = 4;
const MAX_MENU_ITEMS_PER_MENU = 12;
const MAX_SAME_ERROR = 10;                                                 
const SLOW_LIMIT_MS = 1500;                                                       
const MAX_SETTING_KEYS = 64;
const STR_MAX = 120;
const STORE_KEY = "plugins.installed";
const SETTINGS_PREFIX = "plugins.settings.";
const REMOVED_BUILTINS_KEY = "plugins.removedBuiltins";                                                      


let historyCore = null;
const historyWaypoints = [];

function getHistoryCore() {
  if (historyCore) return historyCore;
  const undoHandlers = new Set();
  const redoHandlers = new Set();
  const lastWaypointName = () =>
    (historyWaypoints.length ? historyWaypoints[historyWaypoints.length - 1].name : "");
  bus.on("command:undo", (p) => {



    const label = (p && p.name) || lastWaypointName() || "";
    for (const fn of [...undoHandlers]) {
      try { fn(label); } catch (_) {                                }
    }
  });
  bus.on("command:redo", (p) => {

    const label = (p && p.name) || lastWaypointName() || "";
    for (const fn of [...redoHandlers]) {
      try { fn(label); } catch (_) {                                }
    }
  });
  historyCore = { undoHandlers, redoHandlers };
  return historyCore;
}


function getChangeHistoryService(rt) {
  const core = getHistoryCore();
  const makeEvent = (handlers, label) => ({
    Connect: (fn) => {
      if (typeof fn !== "function") return { Disconnect() {} };
      const wrapped = (name) => guarded(rt, label, fn, [name]);
      handlers.add(wrapped);
      const off = () => handlers.delete(wrapped);
      rt.conns.push(off);
      return { Disconnect: off };
    },
  });
  return {
    SetWaypoint: (name) => {
      historyWaypoints.push({ name: String(name || ""), time: Date.now() });
      if (historyWaypoints.length > 200) historyWaypoints.shift();
      return true;
    },
    ResetWaypoints: () => { historyWaypoints.length = 0; },
    GetWaypoints: () => historyWaypoints.map((w) => ({ ...w })),                                                   
    Undo: () => commands.undo(),
    Redo: () => commands.redo(),
    GetCanUndo: () => commands.canUndo(),
    GetCanRedo: () => commands.canRedo(),
    OnUndo: makeEvent(core.undoHandlers, "ChangeHistory:OnUndo"),
    OnRedo: makeEvent(core.redoHandlers, "ChangeHistory:OnRedo"),
  };
}

function pluginOnlyService(rt, name) {
  if (name === "ChangeHistoryService") return getChangeHistoryService(rt);
  if (name === "Selection") {
    return {
      Get: () => selection.get().slice(),
      Set: (items) => selection.set(Array.isArray(items) ? items : []),
      Add: (items) => {
        const cur = selection.get().slice();
        for (const it of (Array.isArray(items) ? items : [])) {
          if (!cur.includes(it)) cur.push(it);
        }
        selection.set(cur);
      },
      Remove: (items) => {
        const rem = new Set(Array.isArray(items) ? items : []);
        selection.set(selection.get().filter((it) => !rem.has(it)));
      },
      SelectionChanged: rt.selSignal.api,
    };
  }
  if (name === "ScriptEditorService") {
    return {
      FindScriptDocument: (script) => {
        if (!script || typeof script.getProperty !== "function" ||
          typeof script.hasProperty !== "function" || !script.hasProperty("Source")) {
          return null;
        }
        return {
          GetText: () => String(script.getProperty("Source") || ""),
          GetScript: () => script,
          GetLineCount: () => String(script.getProperty("Source") || "").split("\n").length,
        };
      },
    };
  }
  return null;
}


const EVENT_WHITELIST = Object.freeze([
  "selection:changed",
  "theme:changed",
  "history:changed",
  "command:executed",
  "instance:childAdded",
  "instance:childRemoved",
  "instance:destroying",
  "instance:propertyChanged",
  "instance:parentChanged",
]);

let installed = [];                                    
const runtimes = new Map();                                 
const tempInits = new Map();                                                
let initialized = false;


function sStr(v, max) {
  if (typeof v === "string") return v.slice(0, max);
  return v == null ? "" : String(v).slice(0, max);
}


const DEFAULT_PLUGIN_ICON_NAME = "plugin";
const PLUGIN_ICON_INTERNAL_NAME_PATTERN = /^[\w-]{1,32}$/;
const PLUGIN_ICON_DATA_URI_PATTERN = /^data:image\/(png|jpe?g|gif|webp);/i;
const MAX_PLUGIN_ICON_DATA_URI_LENGTH = 4096;
const REMOTE_ICON_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

function sanitizeInlineSvgIcon(rawSvgSource) {
  const sanitizedRoot = parseSvgIconSafely(rawSvgSource, MAX_SVG_ICON_LENGTH);
  if (!sanitizedRoot) return DEFAULT_PLUGIN_ICON_NAME;
  try {
    return new XMLSerializer().serializeToString(sanitizedRoot);
  } catch (_) {
    return DEFAULT_PLUGIN_ICON_NAME;
  }
}


function sanitizeIconValue(rawIconValue) {
  const iconValue = typeof rawIconValue === "string" ? rawIconValue.trim() : "";
  if (!iconValue) return DEFAULT_PLUGIN_ICON_NAME;
  if (PLUGIN_ICON_INTERNAL_NAME_PATTERN.test(iconValue)) return iconValue;            
  if (PLUGIN_ICON_DATA_URI_PATTERN.test(iconValue)) {
    return iconValue.length > MAX_PLUGIN_ICON_DATA_URI_LENGTH
      ? DEFAULT_PLUGIN_ICON_NAME
      : iconValue;
  }
  if (isInlineSvgSource(iconValue)) return sanitizeInlineSvgIcon(iconValue);
  if (REMOTE_ICON_URL_PATTERN.test(iconValue)) {
    logger.warn(
      "[Plugins] \u00cdcone remoto recusado: use um \u00edcone interno, um data: URI ou SVG inline.",
    );
  }
  return DEFAULT_PLUGIN_ICON_NAME;                                    
}

function sanitizeSettingValue(v) {
  if (v == null || typeof v === "boolean" || typeof v === "number") return v;
  if (typeof v === "string") return v.slice(0, 2000);
  try {
    return deepCloneJsonValue(v);
  } catch (_) {
    return null;
  }
}

function sanitizeRecord(meta) {
  const buttons = Array.isArray(meta.buttons)
    ? meta.buttons.slice(0, MAX_BUTTONS_PER_TOOLBAR).map((b) => ({
        id: sStr(b && b.id, 48),
        text: sStr(b && b.text, 24),
        tooltip: sStr(b && b.tooltip, STR_MAX),
        icon: sanitizeIconValue(b && b.icon),
      }))
    : [];
  return {
    id: sStr(meta.id, 80),
    name: sStr(meta.name, 80) || "Plugin",
    creator: sStr(meta.creator, 80) || "Unknown",
    version: sStr(meta.version, 24) || "1.0.0",
    icon: sanitizeIconValue(meta.icon),                                                                              
    category: sStr(meta.category, 24) || "Other",
    hasSettings: !!meta.hasSettings,
    buttons,
    active: meta.active !== false,
    temporary: !!meta.temporary,
  };
}

function settingsKey(id) {
  return SETTINGS_PREFIX + id;
}

function isBuiltinId(id) {
  return BUILTIN_PLUGIN_METAS.some((m) => m.id === id);
}


function readRemovedBuiltins() {
  const raw = readJSON(REMOVED_BUILTINS_KEY);
  return Array.isArray(raw) ? raw.filter((v) => typeof v === "string") : [];
}

function markBuiltinRemoved(id) {
  if (!isBuiltinId(id)) return;
  const list = readRemovedBuiltins();
  if (!list.includes(id)) {
    list.push(id);
    writeJSON(REMOVED_BUILTINS_KEY, list);
  }
}

function unmarkBuiltinRemoved(id) {
  const list = readRemovedBuiltins();
  const i = list.indexOf(id);
  if (i >= 0) {
    list.splice(i, 1);
    writeJSON(REMOVED_BUILTINS_KEY, list);
  }
}

function persist() {

  writeJSON(
    STORE_KEY,
    installed
      .filter((r) => !r.temporary)
      .map((r) => ({
        id: r.id,
        name: r.name,
        creator: r.creator,
        version: r.version,
        icon: r.icon,
        category: r.category,
        hasSettings: r.hasSettings,
        buttons: r.buttons,
        active: r.active,
      })),
  );
}

function emitToolbars(pluginId) {
  bus.emit("plugins:toolbars-changed", { pluginId });
}

function emitButtonState(pluginId, key) {
  bus.emit("plugins:button-state", { pluginId, key });
}


function makeSignal() {
  const handlers = new Set();
  return {
    api: Object.freeze({
      Connect(fn) {
        if (typeof fn !== "function") return { Disconnect() {} };
        handlers.add(fn);
        return {
          Disconnect() {
            handlers.delete(fn);
          },
        };
      },
    }),
    fire(rt, label, ...args) {
      for (const fn of [...handlers]) guarded(rt, label, fn, args);
    },
    clear() {
      handlers.clear();
    },
  };
}


function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function reportPluginError(rt, label, err) {
  const msg = err && err.message ? String(err.message) : String(err);
  const key = label + "|" + msg;
  const n = (rt.errCounts.get(key) || 0) + 1;
  rt.errCounts.set(key, n);

  if (n <= MAX_SAME_ERROR) {
    logger.error(`[Plugins] Erro em "${rt.record.name}" (${label}): ${msg}`);
    if (n === MAX_SAME_ERROR) {
      logger.warn(`[Plugins] "${rt.record.name}": erros repetidos ser\u00e3o suprimidos nesta sess\u00e3o.`);
    }
  }
}

function guarded(rt, label, fn, args) {
  if (!rt || rt.disposed) return undefined;
  const t0 = nowMs();
  try {
    return args && args.length ? fn(...args) : fn();
  } catch (err) {
    reportPluginError(rt, label, err);
    return undefined;
  } finally {
    const dt = nowMs() - t0;
    if (dt > SLOW_LIMIT_MS && !rt.disposed) {
      rt.strikes += 1;
      logger.warn(
        `[Plugins] "${rt.record.name}" bloqueou a interface por ${Math.round(dt)}ms em ${label}.`,
      );
      if (rt.strikes >= 2 || dt > SLOW_LIMIT_MS * 4) {
        autoDeactivate(rt, "travamento detectado (chamadas demoradas demais)");
      }
    }
  }
}












function guardedCommand(rt, label, fn) {
  const t0 = nowMs();
  try {
    return fn();
  } catch (err) {
    if (rt && !rt.disposed) {
      reportPluginError(rt, label, err);
    } else {
      const who = rt && rt.record ? rt.record.name : "plugin";
      const msg = err && err.message ? String(err.message) : String(err);
      logger.error(`[Plugins] Erro em ${label} de "${who}" (plugin desativado): ${msg}`);
    }
    return false;
  } finally {
    const dt = nowMs() - t0;
    if (rt && !rt.disposed && dt > SLOW_LIMIT_MS) {
      rt.strikes += 1;
      logger.warn(
        `[Plugins] "${rt.record.name}" bloqueou a interface por ${Math.round(dt)}ms em ${label}.`,
      );
      if (rt.strikes >= 2 || dt > SLOW_LIMIT_MS * 4) {
        autoDeactivate(rt, "travamento detectado (chamadas demoradas demais)");
      }
    }
  }
}

function autoDeactivate(rt, why) {
  if (rt.disposed) return;
  const rec = rt.record;
  rec.active = false;
  deactivateRecord(rec);
  persist();
  logger.error(`[Plugins] "${rec.name}" foi desativado automaticamente: ${why}.`);
  bus.emit("status:message", { text: `Plugin "${rec.name}" desativado (${why})` });
  bus.emit("plugins:changed", { reason: "auto-disable", id: rec.id });
}


function buildPluginFacade(record, rt) {
  const plugin = {};
  Object.defineProperty(plugin, "Name", { value: record.name, enumerable: true });

  plugin.CreateToolbar = (name) => {
    if (rt.disposed) return null;
    if (rt.toolbars.length >= MAX_TOOLBARS_PER_PLUGIN) {
      logger.warn(`[Plugins] "${record.name}": limite de toolbars atingido.`);
      return null;
    }
    const tb = { name: sStr(name, 48) || "Toolbar", buttons: [] };
    rt.toolbars.push(tb);
    emitToolbars(record.id);
    return Object.freeze({
      CreateButton(id, tooltip, icon, text) {
        if (rt.disposed) return null;
        if (tb.buttons.length >= MAX_BUTTONS_PER_TOOLBAR) {
          logger.warn(`[Plugins] "${record.name}": limite de bot\u00f5es por toolbar atingido.`);
          return null;
        }
        const bid = sStr(id, 48) || "button" + (tb.buttons.length + 1);
        const brec = {
          key: record.id + "::" + tb.name + "::" + bid + "::" + tb.buttons.length,
          id: bid,
          text: sStr(text, 24) || bid,
          tooltip: sStr(tooltip, STR_MAX),
          icon: sanitizeIconValue(icon),
          enabled: true,
          active: false,
          click: makeSignal(),
        };
        tb.buttons.push(brec);
        emitToolbars(record.id);
        const api = {
          Click: brec.click.api,
          SetActive: (v) => {
            brec.active = !!v;
            emitButtonState(record.id, brec.key);
          },
        };
        Object.defineProperty(api, "Enabled", {
          enumerable: true,
          get: () => brec.enabled,
          set: (v) => {
            brec.enabled = !!v;
            emitButtonState(record.id, brec.key);
          },
        });
        Object.defineProperty(api, "Icon", {
          enumerable: true,
          get: () => brec.icon,
          set: (v) => {
            brec.icon = sanitizeIconValue(v);
            emitButtonState(record.id, brec.key);
          },
        });
        Object.defineProperty(api, "Text", {
          enumerable: true,
          get: () => brec.text,
          set: (v) => {
            brec.text = sStr(v, 24) || brec.id;
            emitButtonState(record.id, brec.key);
          },
        });
        return Object.seal(api);
      },
    });
  };

  const makeWidget = (name, rawInfo, dockable) => {
    if (rt.disposed) return null;
    const widgetId = sStr(name, 64);
    if (!widgetId) {
      logger.warn(`[Plugins] "${record.name}": id de widget inv\u00e1lido.`);
      return null;
    }
    if (rt.widgetIds.has(widgetId)) {
      logger.warn(
        `[Plugins] "${record.name}": widget "${widgetId}" j\u00e1 existe (ids devem ser \u00fanicos por plugin).`,
      );
      return null;
    }
    if (rt.widgets.size >= MAX_WIDGETS_PER_PLUGIN) {
      logger.warn(
        `[Plugins] "${record.name}": limite de ${MAX_WIDGETS_PER_PLUGIN} widgets por plugin atingido.`,
      );
      return null;
    }
    const closeSignal = makeSignal();
    const focusSignal = makeSignal();
    const lostFocusSignal = makeSignal();
    const entry = {};
    const win = createDockWidget({
      pluginId: record.id,
      pluginName: record.name,
      widgetId,
      title: widgetId,
      info: rawInfo,
      dockable,
      onClose: () => closeSignal.fire(rt, "widget:OnClose"),
      onFocus: () => focusSignal.fire(rt, "widget:OnFocus"),
      onLostFocus: () => lostFocusSignal.fire(rt, "widget:OnLostFocus"),
      onDestroy: () => {
        rt.widgets.delete(entry);
        rt.widgetIds.delete(widgetId);
      },
    });
    if (!win) return null;
    entry.win = win;
    const api = {
      GetContainer: () => win.body,                                           
      OnClose: closeSignal.api,
      OnFocus: focusSignal.api,
      OnLostFocus: lostFocusSignal.api,
      Close: () => win.setEnabled(false),
      Destroy: () => win.destroy(),
      BringToFront: () => win.bringToFront(),
    };
    Object.defineProperty(api, "Title", {
      enumerable: true,
      get: () => win.getTitle(),
      set: (v) => win.setTitle(sStr(v, 64)),
    });
    Object.defineProperty(api, "Enabled", {
      enumerable: true,
      get: () => win.isEnabled(),
      set: (v) => win.setEnabled(!!v),
    });
    Object.defineProperty(api, "Size", {
      enumerable: true,
      get: () => win.getSize(),
      set: (v) => {
        if (v && typeof v === "object") {
          win.setSize(v.width != null ? v.width : v.x, v.height != null ? v.height : v.y);
        }
      },
    });
    Object.defineProperty(api, "Position", {
      enumerable: true,
      get: () => win.getPosition(),
      set: (v) => {
        if (v && typeof v === "object") win.setPosition(v.x, v.y);
      },
    });
    Object.defineProperty(api, "DockState", {
      enumerable: true,
      get: () => win.getDockState(),
      set: (v) => win.setDockState(v),
    });
    Object.defineProperty(api, "ZIndexBehavior", {
      enumerable: true,
      get: () => win.getZIndexBehavior(),
      set: (v) => win.setZIndexBehavior(v),
    });
    entry.api = Object.seal(api);
    rt.widgets.add(entry);
    rt.widgetIds.set(widgetId, entry);
    return entry.api;
  };

  plugin.CreateDockWidgetPluginGui = (name, options) => {
    const o = options && typeof options === "object" ? options : {};
    const legacy =
      ("width" in o || "height" in o) && !("InitialDockState" in o) && !("FloatingSize" in o);
    const info = legacy
      ? { InitialDockState: "Float", FloatingSize: { x: o.width, y: o.height } }
      : o;
    return makeWidget(name, info, true);
  };

  plugin.CreateWidget = (name, options) => makeWidget(name, options, false);

  plugin.CreateMenu = (menuName) => {
    if (rt.disposed) return null;
    if (rt.menus.length >= MAX_MENUS_PER_PLUGIN) {
      logger.warn(`[Plugins] "${record.name}": limite de ${MAX_MENUS_PER_PLUGIN} menus atingido.`);
      return null;
    }
    const m = { ownerId: record.id, name: sStr(menuName, 48) || "Menu", items: [] };
    rt.menus.push(m);
    const menuApi = Object.freeze({
      AddItem: (text, callback) => addMenuItem(rt, record, m, text, callback),
    });
    menuHandles.set(menuApi, m);
    return menuApi;
  };

  plugin.AddMenuItem = (menu, text, callback) => {
    const m = menuHandles.get(menu);
    if (!m || m.ownerId !== record.id) {
      logger.warn(`[Plugins] "${record.name}": menu inv\u00e1lido ou de outro plugin.`);
      return false;
    }
    return addMenuItem(rt, record, m, text, callback);
  };

  plugin.Activate = (exclusive) => {
    if (exclusive) {
      for (const [oid, ort] of runtimes) {
        if (oid !== record.id) ort.toolActive = false;
      }
    }
    rt.toolActive = true;
  };
  plugin.Deactivate = () => {
    rt.toolActive = false;
  };
  plugin.IsActive = () => !!rt.toolActive;


  plugin.GetSetting = (key) => getPluginSettings(record.id)[sStr(key, 64)];
  plugin.SetSetting = (key, value) => {
    const obj = getPluginSettings(record.id);
    const k = sStr(key, 64);
    if (!k) return false;
    if (!(k in obj) && Object.keys(obj).length >= MAX_SETTING_KEYS) return false;
    obj[k] = sanitizeSettingValue(value);
    return writeJSON(settingsKey(record.id), obj) !== false;
  };

  plugin.SelectionChanged = rt.selSignal.api;


  plugin.GetSelection = () => selection.get().slice();
  plugin.SetSelection = (items) => selection.set(Array.isArray(items) ? items : []);
  plugin.GetDataModel = () => store.getDataModel();
  plugin.GetService = (name) => {
    const special = pluginOnlyService(rt, String(name));
    if (special) return special;
    try {
      return getService(store.getDataModel(), String(name));
    } catch (_) {
      return null;
    }
  };
  plugin.CreateInstance = (className, opts) =>
    createInstance(String(className || ""), opts && typeof opts === "object" ? opts : {});
  plugin.MakeColor = (r, g, b) => makeColor(Number(r) || 0, Number(g) || 0, Number(b) || 0);
  plugin.MakeVector3 = (x, y, z) =>
    makeVector3(Number(x) || 0, Number(y) || 0, Number(z) || 0);
  plugin.RecordAction = (name, doFn, undoFn) => {
    if (typeof doFn !== "function" || typeof undoFn !== "function") return false;


    return commands.execute({
      name: sStr(name, STR_MAX) || record.name,
      do: () => guardedCommand(rt, "action:do", doFn),
      undo: () => guardedCommand(rt, "action:undo", undoFn),
    });
  };
  plugin.OnEvent = (eventName, fn) => {
    const name = sStr(eventName, STR_MAX);
    if (typeof fn !== "function" || !isAllowedEvent(name)) {
      logger.warn(`[Plugins] "${record.name}": evento "${name}" n\u00e3o permitido.`);
      return () => {};
    }
    const off = bus.on(name, (payload) => guarded(rt, "event:" + name, fn, [payload]));
    rt.conns.push(off);
    return off;
  };
  plugin.EmitEvent = (name, payload) => {
    const n = sStr(name, 64).replace(/[^\w:\-]/g, "");
    if (!n) return;

    bus.emit(`plugin:${record.id}:${n}`, payload);
  };
  plugin.Notify = (text) => {
    const t = sStr(text, 200);
    logger.info(`[${record.name}] ${t}`);
    bus.emit("status:message", { text: t });
  };

  return Object.freeze(plugin);
}

const menuHandles = new WeakMap();

function addMenuItem(rt, record, m, text, callback) {
  if (rt.disposed) return false;
  if (m.items.length >= MAX_MENU_ITEMS_PER_MENU) {
    logger.warn(`[Plugins] "${record.name}": limite de ${MAX_MENU_ITEMS_PER_MENU} itens por menu atingido.`);
    return false;
  }
  const label = sStr(text, 48);
  if (!label || typeof callback !== "function") return false;
  m.items.push({ label, run: () => guarded(rt, "menu:" + label, callback) });
  bus.emit("plugins:menus-changed", { pluginId: record.id });
  return true;
}

export function getPluginMenuSections() {
  const out = [];
  for (const rec of installed) {
    const rt = runtimes.get(rec.id);
    if (!rt || rt.disposed) continue;
    for (const m of rt.menus) {
      if (!m.items.length) continue;
      out.push({
        pluginId: rec.id,
        pluginName: rec.name,
        name: m.name,
        items: m.items.map((it) => ({ label: it.label, run: it.run })),
      });
    }
  }
  return out;
}

export function getPluginContextMenuItems() {
  return getPluginMenuSections().map((sec) => ({
    label: sec.name,
    icon: "plugin",
    submenu: sec.items.map((it) => ({ label: it.label, onSelect: it.run })),
  }));
}

function isAllowedEvent(name) {
  return EVENT_WHITELIST.includes(name) || name.startsWith("plugin:");
}


function makeGenericInit(record) {

  return (plugin) => {
    const tb = plugin.CreateToolbar(record.name);
    if (!tb) return;
    for (const def of record.buttons.slice(0, MAX_BUTTONS_PER_TOOLBAR)) {
      const btn = tb.CreateButton(def.id, def.tooltip, def.icon, def.text);
      if (!btn) continue;
      btn.Click.Connect(() => {
        plugin.Notify(`A\u00e7\u00e3o simulada: ${def.text} (plugin de demonstra\u00e7\u00e3o).`);
      });
    }
  };
}

function activateRecord(record) {
  if (runtimes.has(record.id)) return true;
  const rt = {
    record,
    toolbars: [],
    widgets: new Set(),
    widgetIds: new Map(),
    menus: [],
    conns: [],
    selSignal: makeSignal(),
    errCounts: new Map(),
    strikes: 0,
    toolActive: false,
    disposed: false,
  };
  runtimes.set(record.id, rt);

  const init =
    tempInits.get(record.id) ||
    getBuiltinInit(record.id) ||
    (Array.isArray(record.buttons) && record.buttons.length ? makeGenericInit(record) : null);
  if (init) {
    rt.plugin = buildPluginFacade(record, rt);
    guarded(rt, "init", () => init(rt.plugin));
    if (!runtimes.has(record.id)) return false;                                     
  }
  emitToolbars(record.id);
  return true;
}

function deactivateRecord(record) {
  const rt = runtimes.get(record.id);
  if (!rt || rt.disposed) return;

  for (const off of rt.conns.splice(0)) {
    try {
      off();
    } catch (_) {

    }
  }
  for (const entry of [...rt.widgets]) {
    try {
      entry.win.close("deactivate");
    } catch (_) {

    }
  }
  rt.disposed = true;
  rt.widgets.clear();
  rt.selSignal.clear();
  rt.toolbars.length = 0;
  runtimes.delete(record.id);
  emitToolbars(record.id);
}

export function initPluginSystem() {
  if (initialized) return;
  initialized = true;
  let saved = readJSON(STORE_KEY);
  if (!Array.isArray(saved)) {

    saved = BUILTIN_PLUGIN_METAS.map((m) => ({ ...m, active: true }));
    logger.info("[Plugins] Plugins de exemplo instalados (primeira execu\u00e7\u00e3o).");
  } else {


    const removed = readRemovedBuiltins();
    for (const meta of BUILTIN_PLUGIN_METAS) {
      if (removed.includes(meta.id)) continue;
      if (!saved.some((r) => r && r.id === meta.id)) saved.push({ ...meta, active: true });
    }
  }
  installed = [];
  for (const raw of saved.slice(0, MAX_PLUGINS)) {
    if (!raw || !raw.id || installed.some((r) => r.id === raw.id)) continue;
    installed.push(sanitizeRecord(raw));
  }


  for (const rec of installed) {
    const canon =
      BUILTIN_PLUGIN_METAS.find((m) => m.id === rec.id) ||
      MARKETPLACE_PLUGINS.find((m) => m.id === rec.id);
    if (canon && canon.icon && rec.icon !== canon.icon) {
      rec.icon = sanitizeIconValue(canon.icon);
    }
  }
  persist();

  bus.on("selection:changed", () => {
    for (const rt of [...runtimes.values()]) rt.selSignal.fire(rt, "SelectionChanged");
  });
  for (const rec of installed) {
    if (rec.active) activateRecord(rec);
  }
  bus.emit("plugins:changed", { reason: "init" });
  logger.info(
    `[Plugins] Sistema de plugins iniciado: ${installed.filter((r) => r.active).length} ativo(s) de ${installed.length} instalado(s).`,
  );
}


export function listInstalled() {
  return installed.map((r) => ({ ...r, buttons: r.buttons.map((b) => ({ ...b })) }));
}

export function isInstalled(id) {
  return installed.some((r) => r.id === id);
}

export function getCounts() {
  return {
    installed: installed.length,
    active: installed.filter((r) => r.active).length,
  };
}

export function installPlugin(meta) {
  const fail = (error) => {
    NotificationService.notify("error", "Plugin install failed: " + error);
    return { ok: false, error };
  };
  if (!meta || typeof meta !== "object" || !meta.id) {
    return fail("Metadados de plugin inv\u00e1lidos.");
  }
  if (installed.some((r) => r.id === meta.id)) {
    return fail("Plugin j\u00e1 instalado.");
  }
  if (installed.length >= MAX_PLUGINS) {
    return fail(`Limite de ${MAX_PLUGINS} plugins instalados atingido.`);
  }
  const rec = sanitizeRecord(meta);
  rec.active = true;
  unmarkBuiltinRemoved(rec.id);                                            
  installed.push(rec);
  persist();
  activateRecord(rec);
  logger.info(`Plugin '${rec.name}' installed successfully`);
  bus.emit("status:message", { text: `Plugin '${rec.name}' installed successfully` });
  bus.emit("plugins:changed", { reason: "install", id: rec.id });
  NotificationService.notify("success", `Plugin '${rec.name}' installed`);            
  return { ok: true };
}

export function uninstallPlugin(id) {
  const i = installed.findIndex((r) => r.id === id);
  if (i < 0) return { ok: false, error: "Plugin n\u00e3o encontrado." };
  const rec = installed[i];
  deactivateRecord(rec);
  installed.splice(i, 1);
  remove(settingsKey(rec.id));                                           
  clearPluginWidgetLayout(rec.id);
  tempInits.delete(rec.id);
  markBuiltinRemoved(rec.id);                                                   
  persist();
  logger.info(`Plugin '${rec.name}' uninstalled.`);
  bus.emit("status:message", { text: `Plugin '${rec.name}' removido` });
  bus.emit("plugins:changed", { reason: "uninstall", id });
  return { ok: true };
}

export function uninstallAll() {
  for (const rec of [...installed]) {
    deactivateRecord(rec);
    remove(settingsKey(rec.id));
    clearPluginWidgetLayout(rec.id);
    tempInits.delete(rec.id);
    markBuiltinRemoved(rec.id);
  }
  installed = [];
  persist();
  logger.info("[Plugins] Todos os plugins foram desinstalados.");
  bus.emit("status:message", { text: "Todos os plugins foram desinstalados" });
  bus.emit("plugins:changed", { reason: "uninstall-all" });
}

export function setPluginActive(id, on) {
  const rec = installed.find((r) => r.id === id);
  if (!rec) return { ok: false, error: "Plugin n\u00e3o encontrado." };
  const want = !!on;
  rec.active = want;
  if (want) activateRecord(rec);
  else deactivateRecord(rec);
  persist();
  bus.emit("plugins:changed", { reason: want ? "enable" : "disable", id });
  return { ok: true };
}

export function enableAll() {
  let changed = false;
  for (const rec of installed) {
    if (!rec.active) {
      rec.active = true;
      activateRecord(rec);
      changed = true;
    }
  }
  if (changed) {
    persist();
    bus.emit("plugins:changed", { reason: "enable-all" });
  }
}

export function disableAll() {
  let changed = false;
  for (const rec of installed) {
    if (rec.active) {
      rec.active = false;
      deactivateRecord(rec);
      changed = true;
    }
  }
  if (changed) {
    persist();
    bus.emit("plugins:changed", { reason: "disable-all" });
  }
}


export function getPluginSettings(id) {
  const obj = readJSON(settingsKey(id));
  return obj && typeof obj === "object" && !Array.isArray(obj) ? { ...obj } : {};
}

export function updatePluginSettings(id, obj) {
  if (!obj || typeof obj !== "object") return false;
  const clean = {};
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (n >= MAX_SETTING_KEYS) break;
    clean[String(k).slice(0, 64)] = sanitizeSettingValue(v);
    n += 1;
  }
  return writeJSON(settingsKey(id), clean) !== false;
}


export function getToolbarSections() {
  const out = [];
  for (const rec of installed) {
    const rt = runtimes.get(rec.id);
    if (!rt || !rt.toolbars.length) continue;
    out.push({
      pluginId: rec.id,
      pluginName: rec.name,
      toolbars: rt.toolbars.map((tb) => ({
        name: tb.name,
        buttons: tb.buttons.map((b) => ({
          key: b.key,
          text: b.text,
          tooltip: b.tooltip,
          icon: b.icon,
          enabled: b.enabled,
          active: b.active,
        })),
      })),
    });
  }
  return out;
}

function findButton(key) {
  for (const rt of runtimes.values()) {
    for (const tb of rt.toolbars) {
      for (const rec of tb.buttons) {
        if (rec.key === key) return { rt, rec };
      }
    }
  }
  return null;
}

export function getButtonState(key) {
  const found = findButton(key);
  return found
    ? { enabled: found.rec.enabled, active: found.rec.active, icon: found.rec.icon, text: found.rec.text }
    : null;
}

export function pressToolbarButton(key) {
  const found = findButton(key);
  if (!found || !found.rec.enabled) return;
  found.rec.click.fire(found.rt, `button:${found.rec.id}`);
}


export function runSelectedScriptAsPlugin() {
  const scripts = selection
    .get()
    .filter(
      (i) =>
        i && !i.isDestroyed() && ["Script", "LocalScript", "ModuleScript"].includes(i.className),
    );
  if (!scripts.length) {
    return {
      ok: false,
      error:
        "Selecione um Script, LocalScript ou ModuleScript no Explorer para executar como plugin tempor\u00e1rio.",
    };
  }
  if (installed.length >= MAX_PLUGINS) {
    return { ok: false, error: `Limite de ${MAX_PLUGINS} plugins atingido.` };
  }
  const script = scripts[0];
  const source = String(script.getProperty("Source") || "");
  const lines = source.split("\n").length;
  const rec = sanitizeRecord({
    id: "temp." + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: "Script: " + script.name,
    creator: "Local (tempor\u00e1rio)",
    version: "temp",
    icon: "script",
    category: "Scripting",
  });
  rec.temporary = true;
  rec.active = true;
  installed.push(rec);


  tempInits.set(rec.id, (plugin) => {
    plugin.Notify(
      `Executando "${script.name}" como plugin tempor\u00e1rio (${lines} linha(s)) — execu\u00e7\u00e3o simulada.`,
    );
    const tb = plugin.CreateToolbar(rec.name);
    if (!tb) return;
    const btn = tb.CreateButton("run-again", "Executa novamente o script como plugin tempor\u00e1rio", "run", "Run");
    if (!btn) return;
    btn.Click.Connect(() => {
      plugin.Notify(`"${script.name}" executado novamente (simula\u00e7\u00e3o, ${source.length} caractere(s)).`);
    });
  });
  activateRecord(rec);
  bus.emit("plugins:changed", { reason: "install", id: rec.id });
  bus.emit("status:message", { text: `Script "${script.name}" carregado como plugin tempor\u00e1rio` });
  return { ok: true, name: script.name };
}

export function getPluginsFolderInfo() {
  return {
    path: "Documents/RobloxStudioWeb/Plugins",
    files: installed
      .filter((r) => !r.temporary)
      .map((r) => r.id.replace(/[^a-z0-9.\-]/gi, "_") + ".plugin.js"),
  };
}

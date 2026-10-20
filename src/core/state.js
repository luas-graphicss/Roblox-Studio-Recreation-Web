import { bus } from "./eventBus.js";

export const REGIONS = Object.freeze([
  "topBar",
  "subBar",
  "toolStrip",
  "workspace",
  "statusBar",
]);


export const TABS = Object.freeze([
  "home",
  "model",
  "terrain",
  "avatar",
  "ui",
  "script",
  "test",
  "view",                                                        
  "plugins",
]);
export const DEFAULT_TAB = "home";


const MIN_PANEL = 100;
const MAX_PANEL = 20000;

function defaultLayout() {
  return {
    rightWidth: 300,
    explorerHeight: 280,
    outputHeight: 180,
    analysisHeight: 160,                                              
    debuggerHeight: 220,                                       
    findHeight: 200,                                           
    assistantWidth: 340,                                         
    apiBrowserWidth: 420,                                           
    panels: { explorer: true, properties: true, output: true, analysis: false, debugger: false, find: false, assistant: false, apiBrowser: false },
  };
}


export const RENDER_MODES = Object.freeze([
  "default",
  "wireframe",
  "detail",
  "shadowmap",
  "albedo",
  "normals",
  "roughness",
]);
export const AXES_SPACES = Object.freeze(["world", "local", "lastObject"]);
export const GRID_COLORS = Object.freeze(["default", "blue", "green", "amber"]);
export const GRID_CELL_SIZES = Object.freeze([2, 4, 8, 16]);

function defaultViewOptions() {
  return {
    renderMode: "default",
    showGizmos: true,
    showSelectionBoxes: true,
    showBoundingBoxes: false,
    showHoverHighlight: true,
    showGuides: true,
    showPathfinding: false,

    showDynamicObstacles: false,
    showRaycastDebug: false,
    showOverlapDebug: false,
    showShapecastDebug: false,
    showQueryHits: false,

    showStreamingBounds: false,
    showStreamedChunks: false,
    showReplicationFocus: false,
    showLODLevels: false,
    perfStats: false,
    explorerFocus: true,
    axesSpace: "world",
    gridColor: "default",
    gridCellSize: 8,
  };
}


function sanitizeViewOptions(raw) {
  const d = defaultViewOptions();
  if (!raw || typeof raw !== "object") return d;
  const out = { ...d };
  for (const k of Object.keys(d)) {
    const v = raw[k];
    if (typeof d[k] === "boolean") {
      if (typeof v === "boolean") out[k] = v;
    } else if (k === "renderMode") {
      if (RENDER_MODES.includes(v)) out[k] = v;
    } else if (k === "axesSpace") {
      if (AXES_SPACES.includes(v)) out[k] = v;
    } else if (k === "gridColor") {
      if (GRID_COLORS.includes(v)) out[k] = v;
    } else if (k === "gridCellSize") {
      if (GRID_CELL_SIZES.includes(v)) out[k] = v;
    }
  }
  return out;
}

function coerceSize(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_PANEL, Math.max(MIN_PANEL, value));
}


function sanitizeLayout(raw) {
  const d = defaultLayout();
  if (!raw || typeof raw !== "object") return d;
  const panels = raw.panels && typeof raw.panels === "object" ? raw.panels : {};
  return {
    rightWidth: coerceSize(raw.rightWidth, d.rightWidth),
    explorerHeight: coerceSize(raw.explorerHeight, d.explorerHeight),
    outputHeight: coerceSize(raw.outputHeight, d.outputHeight),
    analysisHeight: coerceSize(raw.analysisHeight, d.analysisHeight),            
    debuggerHeight: coerceSize(raw.debuggerHeight, d.debuggerHeight),            
    findHeight: coerceSize(raw.findHeight, d.findHeight),            
    assistantWidth: coerceSize(raw.assistantWidth, d.assistantWidth),            
    apiBrowserWidth: coerceSize(raw.apiBrowserWidth, d.apiBrowserWidth),            
    panels: {
      explorer: typeof panels.explorer === "boolean" ? panels.explorer : true,
      properties: typeof panels.properties === "boolean" ? panels.properties : true,
      output: typeof panels.output === "boolean" ? panels.output : true,
      analysis: typeof panels.analysis === "boolean" ? panels.analysis : false,            
      debugger: typeof panels.debugger === "boolean" ? panels.debugger : false,            
      find: typeof panels.find === "boolean" ? panels.find : false,            
      assistant: typeof panels.assistant === "boolean" ? panels.assistant : false,            
      apiBrowser: typeof panels.apiBrowser === "boolean" ? panels.apiBrowser : false,            
    },
  };
}

function createInitialState() {
  const regions = {};
  for (const r of REGIONS) regions[r] = true;
  return {
    theme: "dark",
    activeTab: "home",
    activeTool: "select",
    selection: [],                       
    regions,                                            
    running: false,                              
    layout: defaultLayout(),                                          
    uiEditorMode: false,                                            
    commandBarVisible: false,                                    
    centralView: "viewport",                                    
    viewOptions: defaultViewOptions(),                                 
    appMode: "START_PAGE",                                      
  };
}

function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const k of Object.keys(obj)) deepFreeze(obj[k]);
  }
  return obj;
}

class Store {
  constructor() {
    this._state = createInitialState();
    this._subscribers = new Set();
    this._initialized = false;


    this._dataModel = null;
  }


  setDataModel(dataModel) {
    if (this._dataModel) {
      console.warn("[RSW] DataModel já registrado; ignorando novo registro.");
      return this._dataModel;
    }
    this._dataModel = dataModel || null;

    this._notify({ key: "dataModel", value: "registered" });
    return this._dataModel;
  }


  getDataModel() {
    return this._dataModel;
  }

  init(partial = {}) {
    if (this._initialized) return;
    this._state = this._sanitize({ ...this._state, ...partial });
    this._initialized = true;
  }

  _sanitize(next) {
    const base = createInitialState();
    const out = { ...base, ...next };
    out.regions = { ...base.regions, ...(next && next.regions ? next.regions : {}) };
    out.running = false;                         
    if (!Array.isArray(out.selection)) out.selection = [];
    out.uiEditorMode = !!out.uiEditorMode;
    out.commandBarVisible = !!out.commandBarVisible;
    out.centralView = out.centralView === "editor" ? "editor" : "viewport";

    if (!TABS.includes(out.activeTab)) out.activeTab = DEFAULT_TAB;
    out.layout = sanitizeLayout(out.layout);
    out.appMode = out.appMode === "EDITOR" ? "EDITOR" : "START_PAGE";            
    out.viewOptions = sanitizeViewOptions(out.viewOptions);            
    return out;
  }


  getState() {
    return deepFreeze(structuredClone(this._state));
  }

  get(key) {
    const v = this._state[key];
    return typeof v === "object" && v !== null
      ? deepFreeze(structuredClone(v))
      : v;
  }

  set(key, value) {
    if (!(key in this._state)) {
      console.warn(`[RSW] Chave de estado desconhecida ignorada: "${key}"`);
      return;
    }
    if (key === "running") return;                         
    const prev = this._state[key];
    if (Object.is(prev, value)) return;
    this._state = { ...this._state, [key]: value };
    this._notify({ key, value, prev });
  }


  setActiveTab(tab) {
    const next = TABS.includes(tab) ? tab : DEFAULT_TAB;
    this.set("activeTab", next);
    return next;
  }


  setLayout(patch) {
    if (!patch || typeof patch !== "object") return this._state.layout;
    const merged = {
      ...this._state.layout,
      ...patch,
      panels: { ...this._state.layout.panels, ...(patch.panels || {}) },
    };
    const next = sanitizeLayout(merged);
    this._state = { ...this._state, layout: next };
    this._notify({ key: "layout", value: next });
    return next;
  }


  setViewOption(key, value) {
    const current = this._state.viewOptions || defaultViewOptions();
    if (!(key in current)) {
      console.warn(`[RSW] Opção de visualização desconhecida ignorada: "${key}"`);
      return current;
    }
    const next = sanitizeViewOptions({ ...current, [key]: value });


    if (!Object.is(next[key], value)) {
      console.warn(`[RSW] Valor inválido ignorado para viewOptions.${key}:`, value);
      return current;
    }
    if (Object.is(next[key], current[key])) return current;               
    this._state = { ...this._state, viewOptions: next };
    this._notify({ key: "viewOptions", value: next, option: key });
    return next;
  }

  getViewOption(key) {
    const v = (this._state.viewOptions || defaultViewOptions())[key];
    return v;
  }

  setRegionVisible(region, visible) {
    if (!REGIONS.includes(region)) return;
    const regions = { ...this._state.regions, [region]: !!visible };
    this._state = { ...this._state, regions };
    this._notify({ key: "regions", value: regions });
  }

  subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  _notify(change) {
    const snapshot = this.getState();
    for (const fn of [...this._subscribers]) {
      try {
        fn(snapshot, change);
      } catch (err) {
        console.error("[RSW] Erro em assinante de estado:", err);
      }
    }
    bus.emit("state:changed", { change, state: snapshot });
  }
}

export const store = new Store();

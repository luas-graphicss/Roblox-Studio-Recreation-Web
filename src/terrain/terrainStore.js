import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { getService } from "../datamodel/index.js";
import { tools } from "../viewport/tools.js";
import { TerrainData } from "./terrainData.js";
import { MATERIAL_COUNT, hasMaterialName, materialIndexByName, materialHex } from "./materials.js";
import { clampRegionBox } from "./regionCore.js";
import { clampNumber } from "../utils/validate.js";

export const TerrainEvents = Object.freeze({
  Changed: "terrain:changed",
  ToolChanged: "terrain:toolChanged",
  BrushChanged: "terrain:brushChanged",
  MaterialChanged: "terrain:materialChanged",
  WaterChanged: "terrain:waterChanged",
  RegionChanged: "terrain:regionChanged",
});

export const BRUSH_TOOLS = Object.freeze([
  "add", "subtract", "paint", "smooth", "grow", "erode", "flatten",
]);


export const REGION_TOOL = "region-select";

const TOOL_TITLES = Object.freeze({
  add: "Add", subtract: "Subtract", paint: "Paint", smooth: "Smooth",
  grow: "Grow", erode: "Erode", flatten: "Flatten", generate: "Generate",
  "region-select": "Select Region",
});


function normalizeRgb(rgb) {
  if (typeof rgb === "number" && Number.isFinite(rgb)) return (rgb >>> 0) & 0xffffff;
  const toByte = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : null);
  let r = null, g = null, b = null;
  if (Array.isArray(rgb) && rgb.length >= 3) { r = toByte(rgb[0]); g = toByte(rgb[1]); b = toByte(rgb[2]); }
  else if (rgb && typeof rgb === "object") { r = toByte(rgb.r); g = toByte(rgb.g); b = toByte(rgb.b); }
  if (r == null || g == null || b == null) return null;
  return (r << 16) | (g << 8) | b;
}

class TerrainStore {
  constructor() {
    this.data = new TerrainData();
    this.activeTool = null;
    this.regionSelection = null;                                                         
    this.brush = { size: 12, strength: 0.5, shape: "Sphere", pivot: "Center" };
    this.material = 0;


    this.importedMaterialColors = new Map();
    this.snap = false;
    this.ignoreParts = true;                                                         
    this.generateParams = {
      seed: 42, biome: "Hills", biomeSize: 0.5,
      caveFrequency: 0.2, terrainHeight: 0.5, waterLevel: 0.3,
    };
    this._subscribed = false;
  }

  ensureSubscribed() {
    if (this._subscribed) return;
    this._subscribed = true;
    try {
      store.subscribe((state) => {
        if (state && state.activeTab !== "terrain" && this.activeTool) this.setTool(null);
      });
    } catch (e) {                              }
  }

  getData() { return this.data; }

  getActiveTool() { return this.activeTool; }
  isBrushTool(tool) { return BRUSH_TOOLS.indexOf(tool) !== -1; }
  toolTitle(tool) { return TOOL_TITLES[tool] || "Terrain"; }

  setTool(tool) {
    const next = tool || null;
    if (this.activeTool === next) {
      if (next) { this.activeTool = null; bus.emit(TerrainEvents.ToolChanged, { tool: null }); }

      if (this.activeTool !== REGION_TOOL) this.setRegionSelection(null);
      return;
    }
    this.activeTool = next;


    if (next) { try { tools.set("select"); } catch (e) {} }

    if (next !== REGION_TOOL) this.setRegionSelection(null);
    bus.emit(TerrainEvents.ToolChanged, { tool: next });
  }


  getRegionSelection() { return this.regionSelection; }
  setRegionSelection(box) {
    const next = box ? clampRegionBox(box) : null;
    if (!next && !this.regionSelection) return;
    this.regionSelection = next;
    bus.emit(TerrainEvents.RegionChanged, { region: next });
  }

  getBrush() { return Object.assign({}, this.brush); }
  setBrush(partial) {
    if (!partial) return;
    if (partial.size != null) this.brush.size = clampNumber(partial.size, 1, 64, this.brush.size);
    if (partial.strength != null) this.brush.strength = clampNumber(partial.strength, 0, 1, this.brush.strength);
    if (partial.shape && ["Sphere", "Box", "Cylinder"].indexOf(partial.shape) !== -1) this.brush.shape = partial.shape;
    if (partial.pivot && ["Center", "Base"].indexOf(partial.pivot) !== -1) this.brush.pivot = partial.pivot;
    bus.emit(TerrainEvents.BrushChanged, this.getBrush());
  }

  getMaterial() { return this.material; }
  setMaterial(idx) {
    this.material = clampNumber(idx, 0, MATERIAL_COUNT - 1, 0) | 0;
    bus.emit(TerrainEvents.MaterialChanged, { material: this.material });
  }


  setImportedMaterialColors(colors) {
    const map = new Map();
    if (Array.isArray(colors)) {
      for (const entry of colors) {
        if (!entry || typeof entry.name !== "string" || !hasMaterialName(entry.name)) continue;
        const rgb = normalizeRgb(entry.rgb);
        if (rgb == null) continue;
        map.set(materialIndexByName(entry.name), rgb);
      }
    }
    this.importedMaterialColors = map;
    bus.emit(TerrainEvents.Changed, { version: this.data.version, materialColors: map.size });
    return map.size;
  }

  getImportedMaterialColor(index) {
    const o = this.importedMaterialColors ? this.importedMaterialColors.get(index | 0) : undefined;
    return typeof o === "number" ? o : null;
  }

  getMaterialHex(index) {
    const o = this.getImportedMaterialColor(index);
    if (o != null) return "#" + o.toString(16).padStart(6, "0");
    return materialHex(index);
  }

  getSnap() { return this.snap; }
  setSnap(v) { this.snap = !!v; bus.emit(TerrainEvents.BrushChanged, this.getBrush()); }

  getIgnoreParts() { return this.ignoreParts; }
  setIgnoreParts(v) { this.ignoreParts = !!v; bus.emit(TerrainEvents.BrushChanged, this.getBrush()); }

  getGenerateParams() { return Object.assign({}, this.generateParams); }
  setGenerateParams(partial) { Object.assign(this.generateParams, partial || {}); }

  getTerrainInstance() {
    try {
      const dm = store.getDataModel && store.getDataModel();
      if (!dm) return null;
      const ws = getService(dm, "Workspace");
      if (!ws || !ws.getChildren) return null;
      return ws.getChildren().find((c) => c.className === "Terrain") || null;
    } catch (e) { return null; }
  }

  notifyChanged() {
    const inst = this.getTerrainInstance();
    if (inst && inst._setInternal) {
      const s = this.data.getSizeStuds();
      try { inst._setInternal("TerrainSize", { x: s.x, y: s.y, z: s.z }); } catch (e) {}
    }
    bus.emit(TerrainEvents.Changed, { version: this.data.version });
  }
}

export const terrainStore = new TerrainStore();

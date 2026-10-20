import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { terrainStore, TerrainEvents } from "../terrain/terrainStore.js";
import { TERRAIN_MATERIALS } from "../terrain/materials.js";
import { createIcon } from "./icons.js";
import { openGenerateTerrainDialog } from "./dialogs/generateTerrain.js";

let api = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function sliderRow(labelText, value, min, max, step, fmt, onInput) {
  const wrap = el("div", "rsw-tp-slider");
  const head = el("div", "rsw-tp-slider__head");
  head.appendChild(el("span", "rsw-tp-slider__label", labelText));
  const val = el("span", "rsw-tp-slider__value", fmt(value));
  head.appendChild(val);
  const input = document.createElement("input");
  input.type = "range";
  input.className = "rsw-tp-range";
  input.min = String(min); input.max = String(max); input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => {
    const v = parseFloat(input.value);
    val.textContent = fmt(v);
    onInput(v);
  });
  wrap.appendChild(head); wrap.appendChild(input);
  return { el: wrap, input, val, fmt };
}

function segmented(options, getValue, onPick) {
  const wrap = el("div", "rsw-tp-seg");
  const btns = {};
  options.forEach((opt) => {
    const b = el("button", "rsw-tp-seg__btn", opt);
    b.type = "button";
    b.addEventListener("click", () => onPick(opt));
    btns[opt] = b;
    wrap.appendChild(b);
  });
  function refresh() {
    const v = getValue();
    for (const k in btns) btns[k].classList.toggle("rsw-tp-seg__btn--active", k === v);
  }
  refresh();
  return { el: wrap, refresh };
}

export function mountTerrainPanel(host) {
  if (api) return api;
  const mount = host || document.body;
  let pinned = false;

  const root = el("div", "rsw-tpanel");
  root.style.display = "none";


  const header = el("div", "rsw-tpanel__header");
  const title = el("div", "rsw-tpanel__title", "Terrain Editor");
  const closeBtn = el("button", "rsw-tpanel__close");
  closeBtn.type = "button";
  closeBtn.appendChild(createIcon("close", 14));
  closeBtn.addEventListener("click", () => { pinned = false; terrainStore.setTool(null); updateVisibility(); });
  header.appendChild(title); header.appendChild(closeBtn);
  root.appendChild(header);

  const bodyEl = el("div", "rsw-tpanel__body");
  root.appendChild(bodyEl);


  const toolLabel = el("div", "rsw-tpanel__tool", "");
  bodyEl.appendChild(toolLabel);


  bodyEl.appendChild(el("div", "rsw-tpanel__section", "Pincel"));
  const brush = terrainStore.getBrush();
  const sizeS = sliderRow("Tamanho", brush.size, 1, 64, 1, (v) => v + " studs", (v) => terrainStore.setBrush({ size: v }));
  const strengthS = sliderRow("Forca", Math.round(brush.strength * 100), 0, 100, 1, (v) => v + "%", (v) => terrainStore.setBrush({ strength: v / 100 }));
  bodyEl.appendChild(sizeS.el);
  bodyEl.appendChild(strengthS.el);

  const shapeSeg = segmented(["Sphere", "Box", "Cylinder"], () => terrainStore.getBrush().shape, (v) => terrainStore.setBrush({ shape: v }));
  const pivotSeg = segmented(["Center", "Base"], () => terrainStore.getBrush().pivot, (v) => terrainStore.setBrush({ pivot: v }));
  bodyEl.appendChild(el("div", "rsw-tpanel__sub", "Forma"));
  bodyEl.appendChild(shapeSeg.el);
  bodyEl.appendChild(el("div", "rsw-tpanel__sub", "Pivot"));
  bodyEl.appendChild(pivotSeg.el);


  bodyEl.appendChild(el("div", "rsw-tpanel__section", "Material"));
  const grid = el("div", "rsw-tpanel__matgrid");
  const matButtons = [];
  const matSwatches = [];
  TERRAIN_MATERIALS.forEach((m, i) => {
    const b = el("button", "rsw-tpanel__mat");
    b.type = "button";
    b.title = m.name;
    const sw = el("span", "rsw-tpanel__matsw");

    sw.style.background = terrainStore.getMaterialHex(i);
    b.appendChild(sw);
    b.appendChild(el("span", "rsw-tpanel__matname", m.name));
    b.addEventListener("click", () => terrainStore.setMaterial(i));
    grid.appendChild(b);
    matButtons.push(b);
    matSwatches.push(sw);
  });
  bodyEl.appendChild(grid);


  bodyEl.appendChild(el("div", "rsw-tpanel__section", "Gerar terreno"));
  const genBtn = el("button", "rsw-tpanel__genbtn", "Abrir gerador...");
  genBtn.type = "button";
  genBtn.addEventListener("click", () => openGenerateTerrainDialog());
  bodyEl.appendChild(genBtn);

  mount.appendChild(root);

  function refreshBrush() {
    const b = terrainStore.getBrush();
    sizeS.input.value = String(b.size); sizeS.val.textContent = sizeS.fmt(b.size);
    strengthS.input.value = String(Math.round(b.strength * 100)); strengthS.val.textContent = strengthS.fmt(Math.round(b.strength * 100));
    shapeSeg.refresh(); pivotSeg.refresh();
  }
  function refreshMaterial() {
    const cur = terrainStore.getMaterial();
    matButtons.forEach((b, i) => b.classList.toggle("rsw-tpanel__mat--active", i === cur));
  }


  function refreshMaterialColors() {
    matSwatches.forEach((sw, i) => { sw.style.background = terrainStore.getMaterialHex(i); });
  }
  function refreshTool() {
    const t = terrainStore.getActiveTool();
    toolLabel.textContent = t ? "Ferramenta: " + terrainStore.toolTitle(t) : "Nenhuma ferramenta ativa";
    updateVisibility();
  }
  function updateVisibility() {
    const active = !!terrainStore.getActiveTool() && terrainStore.isBrushTool(terrainStore.getActiveTool());
    const onTab = (store.getState && store.getState().activeTab) === "terrain";
    root.style.display = (onTab && (active || pinned)) ? "flex" : "none";
  }

  const offTool = bus.on(TerrainEvents.ToolChanged, refreshTool);
  const offBrush = bus.on(TerrainEvents.BrushChanged, refreshBrush);
  const offMat = bus.on(TerrainEvents.MaterialChanged, refreshMaterial);
  const offColors = bus.on(TerrainEvents.Changed, (e) => { if (e && e.materialColors != null) refreshMaterialColors(); });
  const offStore = store.subscribe((_s, change) => { if (change && change.key === "activeTab") updateVisibility(); });
  terrainStore.ensureSubscribed();

  refreshBrush(); refreshMaterial(); refreshTool();

  api = {
    el: root,
    show() { pinned = true; updateVisibility(); },
    hide() { pinned = false; updateVisibility(); },
    toggle(force) { pinned = typeof force === "boolean" ? force : !pinned; updateVisibility(); },
    refresh() { refreshBrush(); refreshMaterial(); refreshMaterialColors(); refreshTool(); },
    destroy() {
      if (typeof offTool === "function") offTool();
      if (typeof offBrush === "function") offBrush();
      if (typeof offMat === "function") offMat();
      if (typeof offColors === "function") offColors();
      if (typeof offStore === "function") offStore();
      if (root.parentNode) root.parentNode.removeChild(root);
      api = null;
    },
  };
  return api;
}

export function toggleTerrainPanel(force) { if (api) api.toggle(force); }
export function getTerrainPanel() { return api; }

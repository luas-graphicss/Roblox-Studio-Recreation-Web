import { buildGroupEl } from "./ribbon.js";
import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { createIcon } from "./icons.js";
import { makeButton, openConfirm, openInfo, openModal } from "./modal.js";
import { terrainStore, TerrainEvents, REGION_TOOL } from "../terrain/terrainStore.js";
import { clearTerrain } from "../terrain/operations.js";
import { fillSelectedRegion, replaceInSelectedRegion, selectedRegionStats } from "../terrain/regionOps.js";
import { materialName, MATERIAL_COUNT } from "../terrain/materials.js";
import { NotificationService } from "../services/notifications.js";
import { openGenerateTerrainDialog } from "./dialogs/generateTerrain.js";
import { mountTerrainPanel, toggleTerrainPanel } from "./terrainPanel.js";
import { importTerrainFromFile, exportTerrainToFile } from "./terrainIO.js";
import { planTerrainToParts, convertTerrainToParts, TO_PARTS_MAX } from "../terrain/toParts.js";

function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function safe(fn) { try { return fn(); } catch (e) { return undefined; } }

function toolEntry(id, label, icon, size) {
  return {
    id, label, icon, size,
    desc: "Ferramenta de terreno: " + label + ".",
    onRun: () => terrainStore.setTool(id),
    getActive: () => terrainStore.getActiveTool() === id,
  };
}


function buildMaterialControl(ctx) {
  const wrap = el("div", "rsw-rmat");
  wrap.dataset.rb = "terrain-material";
  const btn = el("button", "rsw-rmat__btn");
  btn.type = "button";
  const sw = el("span", "rsw-rmat__sw");
  const name = el("span", "rsw-rmat__name");
  btn.appendChild(sw); btn.appendChild(name);
  btn.addEventListener("click", () => { toggleTerrainPanel(true); });
  wrap.appendChild(btn);
  const labelEl = el("div", "rsw-rgroup__minilabel");
  labelEl.textContent = "Material";
  wrap.appendChild(labelEl);
  function update() {
    const idx = terrainStore.getMaterial();

    sw.style.background = terrainStore.getMaterialHex(idx);
    name.textContent = materialName(idx);
  }
  update();
  if (ctx && ctx.customUpdaters) ctx.customUpdaters.push(update);
  return wrap;
}


function nudgeSelectRegion(title) {
  terrainStore.setTool(REGION_TOOL);
  openInfo({
    title,
    content: "Nenhuma regiao selecionada. A ferramenta Select foi ativada: arraste sobre o terreno no viewport para marcar uma regiao e tente de novo. (Esc limpa a selecao.)",
  });
}

function runRegionFill() {
  const res = fillSelectedRegion();
  if (res.ok) { NotificationService.notify("success", res.message); return; }
  if (res.reason === "no-selection") { nudgeSelectRegion("Fill Region"); return; }
  openInfo({ title: "Fill Region", content: res.message });
}


function buildMaterialSelect(counts) {
  const sel = document.createElement("select");
  sel.className = "rsw-input";
  for (let i = 0; i < MATERIAL_COUNT; i++) {
    if (counts && !(counts[i] > 0)) continue;
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = counts ? materialName(i) + " (" + counts[i] + ")" : materialName(i);
    sel.appendChild(opt);
  }
  return sel;
}

function openRegionReplaceDialog() {
  const stats = selectedRegionStats();
  if (!stats) { nudgeSelectRegion("Replace Material"); return; }
  if (!stats.occupied) {
    openInfo({ title: "Replace Material", content: "A regiao selecionada nao contem terreno. Replace troca o material de voxels ja ocupados — use o Fill para preencher a regiao." });
    return;
  }
  const body = el("div", "rsw-form");
  const labFrom = el("label", "rsw-field__label");
  labFrom.textContent = "Substituir (materiais na regiao)";
  const selFrom = buildMaterialSelect(stats.counts);
  if (stats.dominant >= 0) selFrom.value = String(stats.dominant);
  const labTo = el("label", "rsw-field__label");
  labTo.textContent = "Por";
  const selTo = buildMaterialSelect(null);
  selTo.value = String(terrainStore.getMaterial());
  body.appendChild(labFrom);
  body.appendChild(selFrom);
  body.appendChild(labTo);
  body.appendChild(selTo);
  const hint = el("p", "rsw-confirm__msg");
  hint.textContent = stats.occupied + " voxel(s) ocupados na regiao. A troca pode ser desfeita com Ctrl+Z.";
  body.appendChild(hint);
  const foot = el("div", "rsw-modal__btnrow");
  let h = null;
  foot.appendChild(makeButton("Cancelar", "ghost", () => h && h.close()));
  foot.appendChild(makeButton("Replace", "primary", () => {
    const res = replaceInSelectedRegion(parseInt(selFrom.value, 10), parseInt(selTo.value, 10));
    if (h) h.close();
    if (res.ok) NotificationService.notify("success", res.message);
    else openInfo({ title: "Replace Material", content: res.message });
  }));
  h = openModal({ title: "Replace Material (regiao)", body, footer: foot, width: 380 });
}

function buildGroups() {
  return [
    {
      title: "Create",
      tools: [
        { id: "generate", label: "Generate", icon: "t_generate", size: "large", desc: "Abre o gerador procedural de terreno.", onRun: () => openGenerateTerrainDialog() },
        {
          id: "clear", label: "Clear", icon: "trash", size: "large", desc: "Remove todo o terreno (com confirmacao).",
          onRun: async () => {
            const data = terrainStore.getData();
            if (data.isEmpty()) { openInfo({ title: "Clear", message: "Nao ha terreno para limpar." }); return; }
            const ok = await openConfirm({
              title: "Limpar terreno",
              message: "Isto remove TODO o terreno. Esta acao pode ser desfeita (Ctrl+Z). Continuar?",
              buttons: [{ label: "Cancelar", value: false, kind: "ghost" }, { label: "Limpar", value: true, kind: "danger" }],
            });
            if (ok) clearTerrain();
          },
        },
        {
          id: "region", label: "Region Tools", icon: "filter", size: "large",
          desc: "Select marca uma regiao no viewport; Fill preenche com o material atual; Replace troca um material por outro dentro da regiao.",
          getActive: () => terrainStore.getActiveTool() === REGION_TOOL,
          options: [
            { label: "Select", run: () => terrainStore.setTool(REGION_TOOL) },
            { label: "Fill", run: () => runRegionFill() },
            { label: "Replace", run: () => openRegionReplaceDialog() },
          ],
        },
      ],
    },
    {
      title: "Edit",
      tools: [
        toolEntry("add", "Add", "t_add", "large"),
        toolEntry("subtract", "Subtract", "t_sub", "large"),
        toolEntry("paint", "Paint", "paint", "large"),
        toolEntry("flatten", "Flatten", "t_flatten", "small"),
        toolEntry("smooth", "Smooth", "t_smooth", "small"),
        toolEntry("grow", "Grow", "t_grow", "small"),
        toolEntry("erode", "Erode", "t_erode", "small"),
      ],
    },
    {
      title: "Import / Export",
      tools: [
        { id: "import", label: "Import", icon: "duplicate", size: "large", desc: "Importa terreno de um arquivo .rswterrain (substitui o atual; Ctrl+Z desfaz).", onRun: () => importTerrainFromFile() },
        { id: "export", label: "Export", icon: "layers", size: "large", desc: "Exporta o terreno atual para um arquivo .rswterrain.", onRun: () => exportTerrainToFile() },
        {
          id: "to-parts", label: "To Parts", icon: "part", size: "small",
          desc: "Converte o terreno em Parts (Model \"Terrain Parts\"; Ctrl+Z desfaz).",
          onRun: async () => {
            const data = terrainStore.getData();
            if (data.isEmpty()) { openInfo({ title: "Convert to Parts", message: "Nao ha terreno para converter." }); return; }
            const plan = planTerrainToParts(data);
            if (!plan.boxes.length) {
              openInfo({ title: "Convert to Parts", message: "Nada para converter: o terreno atual so tem agua (agua nao vira Part)." });
              return;
            }
            if (plan.boxes.length > TO_PARTS_MAX) {
              openInfo({ title: "Convert to Parts", message: "Terreno grande demais: a conversao geraria mais de " + TO_PARTS_MAX + " Parts. Reduza o terreno e tente de novo." });
              return;
            }
            const ok = await openConfirm({
              title: "Convert to Parts",
              message: "Converter o terreno em " + plan.boxes.length + " Part(s) dentro do Model \"Terrain Parts\"? O terreno atual e removido" + (plan.water ? " e voxels de agua sao descartados" : "") + ". Ctrl+Z desfaz.",
              buttons: [{ label: "Cancelar", value: false, kind: "ghost" }, { label: "Converter", value: true, kind: "danger" }],
            });
            if (ok) convertTerrainToParts(plan);
          },
        },
      ],
    },
    {
      title: "Settings",
      tools: [
        { id: "brush-settings", label: "Brush Settings", icon: "settings", size: "large", desc: "Abre o painel do Terrain Editor.", onRun: () => toggleTerrainPanel(true) },
        { id: "terrain-material", custom: true, build: (ctx) => buildMaterialControl(ctx) },
        { id: "snap", label: "Snap to Grid", icon: "ruler", size: "small", stateToggle: true, colBreak: true, desc: "Alinha as operacoes a grade de voxels.", onRun: () => terrainStore.setSnap(!terrainStore.getSnap()), getActive: () => terrainStore.getSnap() },
        { id: "ignore-parts", label: "Ignore Parts", icon: "part", size: "small", stateToggle: true, desc: "Quando ativo, o pincel ignora os Parts. Desative para esculpir terreno sobre os Parts.", onRun: () => terrainStore.setIgnoreParts(!terrainStore.getIgnoreParts()), getActive: () => terrainStore.getIgnoreParts() },
      ],
    },
  ];
}

export function buildRibbonTerrain() {
  const ctx = { entries: [], disposers: [], customUpdaters: [] };
  const root = el("div", "rsw-ribbon");
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "Terrain");

  const groups = buildGroups();
  groups.forEach((group, i) => {
    if (i > 0) root.appendChild(el("div", "rsw-rsep"));
    root.appendChild(buildGroupEl(group, ctx));
  });

  function refresh() {
    for (const entry of ctx.entries) {
      if (!entry.el) continue;
      if (entry.getActive) entry.el.classList.toggle("rsw-rtool--active", !!safe(entry.getActive));
      if (entry.getEnabled) {
        const enabled = !!safe(entry.getEnabled);
        entry.el.classList.toggle("rsw-rtool--disabled", !enabled);
        entry.el.setAttribute("aria-disabled", enabled ? "false" : "true");
      }
    }
    for (const u of ctx.customUpdaters) safe(u);
  }
  ctx.afterRun = refresh;

  const offTool = bus.on(TerrainEvents.ToolChanged, refresh);
  const offMat = bus.on(TerrainEvents.MaterialChanged, refresh);


  const offColors = bus.on(TerrainEvents.Changed, (e) => { if (e && e.materialColors != null) refresh(); });
  const offHist = bus.on("history:changed", refresh);
  const offStore = store.subscribe((_s, change) => { if (change && change.key === "activeTool") refresh(); });


  safe(() => mountTerrainPanel(document.querySelector(".rsw-shell") || document.body));

  refresh();

  function destroy() {
    if (typeof offTool === "function") offTool();
    if (typeof offMat === "function") offMat();
    if (typeof offColors === "function") offColors();
    if (typeof offHist === "function") offHist();
    if (typeof offStore === "function") offStore();
    for (const d of ctx.disposers) { try { d(); } catch (_) {} }
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return { el: root, refresh, destroy };
}

import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import {
  MATERIAL_CATEGORIES,
  listBaseMaterials,
  getMaterialDef,
  materialThumbDataUri,
} from "../viewport/baseMaterials.js";
import {
  MAX_VARIANTS,
  STUDS_PER_TILE_MIN,
  STUDS_PER_TILE_MAX,
  getCurrentMaterial,
  setCurrentMaterial,
  isPaintMode,
  setPaintMode,
  applyToSelection,
  listVariants,
  variantData,
  createVariant,
  updateVariant,
  deleteVariant,
} from "../editor/materialPaint.js";

let root = null;
let refs = {};
let inited = false;
const state = {
  visible: false,
  search: "",
  category: "All",
  editing: null,                                                   
  placed: false,
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function btn(label, title, onClick, cls = "rsw-mm__act") {
  const b = el("button", cls, label);
  b.type = "button";
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}


function build() {
  root = el("section", "rsw-mm");
  root.hidden = true;
  root.setAttribute("aria-label", "Material Manager");

  const header = el("div", "rsw-mm__header");
  header.appendChild(el("span", "rsw-mm__title", "Material Manager"));
  header.appendChild(btn("\u00d7", "Fechar", () => hide()));
  header.addEventListener("mousedown", startDrag);
  root.appendChild(header);

  const toolbar = el("div", "rsw-mm__toolbar");
  const search = el("input", "rsw-mm__search");
  search.type = "search";
  search.placeholder = "Buscar material\u2026";
  search.addEventListener("input", () => {
    state.search = search.value.trim().toLowerCase();
    renderBody();
  });
  const filter = el("select", "rsw-mm__filter");
  for (const c of MATERIAL_CATEGORIES) {
    const o = el("option", null, c);
    o.value = c;
    filter.appendChild(o);
  }
  filter.addEventListener("change", () => {
    state.category = filter.value;
    renderBody();
  });
  const applyBtn = btn(
    "Apply to Selection",
    "Aplica o material atual \u00e0s Parts selecionadas (desfaz\u00edvel com Ctrl+Z)",
    () => {
      if (!applyToSelection()) {
        logger.info("Selecione uma ou mais Parts para aplicar o material.");
      }
    },
  );
  const paintBtn = btn(
    "Paint",
    "Modo pintura: clique em Parts no Viewport para aplicar o material atual",
    () => setPaintMode(!isPaintMode()),
  );
  toolbar.appendChild(search);
  toolbar.appendChild(filter);
  toolbar.appendChild(applyBtn);
  toolbar.appendChild(paintBtn);
  toolbar.appendChild(btn("Substrate", "Edit layered materials and inspect rendered closures", async () => {
    try {
      const { openSubstrateMaterialPanel } = await import("./substrateMaterialPanel.js");
      openSubstrateMaterialPanel();
      hide();
    } catch (error) {
      logger.error("Substrate material editor could not open:", error);
    }
  }));
  root.appendChild(toolbar);

  const body = el("div", "rsw-mm__body");
  root.appendChild(body);

  const footer = el("div", "rsw-mm__footer");
  const current = el("span", "rsw-mm__current");
  footer.appendChild(current);
  root.appendChild(footer);

  refs = { body, current, paintBtn };
}

function matchesBase(name) {
  if (state.search && name.toLowerCase().indexOf(state.search) === -1) return false;
  if (state.category !== "All") {
    const def = getMaterialDef(name);
    if (!def || def.cat !== state.category) return false;
  }
  return true;
}

function materialCard(baseName, variantName) {
  const card = el("div", "rsw-mm__card");
  const cur = getCurrentMaterial();
  const isCur = variantName
    ? cur.variant === variantName
    : !cur.variant && cur.material === baseName;
  if (isCur) card.classList.add("is-current");
  const img = el("img", "rsw-mm__thumb");
  img.alt = "";
  img.src = materialThumbDataUri(baseName, 56);
  card.appendChild(img);
  card.appendChild(el("div", "rsw-mm__name", variantName || baseName));
  if (variantName) card.appendChild(el("div", "rsw-mm__variant-base", baseName));
  card.addEventListener("click", () => {
    setCurrentMaterial(baseName, variantName || "");
  });
  return card;
}

function newDraft() {
  return {
    name: "MaterialVariant",
    baseMaterial: "Plastic",
    colorMap: "",
    normalMap: "",
    metalnessMap: "",
    roughnessMap: "",
    studsPerTile: 10,
    materialPattern: "Regular",
    setAsOverride: false,
  };
}

function renderBody() {
  if (!refs.body) return;
  refs.body.textContent = "";
  if (state.editing) {
    refs.body.appendChild(variantForm());
    return;
  }


  refs.body.appendChild(el("div", "rsw-mm__section-title", "Base Materials"));
  const grid = el("div", "rsw-mm__grid");
  let count = 0;
  for (const name of listBaseMaterials()) {
    if (!matchesBase(name)) continue;
    grid.appendChild(materialCard(name, null));
    count += 1;
  }
  refs.body.appendChild(grid);
  if (!count) refs.body.appendChild(el("div", "rsw-mm__empty", "Nenhum material encontrado."));


  const head = el("div", "rsw-mm__section-title", "Custom Materials");
  const add = btn(
    "+ New Variant",
    "Criar um MaterialVariant no MaterialService",
    () => {
      state.editing = { variant: null, draft: newDraft() };
      renderBody();
    },
    "rsw-mm__mini",
  );
  if (listVariants().length >= MAX_VARIANTS) add.disabled = true;
  head.appendChild(add);
  refs.body.appendChild(head);

  const variants = listVariants();
  const cgrid = el("div", "rsw-mm__grid");
  for (const v of variants) {
    const data = variantData(v);
    if (!data) continue;
    if (state.search && data.name.toLowerCase().indexOf(state.search) === -1) continue;
    const card = materialCard(data.baseMaterial, data.name);
    const actions = el("div", "rsw-mm__row-actions");
    actions.appendChild(
      btn(
        "Edit",
        "Editar esta variante",
        (e) => {
          e.stopPropagation();
          state.editing = { variant: v, draft: { ...data } };
          renderBody();
        },
        "rsw-mm__mini",
      ),
    );
    actions.appendChild(
      btn(
        "Del",
        "Deletar esta variante",
        (e) => {
          e.stopPropagation();
          const ok = window.confirm(
            `Deletar a variante "${data.name}"? Parts que a usam voltam ao material base.`,
          );
          if (!ok) return;
          deleteVariant(v);
          renderBody();
        },
        "rsw-mm__mini",
      ),
    );
    card.appendChild(actions);
    cgrid.appendChild(card);
  }
  refs.body.appendChild(cgrid);
  if (!variants.length) {
    refs.body.appendChild(
      el("div", "rsw-mm__empty", 'Nenhuma variante criada. Use "+ New Variant".'),
    );
  }
}


function variantForm() {
  const editing = state.editing;
  const d = editing.draft;
  const wrap = el("div", "rsw-mm__form");
  wrap.appendChild(
    el("div", "rsw-mm__section-title", editing.variant ? "Edit Variant" : "New Variant"),
  );

  const row = (label, control) => {
    const r = el("div", "rsw-mm__formrow");
    r.appendChild(el("label", "rsw-mm__formlabel", label));
    r.appendChild(control);
    return r;
  };

  const nameIn = el("input", "rsw-mm__forminput");
  nameIn.type = "text";
  nameIn.value = d.name;
  nameIn.addEventListener("input", () => {
    d.name = nameIn.value;
  });
  wrap.appendChild(row("Name", nameIn));

  const baseSel = el("select", "rsw-mm__forminput");
  for (const m of listBaseMaterials()) {
    const o = el("option", null, m);
    o.value = m;
    baseSel.appendChild(o);
  }
  baseSel.value = d.baseMaterial;
  baseSel.addEventListener("change", () => {
    d.baseMaterial = baseSel.value;
  });
  wrap.appendChild(row("Base Material", baseSel));

  const studs = el("input", "rsw-mm__forminput");
  studs.type = "number";
  studs.min = String(STUDS_PER_TILE_MIN);
  studs.max = String(STUDS_PER_TILE_MAX);
  studs.step = "0.5";
  studs.value = String(d.studsPerTile);
  studs.addEventListener("input", () => {
    const v = parseFloat(studs.value);
    if (Number.isFinite(v)) d.studsPerTile = v;
  });
  wrap.appendChild(row("Studs Per Tile", studs));

  const patSel = el("select", "rsw-mm__forminput");
  for (const p of ["Regular", "Organic"]) {
    const o = el("option", null, p);
    o.value = p;
    patSel.appendChild(o);
  }
  patSel.value = d.materialPattern || "Regular";
  patSel.addEventListener("change", () => {
    d.materialPattern = patSel.value;
  });
  wrap.appendChild(row("Pattern", patSel));

  const override = el("input");
  override.type = "checkbox";
  override.checked = !!d.setAsOverride;
  override.title = "Substitui globalmente o material base por esta variante";
  override.addEventListener("change", () => {
    d.setAsOverride = override.checked;
  });
  wrap.appendChild(row("Set As Override", override));


  for (const [label, key] of [
    ["Color Map", "colorMap"],
    ["Normal Map", "normalMap"],
    ["Metalness Map", "metalnessMap"],
    ["Roughness Map", "roughnessMap"],
  ]) {
    const box = el("div", "rsw-mm__maprow");
    const val = el("span", "rsw-mm__mapval", d[key] || "(nenhum)");
    const browse = btn(
      "Browse",
      "Escolher imagem no Asset Manager (duplo clique seleciona)",
      () => {
        bus.emit("assetmanager:pick", {
          section: "images",
          onPick: (assetId) => {
            d[key] = String(assetId || "");
            val.textContent = d[key] || "(nenhum)";
          },
        });
      },
      "rsw-mm__mini",
    );
    const clear = btn(
      "Clear",
      "Remover este mapa",
      () => {
        d[key] = "";
        val.textContent = "(nenhum)";
      },
      "rsw-mm__mini",
    );
    box.appendChild(val);
    box.appendChild(browse);
    box.appendChild(clear);
    wrap.appendChild(row(label, box));
  }

  const actions = el("div", "rsw-mm__formrow");
  actions.appendChild(
    btn("Save", "Salvar variante", () => {
      const name = String(d.name || "").trim();
      if (!name) {
        logger.warn("D\u00ea um nome \u00e0 variante antes de salvar.");
        return;
      }
      d.name = name;
      let ok = false;
      if (editing.variant) ok = updateVariant(editing.variant, d);
      else ok = !!createVariant(d);
      if (!ok) logger.warn("N\u00e3o foi poss\u00edvel salvar a variante.");
      state.editing = null;
      renderBody();
    }),
  );
  actions.appendChild(
    btn("Cancel", "Descartar altera\u00e7\u00f5es", () => {
      state.editing = null;
      renderBody();
    }),
  );
  wrap.appendChild(actions);
  return wrap;
}




function startDrag(e) {
  if (e.target.closest("button")) return;
  e.preventDefault();
  const rect = root.getBoundingClientRect();
  const dx = e.clientX - rect.left;
  const dy = e.clientY - rect.top;
  const onMove = (ev) => {
    root.style.left = Math.max(0, ev.clientX - dx) + "px";
    root.style.top = Math.max(0, ev.clientY - dy) + "px";
    root.style.transform = "none";
    state.placed = true;
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function mount() {
  if (!root.parentElement) {
    const shell = document.querySelector(".rsw-shell") || document.body;
    shell.appendChild(root);
  }
}

function syncStatus() {
  if (!refs.current) return;
  const cur = getCurrentMaterial();
  refs.current.textContent = cur.variant
    ? `Material atual: ${cur.variant} (${cur.material})`
    : `Material atual: ${cur.material}`;
  refs.paintBtn.classList.toggle("is-active", isPaintMode());
}

function show() {
  mount();
  root.hidden = false;
  state.visible = true;
  if (!state.placed) {
    root.style.left = "50%";
    root.style.top = "96px";
    root.style.transform = "translateX(-50%)";
  }
  renderBody();
  syncStatus();
}

function hide() {
  if (root) root.hidden = true;
  state.visible = false;
  state.editing = null;

  if (isPaintMode()) setPaintMode(false);
}

function toggle() {
  if (state.visible) hide();
  else show();
}

export function initMaterialManager() {
  if (inited) return root;
  inited = true;
  build();
  mount();
  bus.on("materialmanager:toggle", () => toggle());
  bus.on("material:current", () => {
    syncStatus();
    if (state.visible && !state.editing) renderBody();
  });
  bus.on("material:paintmode", (on) => {
    syncStatus();
    if (on) logger.info("Modo Paint ativo: clique em Parts no Viewport para aplicar o material.");
  });
  bus.on("materials:variants-changed", () => {
    if (state.visible && !state.editing) renderBody();
  });
  bus.on("history:changed", () => {
    if (state.visible && !state.editing) renderBody();
  });
  logger.info("Material Manager inicializado.");
  return root;
}

export function isMaterialManagerVisible() {
  return state.visible;
}

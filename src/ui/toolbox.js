import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { createIcon } from "./icons.js";
import { markThumbnailFailureOnError } from "./thumbnailFallback.js";           
import { thumbDataUri, thumbColor } from "../assets/thumbnails.js";
import {
  MOCK_ASSETS,
  getAssetById,
  queryAssets,
  SORTS,
  TYPE_FILTERS,
  CREATOR_FILTERS,
  ASSET_TYPES,
} from "../assets/mockAssets.js";
import { assetStore } from "../assets/assetStore.js";
import { insertAsset, canInsert } from "../assets/assetOps.js";
import { modelSpecFor } from "../assets/modelFactory.js";


import { playAssetPreview, stopAudioPreview, isAudioPreviewActive } from "../audio/audioEngine.js";
import "./audioPreviewBar.js";

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE = 300;
const PREVIEW_DELAY = 800;

const CATEGORIES = [
  { id: "marketplace", label: "Marketplace" },
  { id: "myModels", label: "My Models" },
  { id: "myDecals", label: "My Decals" },
  { id: "myAudio", label: "My Audio" },
  { id: "myMeshes", label: "My Meshes" },
  { id: "myPackages", label: "My Packages" },
  { id: "recent", label: "Recent" },
  { id: "favorites", label: "Favorites" },
];


const TYPE_TABS = [
  { id: "Model", label: "Models" },
  { id: "Decal", label: "Decals" },
  { id: "Audio", label: "Audio" },
  { id: "Mesh", label: "Meshes" },
  { id: "Plugin", label: "Plugins" },
  { id: "Animation", label: "Animations" },
  { id: "Video", label: "Videos" },
  { id: "Font", label: "Fonts" },
];

const RATING_OPTS = [
  { v: 0, label: "Qualquer rating" },
  { v: 3, label: "3+ estrelas" },
  { v: 4, label: "4+ estrelas" },
  { v: 4.5, label: "4.5+ estrelas" },
];




function el(tag, attrs, kids) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k.slice(0, 2) === "on" && typeof v === "function")
        node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "title") node.title = v;
      else node.setAttribute(k, v);
    }
  }
  if (kids != null) {
    for (const c of [].concat(kids)) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
  }
  return node;
}

function rgb255(c) {
  return [
    Math.round(c[0] * 255),
    Math.round(c[1] * 255),
    Math.round(c[2] * 255),
  ];
}


function resolveAsset(id) {
  return getAssetById(id) || assetStore.getById(id) || null;
}


let root = null;                      
let refs = {};                        
let thumbObserver = null;
let previewEl = null;
let previewTimer = null;
let searchTimer = null;
let inited = false;

const state = {
  visible: false,
  category: "marketplace",
  assetType: "Model",
  search: "",
  sort: "relevance",
  typeFilter: "all",
  creatorFilter: "anyone",
  minRating: 0,
  view: "grid",               
  filtersOpen: false,
  selectedId: null,
  fullList: [],
  rendered: 0,
  loading: false,
  error: false,
};


function matchSearch(a, q) {
  if (!q) return true;
  const n = q.toLowerCase();
  return (
    (a.name || "").toLowerCase().includes(n) ||
    (a.creator || "").toLowerCase().includes(n)
  );
}


let pkgCache = [];
let pkgCacheBusy = false;
function pkgAsset(m) {
  return {
    id: "pkg:" + m.id,
    name: m.name,
    assetType: "Package",
    creator: "Local",
    rating: 5,
    local: true,
    section: "packages",
    packageId: m.id,
    version: m.version,
  };
}
function refreshPkgCache() {
  if (pkgCacheBusy) return;
  pkgCacheBusy = true;
  import("../packages/packageStore.js")
    .then((mod) => mod.packageStore.safeListPackages())
    .then((list) => {
      pkgCacheBusy = false;
      const next = Array.isArray(list) ? list : [];
      const changed =
        next.length !== pkgCache.length ||
        next.some((m, i) => {
          const o = pkgCache[i];
          return !o || o.id !== m.id || o.version !== m.version || o.name !== m.name;
        });
      pkgCache = next;
      if (changed && state.visible && state.category === "myPackages") reload();
    })
    .catch(() => { pkgCacheBusy = false; });
}

function computeList() {
  const cat = state.category;
  if (cat === "marketplace") {
    const r = queryAssets({
      assetType: state.assetType,
      search: state.search,
      sort: state.sort,
      typeFilter: state.typeFilter,
      creatorFilter: state.creatorFilter,
      minRating: state.minRating,
      page: 0,
      pageSize: MOCK_ASSETS.length,                                          
    });
    return r.items;
  }
  if (cat === "recent") {
    return assetStore
      .recentIds()
      .map(resolveAsset)
      .filter(Boolean)
      .filter((a) => matchSearch(a, state.search));
  }
  if (cat === "favorites") {
    return assetStore
      .favoriteIds()
      .map(resolveAsset)
      .filter(Boolean)
      .filter((a) => matchSearch(a, state.search));
  }

  const SECTION_OF = {
    myModels: null,                         
    myDecals: "images",
    myAudio: "audio",
    myMeshes: "meshes",
    myPackages: "packages",
  };
  if (cat === "myPackages") {
    refreshPkgCache();
    return pkgCache.map(pkgAsset).filter((a) => matchSearch(a, state.search));
  }
  const sec = SECTION_OF[cat];
  if (!sec) return [];
  return assetStore.list(sec).filter((a) => matchSearch(a, state.search));
}


function thumbFor(asset) {
  if (asset.local && asset.dataUri && asset.section === "images") return asset.dataUri;
  return thumbDataUri(asset, 120);
}


function build() {
  root = el("aside", {
    class: "rsw-toolbox",
    "aria-label": "Toolbox",
    hidden: "",
  });


  const closeBtn = el("button", {
    class: "rsw-tbx__close",
    title: "Fechar Toolbox",
    "aria-label": "Fechar Toolbox",
    type: "button",
    onclick: () => hide(),
  });
  closeBtn.appendChild(createIcon("close", 14));
  const header = el("div", { class: "rsw-tbx__header" }, [
    el("span", { class: "rsw-tbx__title", text: "Toolbox" }),
    closeBtn,
  ]);


  const catSel = el(
    "select",
    {
      class: "rsw-tbx__category",
      "aria-label": "Categoria",
      onchange: (e) => {
        state.category = e.target.value;
        state.selectedId = null;
        syncTypeTabs();
        reload();
      },
    },
    CATEGORIES.map((c) => el("option", { value: c.id, text: c.label })),
  );
  refs.catSel = catSel;


  const typeTabs = el(
    "div",
    { class: "rsw-tbx__types" },
    TYPE_TABS.map((t) =>
      el("button", {
        class: "rsw-tbx__type" + (t.id === state.assetType ? " is-active" : ""),
        type: "button",
        dataset: { type: t.id },
        text: t.label,
        onclick: () => {
          state.assetType = t.id;
          syncTypeTabs();
          reload();
        },
      }),
    ),
  );
  refs.typeTabs = typeTabs;


  const searchIcon = el("span", { class: "rsw-tbx__searchicon" });
  searchIcon.appendChild(createIcon("find", 14));
  const input = el("input", {
    class: "rsw-tbx__input",
    type: "text",
    placeholder: "Buscar assets\u2026",
    "aria-label": "Buscar assets",
    oninput: (e) => onSearchInput(e.target.value),
  });
  refs.input = input;
  const clearBtn = el("button", {
    class: "rsw-tbx__clear",
    type: "button",
    title: "Limpar busca",
    "aria-label": "Limpar busca",
    hidden: "",
    onclick: () => {
      input.value = "";
      onSearchInput("");
    },
  });
  clearBtn.appendChild(createIcon("close", 12));
  refs.clearBtn = clearBtn;
  const filtersBtn = el("button", {
    class: "rsw-tbx__filters",
    type: "button",
    title: "Filtros avan\u00e7ados",
    "aria-label": "Filtros avan\u00e7ados",
    onclick: () => toggleFilters(),
  });
  filtersBtn.appendChild(createIcon("filter", 14));
  refs.filtersBtn = filtersBtn;
  const viewBtn = el("button", {
    class: "rsw-tbx__viewtoggle",
    type: "button",
    title: "Alternar grid/lista",
    "aria-label": "Alternar grid/lista",
    onclick: () => {
      state.view = state.view === "grid" ? "list" : "grid";
      viewBtn.replaceChildren(createIcon(state.view === "grid" ? "listView" : "gridView", 14));
      results.classList.toggle("is-list", state.view === "list");
    },
  });
  viewBtn.appendChild(createIcon("listView", 14));
  const searchRow = el("div", { class: "rsw-tbx__searchrow" }, [
    el("div", { class: "rsw-tbx__searchwrap" }, [searchIcon, input, clearBtn]),
    filtersBtn,
    viewBtn,
  ]);


  const filtersPanel = buildFiltersPanel();
  refs.filtersPanel = filtersPanel;


  const results = el("div", { class: "rsw-tbx__results" });
  refs.results = results;
  results.addEventListener("scroll", onResultsScroll);

  root.appendChild(header);
  root.appendChild(catSel);
  root.appendChild(typeTabs);
  root.appendChild(searchRow);
  root.appendChild(filtersPanel);
  root.appendChild(results);


  thumbObserver = new IntersectionObserver(onThumbVisible, {
    root: results,
    rootMargin: "120px",
  });

  syncTypeTabs();
  return root;
}

function buildFiltersPanel() {
  const mkSelect = (label, opts, getVal, onChange) => {
    const sel = el(
      "select",
      { class: "rsw-tbx__fselect", onchange: (e) => onChange(e.target.value) },
      opts.map((o) =>
        el("option", {
          value: String(o.value),
          text: o.label,
          selected: String(o.value) === String(getVal()) ? "" : null,
        }),
      ),
    );
    return el("label", { class: "rsw-tbx__field" }, [
      el("span", { class: "rsw-tbx__flabel", text: label }),
      sel,
    ]);
  };
  const panel = el("div", { class: "rsw-tbx__filterspanel", hidden: "" }, [
    mkSelect(
      "Ordenar por",
      SORTS.map((s) => ({ value: s.id, label: s.label })),
      () => state.sort,
      (v) => {
        state.sort = v;
        reload();
      },
    ),
    mkSelect(
      "Tipo",
      TYPE_FILTERS.map((s) => ({ value: s.id, label: s.label })),
      () => state.typeFilter,
      (v) => {
        state.typeFilter = v;
        reload();
      },
    ),
    mkSelect(
      "Criador",
      CREATOR_FILTERS.map((s) => ({ value: s.id, label: s.label })),
      () => state.creatorFilter,
      (v) => {
        state.creatorFilter = v;
        reload();
      },
    ),
    mkSelect(
      "Rating m\u00ednimo",
      RATING_OPTS.map((s) => ({ value: s.v, label: s.label })),
      () => state.minRating,
      (v) => {
        state.minRating = Number(v);
        reload();
      },
    ),
  ]);
  return panel;
}

function toggleFilters() {
  state.filtersOpen = !state.filtersOpen;
  refs.filtersPanel.hidden = !state.filtersOpen;
  refs.filtersBtn.classList.toggle("is-active", state.filtersOpen);
}

function syncTypeTabs() {
  const isMarket = state.category === "marketplace";
  refs.typeTabs.hidden = !isMarket;

  refs.filtersBtn.disabled = !isMarket;
  if (isMarket) {
    for (const btn of refs.typeTabs.querySelectorAll(".rsw-tbx__type")) {
      btn.classList.toggle("is-active", btn.dataset.type === state.assetType);
    }
  }
}


function onSearchInput(value) {
  refs.clearBtn.hidden = !value;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = String(value || "").trim();
    reload();
  }, SEARCH_DEBOUNCE);
}


function reload() {
  state.loading = true;
  state.error = false;
  renderSkeleton();

  setTimeout(() => {
    try {
      state.fullList = computeList();
      state.loading = false;
      state.rendered = 0;
      renderResults(true);
    } catch (err) {
      logger.warn(`Toolbox: falha ao carregar (${err && err.message}).`);
      state.loading = false;
      state.error = true;
      renderError();
    }
  }, 220);
}

function clearResults() {
  if (thumbObserver) thumbObserver.disconnect();
  refs.results.textContent = "";
}

function renderSkeleton() {
  clearResults();
  refs.results.classList.toggle("is-list", state.view === "list");
  const grid = el("div", { class: "rsw-tbx__grid" });
  for (let i = 0; i < 8; i++) {
    grid.appendChild(el("div", { class: "rsw-tbx__skel" }));
  }
  refs.results.appendChild(grid);
}

function renderError() {
  clearResults();
  const box = el("div", { class: "rsw-tbx__state rsw-tbx__state--error" }, [
    el("p", { text: "Falha ao carregar os assets." }),
    el("button", {
      class: "rsw-tbx__retry",
      type: "button",
      text: "Tentar novamente",
      onclick: () => reload(),
    }),
  ]);
  refs.results.appendChild(box);
}

function renderResults(reset) {
  if (reset) {
    clearResults();
    refs.results.scrollTop = 0;
    state.rendered = 0;
    if (!state.fullList.length) {
      refs.results.appendChild(
        el("div", { class: "rsw-tbx__state rsw-tbx__state--empty" }, [
          el("p", { text: "No results found" }),
        ]),
      );
      return;
    }
    const grid = el("div", { class: "rsw-tbx__grid" });
    refs.gridEl = grid;
    refs.results.appendChild(grid);
    const sentinel = el("div", { class: "rsw-tbx__sentinel" });
    refs.sentinel = sentinel;
    refs.results.appendChild(sentinel);
  }
  appendMore();
}

function appendMore() {
  const grid = refs.gridEl;
  if (!grid) return;
  const next = state.fullList.slice(state.rendered, state.rendered + PAGE_SIZE);
  for (const asset of next) grid.appendChild(buildCard(asset));
  state.rendered += next.length;

  if (refs.sentinel) refs.results.appendChild(refs.sentinel);
  refs.spinnerActive = false;
  const sp = refs.results.querySelector(".rsw-tbx__spinner");
  if (sp) sp.remove();
}

function onResultsScroll() {
  if (state.loading || state.error) return;
  if (state.rendered >= state.fullList.length) return;
  const r = refs.results;
  if (r.scrollTop + r.clientHeight >= r.scrollHeight - 160) {
    if (refs.spinnerActive) return;
    refs.spinnerActive = true;
    const spinner = el("div", { class: "rsw-tbx__spinner" }, [
      el("div", { class: "rsw-tbx__spinnerdot" }),
      el("span", { text: "Carregando\u2026" }),
    ]);
    refs.results.appendChild(spinner);
    setTimeout(() => appendMore(), 200);
  }
}


function buildCard(asset) {
  const card = el("div", {
    class: "rsw-tbx__card" + (asset.id === state.selectedId ? " is-selected" : ""),
    dataset: { id: asset.id },
    draggable: "true",
    tabindex: "0",
  });


  const img = el("img", {
    class: "rsw-tbx__thumb",
    alt: "",
    draggable: "false",
  });
  img.dataset.thumb = thumbFor(asset);
  img.style.background = thumbColor(asset);
  const thumbWrap = el("div", { class: "rsw-tbx__thumbwrap" }, [img]);
  thumbWrap.appendChild(
    el("span", { class: "rsw-tbx__badge", text: asset.assetType }),
  );
  if (asset.paid) {
    thumbWrap.appendChild(
      el("span", { class: "rsw-tbx__price", text: "R$ " + (asset.price || 0) }),
    );
  }


  if (asset.assetType === "Audio") {
    const pbtn = document.createElement("button");
    pbtn.type = "button";
    pbtn.className = "rsw-tbx__playpreview";
    pbtn.appendChild(createIcon("play", 11));
    pbtn.title = "Play Preview";
    pbtn.style.cssText =
      "position:absolute;bottom:4px;right:4px;z-index:2;width:24px;height:24px;" +
      "border-radius:50%;border:none;cursor:pointer;background:rgba(0,0,0,0.65);" +
      "color:#fff;font-size:11px;padding:0;";
    pbtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isAudioPreviewActive(String(asset.id))) stopAudioPreview();
      else playAssetPreview(String(asset.id), asset.name);
    });
    thumbWrap.style.position = "relative";
    thumbWrap.appendChild(pbtn);
  }
  if (thumbObserver) thumbObserver.observe(img);


  const name = el("div", { class: "rsw-tbx__name", title: asset.name });
  name.textContent = asset.name;                             
  const creator = el("div", { class: "rsw-tbx__creator" });
  creator.textContent = "by " + (asset.creator || "Unknown");
  const rating = el("div", { class: "rsw-tbx__rating" });
  rating.appendChild(buildStars(asset.rating || 0));

  card.appendChild(thumbWrap);
  card.appendChild(name);
  card.appendChild(creator);
  card.appendChild(rating);


  card.addEventListener("click", () => selectCard(asset, card));
  card.addEventListener("dblclick", () => doInsert(asset));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doInsert(asset);
  });
  card.addEventListener("dragstart", (e) => {
    try {
      e.dataTransfer.setData("application/x-rsw-asset", asset.id);
      e.dataTransfer.setData("text/plain", asset.name);
      e.dataTransfer.effectAllowed = "copy";
    } catch (_) {}
    draggedAssetId = asset.id;
    hidePreview();
  });
  card.addEventListener("dragend", () => {
    draggedAssetId = null;
  });
  card.addEventListener("mouseenter", () => schedulePreview(asset, card));
  card.addEventListener("mouseleave", () => cancelPreview());
  return card;
}

function buildStars(rating) {
  const wrap = el("span", { class: "rsw-tbx__stars", title: rating.toFixed(1) });
  const full = Math.round(rating);
  for (let i = 1; i <= 5; i++) {
    wrap.appendChild(
      el("span", {
        class: "rsw-tbx__star" + (i <= full ? " is-on" : ""),
      }, [createIcon(i <= full ? "starFill" : "star", 10)]),
    );
  }
  wrap.appendChild(el("span", { class: "rsw-tbx__ratingnum", text: rating.toFixed(1) }));
  return wrap;
}

function selectCard(asset, card) {
  state.selectedId = asset.id;
  const prev = refs.results.querySelector(".rsw-tbx__card.is-selected");
  if (prev) prev.classList.remove("is-selected");
  card.classList.add("is-selected");
}

function doInsert(asset) {
  hidePreview();
  if (asset && asset.packageId) {
    import("../packages/packages.js")
      .then((m) => m.insertCopy(asset.packageId))
      .then((res) => {
        if (res && res.ok) logger.info(`Package inserido do Toolbox: ${asset.name} (v${asset.version}).`);
        else logger.warn("Falha ao inserir package: " + ((res && res.error) || "erro"));
      });
    return;
  }
  const inst = insertAsset(asset);
  if (inst) {
    logger.info(`Inserido do Toolbox: ${asset.name} (${asset.assetType}).`);
  } else if (!canInsert(asset.assetType)) {
    logger.info(`"${asset.assetType}" n\u00e3o insere geometria na cena.`);
  }
}


function onThumbVisible(entries) {
  for (const ent of entries) {
    if (!ent.isIntersecting) continue;
    const img = ent.target;
    if (img.dataset.thumb && !img.src) {


      img.addEventListener("load", onThumbLoaded, { once: true });


      markThumbnailFailureOnError(img, img.closest(".rsw-tbx__thumbwrap"));
      img.src = img.dataset.thumb;
    }
    thumbObserver.unobserve(img);
  }
}

function onThumbLoaded(event) {
  event.currentTarget.classList.add("is-loaded");
}


let draggedAssetId = null;

function schedulePreview(asset, card) {
  cancelPreview();
  previewTimer = setTimeout(() => showPreview(asset, card), PREVIEW_DELAY);
}
function cancelPreview() {
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
}
function hidePreview() {
  cancelPreview();
  if (previewEl) {
    previewEl.remove();                                   
    previewEl = null;
  }
}

function showPreview(asset, card) {
  hidePreview();
  const rect = card.getBoundingClientRect();
  const box = el("div", { class: "rsw-tbx-preview" });


  if (asset.assetType === "Model") {
    const img = el("img", { class: "rsw-tbx-preview__media", alt: "" });
    img.src = modelPreviewDataUri(asset);                      
    box.appendChild(img);
  } else if (asset.assetType === "Audio") {
    const playBtn = el("button", {
      class: "rsw-tbx-preview__play",
      type: "button",
      text: "Ouvir amostra",
      onclick: () => playSample(asset),
    });
    playBtn.prepend(createIcon("play", 11));
    const media = el("div", { class: "rsw-tbx-preview__audio" }, [playBtn]);
    box.appendChild(media);
  } else {
    const img = el("img", { class: "rsw-tbx-preview__media", alt: "" });
    img.src = thumbFor(asset);
    box.appendChild(img);
  }

  const name = el("div", { class: "rsw-tbx-preview__name" });
  name.textContent = asset.name;
  const creator = el("div", { class: "rsw-tbx-preview__row" });
  creator.textContent = "Criador: " + (asset.creator || "Unknown");
  const idRow = el("div", { class: "rsw-tbx-preview__row rsw-tbx-preview__id" });
  idRow.textContent = "Asset ID: " + asset.id;
  const desc = el("div", { class: "rsw-tbx-preview__desc" });
  desc.textContent = asset.description || "";

  box.appendChild(name);
  box.appendChild(creator);
  box.appendChild(idRow);
  box.appendChild(desc);

  document.body.appendChild(box);

  const pw = box.offsetWidth || 260;
  const ph = box.offsetHeight || 220;
  let left = rect.right + 10;
  if (left + pw > window.innerWidth - 8) left = rect.left - pw - 10;
  if (left < 8) left = 8;
  let top = rect.top;
  if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
  if (top < 8) top = 8;
  box.style.left = left + "px";
  box.style.top = top + "px";
  previewEl = box;
  box.addEventListener("mouseleave", () => hidePreview());
}


function modelPreviewDataUri(asset) {
  const spec = modelSpecFor(asset);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of spec.parts) {
    minX = Math.min(minX, p.pos[0] - p.size[0] / 2);
    maxX = Math.max(maxX, p.pos[0] + p.size[0] / 2);
    minY = Math.min(minY, p.pos[1] - p.size[1] / 2);
    maxY = Math.max(maxY, p.pos[1] + p.size[1] / 2);
  }
  if (!Number.isFinite(minX)) {
    minX = -5; maxX = 5; minY = 0; maxY = 10;
  }
  const W = 240, H = 180, PAD = 16;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const offX = (W - spanX * scale) / 2;
  const offY = (H - spanY * scale) / 2;
  const mapX = (x) => offX + (x - minX) * scale;
  const mapY = (y) => H - (offY + (y - minY) * scale);                  

  const parts = spec.parts
    .slice()
    .sort((a, b) => b.pos[2] - a.pos[2]);                   
  let shapes = "";
  for (const p of parts) {
    const [r, g, b] = rgb255(p.color);
    const fill = `rgb(${r},${g},${b})`;
    const w = p.size[0] * scale;
    const h = p.size[1] * scale;
    const cx = mapX(p.pos[0]);
    const cy = mapY(p.pos[1]);
    if (p.shape === "Ball") {
      shapes +=
        `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(w / 2).toFixed(1)}" ry="${(h / 2).toFixed(1)}" fill="${fill}" stroke="rgba(0,0,0,0.25)"/>`;
    } else {
      const rx = p.shape === "Cylinder" ? Math.min(w, h) * 0.32 : 3;
      shapes +=
        `<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx.toFixed(1)}" fill="${fill}" stroke="rgba(0,0,0,0.25)"/>`;
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#1f2430"/>` +
    `<line x1="0" y1="${(H - offY).toFixed(1)}" x2="${W}" y2="${(H - offY).toFixed(1)}" stroke="rgba(255,255,255,0.08)"/>` +
    shapes +
    `</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}


function playSample(asset) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const seed = (String(asset.id).length + (asset.name || "").length) % 12;
    osc.type = ["sine", "triangle", "square", "sawtooth"][seed % 4];
    osc.frequency.value = 220 + seed * 40;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.start(t);
    osc.stop(t + 0.58);
    osc.onended = () => {
      try {
        ctx.close();
      } catch (_) {}
    };
  } catch (err) {
    logger.warn(`Toolbox: amostra de \u00e1udio indispon\u00edvel (${err && err.message}).`);
  }
}


function wireViewportDrop() {
  const host =
    document.querySelector(".rsw-viewport") ||
    document.querySelector(".rsw-center");
  if (!host || host.dataset.tbxDrop === "1") return;
  host.dataset.tbxDrop = "1";
  host.addEventListener("dragover", (e) => {
    if (draggedAssetId || (e.dataTransfer && e.dataTransfer.types.includes("application/x-rsw-asset"))) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      host.classList.add("rsw-viewport--dropping");
    }
  });
  host.addEventListener("dragleave", () => host.classList.remove("rsw-viewport--dropping"));
  host.addEventListener("drop", (e) => {
    host.classList.remove("rsw-viewport--dropping");
    let id = "";
    try {
      id = e.dataTransfer.getData("application/x-rsw-asset");
    } catch (_) {}
    if (!id) id = draggedAssetId;
    draggedAssetId = null;
    if (!id) return;
    e.preventDefault();
    const asset = resolveAsset(id);
    if (asset) doInsert(asset);
  });
}


function mount() {
  const main = document.querySelector(".rsw-work-main");
  if (main && root.parentElement !== main) {
    main.insertBefore(root, main.firstChild);                   
  } else if (!main && !root.parentElement) {
    const shell = document.querySelector(".rsw-shell") || document.body;
    shell.appendChild(root);
  }
}

function show() {
  mount();
  root.hidden = false;
  state.visible = true;
  wireViewportDrop();

  if (!state.fullList.length && !state.loading) reload();
  bus.emit("toolbox:visibility", { visible: true });
}

function hide() {
  if (root) root.hidden = true;
  state.visible = false;
  hidePreview();
  bus.emit("toolbox:visibility", { visible: false });
}

function toggle() {
  if (state.visible) hide();
  else show();
}


function onStoreChange() {
  if (!state.visible) return;
  if (["recent", "favorites", "myDecals", "myAudio", "myMeshes", "myPackages", "myModels"].includes(state.category)) {
    reload();
  }
}

export function initToolbox() {
  if (inited) return root;
  inited = true;
  build();
  mount();
  bus.on("toolbox:toggle", () => toggle());
  bus.on("toolbox:show", () => show());
  bus.on("toolbox:hide", () => hide());
  bus.on("assets:changed", () => onStoreChange());
  bus.on("packages:changed", () => refreshPkgCache());
  refreshPkgCache();
  bus.on("assets:recentChanged", () => onStoreChange());
  bus.on("assets:favoritesChanged", () => onStoreChange());

  window.addEventListener("scroll", () => hidePreview(), true);
  window.addEventListener("resize", () => hidePreview());
  logger.info("Toolbox inicializado.");
  return root;
}

export function isToolboxVisible() {
  return state.visible;
}

import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { createIcon } from "./icons.js";
import { markThumbnailFailureOnError } from "./thumbnailFallback.js";           
import { openContextMenu } from "./contextMenu.js";
import { thumbDataUri, thumbColor } from "../assets/thumbnails.js";

import { parseObj, countObjTriangles, renderObjThumbnail, MAX_TRIANGLES } from "../assets/objParser.js";
import {
  assetStore,
  SECTIONS,
  SECTION_LABELS,
  validateImport,
  acceptAttribute,
} from "../assets/assetStore.js";
import { registerSkin } from "../assets/skinRegistry.js";            
import { buildSimulatedSkinnedMesh } from "../assets/skinnedMeshFactory.js";            
import { insertAsset, canInsert } from "../assets/assetOps.js";


import { playAssetPreview, stopAudioPreview, isAudioPreviewActive } from "../audio/audioEngine.js";
import "./audioPreviewBar.js";

let root = null;
let refs = {};
let inited = false;
const state = {
  visible: false,
  section: "images",
  view: "grid",               
  selectedId: null,
  pos: { left: 0, top: 0, placed: false },
};


let pickRequest = null;

function finishPick(asset) {
  const req = pickRequest;
  pickRequest = null;
  if (req && typeof req.onPick === "function") {
    try {
      req.onPick(String(asset.id));
    } catch (err) {
      logger.warn(`Browse: callback falhou (${err && err.message}).`);
    }
  }
  hide();
}

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

function formatSize(bytes) {
  const b = Number(bytes) || 0;
  if (b <= 0) return "\u2014";
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / 1024 / 1024).toFixed(1) + " MB";
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "\u2014";
    return d.toLocaleDateString();
  } catch (_) {
    return "\u2014";
  }
}

function thumbFor(asset) {
  if (asset.thumb) return asset.thumb;                                              
  if (asset.dataUri && asset.section === "images") return asset.dataUri;
  return thumbDataUri(asset, 96);
}




function build() {
  root = el("section", {
    class: "rsw-am",
    "aria-label": "Asset Manager",
    hidden: "",
  });


  const importBtn = el("button", {
    class: "rsw-am__act",
    type: "button",
    title: "Importar arquivo",
    onclick: () => triggerImport(),
  });
  importBtn.appendChild(createIcon("folder", 14));
  importBtn.appendChild(el("span", { text: "Import" }));

  const refreshBtn = el("button", {
    class: "rsw-am__act",
    type: "button",
    title: "Atualizar",
    onclick: () => renderContent(),
  });
  refreshBtn.appendChild(createIcon("undo", 14));
  refreshBtn.appendChild(el("span", { text: "Refresh" }));

  const viewBtn = el("button", {
    class: "rsw-am__act",
    type: "button",
    title: "Alternar grid/lista",
    onclick: () => {
      state.view = state.view === "grid" ? "list" : "grid";
      viewBtn.replaceChildren(createIcon(state.view === "grid" ? "listView" : "gridView", 14));
      renderContent();
    },
  });
  viewBtn.appendChild(createIcon("listView", 14));

  const closeBtn = el("button", {
    class: "rsw-am__close",
    type: "button",
    title: "Fechar",
    "aria-label": "Fechar Asset Manager",
    onclick: () => hide(),
  });
  closeBtn.appendChild(createIcon("close", 14));

  const header = el("div", { class: "rsw-am__header" }, [
    el("span", { class: "rsw-am__title", text: "Asset Manager" }),
    el("div", { class: "rsw-am__actions" }, [importBtn, refreshBtn, viewBtn, closeBtn]),
  ]);
  refs.header = header;


  const fileInput = el("input", {
    class: "rsw-am__file",
    type: "file",
    accept: acceptAttribute(),
    multiple: "",
    hidden: "",
    onchange: (e) => onFilesChosen(e.target.files),
  });
  refs.fileInput = fileInput;


  const nav = el("nav", { class: "rsw-am__nav" });
  refs.nav = nav;
  refs.navItems = {};
  for (const sec of SECTIONS) {
    const item = el("button", {
      class: "rsw-am__navitem" + (sec === state.section ? " is-active" : ""),
      type: "button",
      dataset: { section: sec },
      onclick: () => {
        state.section = sec;
        state.selectedId = null;
        syncNav();
        renderContent();
      },
    });
    item.appendChild(el("span", { class: "rsw-am__navlabel", text: SECTION_LABELS[sec] }));
    const count = el("span", { class: "rsw-am__navcount", text: "0" });
    item.appendChild(count);
    refs.navItems[sec] = { item, count };
    nav.appendChild(item);
  }


  const content = el("div", { class: "rsw-am__content" });
  refs.content = content;

  const body = el("div", { class: "rsw-am__body" }, [nav, content]);

  root.appendChild(header);
  root.appendChild(fileInput);
  root.appendChild(body);


  header.addEventListener("mousedown", startDrag);
  return root;
}

function syncNav() {
  const counts = assetStore.counts();
  for (const sec of SECTIONS) {
    const r = refs.navItems[sec];
    if (!r) continue;
    r.item.classList.toggle("is-active", sec === state.section);
    r.count.textContent = String(counts[sec] || 0);
  }
}


let amPkgCache = [];
let amPkgBusy = false;
function amPkgAssets() {
  return amPkgCache.map((m) => ({
    id: "pkg:" + m.id,
    name: m.name,
    assetType: "Package",
    section: "packages",
    local: true,
    packageId: m.id,
    version: m.version,
  }));
}
function amRefreshPkgCache() {
  if (amPkgBusy) return;
  amPkgBusy = true;
  import("../packages/packageStore.js")
    .then((mod) => mod.packageStore.safeListPackages())
    .then((list) => {
      amPkgBusy = false;
      amPkgCache = Array.isArray(list) ? list : [];
      try {
        if (root && !root.hidden && state.section === "packages") renderContent();
      } catch (_) {                      }
    })
    .catch(() => { amPkgBusy = false; });
}
bus.on("packages:changed", () => amRefreshPkgCache());
amRefreshPkgCache();

function renderContent() {
  syncNav();
  const content = refs.content;
  content.textContent = "";
  content.classList.toggle("is-list", state.view === "list");
  const items = state.section === "packages"
    ? (amRefreshPkgCache(), amPkgAssets())
    : assetStore.list(state.section);

  if (!items.length) {
    content.appendChild(
      el("div", { class: "rsw-am__empty" }, [
        el("p", { text: "Nenhum asset nesta se\u00e7\u00e3o." }),
        el("p", {
          class: "rsw-am__hint",
          text: importableSection(state.section)
            ? 'Use "Import" para adicionar arquivos.'
            : "Esta se\u00e7\u00e3o n\u00e3o aceita importa\u00e7\u00e3o.",
        }),
      ]),
    );
    return;
  }

  if (state.view === "list") {
    content.appendChild(buildListView(items));
  } else {
    const grid = el("div", { class: "rsw-am__grid" });
    for (const a of items) grid.appendChild(buildGridCard(a));
    content.appendChild(grid);
  }
}

function importableSection(sec) {
  return ["images", "meshes", "audio", "videos", "fonts"].includes(sec);
}

function buildGridCard(asset) {
  const img = el("img", { class: "rsw-am__thumb", alt: "", draggable: "false" });
  img.style.background = thumbColor(asset);
  const name = el("div", { class: "rsw-am__name", title: asset.name });
  name.textContent = asset.name;
  const type = el("div", { class: "rsw-am__type", text: asset.assetType });
  const thumbWrap = el("div", { class: "rsw-am__thumbwrap" },
    asset.skinned
      ? [img, el("span", { class: "rsw-am__skinbadge", title: "Skinned mesh: esqueleto de Bones", text: "\u{1F9B4}" })]
      : [img]);


  markThumbnailFailureOnError(img, thumbWrap);
  img.src = thumbFor(asset);
  const card = el("div", {
    class: "rsw-am__card" + (asset.id === state.selectedId ? " is-selected" : ""),
    dataset: { id: asset.id },
    tabindex: "0",
  }, [thumbWrap, name, type]);
  wireItem(card, asset);
  return card;
}

function buildListView(items) {
  const table = el("div", { class: "rsw-am__table" });
  table.appendChild(
    el("div", { class: "rsw-am__row rsw-am__row--head" }, [
      el("span", { class: "rsw-am__c rsw-am__c--name", text: "Nome" }),
      el("span", { class: "rsw-am__c", text: "Tipo" }),
      el("span", { class: "rsw-am__c", text: "Tamanho" }),
      el("span", { class: "rsw-am__c", text: "Importado" }),
    ]),
  );
  for (const a of items) {
    const nameC = el("span", { class: "rsw-am__c rsw-am__c--name", title: a.name });
    nameC.textContent = a.name;
    const row = el("div", {
      class: "rsw-am__row" + (a.id === state.selectedId ? " is-selected" : ""),
      dataset: { id: a.id },
      tabindex: "0",
    }, [
      nameC,
      el("span", { class: "rsw-am__c", text: a.assetType }),
      el("span", { class: "rsw-am__c", text: formatSize(a.size) }),
      el("span", { class: "rsw-am__c", text: formatDate(a.imported) }),
    ]);
    wireItem(row, a);
    table.appendChild(row);
  }
  return table;
}

function wireItem(node, asset) {

  if (asset && asset.packageId) {
    node.addEventListener("dblclick", () => {
      import("../packages/packages.js")
        .then((m) => m.insertCopy(asset.packageId))
        .then((res) => {
          if (res && res.ok) logger.info(`Package inserido: ${asset.name} (v${asset.version}).`);
          else logger.warn("Falha ao inserir package: " + ((res && res.error) || "erro"));
        });
    });
  }


  if (asset.assetType === "Audio") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rsw-am__preview";
    btn.appendChild(createIcon("play", 11));
    btn.title = "Play Preview";
    btn.style.cssText =
      "position:absolute;top:4px;left:4px;z-index:2;width:22px;height:22px;" +
      "border-radius:50%;border:none;cursor:pointer;background:rgba(0,0,0,0.65);" +
      "color:#fff;font-size:10px;line-height:22px;padding:0;";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isAudioPreviewActive(String(asset.id))) stopAudioPreview();
      else playAssetPreview(String(asset.id), asset.name);
    });
    node.style.position = "relative";
    node.appendChild(btn);
  }
  node.addEventListener("click", () => {
    state.selectedId = asset.id;
    const prev = refs.content.querySelector(".is-selected");
    if (prev) prev.classList.remove("is-selected");
    node.classList.add("is-selected");
  });
  node.addEventListener("dblclick", () => {

    if (pickRequest) {
      finishPick(asset);
      return;
    }
    doInsert(asset);
  });
  node.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openItemMenu(e, asset);
  });
}

function openItemMenu(e, asset) {
  state.selectedId = asset.id;
  openContextMenu({
    x: e.clientX,
    y: e.clientY,
    items: [
      {
        label: "Insert",
        icon: "object",
        disabled: !canInsert(asset.assetType),
        onSelect: () => doInsert(asset),
      },
      { label: "Rename", icon: "text", onSelect: () => renameAsset(asset) },
      { label: "Edit", icon: "script", onSelect: () => editAsset(asset) },
      { type: "separator" },
      {
        label: "Remove From Game",
        icon: "trash",
        disabled: !!asset.builtin,
        onSelect: () => removeAsset(asset),
      },

      ...(asset.assetType === "Audio"
        ? [
            { label: "Play Preview", icon: "sound", onSelect: () => playAssetPreview(String(asset.id), asset.name) },
            { label: "Stop Preview", icon: "sound", disabled: !isAudioPreviewActive(), onSelect: () => stopAudioPreview() },
          ]
        : []),
      { label: "Copy Asset ID", icon: "copy", onSelect: () => copyAssetId(asset) },
    ],
  });
}


function doInsert(asset) {
  const inst = insertAsset(asset);
  if (inst) logger.info(`Inserido do Asset Manager: ${asset.name}.`);
  else if (!canInsert(asset.assetType))
    logger.info(`"${asset.assetType}" n\u00e3o insere geometria na cena.`);
}

function renameAsset(asset) {
  const next = window.prompt("Novo nome do asset:", asset.name);
  if (next == null) return;
  const clean = String(next).trim();
  if (!clean) return;
  assetStore.rename(asset.id, clean);
  renderContent();
}

function editAsset(asset) {

  renameAsset(asset);
}

function removeAsset(asset) {
  if (asset.builtin) return;
  const ok = assetStore.remove(asset.id);
  if (ok) {
    if (state.selectedId === asset.id) state.selectedId = null;
    renderContent();
  }
}

function copyAssetId(asset) {
  const id = String(asset.id || "");
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(id);
    } else {
      const ta = document.createElement("textarea");
      ta.value = id;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    logger.info(`Asset ID copiado: ${id}.`);
  } catch (_) {
    logger.warn("N\u00e3o foi poss\u00edvel copiar o Asset ID.");
  }
}


function triggerImport() {
  refs.fileInput.value = "";                                      
  refs.fileInput.click();
}

function onFilesChosen(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  let firstSection = null;
  let pending = files.length;
  const done = () => {
    pending -= 1;
    if (pending <= 0) {
      if (firstSection) {
        state.section = firstSection;
        syncNav();
      }
      renderContent();
    }
  };
  for (const file of files) {
    const v = validateImport({ name: file.name, size: file.size, type: file.type });
    if (!v.ok) {
      logger.warn(`Import rejeitado (${file.name}): ${v.reason}`);
      done();
      continue;
    }
    if (!firstSection) firstSection = v.section;
    const reader = new FileReader();
    reader.onload = () => {

      finishImport(file, v, typeof reader.result === "string" ? reader.result : null, done);
    };
    reader.onerror = () => {
      logger.warn(`Falha ao ler arquivo: ${file.name}.`);
      done();
    };
    try {
      reader.readAsDataURL(file);
    } catch (err) {
      logger.warn(`Falha ao importar ${file.name}: ${err && err.message}.`);
      done();
    }
  }
}


const MAX_IMAGE_DIM = 2048;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function finishImport(file, v, dataUri, done) {
  if (!dataUri) {
    logger.warn(`Falha ao ler arquivo: ${file.name}.`);
    done();
    return;
  }
  if (v.section === "meshes" && v.ext === "obj") {
    importObjMesh(file, v, dataUri, done);
    return;
  }
  if (v.section === "meshes" && v.ext === "fbx") {
    importFbxSkinnedMesh(file, v, dataUri, done);
    return;
  }
  if (v.section === "images") {
    importImage(file, v, dataUri, done);
    return;
  }
  assetStore.addImported({
    name: file.name,
    section: v.section,
    ext: v.ext,
    size: file.size,
    dataUri,
    mime: file.type || null,
  });
  done();
}


function importObjMesh(file, v, dataUri, done) {
  let text = "";
  try {
    const comma = dataUri.indexOf(",");
    const raw = atob(dataUri.slice(comma + 1));
    try {
      text = decodeURIComponent(escape(raw));
    } catch (_) {
      text = raw;
    }
  } catch (err) {
    logger.warn(`Import rejeitado (${file.name}): arquivo .obj ileg\u00edvel.`);
    done();
    return;
  }
  const tris = countObjTriangles(text);
  if (tris > MAX_TRIANGLES) {
    logger.warn(
      `Import rejeitado (${file.name}): ${tris.toLocaleString("pt-BR")} tri\u00e2ngulos \u2014 o limite \u00e9 ${MAX_TRIANGLES.toLocaleString("pt-BR")} por mesh.`,
    );
    done();
    return;
  }
  const parsed = parseObj(text);
  if (!parsed.ok) {
    logger.warn(`Import rejeitado (${file.name}): ${parsed.error}`);
    done();
    return;
  }
  for (const w of parsed.warnings || []) logger.warn(`${file.name}: ${w}`);
  let thumb = null;
  try {
    thumb = renderObjThumbnail(parsed, 96, document);
  } catch (_) {
    thumb = null;
  }
  assetStore.addImported({
    name: file.name,
    section: v.section,
    ext: v.ext,
    size: file.size,
    dataUri,
    mime: file.type || null,
    thumb,
  });
  done();
}


function importFbxSkinnedMesh(file, v, dataUri, done) {
  let skin = null;
  try {
    skin = buildSimulatedSkinnedMesh({ bones: 3 });
  } catch (_) {
    skin = null;
  }
  const rec = assetStore.addImported({
    name: file.name,
    section: v.section,
    ext: v.ext,
    size: file.size,
    dataUri,
    mime: file.type || null,
    skinned: Boolean(skin),
    skin: skin || null,
  });
  if (skin && rec && rec.id) {
    try {
      registerSkin(rec.id, skin);
      logger.info(
        `Import FBX (simulado): ${file.name} com esqueleto de ${skin.joints.length} bones e pesos normalizados.`,
      );
    } catch (_) {

    }
  }
  done();
}


function importImage(file, v, dataUri, done) {
  if ((Number(file.size) || 0) > MAX_IMAGE_BYTES) {
    logger.warn(`Import rejeitado (${file.name}): imagens s\u00e3o limitadas a 20MB.`);
    done();
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (img.naturalWidth > MAX_IMAGE_DIM || img.naturalHeight > MAX_IMAGE_DIM) {
      logger.warn(
        `Import rejeitado (${file.name}): ${img.naturalWidth}x${img.naturalHeight} excede o limite de ${MAX_IMAGE_DIM}x${MAX_IMAGE_DIM}.`,
      );
      done();
      return;
    }
    assetStore.addImported({
      name: file.name,
      section: v.section,
      ext: v.ext,
      size: file.size,
      dataUri,
      mime: file.type || null,
    });
    done();
  };
  img.onerror = () => {
    logger.warn(`Import rejeitado (${file.name}): imagem inv\u00e1lida.`);
    done();
  };
  img.src = dataUri;
}


function startDrag(e) {
  if (e.target.closest("button")) return;                                    
  e.preventDefault();
  const rect = root.getBoundingClientRect();
  const offX = e.clientX - rect.left;
  const offY = e.clientY - rect.top;
  const onMove = (ev) => {
    let left = ev.clientX - offX;
    let top = ev.clientY - offY;
    left = Math.max(4, Math.min(window.innerWidth - 80, left));
    top = Math.max(4, Math.min(window.innerHeight - 40, top));
    state.pos = { left, top, placed: true };
    root.style.left = left + "px";
    root.style.top = top + "px";
    root.style.transform = "none";
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

function show() {
  mount();
  root.hidden = false;
  state.visible = true;
  if (!state.pos.placed) {

    root.style.left = "50%";
    root.style.top = "96px";
    root.style.transform = "translateX(-50%)";
  }
  assetStore.seed();
  syncNav();
  renderContent();
  bus.emit("assetmanager:visibility", { visible: true });
}

function hide() {
  if (root) root.hidden = true;
  state.visible = false;
  pickRequest = null;                                          
  bus.emit("assetmanager:visibility", { visible: false });
}

function toggle() {
  if (state.visible) hide();
  else show();
}

export function initAssetManager() {
  if (inited) return root;
  inited = true;
  assetStore.seed();
  build();
  mount();
  bus.on("assetmanager:toggle", () => toggle());

  bus.on("assetmanager:pick", (req) => {
    if (!req || typeof req.onPick !== "function") return;
    pickRequest = req;
    if (req.section && SECTIONS.indexOf(req.section) !== -1) {
      state.section = req.section;
      syncNav();
    }
    show();
    logger.info("Modo Browse: escolha um asset com duplo clique.");
  });
  bus.on("assetmanager:show", () => show());
  bus.on("assetmanager:hide", () => hide());
  bus.on("assets:changed", () => {
    if (state.visible) {
      syncNav();
      renderContent();
    }
  });
  logger.info("Asset Manager inicializado.");
  return root;
}

export function isAssetManagerVisible() {
  return state.visible;
}

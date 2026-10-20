import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { logger } from "../core/logger.js";
import { project, setStatus } from "../core/project.js";
import { engine } from "../runtime/engine.js";
import { persistence } from "../persistence/persistence.js";
import * as projectStore from "../persistence/projectStore.js";
import { openConfirm, openInfo, openModal, makeButton } from "./modal.js";
import { openContextMenu } from "./contextMenu.js";
import { createIcon } from "./icons.js";
import { TEMPLATES, applyTemplateCooperatively } from "../start/templates.js";
import { openTemplateInStages } from "../start/templateOpenSequence.js";            
import { getTemplatePhoto, ensureTemplatePhotos, onTemplatePhotosChanged, TEMPLATE_PHOTOS_ENABLED } from "../start/templateThumbs.js";
import { openWhatsNewPanel } from "./whatsNewPanel.js";            
import { isTourCompleted, startWelcomeTour } from "../help/welcomeTour.js";            
import { APP_NAME, APP_VERSION, BUILD_DATE } from "../help/appInfo.js";                    
import {
  listRecents,
  recordRecent,
  removeRecent,
  recentKeyOf,
  renameRecent,
  listArchivedIds,
  setArchived,
  timeAgo,
} from "../start/recents.js";

const USERNAME = "RobloxDev";
const SVG_NS = "http://www.w3.org/2000/svg";


const MIN_CARD_WIDTH = 220;
const CARD_HEIGHT = 200;
const CARD_GAP = 16;

const SECTIONS = [
  { id: "new", label: "New", icon: "create" },
  { id: "recent", label: "Recent", icon: "undo" },
  { id: "mygames", label: "My Games", icon: "datamodel" },
  { id: "archive", label: "Archive", icon: "folder" },
];

let root = null;
let contentEl = null;
let searchInput = null;
let navButtons = new Map();
let navCountEls = new Map();
let statusCountEl = null;
let section = "new";
let query = "";
let projectsCache = [];
let mode = null;
let suppressEnter = false;
let busyOpening = false;
let cleanupGrid = null;
let inited = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svgFromShapes(shapes, viewBox) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const [tag, attrs] of shapes) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    svg.appendChild(node);
  }
  return svg;
}


function applyStartPageVisibility(isStartPageVisible) {
  if (!root) return;
  root.inert = !isStartPageVisible;
  root.classList.toggle("is-visible", isStartPageVisible);
  root.setAttribute("aria-hidden", isStartPageVisible ? "false" : "true");
}

export function getAppMode() {
  return mode;
}

function setMode(next) {
  if (mode === next) return;
  mode = next;
  try {
    store.set("appMode", next);
  } catch (_) {}
  document.body.classList.toggle("rsw-mode-start", next === "START_PAGE");
  applyStartPageVisibility(next === "START_PAGE");
  bus.emit("appmode:changed", { mode: next });
}

export function showStartPage() {
  refreshProjects();
  setMode("START_PAGE");
  setStatus("Start Page");
  schedulePhotoSession();                                                   
}

export function enterEditor() {
  setMode("EDITOR");
}

function refreshProjects() {
  projectStore
    .safeListProjects()
    .then((list) => {
      projectsCache = Array.isArray(list) ? list : [];
      if (mode === "START_PAGE") {


        if (section === "new") updateNavCounts();
        else renderSection();
      }
    })
    .catch(() => {
      projectsCache = [];
      if (mode === "START_PAGE") renderSection();
    });
}

function setSection(next) {
  section = next;
  for (const [id, btn] of navButtons) btn.classList.toggle("is-active", id === section);
  if (searchInput) {
    searchInput.placeholder = section === "new" ? "Search templates\u2026" : "Search projects\u2026";
  }
  renderSection();
}

function matchesQuery(text) {
  if (!query) return true;
  return String(text || "").toLowerCase().indexOf(query) !== -1;
}

function disposeGrid() {
  if (cleanupGrid) {
    try {
      cleanupGrid();
    } catch (_) {}
    cleanupGrid = null;
  }
}


function updateNavCounts() {
  if (!navCountEls.size) return;
  const archived = new Set(listArchivedIds());
  const counts = {
    recent: listRecents().length,
    mygames: projectsCache.filter((m) => !archived.has(m.id)).length,
    archive: projectsCache.filter((m) => archived.has(m.id)).length,
  };
  for (const [id, badge] of navCountEls) {
    const n = counts[id] || 0;
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.classList.toggle("is-zero", n === 0);
  }
}


function setStatusCount(text) {
  if (statusCountEl) statusCountEl.textContent = text || "";
}

function renderSection() {
  if (!contentEl) return;
  disposeGrid();
  contentEl.textContent = "";
  updateNavCounts();
  if (section === "new") renderTemplates();
  else renderProjects();
}


function sectionTitle(text, meta) {
  const head = el("div", "rsw-start__sectionhead");
  const stack = el("div", "rsw-start__sectionstack");
  stack.appendChild(el("h1", "rsw-start__heading", text));
  if (meta) stack.appendChild(el("div", "rsw-start__sectionmeta", meta));
  head.appendChild(stack);
  return head;
}

function renderTemplates() {
  const items = TEMPLATES.filter((t) => matchesQuery(t.title) || matchesQuery(t.desc));
  const meta = query
    ? items.length + " of " + TEMPLATES.length + (TEMPLATES.length === 1 ? " template" : " templates")
    : "Choose a template to start a new place";
  contentEl.appendChild(sectionTitle("New", meta));
  setStatusCount(items.length + (items.length === 1 ? " template" : " templates"));
  if (!items.length) {
    contentEl.appendChild(buildEmptyState("find", "No templates found", "Nenhum template corresponde \u00e0 busca.", null));
    return;
  }
  const grid = el("div", "rsw-start__tplgrid");
  for (const t of items) {
    const card = el("div", "rsw-start__card rsw-start__card--tpl");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", "Create " + t.title);
    const thumb = el("div", "rsw-start__thumb");
    const photo = getTemplatePhoto(t.id);
    if (photo) {

      const img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = "";
      img.src = photo;
      thumb.appendChild(img);
    } else {

      thumb.appendChild(svgFromShapes(t.art, "0 0 160 96"));
    }


    const action = el("span", "rsw-start__cardaction");
    action.setAttribute("aria-hidden", "true");
    action.appendChild(createIcon("create", 12));
    action.appendChild(el("span", "", "Create"));
    thumb.appendChild(action);
    const title = el("div", "rsw-start__cardtitle", t.title);
    const desc = el("div", "rsw-start__cardsub", t.desc);
    card.append(thumb, title, desc);
    const activate = () => openTemplate(t);
    card.addEventListener("click", activate);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
    grid.appendChild(card);
  }
  contentEl.appendChild(grid);
}

function currentProjectItems() {
  const metaById = new Map(projectsCache.map((m) => [m.id, m]));
  const archived = new Set(listArchivedIds());
  if (section === "recent") {
    return listRecents()
      .map((e) => {
        const meta = e.kind === "idb" ? metaById.get(e.id) : null;
        return {
          key: recentKeyOf(e),
          kind: e.kind,
          id: e.id,
          name: meta ? meta.name : e.name,
          sub: "Opened " + timeAgo(e.openedAt),
          thumbnail: meta ? meta.thumbnail : null,
          missing: e.kind === "idb" && !meta,
        };
      })
      .filter((it) => matchesQuery(it.name));
  }
  const wantArchived = section === "archive";
  return projectsCache
    .filter((m) => archived.has(m.id) === wantArchived)
    .filter((m) => matchesQuery(m.name))
    .map((m) => ({
      key: "idb:" + m.id,
      kind: "idb",
      id: m.id,
      name: m.name,
      sub: "Saved " + timeAgo(m.savedAt),
      thumbnail: m.thumbnail,
      missing: false,
    }));
}

function renderProjects() {
  const titles = { recent: "Recent", mygames: "My Games", archive: "Archive" };
  const metas = {
    recent: "Sorted by last opened",
    mygames: "Saved in this browser",
    archive: "Hidden from My Games",
  };
  const items = currentProjectItems();
  const countText = items.length + (items.length === 1 ? " place" : " places");
  const meta = query
    ? items.length + (items.length === 1 ? " result" : " results")
    : countText + " \u00b7 " + (metas[section] || "");
  contentEl.appendChild(sectionTitle(titles[section] || "Projects", meta));
  setStatusCount(countText);
  if (!items.length) {
    if (query) {
      contentEl.appendChild(buildEmptyState("find", "No results", "Nenhum projeto corresponde \u00e0 busca.", null));
    } else if (section === "recent") {
      contentEl.appendChild(
        buildEmptyState("undo", "No recent files", "Os projetos que voc\u00ea abrir ou salvar aparecer\u00e3o aqui.", "Create New")
      );
    } else if (section === "mygames") {
      contentEl.appendChild(
        buildEmptyState("datamodel", "No saved games yet", "Salve um projeto com Ctrl+S para v\u00ea-lo aqui.", "Create New")
      );
    } else {
      contentEl.appendChild(buildEmptyState("folder", "Nothing archived", "Use o menu de um projeto para arquiv\u00e1-lo.", null));
    }
    return;
  }
  buildVirtualGrid(items);
}

function buildEmptyState(icon, title, desc, actionLabel) {
  const wrap = el("div", "rsw-start__empty");
  const art = el("div", "rsw-start__emptyart");
  art.appendChild(createIcon(icon, 42));
  const h = el("div", "rsw-start__emptytitle", title);
  const p = el("div", "rsw-start__emptydesc", desc);
  wrap.append(art, h, p);
  if (actionLabel) {
    const btn = el("button", "rsw-start__btn rsw-start__btn--primary", actionLabel);
    btn.type = "button";
    btn.addEventListener("click", () => setSection("new"));
    wrap.appendChild(btn);
  }
  return wrap;
}

function buildVirtualGrid(items) {
  const scroller = el("div", "rsw-start__scroller");
  const sizer = el("div", "rsw-start__sizer");
  scroller.appendChild(sizer);
  contentEl.appendChild(scroller);
  let raf = 0;
  const renderWindow = () => {
    raf = 0;
    const availableWidth = Math.max(0, scroller.clientWidth - 8);
    const columnCount = Math.max(
      1,
      Math.floor((availableWidth + CARD_GAP) / (MIN_CARD_WIDTH + CARD_GAP)),
    );



    const cardWidth = Math.max(
      MIN_CARD_WIDTH,
      Math.floor((availableWidth - (columnCount - 1) * CARD_GAP) / columnCount),
    );
    sizer.style.setProperty("--rsw-project-card-width", cardWidth + "px");
    const rowCount = Math.ceil(items.length / columnCount);
    sizer.style.height = Math.max(1, rowCount * (CARD_HEIGHT + CARD_GAP)) + "px";
    const top = scroller.scrollTop;
    const firstRow = Math.max(0, Math.floor(top / (CARD_HEIGHT + CARD_GAP)) - 1);
    const lastRow = Math.min(
      rowCount - 1,
      Math.ceil((top + scroller.clientHeight) / (CARD_HEIGHT + CARD_GAP)) + 1,
    );
    sizer.textContent = "";
    for (let r = firstRow; r <= lastRow; r++) {
      for (let c = 0; c < columnCount; c++) {
        const idx = r * columnCount + c;
        if (idx >= items.length) break;
        const card = buildProjectCard(items[idx]);
        card.style.transform =
          "translate(" + c * (cardWidth + CARD_GAP) + "px, " + r * (CARD_HEIGHT + CARD_GAP) + "px)";
        sizer.appendChild(card);
      }
    }
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(renderWindow);
  };
  scroller.addEventListener("scroll", schedule);
  let ro = null;
  if (typeof ResizeObserver === "function") {
    ro = new ResizeObserver(schedule);
    ro.observe(scroller);
  }
  cleanupGrid = () => {
    if (raf) cancelAnimationFrame(raf);
    if (ro) ro.disconnect();
  };
  renderWindow();
}

function buildProjectCard(item) {
  const card = el("div", "rsw-start__card rsw-start__card--proj");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", "Open " + item.name);
  const thumb = el("div", "rsw-start__thumb");
  if (item.thumbnail) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = "";
    img.src = item.thumbnail;
    thumb.appendChild(img);
  } else {
    thumb.classList.add("is-empty");
    thumb.appendChild(createIcon(item.kind === "file" ? "script" : "datamodel", 34));
  }
  const nameRow = el("div", "rsw-start__cardname");
  const nameEl = el("span", "rsw-start__cardtitle", item.name);
  nameEl.title = item.name;
  const menuBtn = el("button", "rsw-start__cardmenu");
  menuBtn.appendChild(createIcon("kebab", 16));
  menuBtn.type = "button";
  menuBtn.title = "Project options";
  menuBtn.setAttribute("aria-label", "Project options");
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openCardMenu(item, e.clientX, e.clientY);
  });
  nameRow.append(nameEl, menuBtn);
  const sub = el("div", "rsw-start__cardsub", item.sub || "");
  card.append(thumb, nameRow, sub);
  card.addEventListener("click", () => openItem(item));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter") openItem(item);
  });
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openCardMenu(item, e.clientX, e.clientY);
  });
  return card;
}

function openCardMenu(item, x, y) {
  const items = [{ label: "Open", icon: "play", onSelect: () => openItem(item) }];
  if (item.kind === "idb" && !item.missing) {
    items.push({ label: "Rename", onSelect: () => openRenameDialog(item) });
    items.push({ label: "Duplicate", icon: "duplicate", onSelect: () => duplicateItem(item) });
    if (listArchivedIds().indexOf(item.id) === -1) {
      items.push({ label: "Archive", icon: "folder", onSelect: () => archiveItem(item, true) });
    } else {
      items.push({ label: "Restore", icon: "folder", onSelect: () => archiveItem(item, false) });
    }
  }
  if (section === "recent") {
    items.push({ label: "Remove from Recent", onSelect: () => removeFromRecent(item) });
  }
  if (item.kind === "idb" && !item.missing) {
    items.push({ type: "separator" });
    items.push({ label: "Delete", icon: "trash", onSelect: () => deleteItem(item) });
  }
  openContextMenu({ x, y, items });
}

function openItem(item) {
  if (item.kind === "file") {
    openInfo({
      title: "Open from File",
      content:
        "Arquivos locais n\u00e3o ficam armazenados no navegador. Clique em \"Open from File\u2026\" e selecione o arquivo \"" +
        item.name +
        "\" novamente.",
    });
    return;
  }
  if (item.missing) {
    openInfo({
      title: "Projeto indispon\u00edvel",
      content: "Este projeto n\u00e3o existe mais no armazenamento do navegador. Remova-o da lista de recentes.",
    });
    return;
  }
  if (busyOpening) return;
  busyOpening = true;
  persistence
    .openFromBrowser(item.id)
    .then((ok) => {
      busyOpening = false;
      if (!ok) refreshProjects();
    })
    .catch((e) => {
      busyOpening = false;
      logger.error("Start Page: falha ao abrir projeto: " + ((e && e.message) || e), { source: "Studio" });
    });
}







function openTemplate(template) {
  if (busyOpening) return;
  busyOpening = true;


  suppressEnter = true;
  openTemplateInStages({
    clearPlace: () => persistence.newPlace(),
    buildTemplate: async (context) => {
      const isFullyApplied = await applyTemplateCooperatively(store.getDataModel(), template.id, context);
      project.setName(template.title);
      project.markClean();
      if (!isFullyApplied) logger.warn("Start Page: template aplicado parcialmente: " + template.id, { source: "Studio" });
    },
    enterEditor: () => enterEditor(),
    onStageError: (failure) =>
      logger.error("Start Page: falha ao criar do template (" + failure.stageId + "): " + ((failure.error && failure.error.message) || failure.error), { source: "Studio" }),
  })
    .then(() => setStatus("New place: " + template.title))
    .catch((e) => {
      setStatus("Template loading failed");
      logger.error("Start Page: falha ao criar do template: " + ((e && e.message) || e), { source: "Studio" });
    })
    .finally(() => {
      suppressEnter = false;
      busyOpening = false;
    });
}

function duplicateItem(item) {
  projectStore
    .duplicateProject(item.id)
    .then(() => {
      refreshProjects();
      setStatus("Project duplicated");
    })
    .catch((e) => openInfo({ title: "Falha ao duplicar", content: String((e && e.message) || e) }));
}

function archiveItem(item, flag) {
  setArchived(item.id, flag);
  renderSection();
  setStatus(flag ? "Project archived" : "Project restored");
}

function removeFromRecent(item) {
  removeRecent(item.key);
  renderSection();
  setStatus("Removed from Recent");
}

function deleteItem(item) {
  openConfirm({
    title: "Delete Project",
    message: 'Excluir "' + item.name + '" permanentemente? Esta a\u00e7\u00e3o n\u00e3o pode ser desfeita.',
    buttons: [
      { label: "Delete", value: "delete", kind: "primary" },
      { label: "Cancel", value: "cancel", kind: "ghost" },
    ],
    closeOnBackdrop: false,
  }).then((choice) => {
    if (choice !== "delete") return;
    projectStore
      .deleteProject(item.id)
      .then(() => {
        removeRecent("idb:" + item.id);
        setArchived(item.id, false);
        refreshProjects();
        setStatus("Project deleted");
      })
      .catch((e) => openInfo({ title: "Falha ao excluir", content: String((e && e.message) || e) }));
  });
}

function openRenameDialog(item) {
  const body = el("div", "rsw-start__renamebody");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rsw-start__renameinput";
  input.value = item.name;
  input.maxLength = 120;
  body.appendChild(input);
  let handle = null;
  const commit = () => {
    const value = input.value.trim();
    if (handle) handle.close();
    if (!value || value === item.name) return;
    projectStore
      .renameProject(item.id, value)
      .then(() => {
        renameRecent(item.id, value);
        refreshProjects();
        setStatus("Project renamed");
      })
      .catch((e) => openInfo({ title: "Falha ao renomear", content: String((e && e.message) || e) }));
  };
  const footer = el("div", "rsw-start__renamefooter");
  footer.append(
    makeButton("Cancel", "ghost", () => {
      if (handle) handle.close();
    }),
    makeButton("Rename", "primary", commit)
  );
  handle = openModal({ title: "Rename Project", body, footer, width: 400 });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
  });
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}

function openWhatsNew() {
  openWhatsNewPanel();            
}

function handleOpenFromFile(file) {
  if (!file) return;
  file
    .text()
    .then((text) => persistence.openFromFileText(text, file.name))
    .then((ok) => {
      if (!ok) setStatus("Open canceled");
    })
    .catch((e) => openInfo({ title: "Falha ao abrir", content: String((e && e.message) || e) }));
}


function buildTopBar() {
  const bar = el("div", "rsw-start__topbar");
  const brand = el("div", "rsw-start__brand");
  const brandLogo = el("span", "rsw-start__brandlogo");
  brandLogo.appendChild(createIcon("logo", 16));
  const brandStack = el("span", "rsw-start__brandstack");
  brandStack.appendChild(el("span", "rsw-start__brandname", "ROBLOX Studio"));
  brandStack.appendChild(el("span", "rsw-start__brandsub", "Start Page"));
  const verChip = el("span", "rsw-start__verchip", "v" + APP_VERSION);
  verChip.title = APP_NAME + " " + APP_VERSION + " \u00b7 build " + BUILD_DATE;
  brand.append(brandLogo, brandStack, verChip);
  const searchWrap = el("div", "rsw-start__search");
  searchWrap.appendChild(createIcon("find", 14));
  searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "rsw-start__searchinput";
  searchInput.placeholder = "Search templates\u2026";
  searchInput.setAttribute("aria-label", "Search");
  searchInput.addEventListener("input", () => {
    query = searchInput.value.trim().toLowerCase();
    renderSection();
  });
  searchWrap.appendChild(searchInput);
  const right = el("div", "rsw-start__topright");
  const whatsNew = el("button", "rsw-start__btn rsw-start__whatsnew");
  whatsNew.type = "button";
  whatsNew.appendChild(createIcon("gift", 15));
  whatsNew.appendChild(el("span", "", "What's New"));
  whatsNew.addEventListener("click", openWhatsNew);
  const divider = el("span", "rsw-start__topdivider");
  divider.setAttribute("aria-hidden", "true");
  const user = el("div", "rsw-start__user");
  user.title = USERNAME;
  const avatar = el("span", "rsw-start__avatar", USERNAME.charAt(0).toUpperCase());
  const userStack = el("span", "rsw-start__userstack");
  userStack.appendChild(el("span", "rsw-start__username", USERNAME));
  userStack.appendChild(el("span", "rsw-start__usersub", "Local Build"));
  user.append(avatar, userStack);
  right.append(whatsNew, divider, user);
  bar.append(brand, searchWrap, right);
  return bar;
}


function buildSidebar() {
  const side = el("div", "rsw-start__sidebar");
  navButtons = new Map();
  navCountEls = new Map();
  const makeNavBtn = (s) => {
    const btn = el("button", "rsw-start__navbtn");
    btn.type = "button";
    btn.appendChild(createIcon(s.icon, 15));
    btn.appendChild(el("span", "rsw-start__navtext", s.label));
    if (s.id !== "new") {
      const count = el("span", "rsw-start__navcount", "0");
      count.setAttribute("aria-hidden", "true");
      navCountEls.set(s.id, count);
      btn.appendChild(count);
    }
    btn.addEventListener("click", () => setSection(s.id));
    navButtons.set(s.id, btn);
    return btn;
  };
  const navCreate = el("nav", "rsw-start__nav");
  navCreate.setAttribute("aria-label", "Create");
  const navProjects = el("nav", "rsw-start__nav");
  navProjects.setAttribute("aria-label", "Start Page sections");
  for (const s of SECTIONS) {
    (s.id === "new" ? navCreate : navProjects).appendChild(makeNavBtn(s));
  }
  const spacer = el("div", "rsw-start__sidespacer");
  const openBtn = el("button", "rsw-start__btn rsw-start__btn--side rsw-start__openfile");
  openBtn.type = "button";
  openBtn.appendChild(createIcon("folder", 15));
  openBtn.appendChild(el("span", "", "Open from File\u2026"));
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".rswp,application/json";
  fileInput.className = "rsw-start__fileinput";
  fileInput.setAttribute("aria-hidden", "true");
  fileInput.tabIndex = -1;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    handleOpenFromFile(file);
  });
  openBtn.addEventListener("click", () => fileInput.click());
  const tourBtn = el("button", "rsw-start__btn rsw-start__btn--side rsw-start__tourbtn");
  tourBtn.type = "button";
  tourBtn.appendChild(createIcon("info", 15));
  tourBtn.appendChild(el("span", "", "Take a Tour"));
  tourBtn.addEventListener("click", () => startWelcomeTour());
  tourBtn.hidden = isTourCompleted();
  bus.on("tour:completed", () => { tourBtn.hidden = true; });
  const dashBtn = el("button", "rsw-start__btn rsw-start__btn--side rsw-start__dashbtn");
  dashBtn.type = "button";
  dashBtn.appendChild(createIcon("workspace", 15));
  dashBtn.appendChild(el("span", "", "Creator Dashboard"));
  dashBtn.addEventListener("click", () => {
    import("./creatorDashboard.js")
      .then((m) => m.openCreatorDashboard())
      .catch((e) => logger.warn("Start Page: falha ao abrir o Creator Dashboard: " + ((e && e.message) || e), { source: "Studio" }));
  });
  const foot = el("div", "rsw-start__sidefoot");
  foot.appendChild(el("div", "rsw-start__sidefootname", APP_NAME));
  foot.appendChild(el("div", "rsw-start__sidefootver", "v" + APP_VERSION + " \u00b7 build " + BUILD_DATE));
  side.append(
    el("div", "rsw-start__navlabel", "Create"),
    navCreate,
    el("div", "rsw-start__navlabel", "Projects"),
    navProjects,
    spacer,
    el("div", "rsw-start__navlabel", "Resources"),
    tourBtn,
    dashBtn,
    openBtn,
    fileInput,
    foot
  );
  return side;
}



function buildStatusBar() {
  const bar = el("div", "rsw-start__statusbar");
  const left = el("div", "rsw-start__statusgroup");
  const dot = el("span", "rsw-start__statusdot");
  dot.setAttribute("aria-hidden", "true");
  left.append(dot, el("span", "rsw-start__statustext", "Ready"));
  statusCountEl = el("span", "rsw-start__statustext rsw-start__statuscount", "");
  const storage = el("span", "rsw-start__statustext", "Local storage");
  storage.title = "Projects are saved in this browser (IndexedDB)";
  const right = el("div", "rsw-start__statusgroup rsw-start__statusgroup--right");
  const div1 = el("span", "rsw-start__statusdivider");
  const div2 = el("span", "rsw-start__statusdivider");
  div1.setAttribute("aria-hidden", "true");
  div2.setAttribute("aria-hidden", "true");
  right.append(statusCountEl, div1, storage, div2, el("span", "rsw-start__statustext", APP_NAME + " v" + APP_VERSION));
  bar.append(left, right);
  return bar;
}


function newPlaceSilently() {
  suppressEnter = true;
  try {
    persistence.newPlace();
  } finally {
    suppressEnter = false;
  }
}



function schedulePhotoSession() {


  if (!TEMPLATE_PHOTOS_ENABLED) return;
  setTimeout(() => {
    ensureTemplatePhotos({
      newPlaceSilently,
      isIdle: () => mode === "START_PAGE" && !busyOpening,
    }).catch((e) => {
      logger.warn("Start Page: falha ao gerar fotos dos templates: " + ((e && e.message) || e), { source: "Studio" });
    });
  }, 400);
}

function closeProjectToStartPage() {
  try {
    if (engine.isRunning()) engine.stop();
  } catch (_) {}
  suppressEnter = true;
  try {
    persistence.newPlace();
  } catch (e) {
    logger.warn("Start Page: falha ao limpar o projeto ao fechar: " + ((e && e.message) || e), { source: "Studio" });
  }
  suppressEnter = false;
  showStartPage();
}

export function initStartPage() {
  if (inited) return;
  inited = true;
  root = el("div", "rsw-start");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Start Page");
  const body = el("div", "rsw-start__body");
  contentEl = el("div", "rsw-start__content");
  body.append(buildSidebar(), contentEl);
  root.append(buildTopBar(), body, buildStatusBar());
  document.body.appendChild(root);



  applyStartPageVisibility(mode === "START_PAGE");

  bus.on("project:loaded", () => {
    try {
      const dest = persistence.getDestination ? persistence.getDestination() : null;
      if (dest && dest.type === "idb" && dest.id) {
        recordRecent({ kind: "idb", id: dest.id, name: dest.name });
      } else if (dest && dest.type === "file" && dest.fileName) {
        recordRecent({ kind: "file", name: dest.fileName });
      }
    } catch (_) {}
    if (!suppressEnter) enterEditor();
  });

  bus.on("startpage:closeProject", closeProjectToStartPage);
  bus.on("startpage:show", showStartPage);


  onTemplatePhotosChanged(() => {
    if (mode === "START_PAGE" && section === "new") renderSection();
  });

  setSection("new");
  setMode("START_PAGE");
  refreshProjects();
  setStatus("Start Page");
  schedulePhotoSession();                                                          
  logger.info("Start Page pronta (Parte 48; redesign desktop).", { source: "Studio" });
}

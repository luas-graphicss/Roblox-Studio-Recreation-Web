import { openModal, makeButton } from "./modal.js";
import { createIcon } from "./icons.js";
import { listInsertableClasses } from "../datamodel/classes.js";
import { insertAnyClass } from "../core/editOps.js";
import { selection } from "../core/selection.js";
import { getClass, resolveClassName, API_CLASSES } from "../editor/apiDocs.js";
import { categorizeClass, openApiBrowser } from "./apiBrowser.js";
import { readJSON, writeJSON } from "../utils/storage.js";

const FAV_KEY = "insertFavorites";
const RECENT_KEY = "insertRecents";
const RECENT_LIMIT = 10;
const CATEGORIES = ["All", "BaseParts", "GUI", "Scripting", "Effects", "Constraints", "Values", "Lighting", "Sound", "Services", "Other"];

let _open = false;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function readList(key) {
  const raw = readJSON(key);
  return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
}

function toggleFavorite(name) {
  const favs = readList(FAV_KEY);
  const i = favs.indexOf(name);
  if (i >= 0) favs.splice(i, 1);
  else favs.unshift(name);
  writeJSON(FAV_KEY, favs.slice(0, 50));
  return i < 0;
}

function recordRecent(name) {
  const rec = readList(RECENT_KEY).filter((x) => x !== name);
  rec.unshift(name);
  writeJSON(RECENT_KEY, rec.slice(0, RECENT_LIMIT));
}

function shortDescription(name) {
  const cls = getClass(resolveClassName(name) || name);
  const desc = cls && cls.description ? String(cls.description) : "";
  if (desc.length <= 90) return desc;
  return desc.slice(0, 87) + "\u2026";
}

function iconFor(name) {
  const cat = categorizeClass(name);
  if (cat === "BaseParts") return "part";
  if (cat === "Scripting") return "script";
  if (cat === "Sound") return "sound";
  if (cat === "Effects") return name === "Fire" ? "fire" : "particle";
  if (cat === "Values") return "value";
  if (name === "Model") return "model";
  if (name === "Folder") return "folder";
  return "instance";
}

function insertTarget() {
  try {
    const sel = selection.get();
    if (sel && sel.length) return sel[0];
  } catch (_) {

  }
  return null;                                                      
}

export function openInsertObjectDialog() {
  if (_open) return;
  _open = true;

  const classes = listInsertableClasses();
  const favSet = new Set(readList(FAV_KEY));
  const recents = readList(RECENT_KEY).filter((n) => classes.includes(n));

  let activeCategory = "All";
  let query = "";
  let selected = null;
  const rows = [];

  const body = el("div", "rsw-insobj");
  const left = el("div", "rsw-insobj__left");
  const right = el("div", "rsw-insobj__preview");

  const search = document.createElement("input");
  search.type = "search";
  search.className = "rsw-insobj__search";
  search.placeholder = "Search classes\u2026";
  search.setAttribute("aria-label", "Search classes");

  const chips = el("div", "rsw-insobj__chips");
  const chipEls = new Map();
  for (const cat of CATEGORIES) {
    const chip = el("button", "rsw-insobj__chip" + (cat === activeCategory ? " is-active" : ""), cat);
    chip.type = "button";
    chip.addEventListener("click", () => {
      activeCategory = cat;
      for (const [c, node] of chipEls) node.classList.toggle("is-active", c === cat);
      applyFilter();
    });
    chipEls.set(cat, chip);
    chips.appendChild(chip);
  }

  const list = el("div", "rsw-insobj__list");
  list.tabIndex = 0;

  function renderPreview(name) {
    right.replaceChildren();
    if (!name) {
      right.appendChild(el("div", "rsw-insobj__hint", "Select a class to see details. Double-click or press Enter to insert."));
      return;
    }
    const head = el("div", "rsw-insobj__pvhead");
    const ic = el("span", "rsw-insobj__pvicon");
    ic.appendChild(createIcon(iconFor(name), 20));
    head.appendChild(ic);
    const titles = el("div");
    titles.appendChild(el("div", "rsw-insobj__pvname", name));
    titles.appendChild(el("div", "rsw-insobj__pvcat", categorizeClass(name)));
    head.appendChild(titles);
    right.appendChild(head);
    const cls = getClass(resolveClassName(name) || name);
    right.appendChild(el("p", "rsw-insobj__pvdesc", (cls && cls.description) || "No description available."));
    const raw = API_CLASSES[resolveClassName(name) || name];
    if (raw && Array.isArray(raw.properties) && raw.properties.length) {
      right.appendChild(el("div", "rsw-insobj__pvsub", "Main properties"));
      const ul = el("ul", "rsw-insobj__pvprops");
      for (const p of raw.properties.slice(0, 8)) {
        ul.appendChild(el("li", "", p.name + (p.valueType ? ": " + p.valueType : "")));
      }
      right.appendChild(ul);
    }
    const link = el("button", "rsw-insobj__apilink", "View in API Browser");
    link.type = "button";
    link.addEventListener("click", () => {
      handle.close();
      openApiBrowser({ kind: "class", name: resolveClassName(name) || name });
    });
    right.appendChild(link);
  }

  function selectRow(row) {
    for (const r of rows) r.node.classList.toggle("is-selected", r === row);
    selected = row;
    renderPreview(row ? row.name : null);
  }

  function doInsert(name) {
    if (!name) return;
    const inst = insertAnyClass(name, insertTarget());
    if (inst) {
      recordRecent(name);
      handle.close();
    }
  }

  function makeRow(name, sectionTag) {
    const node = el("div", "rsw-insobj__row");
    node.setAttribute("role", "option");
    const ic = el("span", "rsw-insobj__rowicon");
    ic.appendChild(createIcon(iconFor(name), 14));
    const main = el("div", "rsw-insobj__rowmain");
    const line = el("div", "rsw-insobj__rowline");
    line.appendChild(el("span", "rsw-insobj__rowname", name));
    line.appendChild(el("span", "rsw-insobj__rowcat", categorizeClass(name)));
    main.appendChild(line);
    const sd = shortDescription(name);
    if (sd) main.appendChild(el("div", "rsw-insobj__rowdesc", sd));
    const star = el("button", "rsw-insobj__star" + (favSet.has(name) ? " is-fav" : ""));
    star.appendChild(createIcon("starFill", 13));
    star.type = "button";
    star.title = favSet.has(name) ? "Remove from favorites" : "Add to favorites";
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      const nowFav = toggleFavorite(name);
      if (nowFav) favSet.add(name);
      else favSet.delete(name);
      for (const r of rows) {
        if (r.name === name) {
          r.starEl.classList.toggle("is-fav", nowFav);
          r.starEl.title = nowFav ? "Remove from favorites" : "Add to favorites";
        }
      }
    });
    node.append(ic, main, star);
    const row = { name, node, starEl: star, section: sectionTag, category: categorizeClass(name), key: name.toLowerCase() };
    node.addEventListener("click", () => selectRow(row));
    node.addEventListener("dblclick", () => doInsert(name));
    return row;
  }


  const sections = [];
  function addSection(title, names, tag) {
    if (!names.length) return;
    const header = el("div", "rsw-insobj__sechead", title);
    list.appendChild(header);
    const secRows = [];
    for (const n of names) {
      const row = makeRow(n, tag);
      rows.push(row);
      secRows.push(row);
      list.appendChild(row.node);
    }
    sections.push({ header, rows: secRows });
  }
  addSection("Recently Used", recents, "recent");
  addSection("Favorites", classes.filter((n) => favSet.has(n)), "fav");
  addSection("All Classes", classes, "all");

  function applyFilter() {
    for (const sec of sections) {
      let visible = 0;
      for (const row of sec.rows) {
        const okCat = activeCategory === "All" || row.category === activeCategory;
        const okText = !query || row.key.includes(query);
        const show = okCat && okText;
        row.node.style.display = show ? "" : "none";
        if (show) visible += 1;
      }
      sec.header.style.display = visible ? "" : "none";
    }
    if (selected && selected.node.style.display === "none") selectRow(null);
  }

  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    applyFilter();
  });

  function visibleRows() {
    return rows.filter((r) => r.node.style.display !== "none");
  }

  const onKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (selected) doInsert(selected.name);
      else {
        const vis = visibleRows();
        if (vis.length) doInsert(vis[0].name);
      }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const vis = visibleRows();
      if (!vis.length) return;
      let idx = selected ? vis.indexOf(selected) : -1;
      idx = e.key === "ArrowDown" ? Math.min(vis.length - 1, idx + 1) : Math.max(0, idx - 1);
      selectRow(vis[idx]);
      vis[idx].node.scrollIntoView({ block: "nearest" });
    }
  };
  search.addEventListener("keydown", onKey);
  list.addEventListener("keydown", onKey);

  left.append(search, chips, list);
  body.append(left, right);
  renderPreview(null);

  const handle = openModal({
    title: "Insert Object",
    width: 720,
    className: "rsw-insobj-modal",
    body,
    footer: [
      makeButton("Cancel", "", () => handle.close()),
      makeButton("Insert", "primary", () => {
        if (selected) doInsert(selected.name);
      }),
    ],
    ariaLabel: "Insert Object",
    onClose: () => {
      _open = false;
    },
  });
  setTimeout(() => search.focus(), 0);
  return handle;
}

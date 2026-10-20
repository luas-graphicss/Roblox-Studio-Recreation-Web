import { CATEGORY_META } from "../help/changelogCategories.js";
import { getLoadedChangelogEntries, loadChangelogEntries } from "../help/changelogSource.js";
import { getUnseenIds, markAllSeen } from "../help/changelog.js";
import { createIcon } from "./icons.js";

const CHUNK = 10;
const FILTERS = [
  { id: "all", label: "All" },
  { id: "feature", label: "Features" },
  { id: "improvement", label: "Improvements" },
  { id: "bugfix", label: "Bug Fixes" },
];

let _win = null;
let _listEl = null;
let _sentinel = null;
let _observer = null;
let _filter = "all";
let _query = "";
let _entries = [];
let _entriesLoaded = false;
let _visible = [];
let _rendered = 0;
let _newIds = new Set();

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function matches(entry) {
  if (_filter !== "all" && entry.category !== _filter) return false;
  if (_query) {
    const hay = (entry.title + " " + entry.description).toLowerCase();
    if (!hay.includes(_query)) return false;
  }
  return true;
}

function entryRow(entry) {
  const meta = CATEGORY_META[entry.category] || CATEGORY_META.feature;
  const row = el("div", "rsw-wn__entry rsw-wn__entry--" + entry.category);
  const icon = el("span", "rsw-wn__caticon", meta.glyph);
  icon.title = meta.label;
  const body = el("div", "rsw-wn__body");
  const head = el("div", "rsw-wn__head");
  head.appendChild(el("span", "rsw-wn__title", entry.title));
  if (_newIds.has(entry.id)) head.appendChild(el("span", "rsw-wn__new", "NEW"));
  const sub = el("div", "rsw-wn__sub");
  sub.appendChild(el("span", "rsw-wn__cat", meta.label));
  sub.appendChild(el("span", "rsw-wn__date", entry.date));
  body.append(head, sub, el("div", "rsw-wn__desc", entry.description));
  row.append(icon, body);
  return row;
}

function renderChunk() {
  if (!_listEl) return;
  const end = Math.min(_visible.length, _rendered + CHUNK);
  for (let i = _rendered; i < end; i++) _listEl.insertBefore(entryRow(_visible[i]), _sentinel);
  _rendered = end;
  if (_sentinel) _sentinel.style.display = _rendered < _visible.length ? "" : "none";
}

function rebuildList() {
  if (!_listEl) return;
  _visible = _entries.filter(matches);
  _rendered = 0;
  _listEl.replaceChildren();
  _sentinel = el("div", "rsw-wn__sentinel");
  _listEl.appendChild(_sentinel);
  if (_observer) _observer.disconnect();
  _observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) renderChunk();
  }, { root: _listEl });
  _observer.observe(_sentinel);
  if (!_visible.length) {

    const emptyMessage = _entriesLoaded ? "No entries match your search." : "Loading updates\u2026";
    _listEl.insertBefore(el("div", "rsw-wn__empty", emptyMessage), _sentinel);
  }
  renderChunk();
}

export function closeWhatsNew() {
  if (!_win) return;
  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }
  if (_win.parentNode) _win.parentNode.removeChild(_win);
  _win = null;
  _listEl = null;
  _sentinel = null;
}

export function isWhatsNewOpen() {
  return !!_win;
}


async function loadEntriesIntoOpenPanel(ownerWindow) {
  const unseenIds = await getUnseenIds();
  const entries = await loadChangelogEntries();
  if (_win !== ownerWindow) return;
  _newIds = new Set(unseenIds);
  _entries = entries;
  _entriesLoaded = true;
  rebuildList();
  await markAllSeen();
}

export function openWhatsNewPanel() {
  if (_win) {
    closeWhatsNew();
    return;
  }
  _filter = "all";
  _query = "";


  _entries = getLoadedChangelogEntries();
  _entriesLoaded = _entries.length > 0;
  _newIds = new Set();

  const win = el("div", "rsw-wn");
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", "What's New");

  const head = el("div", "rsw-wn__titlebar");
  const brand = el("div", "rsw-wn__brand");
  brand.appendChild(createIcon("gift", 15));
  brand.appendChild(el("span", "", "What's New"));
  const closeBtn = el("button", "rsw-wn__close", "\u00d7");
  closeBtn.type = "button";
  closeBtn.title = "Close";
  closeBtn.addEventListener("click", closeWhatsNew);
  head.append(brand, closeBtn);


  head.addEventListener("pointerdown", (e) => {
    if (e.target === closeBtn) return;


    if (typeof e.button === "number" && e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = win.getBoundingClientRect();
    const move = (ev) => {



      if (ev.pointerType === "mouse" && ev.buttons === 0) {
        up();
        return;
      }
      const x = Math.max(0, Math.min(window.innerWidth - 120, rect.left + (ev.clientX - startX)));
      const y = Math.max(0, Math.min(window.innerHeight - 60, rect.top + (ev.clientY - startY)));
      win.style.left = x + "px";
      win.style.top = y + "px";
      win.style.right = "auto";
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);


    window.addEventListener("pointercancel", up);
  });

  const toolbar = el("div", "rsw-wn__toolbar");
  const search = document.createElement("input");
  search.type = "search";
  search.className = "rsw-wn__search";
  search.placeholder = "Search updates\u2026";
  search.setAttribute("aria-label", "Search updates");
  search.addEventListener("input", () => {
    _query = search.value.trim().toLowerCase();
    rebuildList();
  });
  toolbar.appendChild(search);
  const chips = el("div", "rsw-wn__chips");
  const chipEls = new Map();
  for (const f of FILTERS) {
    const chip = el("button", "rsw-wn__chip" + (f.id === _filter ? " is-active" : ""), f.label);
    chip.type = "button";
    chip.addEventListener("click", () => {
      _filter = f.id;
      for (const [id, c] of chipEls) c.classList.toggle("is-active", id === f.id);
      rebuildList();
    });
    chipEls.set(f.id, chip);
    chips.appendChild(chip);
  }
  toolbar.appendChild(chips);

  const list = el("div", "rsw-wn__list");
  win.append(head, toolbar, list);
  document.body.appendChild(win);

  win.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeWhatsNew();
    }
  });

  _win = win;
  _listEl = list;
  rebuildList();
  void loadEntriesIntoOpenPanel(win);
  setTimeout(() => search.focus(), 0);
}

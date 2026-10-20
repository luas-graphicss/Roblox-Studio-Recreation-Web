import { store } from "../core/state.js";
import { createIcon } from "./icons.js";
import { renderHighlightedCode } from "./syntaxHighlightRenderer.js";
import {
  API_CLASSES,
  API_DATATYPES,
  LUAU_GLOBALS,
  ROBLOX_GLOBAL_VALUES,
  LUAU_LIBRARIES,
  resolveClassName,
  getClass,
  membersOf,
  getDatatype,
  getLibrary,
  getGlobal,
  enumNames,
  enumItems,
  classFromReturnType,
} from "../editor/apiDocs.js";
import { examplesFor } from "../help/apiExamples.js";
import { canInsertIntoScript, insertIntoActiveScript } from "../ai/editorBridge.js";
import { NotificationService } from "../services/notifications.js";

const CATEGORY_ORDER = [
  "BaseParts",
  "GUI",
  "Scripting",
  "Effects",
  "Constraints",
  "Values",
  "Lighting",
  "Sound",
  "Services",
  "Other",
];

let _hostBody = null;
let _ui = null;
let _index = null;
let _currentPage = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function chainOf(name) {
  const chain = [];
  let cur = name;
  let guard = 0;
  while (cur && API_CLASSES[cur] && guard++ < 24) {
    chain.push(cur);
    cur = API_CLASSES[cur].superclass;
  }
  return chain;
}


export function categorizeClass(name) {
  const cls = API_CLASSES[name];
  const chain = chainOf(name);
  const has = (x) => chain.includes(x);
  if (has("BasePart")) return "BaseParts";
  if (/^Sound|SoundEffect$/.test(name) || has("SoundEffect")) return "Sound";
  if (/Light$/.test(name) || /^(Sky|Atmosphere|Clouds)$/.test(name) || /Effect$/.test(name)) return "Lighting";
  if (/^(Script|LocalScript|ModuleScript|RemoteEvent|RemoteFunction|BindableEvent|BindableFunction)$/.test(name)) return "Scripting";
  if (has("GuiBase2d") || has("GuiObject") || has("LayerCollector") || /^UI/.test(name) || /Gui$/.test(name)) return "GUI";
  if (/^(ParticleEmitter|Fire|Smoke|Sparkles|Beam|Trail|Explosion|Highlight)$/.test(name)) return "Effects";
  if (has("Constraint") || /Constraint$/.test(name) || /^(Attachment|Weld|Motor6D)$/.test(name)) return "Constraints";
  if (has("ValueBase") || /Value$/.test(name)) return "Values";
  if (cls && cls.service) return "Services";
  return "Other";
}

function iconForClass(name) {
  const chain = chainOf(name);
  if (chain.includes("BasePart")) return "part";
  if (/Script$/.test(name)) return "script";
  if (name === "Model") return "model";
  if (name === "Folder") return "folder";
  if (/^Sound/.test(name)) return "sound";
  if (name === "ParticleEmitter") return "particle";
  if (name === "Fire") return "fire";
  return "instance";
}


function setPanelOpen(on) {
  const P = store.getState().layout.panels;
  if (!!P.apiBrowser !== !!on) store.setLayout({ panels: { apiBrowser: !!on } });
}


function buildIndex() {
  const entries = [];
  const add = (label, detail, page) => entries.push({ key: label.toLowerCase(), label, detail, page });
  for (const name of Object.keys(API_CLASSES)) {
    add(name, "Class", { kind: "class", name });
    const cls = API_CLASSES[name];
    for (const listName of ["properties", "methods", "events", "callbacks"]) {
      const arr = cls[listName];
      if (!Array.isArray(arr)) continue;
      for (const m of arr) add(name + "." + m.name, m.kind || listName, { kind: "class", name, member: m.name });
    }
  }
  for (const name of Object.keys(API_DATATYPES)) {
    add(name, "Data Type", { kind: "datatype", name });
    const dt = API_DATATYPES[name];
    for (const arr of [dt.statics, dt.members]) {
      if (!Array.isArray(arr)) continue;
      for (const m of arr) add(name + "." + m.name, "Data Type member", { kind: "datatype", name, member: m.name });
    }
  }
  for (const name of enumNames()) add("Enum." + name, "Enum", { kind: "enum", name });
  for (const g of LUAU_GLOBALS) add(g.name, "Global", { kind: "globals", member: g.name });
  for (const g of ROBLOX_GLOBAL_VALUES) add(g.name, "Global", { kind: "globals", member: g.name });
  for (const name of Object.keys(LUAU_LIBRARIES)) {
    add(name, "Library", { kind: "library", name });
    const lib = LUAU_LIBRARIES[name];
    if (lib && Array.isArray(lib.members)) {
      for (const m of lib.members) add(name + "." + m.name, "Library member", { kind: "library", name, member: m.name });
    }
  }
  return entries;
}

function ensureIndex() {
  if (!_index) _index = buildIndex();
  return _index;
}


export function buildApiBrowserPanel(dockRefs) {
  _hostBody = dockRefs && dockRefs.body ? dockRefs.body : null;
  window.addEventListener("rsw:apibrowser", (e) => {
    const d = e && e.detail;
    if (d && typeof d === "object" && typeof d.word === "string") openApiBrowserForWord(d.word);
    else if (d && typeof d === "object") openApiBrowser(d);
    else openApiBrowser();
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "F1" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      const word = activeEditorWord();
      if (word) openApiBrowserForWord(word);
      else openApiBrowser();
    },
    true,
  );
}

function activeEditorWord() {
  try {
    const m = window.monaco;
    if (!m || !m.editor || typeof m.editor.getEditors !== "function") return null;
    for (const ed of m.editor.getEditors()) {
      if (ed.hasTextFocus && ed.hasTextFocus()) {
        const pos = ed.getPosition();
        const model = ed.getModel();
        if (!pos || !model) return null;
        const w = model.getWordAtPosition(pos);
        return w ? w.word : null;
      }
    }
  } catch (_) {

  }
  return null;
}

function ensureUI() {
  if (_ui || !_hostBody) return _ui;
  const root = el("div", "rsw-apib");

  const side = el("div", "rsw-apib__side");
  const search = document.createElement("input");
  search.type = "search";
  search.className = "rsw-apib__search";
  search.placeholder = "Search API\u2026 (Ctrl+Shift+D)";
  search.setAttribute("aria-label", "Search API");
  const results = el("div", "rsw-apib__results");
  results.style.display = "none";
  const tree = el("div", "rsw-apib__tree");
  side.append(search, results, tree);

  const content = el("div", "rsw-apib__content");
  root.append(side, content);
  _hostBody.appendChild(root);

  _ui = { root, search, results, tree, content };
  buildTree(tree);

  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    if (!q) {
      results.style.display = "none";
      tree.style.display = "";
      return;
    }
    const idx = ensureIndex();
    const starts = [];
    const contains = [];
    for (const entry of idx) {
      if (entry.key.startsWith(q)) starts.push(entry);
      else if (entry.key.includes(q)) contains.push(entry);
      if (starts.length >= 60) break;
    }
    const found = starts.concat(contains).slice(0, 60);
    results.replaceChildren();
    if (!found.length) results.appendChild(el("div", "rsw-apib__noresult", "No results"));
    for (const entry of found) {
      const row = el("button", "rsw-apib__result");
      row.type = "button";
      row.appendChild(el("span", "rsw-apib__resultname", entry.label));
      row.appendChild(el("span", "rsw-apib__resultkind", entry.detail));
      row.addEventListener("click", () => navigate(entry.page));
      results.appendChild(row);
    }
    results.style.display = "";
    tree.style.display = "none";
  });

  navigate({ kind: "home" });
  return _ui;
}

function treeSection(title, buildChildren) {
  const det = document.createElement("details");
  det.className = "rsw-apib__section";
  const sum = document.createElement("summary");
  sum.textContent = title;
  det.appendChild(sum);
  let built = false;
  det.addEventListener("toggle", () => {
    if (det.open && !built) {
      built = true;
      buildChildren(det);
    }
  });
  return det;
}

function treeItem(label, page) {
  const btn = el("button", "rsw-apib__item", label);
  btn.type = "button";
  btn.addEventListener("click", () => navigate(page));
  return btn;
}

function buildTree(tree) {
  const classesSec = treeSection("Classes", (det) => {
    const byCat = new Map();
    for (const name of Object.keys(API_CLASSES).sort()) {
      const cat = categorizeClass(name);
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(name);
    }
    for (const cat of CATEGORY_ORDER) {
      const names = byCat.get(cat);
      if (!names || !names.length) continue;
      const sub = treeSection(cat + " (" + names.length + ")", (subDet) => {
        for (const n of names) subDet.appendChild(treeItem(n, { kind: "class", name: n }));
      });
      sub.classList.add("rsw-apib__section--sub");
      det.appendChild(sub);
    }
  });
  classesSec.open = true;
  const enumsSec = treeSection("Enums", (det) => {
    for (const n of enumNames().sort()) det.appendChild(treeItem(n, { kind: "enum", name: n }));
  });
  const dtSec = treeSection("Data Types", (det) => {
    for (const n of Object.keys(API_DATATYPES).sort()) det.appendChild(treeItem(n, { kind: "datatype", name: n }));
  });
  const globalsSec = treeSection("Global Functions", (det) => {
    det.appendChild(treeItem("All globals", { kind: "globals" }));
    for (const g of LUAU_GLOBALS) det.appendChild(treeItem(g.name, { kind: "globals", member: g.name }));
  });
  const libsSec = treeSection("Libraries", (det) => {
    for (const n of Object.keys(LUAU_LIBRARIES).sort()) det.appendChild(treeItem(n, { kind: "library", name: n }));
  });
  tree.append(classesSec, enumsSec, dtSec, globalsSec, libsSec);
}


export function openApiBrowser(page) {
  setPanelOpen(true);
  const ui = ensureUI();
  if (!ui) return;
  if (page && page.kind) navigate(page);
}

export function focusApiSearch() {
  openApiBrowser();
  if (_ui) {
    _ui.search.focus();
    _ui.search.select();
  }
}

export function openApiBrowserForWord(word) {
  const name = String(word || "").trim();
  if (!name) {
    openApiBrowser();
    return;
  }
  const cls = resolveClassName(name);
  if (cls) {
    openApiBrowser({ kind: "class", name: cls });
    return;
  }
  if (getDatatype(name)) {
    openApiBrowser({ kind: "datatype", name });
    return;
  }
  if (getLibrary(name)) {
    openApiBrowser({ kind: "library", name });
    return;
  }
  if (enumItems(name)) {
    openApiBrowser({ kind: "enum", name });
    return;
  }
  if (getGlobal(name)) {
    openApiBrowser({ kind: "globals", member: name });
    return;
  }
  const q = name.toLowerCase();
  const hit = ensureIndex().find((entry) => entry.key.endsWith("." + q) || entry.key === q);
  if (hit) {
    openApiBrowser(hit.page);
    return;
  }
  openApiBrowser();
  if (_ui) {
    _ui.search.value = name;
    _ui.search.dispatchEvent(new Event("input"));
  }
}

function typeLink(typeText) {
  const raw = String(typeText == null ? "" : typeText);
  if (!raw) return el("span", "", "\u2014");
  const target = classFromReturnType(raw);
  let clean = raw.trim();
  if (clean.endsWith("?")) clean = clean.slice(0, -1);
  const dtTarget = !target && getDatatype(clean) ? clean : null;
  if (!target && !dtTarget) return el("span", "", raw);
  const btn = el("button", "rsw-apib__typelink", raw);
  btn.type = "button";
  btn.addEventListener("click", () => {
    if (target) navigate({ kind: "class", name: target });
    else navigate({ kind: "datatype", name: dtTarget });
  });
  return btn;
}

function paramsText(params) {
  if (!Array.isArray(params) || !params.length) return "()";
  return "(" + params.map((p) => (p.name || "arg") + (p.type ? ": " + p.type : "")).join(", ") + ")";
}

function sectionTable(title, headers, rows) {
  if (!rows.length) return null;
  const det = document.createElement("details");
  det.open = true;
  det.className = "rsw-apib__docsection";
  const sum = document.createElement("summary");
  sum.textContent = title + " (" + rows.length + ")";
  det.appendChild(sum);
  const table = el("table", "rsw-apib__table");
  const thead = el("thead");
  const hr = el("tr");
  for (const h of headers) hr.appendChild(el("th", "", h));
  thead.appendChild(hr);
  const tbody = el("tbody");
  for (const cells of rows) {
    const tr = el("tr");
    for (const c of cells) {
      const td = el("td");
      if (c instanceof Node) td.appendChild(c);
      else td.textContent = c == null ? "" : String(c);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  det.appendChild(table);
  return det;
}

function nameCell(m, owner, className) {
  const wrap = el("span", "rsw-apib__name");
  if (m.deprecated) {
    const dep = el("span", "rsw-apib__dep", "\u26a0");
    dep.title = "Deprecated";
    wrap.appendChild(dep);
  }
  wrap.appendChild(el("span", "", m.name));
  if (owner && owner !== className) {
    const tag = el("span", "rsw-apib__owner", owner);
    tag.title = "Inherited from " + owner;
    wrap.appendChild(tag);
  }
  return wrap;
}

function highlightInto(node, code) {
  try {
    const m = window.monaco;
    const langs = m && m.languages && typeof m.languages.getLanguages === "function" ? m.languages.getLanguages() : [];
    const id = langs.some((l) => l.id === "luau") ? "luau" : langs.some((l) => l.id === "lua") ? "lua" : null;
    if (m && id && m.editor && typeof m.editor.colorize === "function") {
      m.editor.colorize(code, id, { tabSize: 4 }).then(

        (highlightedMarkup) => {
          renderHighlightedCode(node, highlightedMarkup, code);
        },
        () => {
          node.textContent = code;
        },
      );
      return;
    }
  } catch (_) {

  }
  node.textContent = code;
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

function examplesBlock(name) {
  const list = examplesFor(name);
  if (!list.length) return null;
  const det = document.createElement("details");
  det.open = true;
  det.className = "rsw-apib__docsection";
  const sum = document.createElement("summary");
  sum.textContent = "Code Examples (" + list.length + ")";
  det.appendChild(sum);
  for (const exItem of list) {
    const card = el("div", "rsw-apib__example");
    const head = el("div", "rsw-apib__exhead");
    head.appendChild(el("span", "rsw-apib__extitle", exItem.title));
    const copyBtn = el("button", "rsw-apib__exbtn", "Copy");
    copyBtn.type = "button";
    copyBtn.addEventListener("click", () => {
      copyText(exItem.code);
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1200);
    });
    const insBtn = el("button", "rsw-apib__exbtn", "Insert");
    insBtn.type = "button";
    insBtn.title = "Insert into the active script";
    insBtn.addEventListener("click", () => {
      if (canInsertIntoScript()) {
        insertIntoActiveScript(exItem.code);
        NotificationService.notify("success", "Example inserted into the active script.", { silent: true });
      } else {
        NotificationService.notify("warning", "Open a script in the Script Editor to insert examples.");
      }
    });
    head.append(copyBtn, insBtn);
    const pre = el("pre", "rsw-apib__code");
    highlightInto(pre, exItem.code);
    card.append(head, pre);
    det.appendChild(card);
  }
  return det;
}

function headerBlock(title, iconName, subtitleNode, page) {
  const head = el("div", "rsw-apib__pagehead");
  const iconWrap = el("span", "rsw-apib__pageicon");
  iconWrap.appendChild(createIcon(iconName || "instance", 18));
  const titles = el("div", "rsw-apib__pagetitles");
  titles.appendChild(el("div", "rsw-apib__pagetitle", title));
  if (subtitleNode) titles.appendChild(subtitleNode);
  const newTab = el("button", "rsw-apib__exbtn rsw-apib__newtab", "Open in New Tab");
  newTab.type = "button";
  newTab.addEventListener("click", () => openStaticPage(page));
  head.append(iconWrap, titles, newTab);
  return head;
}

function renderClassPage(content, page) {
  const name = resolveClassName(page.name) || page.name;
  const cls = getClass(name);
  if (!cls) {
    content.appendChild(el("div", "rsw-apib__noresult", 'Class "' + page.name + '" not found.'));
    return;
  }
  const chain = chainOf(name).reverse();
  const crumbs = el("div", "rsw-apib__crumbs");
  chain.forEach((c, i) => {
    if (i > 0) crumbs.appendChild(el("span", "rsw-apib__crumbsep", " > "));
    if (c === name) crumbs.appendChild(el("span", "rsw-apib__crumbcur", c));
    else {
      const btn = el("button", "rsw-apib__typelink", c);
      btn.type = "button";
      btn.addEventListener("click", () => navigate({ kind: "class", name: c }));
      crumbs.appendChild(btn);
    }
  });
  content.appendChild(headerBlock(name + (cls.deprecated ? " \u26a0" : ""), iconForClass(name), crumbs, page));
  if (cls.description) content.appendChild(el("p", "rsw-apib__desc", cls.description));

  const info = membersOf(name);
  const groups = { Property: [], Method: [], Event: [], Callback: [] };
  if (info && info.all) {
    for (const [, v] of info.all) {
      const kind = v.kind || (v.member && v.member.kind) || "Property";
      if (groups[kind]) groups[kind].push(v);
    }
    for (const k of Object.keys(groups)) {
      groups[k].sort((a, b) => {
        const ao = a.owner === name ? 0 : 1;
        const bo = b.owner === name ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return a.member.name.localeCompare(b.member.name);
      });
    }
  }

  const propRows = groups.Property.map((v) => [
    nameCell(v.member, v.owner, name),
    typeLink(v.member.valueType),
    v.member.default != null ? String(v.member.default) : "\u2014",
    v.member.readOnly ? "Yes" : "No",
    v.member.description || "",
  ]);
  const methodRows = groups.Method.map((v) => [
    nameCell(v.member, v.owner, name),
    paramsText(v.member.parameters),
    typeLink(v.member.returnType || "void"),
    v.member.description || "",
  ]);
  const eventRows = groups.Event.map((v) => [
    nameCell(v.member, v.owner, name),
    paramsText(v.member.parameters),
    v.member.description || "",
  ]);
  const cbRows = groups.Callback.map((v) => [
    nameCell(v.member, v.owner, name),
    paramsText(v.member.parameters),
    v.member.description || "",
  ]);

  const sections = [
    sectionTable("Properties", ["Name", "Type", "Default", "Read-Only", "Description"], propRows),
    sectionTable("Methods", ["Name", "Parameters", "Return Type", "Description"], methodRows),
    sectionTable("Events", ["Name", "Parameters", "Description"], eventRows),
    sectionTable("Callbacks", ["Name", "Parameters", "Description"], cbRows),
    examplesBlock(name),
  ];
  for (const s of sections) if (s) content.appendChild(s);

  if (page.member) scrollToMember(content, page.member);
}

function scrollToMember(content, memberName) {
  setTimeout(() => {
    const rows = content.querySelectorAll(".rsw-apib__name");
    for (const row of rows) {
      if (row.textContent.replace("\u26a0", "").trim().startsWith(memberName)) {
        const tr = row.closest("tr");
        if (tr) {
          tr.classList.add("is-flash");
          tr.scrollIntoView({ block: "center" });
          setTimeout(() => tr.classList.remove("is-flash"), 1600);
        }
        return;
      }
    }
  }, 0);
}

function renderEnumPage(content, page) {
  const items = enumItems(page.name);
  content.appendChild(headerBlock("Enum." + page.name, "value", null, page));
  if (!items) {
    content.appendChild(el("div", "rsw-apib__noresult", "Enum not found."));
    return;
  }
  const arr = Array.isArray(items) ? items : Object.keys(items);
  const rows = arr.map((it, i) => {
    if (typeof it === "string") return [it, String(i)];
    return [it.name || String(it), it.value != null ? String(it.value) : String(i)];
  });
  const table = sectionTable("Items", ["Name", "Value"], rows);
  if (table) content.appendChild(table);
}

function renderDatatypePage(content, page) {
  const dt = getDatatype(page.name);
  content.appendChild(headerBlock(page.name, "value", null, page));
  if (!dt) {
    content.appendChild(el("div", "rsw-apib__noresult", "Data type not found."));
    return;
  }
  if (dt.description) content.appendChild(el("p", "rsw-apib__desc", dt.description));
  const staticRows = (Array.isArray(dt.statics) ? dt.statics : []).map((m) => [
    nameCell(m, null, null),
    m.parameters ? paramsText(m.parameters) : "\u2014",
    typeLink(m.returnType || m.valueType || "\u2014"),
    m.description || "",
  ]);
  const memberRows = (Array.isArray(dt.members) ? dt.members : []).map((m) => [
    nameCell(m, null, null),
    m.parameters ? paramsText(m.parameters) : "\u2014",
    typeLink(m.returnType || m.valueType || "\u2014"),
    m.description || "",
  ]);
  const s1 = sectionTable("Constructors & Statics", ["Name", "Parameters", "Type", "Description"], staticRows);
  const s2 = sectionTable("Members", ["Name", "Parameters", "Type", "Description"], memberRows);
  if (s1) content.appendChild(s1);
  if (s2) content.appendChild(s2);
  const exs = examplesBlock(page.name);
  if (exs) content.appendChild(exs);
}

function renderLibraryPage(content, page) {
  const lib = getLibrary(page.name);
  content.appendChild(headerBlock(page.name + " library", "script", null, page));
  if (!lib) {
    content.appendChild(el("div", "rsw-apib__noresult", "Library not found."));
    return;
  }
  if (lib.description) content.appendChild(el("p", "rsw-apib__desc", lib.description));
  const rows = (Array.isArray(lib.members) ? lib.members : []).map((m) => [
    nameCell(m, null, null),
    m.parameters ? paramsText(m.parameters) : "\u2014",
    typeLink(m.returnType || m.valueType || "\u2014"),
    m.description || "",
  ]);
  const table = sectionTable("Members", ["Name", "Parameters", "Type", "Description"], rows);
  if (table) content.appendChild(table);
  const exs = examplesBlock(page.name);
  if (exs) content.appendChild(exs);
}

function renderGlobalsPage(content, page) {
  content.appendChild(headerBlock("Global Functions & Values", "script", null, page));
  const gRows = LUAU_GLOBALS.map((g) => [
    nameCell(g, null, null),
    g.parameters ? paramsText(g.parameters) : "\u2014",
    typeLink(g.returnType || "\u2014"),
    g.description || "",
  ]);
  const vRows = ROBLOX_GLOBAL_VALUES.map((g) => [
    nameCell(g, null, null),
    typeLink(g.valueType || g.returnType || "\u2014"),
    g.description || "",
  ]);
  const s1 = sectionTable("Luau Globals", ["Name", "Parameters", "Return Type", "Description"], gRows);
  const s2 = sectionTable("Roblox Globals", ["Name", "Type", "Description"], vRows);
  if (s1) content.appendChild(s1);
  if (s2) content.appendChild(s2);
  if (page.member) scrollToMember(content, page.member);
}

function renderHome(content) {
  content.appendChild(headerBlock("API Reference", "logo", null, { kind: "home" }));
  content.appendChild(
    el(
      "p",
      "rsw-apib__desc",
      "Browse the full Roblox API: classes, enums, data types, global functions and Luau libraries. " +
        "Use the search box (Ctrl+Shift+D) or press F1 over a symbol in the Script Editor to jump to its documentation.",
    ),
  );
  const stats = el("ul", "rsw-apib__stats");
  stats.appendChild(el("li", "", Object.keys(API_CLASSES).length + " classes"));
  stats.appendChild(el("li", "", enumNames().length + " enums"));
  stats.appendChild(el("li", "", Object.keys(API_DATATYPES).length + " data types"));
  stats.appendChild(el("li", "", Object.keys(LUAU_LIBRARIES).length + " libraries"));
  content.appendChild(stats);
}

function navigate(page) {
  const ui = ensureUI();
  if (!ui) return;
  _currentPage = page;
  ui.content.replaceChildren();
  ui.content.scrollTop = 0;
  switch (page.kind) {
    case "class":
      renderClassPage(ui.content, page);
      break;
    case "enum":
      renderEnumPage(ui.content, page);
      break;
    case "datatype":
      renderDatatypePage(ui.content, page);
      break;
    case "library":
      renderLibraryPage(ui.content, page);
      break;
    case "globals":
      renderGlobalsPage(ui.content, page);
      break;
    default:
      renderHome(ui.content);
  }
}


function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function staticTable(title, headers, rows) {
  if (!rows.length) return "";
  let html = "<h2>" + esc(title) + "</h2><table><tr>";
  for (const h of headers) html += "<th>" + esc(h) + "</th>";
  html += "</tr>";
  for (const r of rows) {
    html += "<tr>";
    for (const c of r) html += "<td>" + esc(c) + "</td>";
    html += "</tr>";
  }
  return html + "</table>";
}

function openStaticPage(page) {
  let title = "API Reference";
  let body = "";
  if (page.kind === "class") {
    const name = resolveClassName(page.name) || page.name;
    const cls = getClass(name);
    if (cls) {
      title = name;
      body += "<p><em>" + esc(chainOf(name).reverse().join(" &gt; ")) + "</em></p>";
      body += "<p>" + esc(cls.description || "") + "</p>";
      const info = membersOf(name);
      const groups = { Property: [], Method: [], Event: [], Callback: [] };
      if (info && info.all) {
        for (const [, v] of info.all) {
          const kind = v.kind || (v.member && v.member.kind) || "Property";
          if (groups[kind]) groups[kind].push(v);
        }
      }
      body += staticTable("Properties", ["Name", "Type", "Read-Only", "Description"], groups.Property.map((v) => [v.member.name, v.member.valueType || "", v.member.readOnly ? "Yes" : "No", v.member.description || ""]));
      body += staticTable("Methods", ["Name", "Parameters", "Return", "Description"], groups.Method.map((v) => [v.member.name, paramsText(v.member.parameters), v.member.returnType || "void", v.member.description || ""]));
      body += staticTable("Events", ["Name", "Parameters", "Description"], groups.Event.map((v) => [v.member.name, paramsText(v.member.parameters), v.member.description || ""]));
      body += staticTable("Callbacks", ["Name", "Parameters", "Description"], groups.Callback.map((v) => [v.member.name, paramsText(v.member.parameters), v.member.description || ""]));
      const exs = examplesFor(name);
      if (exs.length) {
        body += "<h2>Code Examples</h2>";
        for (const e2 of exs) body += "<h3>" + esc(e2.title) + "</h3><pre>" + esc(e2.code) + "</pre>";
      }
    }
  } else if (page.kind === "enum") {
    title = "Enum." + page.name;
    const items = enumItems(page.name) || [];
    const arr = Array.isArray(items) ? items : Object.keys(items);
    body += staticTable("Items", ["Name"], arr.map((it) => [typeof it === "string" ? it : it.name || ""]));
  } else if (page.kind === "datatype") {
    title = page.name;
    const dt = getDatatype(page.name);
    if (dt) {
      body += "<p>" + esc(dt.description || "") + "</p>";
      body += staticTable("Statics", ["Name", "Description"], (dt.statics || []).map((m) => [m.name, m.description || ""]));
      body += staticTable("Members", ["Name", "Description"], (dt.members || []).map((m) => [m.name, m.description || ""]));
    }
  } else if (page.kind === "library") {
    title = page.name + " library";
    const lib = getLibrary(page.name);
    if (lib) {
      body += "<p>" + esc(lib.description || "") + "</p>";
      body += staticTable("Members", ["Name", "Description"], (lib.members || []).map((m) => [m.name, m.description || ""]));
    }
  } else if (page.kind === "globals") {
    title = "Global Functions";
    body += staticTable("Luau Globals", ["Name", "Description"], LUAU_GLOBALS.map((g) => [g.name, g.description || ""]));
    body += staticTable("Roblox Globals", ["Name", "Description"], ROBLOX_GLOBAL_VALUES.map((g) => [g.name, g.description || ""]));
  }
  const html =
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" +
    esc(title) +
    " \u2014 RSW API Reference</title><style>" +
    "body{font-family:system-ui,sans-serif;background:#1e1e22;color:#e4e4e6;padding:24px;max-width:960px;margin:0 auto;}" +
    "table{border-collapse:collapse;width:100%;margin:8px 0 20px;}th,td{border:1px solid #3a3a3e;padding:6px 8px;text-align:left;font-size:13px;vertical-align:top;}" +
    "th{background:#2a2a2e;}pre{background:#141416;padding:10px;border-radius:6px;overflow:auto;}h1{border-bottom:1px solid #3a3a3e;padding-bottom:8px;}" +
    "</style></head><body><h1>" +
    esc(title) +
    "</h1>" +
    body +
    "</body></html>";
  try {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (_) {

  }
}

export function getCurrentApiPage() {
  return _currentPage;
}

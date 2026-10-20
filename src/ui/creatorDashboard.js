import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { logger } from "../core/logger.js";
import { project, setStatus } from "../core/project.js";
import { persistence } from "../persistence/persistence.js";
import * as versionHistory from "../collab/versionHistory.js";
import * as cloudStore from "../cloud/cloudStore.js";
import * as cloudAssets from "../cloud/cloudAssets.js";
import * as openCloud from "../cloud/openCloud.js";
import * as cloudPublish from "../cloud/cloudPublish.js";
import { openModal, openConfirm, openInfo, openPrompt, makeButton } from "./modal.js";
import { createIcon } from "./icons.js";
import { markThumbnailFailureOnError } from "./thumbnailFallback.js";           
import { NotificationService } from "../services/notifications.js";
import { openApiBrowser } from "./apiBrowser.js";

const NAV = [
  { id: "home", label: "Dashboard", icon: "datamodel" },
  { id: "creations", label: "Creations", icon: "workspace" },
  { id: "credentials", label: "Credentials", icon: "lock" },
  { id: "assets", label: "Asset Manager", icon: "folder" },
  { id: "docs", label: "Documentation", icon: "find" },
];

let _root = null;
let _contentEl = null;
let _navBtns = new Map();
let _section = "home";
let _open = false;
let _inited = false;
let _assetsUniverseId = null;
let _uploading = false;
let _busySave = false;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmtInt(n) {
  try { return Number(n || 0).toLocaleString("pt-BR"); } catch (_) { return String(n || 0); }
}

function fmtDate(iso) {
  if (!iso) return "\u2014";
  try { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch (_) { return String(iso); }
}

function copyText(text) {
  const s = String(text == null ? "" : text);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s);
      return true;
    }
  } catch (_) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = s;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  } catch (_) {
    return false;
  }
}

function chip(text, kind) {
  return el("span", "rsw-cdash__chip" + (kind ? " rsw-cdash__chip--" + kind : ""), text);
}

function smallBtn(label, onClick, kind) {
  const b = el("button", "rsw-cdash__sbtn" + (kind ? " rsw-cdash__sbtn--" + kind : ""), label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

export function isCreatorDashboardOpen() {
  return _open;
}

function setSection(next) {
  _section = NAV.some((s) => s.id === next) ? next : "home";
  for (const [id, btn] of _navBtns) btn.classList.toggle("is-active", id === _section);
  renderSection();
}

function onKeyDown(e) {
  if (e.key === "Escape" && _open) closeCreatorDashboard();
}

function init() {
  if (_inited) return;
  _inited = true;
  _root = el("div", "rsw-cdash");
  _root.setAttribute("role", "region");
  _root.setAttribute("aria-label", "Creator Dashboard");
  _root.setAttribute("aria-hidden", "true");

  const top = el("div", "rsw-cdash__topbar");
  const brand = el("div", "rsw-cdash__brand");
  brand.appendChild(createIcon("logo", 20));
  brand.appendChild(el("span", "rsw-cdash__brandname", "Creator Hub"));
  brand.appendChild(el("span", "rsw-cdash__brandtag", "Simulado"));
  const backBtn = el("button", "rsw-cdash__back");
  backBtn.type = "button";
  backBtn.appendChild(createIcon("close", 14));
  backBtn.appendChild(el("span", "", "Back to Studio"));
  backBtn.addEventListener("click", () => closeCreatorDashboard());
  top.append(brand, backBtn);

  const body = el("div", "rsw-cdash__body");
  const side = el("nav", "rsw-cdash__side");
  side.setAttribute("aria-label", "Creator Dashboard sections");
  _navBtns = new Map();
  for (const s of NAV) {
    const btn = el("button", "rsw-cdash__navbtn");
    btn.type = "button";
    btn.appendChild(createIcon(s.icon, 15));
    btn.appendChild(el("span", "", s.label));
    btn.addEventListener("click", () => setSection(s.id));
    _navBtns.set(s.id, btn);
    side.appendChild(btn);
  }
  _contentEl = el("div", "rsw-cdash__content");
  body.append(side, _contentEl);
  _root.append(top, body);
  document.body.appendChild(_root);

  bus.on("cloud:assetsChanged", () => {
    if (_open && _section === "assets" && !_uploading) renderSection();
  });
  bus.on("cloud:placeSaved", () => {
    if (_open && (_section === "creations" || _section === "home")) renderSection();
  });
}

export function openCreatorDashboard(section) {
  init();
  _open = true;
  _root.classList.add("is-visible");
  _root.setAttribute("aria-hidden", "false");
  document.addEventListener("keydown", onKeyDown);
  cloudAssets.resumePendingModeration();
  setSection(section || _section || "home");
  setStatus("Creator Dashboard");
}

export function closeCreatorDashboard() {
  if (!_open) return;
  _open = false;
  if (_root) {
    _root.classList.remove("is-visible");
    _root.setAttribute("aria-hidden", "true");
  }
  document.removeEventListener("keydown", onKeyDown);
  setStatus("Ready");
}

function heading(text, subtitle) {
  const wrap = el("div", "rsw-cdash__heading");
  wrap.appendChild(el("h1", "rsw-cdash__h1", text));
  if (subtitle) wrap.appendChild(el("p", "rsw-cdash__sub", subtitle));
  return wrap;
}

function renderSection() {
  if (!_contentEl) return;
  _contentEl.textContent = "";
  if (_section === "home") renderHome();
  else if (_section === "creations") renderCreations();
  else if (_section === "credentials") renderCredentials();
  else if (_section === "assets") renderAssets();
  else renderDocs();
}

async function renderHome() {
  const target = _contentEl;
  target.appendChild(heading("Dashboard", "Resumo simulado das suas experi\u00eancias."));
  const universes = await cloudStore.listUniverses();
  const places = await cloudStore.listPlaces();
  const assets = await cloudStore.listAssets();
  const keys = await cloudStore.listApiKeys();
  if (_section !== "home" || target !== _contentEl) return;
  let visits = 0;
  let ccu = 0;
  let revenue = 0;
  for (const u of universes) {
    const m = u.metrics || {};
    visits += Number(m.visits) || 0;
    ccu += Number(m.concurrents) || 0;
    revenue += Number(m.revenue) || 0;
  }
  const cards = el("div", "rsw-cdash__cards");
  const metric = (label, value, sub) => {
    const c = el("div", "rsw-cdash__card rsw-cdash__card--metric");
    c.appendChild(el("div", "rsw-cdash__cardlabel", label));
    c.appendChild(el("div", "rsw-cdash__cardvalue", value));
    if (sub) c.appendChild(el("div", "rsw-cdash__cardsub", sub));
    return c;
  };
  cards.appendChild(metric("Visits", fmtInt(visits), "todas as experi\u00eancias"));
  cards.appendChild(metric("Concurrents", fmtInt(ccu), "jogadores agora (simulado)"));
  cards.appendChild(metric("Revenue (m\u00eas)", "R$ " + fmtInt(revenue), "Robux simulados"));
  target.appendChild(cards);

  const counts = el("div", "rsw-cdash__cards");
  counts.appendChild(metric("Universes", fmtInt(universes.length)));
  counts.appendChild(metric("Places", fmtInt(places.length)));
  counts.appendChild(metric("Cloud Assets", fmtInt(assets.length)));
  counts.appendChild(metric("API Keys", fmtInt(keys.length)));
  target.appendChild(counts);

  const recent = places.filter((p) => p.savedAt).slice(0, 5);
  if (recent.length) {
    const box = el("div", "rsw-cdash__panel");
    box.appendChild(el("h2", "rsw-cdash__h2", "Locais recentes"));
    for (const p of recent) {
      const row = el("div", "rsw-cdash__row");
      row.appendChild(el("span", "rsw-cdash__rowname", p.name));
      row.appendChild(el("span", "rsw-cdash__rowmeta", "Salvo " + fmtDate(p.savedAt) + " \u00b7 " + persistence.formatBytes(p.size)));
      const open = smallBtn("Open", () => openPlaceInStudio(p), "primary");
      row.appendChild(open);
      box.appendChild(row);
    }
    target.appendChild(box);
  }
}

async function renderCreations() {
  const target = _contentEl;
  target.appendChild(heading("Creations", "Universes e Places salvos na nuvem local (IndexedDB)."));
  const bar = el("div", "rsw-cdash__toolbar");
  bar.appendChild(smallBtn("+ New Universe", async () => {
    const name = await openPrompt({
      title: "New Universe",
      label: "Nome do Universe",
      placeholder: "Minha experi\u00eancia",
      maxLength: 120,
      sanitize: (v) => cloudPublish.sanitizeCloudName(v, ""),
      validate: (v) => (!v ? "Digite um nome v\u00e1lido." : null),
      okLabel: "Criar",
      cancelLabel: "Cancelar",
    });
    if (name == null) return;
    await cloudPublish.createUniverse({ name });
    renderSection();
  }, "primary"));
  bar.appendChild(smallBtn("Save Current Project to Cloud", () => { saveCurrentProjectToCloud(); }));
  target.appendChild(bar);

  const universes = await cloudStore.listUniverses();
  if (_section !== "creations" || target !== _contentEl) return;
  if (!universes.length) {
    const empty = el("div", "rsw-cdash__empty");
    empty.appendChild(el("div", "rsw-cdash__emptytitle", "Nenhum Universe ainda"));
    empty.appendChild(el("div", "rsw-cdash__emptydesc", "Crie um Universe ou use \"Save Current Project to Cloud\" para come\u00e7ar."));
    target.appendChild(empty);
    return;
  }
  universes.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  for (const u of universes) {
    target.appendChild(await buildUniverseCard(u));
  }
}

async function buildUniverseCard(u) {
  const card = el("div", "rsw-cdash__panel rsw-cdash__universe");
  const head = el("div", "rsw-cdash__uhead");
  const title = el("div", "rsw-cdash__utitle");
  title.appendChild(createIcon("workspace", 16));
  title.appendChild(el("span", "rsw-cdash__uname", u.name));
  title.appendChild(chip(u.isPublic ? "Public" : "Private", u.isPublic ? "ok" : "muted"));
  head.appendChild(title);
  const acts = el("div", "rsw-cdash__uacts");
  acts.appendChild(smallBtn(u.isPublic ? "Make Private" : "Make Public", async () => {
    u.isPublic = !u.isPublic;
    u.updatedAt = new Date().toISOString();
    await cloudStore.putUniverse(u);
    renderSection();
  }));
  acts.appendChild(smallBtn("Permissions\u2026", () => openPermissionsModal(u)));
  acts.appendChild(smallBtn("Rename", async () => {
    const name = await openPrompt({
      title: "Rename Universe",
      label: "Novo nome",
      placeholder: u.name,
      maxLength: 120,
      sanitize: (v) => cloudPublish.sanitizeCloudName(v, ""),
      validate: (v) => (!v ? "Digite um nome v\u00e1lido." : null),
      okLabel: "Renomear",
      cancelLabel: "Cancelar",
    });
    if (name == null) return;
    u.name = name;
    u.updatedAt = new Date().toISOString();
    await cloudStore.putUniverse(u);
    renderSection();
  }));
  acts.appendChild(smallBtn("Delete", () => {
    openConfirm({
      title: "Delete Universe",
      message: 'Excluir "' + u.name + '" e todos os seus Places, assets e API Keys? Esta a\u00e7\u00e3o n\u00e3o pode ser desfeita.',
      buttons: [
        { label: "Delete", value: "del", kind: "primary" },
        { label: "Cancel", value: "cancel", kind: "ghost" },
      ],
      closeOnBackdrop: false,
    }).then(async (v) => {
      if (v !== "del") return;
      await cloudStore.deleteUniverse(u.id);
      NotificationService.notify("info", 'Universe "' + u.name + '" deleted');
      renderSection();
    });
  }, "danger"));
  head.appendChild(acts);
  card.appendChild(head);

  const meta = el("div", "rsw-cdash__umeta");
  meta.appendChild(el("span", "", "Universe ID: " + u.id));
  meta.appendChild(el("span", "", "Root Place: " + (u.rootPlaceId || "\u2014")));
  const collab = (u.collaborators || []).length;
  const groups = (u.groups || []).length;
  meta.appendChild(el("span", "", collab + " colaborador(es) \u00b7 " + groups + " grupo(s)"));
  card.appendChild(meta);

  const places = await cloudStore.listPlaces(u.id);
  const tbl = el("div", "rsw-cdash__places");
  if (!places.length) {
    tbl.appendChild(el("div", "rsw-cdash__rowmeta", "Nenhum Place neste Universe ainda."));
  }
  for (const p of places) {
    const row = el("div", "rsw-cdash__row");
    const nameWrap = el("span", "rsw-cdash__rowname");
    nameWrap.textContent = p.name;
    if (u.rootPlaceId === p.id) nameWrap.appendChild(chip("Root", "accent"));
    row.appendChild(nameWrap);
    row.appendChild(el("span", "rsw-cdash__rowmeta", "ID " + p.id));
    const vinfo = p.activeVersionNum
      ? "Active v" + p.activeVersionNum + " \u00b7 cloud v" + (p.cloudVersion || 0)
      : (p.savedAt ? "Sem vers\u00e3o ativa" : "Nunca salvo");
    row.appendChild(el("span", "rsw-cdash__rowmeta", vinfo + (p.savedAt ? " \u00b7 " + fmtDate(p.savedAt) : "")));
    const acts2 = el("span", "rsw-cdash__rowacts");
    acts2.appendChild(smallBtn("Open", () => openPlaceInStudio(p), "primary"));
    acts2.appendChild(smallBtn("Versions\u2026", () => openVersionsModal(p)));
    if (u.rootPlaceId !== p.id) {
      acts2.appendChild(smallBtn("Make Root", async () => {
        u.rootPlaceId = p.id;
        u.updatedAt = new Date().toISOString();
        await cloudStore.putUniverse(u);
        renderSection();
      }));
    }
    acts2.appendChild(smallBtn("Delete", () => {
      openConfirm({
        title: "Delete Place",
        message: 'Excluir o Place "' + p.name + '" da nuvem?',
        buttons: [
          { label: "Delete", value: "del", kind: "primary" },
          { label: "Cancel", value: "cancel", kind: "ghost" },
        ],
      }).then(async (v) => {
        if (v !== "del") return;
        await cloudStore.deletePlace(p.id);
        if (u.rootPlaceId === p.id) {
          u.rootPlaceId = null;
          await cloudStore.putUniverse(u);
        }
        renderSection();
      });
    }, "danger"));
    row.appendChild(acts2);
    tbl.appendChild(row);
  }
  const newPlaceBtn = smallBtn("+ New Place", async () => {
    const name = await openPrompt({
      title: "New Place",
      label: "Nome do Place",
      placeholder: "Novo local",
      maxLength: 120,
      sanitize: (v) => cloudPublish.sanitizeCloudName(v, ""),
      validate: (v) => (!v ? "Digite um nome v\u00e1lido." : null),
      okLabel: "Criar",
      cancelLabel: "Cancelar",
    });
    if (name == null) return;
    await cloudPublish.createPlace(u, name);
    renderSection();
  });
  tbl.appendChild(newPlaceBtn);
  card.appendChild(tbl);
  return card;
}

function openPermissionsModal(u) {
  const body = el("div", "rsw-cdash__permbody");
  const buildList = (arr, label, placeholder) => {
    const box = el("div", "rsw-cdash__permbox");
    box.appendChild(el("div", "rsw-cdash__permlabel", label));
    const chips = el("div", "rsw-cdash__permchips");
    const redraw = () => {
      chips.textContent = "";
      if (!arr.length) chips.appendChild(el("span", "rsw-cdash__rowmeta", "Vazio."));
      arr.forEach((name, i) => {
        const c = chip(name);
        const x = el("button", "rsw-cdash__chipx", "\u00d7");
        x.type = "button";
        x.addEventListener("click", () => {
          arr.splice(i, 1);
          redraw();
        });
        c.appendChild(x);
        chips.appendChild(c);
      });
    };
    redraw();
    const addRow = el("div", "rsw-cdash__permadd");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "rsw-cdash__input";
    input.placeholder = placeholder;
    input.maxLength = 60;
    const add = smallBtn("Add", () => {
      const v = cloudPublish.sanitizeCloudName(input.value, "");
      if (!v) return;
      if (arr.length >= 20) return;
      if (!arr.includes(v)) arr.push(v);
      input.value = "";
      redraw();
    }, "primary");
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
    addRow.append(input, add);
    box.append(chips, addRow);
    return box;
  };
  const collaborators = (u.collaborators || []).slice();
  const groups = (u.groups || []).slice();
  body.appendChild(buildList(collaborators, "Colaboradores", "Username do colaborador"));
  body.appendChild(buildList(groups, "Grupos", "Nome do grupo"));
  let handle = null;
  const foot = el("div", "rsw-modal__btnrow");
  foot.append(
    makeButton("Cancel", "ghost", () => { if (handle) handle.close(); }),
    makeButton("Save", "primary", async () => {
      u.collaborators = collaborators;
      u.groups = groups;
      u.updatedAt = new Date().toISOString();
      await cloudStore.putUniverse(u);
      if (handle) handle.close();
      renderSection();
    }),
  );
  handle = openModal({ title: "Permissions \u2014 " + u.name, body, footer: foot, width: 460 });
}

async function openVersionsModal(place) {
  const key = place.sourceKey || "cloudplace:" + place.id;
  const versions = await versionHistory.listVersions(key);
  const body = el("div", "rsw-cdash__versions");
  if (!versions.length) {
    body.appendChild(el("p", "rsw-cdash__rowmeta", "Nenhuma vers\u00e3o registrada ainda. Use Save to Cloud ou Publish to Roblox."));
  }
  let handle = null;
  const redraw = (list) => {
    body.textContent = "";
    for (const v of list) {
      const row = el("div", "rsw-cdash__row");
      const name = el("span", "rsw-cdash__rowname", "v" + v.num);
      if (place.activeVersionId === v.id) name.appendChild(chip("Active", "ok"));
      row.appendChild(name);
      row.appendChild(el("span", "rsw-cdash__rowmeta", fmtDate(v.savedAt) + " \u00b7 " + v.author + " \u00b7 " + persistence.formatBytes(v.size)));
      if (v.comment) row.appendChild(el("span", "rsw-cdash__rowmeta rsw-cdash__rowcomment", v.comment));
      const acts = el("span", "rsw-cdash__rowacts");
      if (place.activeVersionId !== v.id) {
        acts.appendChild(smallBtn("Set Active", async () => {
          const updated = await cloudPublish.setActiveVersion(place.id, v);
          if (updated) {
            place.activeVersionId = updated.activeVersionId;
            place.activeVersionNum = updated.activeVersionNum;
            NotificationService.notify("success", 'Version v' + v.num + ' is now active for "' + place.name + '"');
            redraw(list);
          }
        }, "primary"));
      }
      row.appendChild(acts);
      body.appendChild(row);
    }
  };
  if (versions.length) redraw(versions);
  const foot = el("div", "rsw-modal__btnrow");
  foot.append(makeButton("Close", "primary", () => { if (handle) handle.close(); renderSection(); }));
  handle = openModal({ title: "Versions \u2014 " + place.name, body, footer: foot, width: 560 });
}

async function openPlaceInStudio(place) {
  try {
    let text = null;
    if (place.activeVersionId) text = await versionHistory.getVersionText(place.activeVersionId);
    if (!text) text = await cloudStore.readPlaceText(place.id);
    if (!text) {
      openInfo({ title: "Cloud", content: 'O Place "' + place.name + '" ainda n\u00e3o tem conte\u00fado salvo na nuvem. Use "Save Current Project to Cloud" primeiro.' });
      return;
    }


    const ok = await persistence.openFromCloudText(text, place.name);
    if (ok) {
      cloudPublish.setActivePlace(place.id);
      closeCreatorDashboard();
      setStatus('Opened from Cloud: "' + place.name + '"');
    }
  } catch (e) {
    logger.warn("Creator Dashboard: falha ao abrir place: " + ((e && e.message) || e), { source: "Studio" });
    openInfo({ title: "Cloud", content: "Falha ao abrir o Place: " + ((e && e.message) || e) });
  }
}

function pickDestinationModal() {
  return new Promise((resolve) => {
    cloudStore.listUniverses().then((universes) => {
      const body = el("div", "rsw-cdash__savebody");
      const uniField = el("div", "rsw-cdash__permbox");
      uniField.appendChild(el("div", "rsw-cdash__permlabel", "Universe de destino"));
      const select = document.createElement("select");
      select.className = "rsw-cdash__input";
      const optNew = document.createElement("option");
      optNew.value = "__new__";
      optNew.textContent = "\u2014 Novo Universe \u2014";
      select.appendChild(optNew);
      for (const u of universes) {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = u.name + " (" + u.id + ")";
        select.appendChild(opt);
      }
      uniField.appendChild(select);
      const uniNameInput = document.createElement("input");
      uniNameInput.type = "text";
      uniNameInput.className = "rsw-cdash__input";
      uniNameInput.placeholder = "Nome do novo Universe";
      uniNameInput.maxLength = 120;
      uniNameInput.value = project.getName();
      uniField.appendChild(uniNameInput);
      const placeField = el("div", "rsw-cdash__permbox");
      placeField.appendChild(el("div", "rsw-cdash__permlabel", "Nome do Place"));
      const placeInput = document.createElement("input");
      placeInput.type = "text";
      placeInput.className = "rsw-cdash__input";
      placeInput.maxLength = 120;
      placeInput.value = project.getName();
      placeField.appendChild(placeInput);
      select.addEventListener("change", () => {
        uniNameInput.style.display = select.value === "__new__" ? "" : "none";
      });
      body.append(uniField, placeField);
      let handle = null;
      let done = false;
      const finish = (val) => {
        if (done) return;
        done = true;
        resolve(val);
      };
      const foot = el("div", "rsw-modal__btnrow");
      foot.append(
        makeButton("Cancel", "ghost", () => { if (handle) handle.close(); finish(null); }),
        makeButton("Save to Cloud", "primary", async () => {
          try {
            const placeName = cloudPublish.sanitizeCloudName(placeInput.value, project.getName());
            let link;
            if (select.value === "__new__") {
              link = await cloudPublish.createLink({
                universeName: cloudPublish.sanitizeCloudName(uniNameInput.value, project.getName()),
                placeName,
              });
            } else {
              link = await cloudPublish.createLink({ universeId: select.value, placeName });
            }
            if (handle) handle.close();
            finish(link);
          } catch (e) {
            if (handle) handle.close();
            openInfo({ title: "Cloud", content: "Falha ao preparar o destino: " + ((e && e.message) || e) });
            finish(null);
          }
        }),
      );
      handle = openModal({
        title: "Save to Cloud",
        body,
        footer: foot,
        width: 440,
        onClose: () => finish(null),
      });
    });
  });
}

export async function saveCurrentProjectToCloud() {
  if (_busySave) return false;
  _busySave = true;
  try {
    const built = await persistence.buildPlaceTextAsync("Saving to Cloud\u2026");
    let link = await cloudPublish.findLink();
    if (!link) link = await pickDestinationModal();
    if (!link) {
      setStatus("Save to Cloud canceled");
      return false;
    }
    const res = await cloudPublish.saveBuiltToCloud(built, {
      universe: link.universe,
      place: link.place,
      comment: "Save to Cloud",
    });
    NotificationService.notify("success", 'Saved to Cloud: "' + res.place.name + '" (' + persistence.formatBytes(res.place.size) + ")");
    setStatus("Saved to Cloud");
    logger.info('Cloud: projeto salvo em "' + res.place.name + '" (Universe ' + res.place.universeId + ").", { source: "Studio" });
    if (_open && (_section === "creations" || _section === "home")) renderSection();
    return true;
  } catch (e) {
    logger.warn("Save to Cloud falhou: " + ((e && e.message) || e), { source: "Studio" });
    NotificationService.notify("error", "Save to Cloud failed: " + ((e && e.message) || e));
    return false;
  } finally {
    _busySave = false;
  }
}

async function renderCredentials() {
  const target = _contentEl;
  target.appendChild(heading("Credentials", "API Keys simuladas para uso com CloudService em scripts server-side."));
  const note = el("div", "rsw-cdash__note");
  note.textContent = "Anti-exploit: as chaves s\u00e3o fake e locais. O token completo \u00e9 exibido apenas uma vez, nunca \u00e9 acess\u00edvel a LocalScripts e o CloudService s\u00f3 funciona no contexto Server.";
  target.appendChild(note);
  const bar = el("div", "rsw-cdash__toolbar");
  bar.appendChild(smallBtn("+ Create API Key", openCreateKeyModal, "primary"));
  target.appendChild(bar);

  const keys = await cloudStore.listApiKeys();
  const universes = await cloudStore.listUniverses();
  if (_section !== "credentials" || target !== _contentEl) return;
  const uniName = (id) => {
    const u = universes.find((x) => x.id === id);
    return u ? u.name : id;
  };
  if (!keys.length) {
    const empty = el("div", "rsw-cdash__empty");
    empty.appendChild(el("div", "rsw-cdash__emptytitle", "Nenhuma API Key"));
    empty.appendChild(el("div", "rsw-cdash__emptydesc", "Crie uma chave para usar CloudService:RequestAsync em scripts."));
    target.appendChild(empty);
    return;
  }
  keys.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const panel = el("div", "rsw-cdash__panel");
  for (const k of keys) {
    const status = openCloud.keyStatus(k);
    const row = el("div", "rsw-cdash__row");
    const name = el("span", "rsw-cdash__rowname", k.name);
    name.appendChild(chip(status === "active" ? "Active" : status === "expired" ? "Expired" : "Revoked", status === "active" ? "ok" : status === "expired" ? "warn" : "muted"));
    row.appendChild(name);


  row.appendChild(el("span", "rsw-cdash__rowmeta rsw-cdash__mono", k.tokenPreview || openCloud.maskToken(k.token)));
    row.appendChild(el("span", "rsw-cdash__rowmeta", uniName(k.universeId) + " \u00b7 " + k.scopes.length + " scope(s) \u00b7 " + (k.expiresAt ? "expira " + fmtDate(k.expiresAt) : "sem expira\u00e7\u00e3o")));
    const acts = el("span", "rsw-cdash__rowacts");
    if (status === "active") {
      acts.appendChild(smallBtn("Revoke", async () => {
        await openCloud.revokeApiKey(k.id);
        renderSection();
      }));
    }
    acts.appendChild(smallBtn("Delete", () => {
      openConfirm({
        title: "Delete API Key",
        message: 'Excluir a chave "' + k.name + '"? Scripts que a usam v\u00e3o falhar com 401.',
        buttons: [
          { label: "Delete", value: "del", kind: "primary" },
          { label: "Cancel", value: "cancel", kind: "ghost" },
        ],
      }).then(async (v) => {
        if (v !== "del") return;
        await cloudStore.deleteApiKey(k.id);
        renderSection();
      });
    }, "danger"));
    row.appendChild(acts);
    panel.appendChild(row);
  }
  target.appendChild(panel);
}

async function openCreateKeyModal() {
  const universes = await cloudStore.listUniverses();
  if (!universes.length) {
    openInfo({ title: "API Keys", content: "Crie um Universe primeiro (se\u00e7\u00e3o Creations) para associar a API Key." });
    return;
  }
  const body = el("div", "rsw-cdash__savebody");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "rsw-cdash__input";
  nameInput.placeholder = "Ex.: Deploy pipeline";
  nameInput.maxLength = 80;
  const fName = el("div", "rsw-cdash__permbox");
  fName.appendChild(el("div", "rsw-cdash__permlabel", "Name"));
  fName.appendChild(nameInput);

  const select = document.createElement("select");
  select.className = "rsw-cdash__input";
  for (const u of universes) {
    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = u.name + " (" + u.id + ")";
    select.appendChild(opt);
  }
  const fUni = el("div", "rsw-cdash__permbox");
  fUni.appendChild(el("div", "rsw-cdash__permlabel", "Universe"));
  fUni.appendChild(select);

  const fScopes = el("div", "rsw-cdash__permbox");
  fScopes.appendChild(el("div", "rsw-cdash__permlabel", "Scopes"));
  const checks = [];
  for (const s of openCloud.SCOPES) {
    const lab = el("label", "rsw-cdash__check");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = s;
    lab.appendChild(cb);
    lab.appendChild(el("span", "", openCloud.SCOPE_LABELS[s] || s));
    lab.appendChild(el("code", "rsw-cdash__mono rsw-cdash__scopecode", s));
    checks.push(cb);
    fScopes.appendChild(lab);
  }




  const ipInput = document.createElement("input");
  ipInput.type = "text";
  ipInput.className = "rsw-cdash__input";
  ipInput.value = openCloud.IP_WHITELIST_PLACEHOLDER_VALUE;
  ipInput.maxLength = 120;
  ipInput.disabled = !openCloud.IP_WHITELIST_IS_ENFORCED;
  ipInput.title = openCloud.IP_WHITELIST_NOT_ENFORCED_HINT;
  const fIp = el("div", "rsw-cdash__permbox");
  fIp.appendChild(el("div", "rsw-cdash__permlabel", "IP Whitelist (n\u00e3o aplicada)"));
  fIp.appendChild(ipInput);
  if (!openCloud.IP_WHITELIST_IS_ENFORCED) {
    fIp.appendChild(
      el("div", "rsw-cdash__note rsw-cdash__note--warn", openCloud.IP_WHITELIST_NOT_ENFORCED_HINT),
    );
  }

  const expSelect = document.createElement("select");
  expSelect.className = "rsw-cdash__input";
  for (const [v, label] of [["30", "30 dias"], ["60", "60 dias"], ["90", "90 dias"], ["0", "Sem expira\u00e7\u00e3o"]]) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = label;
    expSelect.appendChild(opt);
  }
  const fExp = el("div", "rsw-cdash__permbox");
  fExp.appendChild(el("div", "rsw-cdash__permlabel", "Expiration"));
  fExp.appendChild(expSelect);

  const errEl = el("p", "rsw-cdash__error");
  errEl.hidden = true;
  body.append(fName, fUni, fScopes, fIp, fExp, errEl);

  let handle = null;
  const foot = el("div", "rsw-modal__btnrow");
  foot.append(
    makeButton("Cancel", "ghost", () => { if (handle) handle.close(); }),
    makeButton("Create Key", "primary", async () => {
      const scopes = checks.filter((c) => c.checked).map((c) => c.value);
      const name = openCloud.sanitizeKeyName(nameInput.value);
      if (!name) {
        errEl.textContent = "Informe um nome v\u00e1lido.";
        errEl.hidden = false;
        return;
      }
      if (!scopes.length) {
        errEl.textContent = "Selecione pelo menos um scope.";
        errEl.hidden = false;
        return;
      }
      try {
        const rec = await openCloud.createApiKey({
          name,
          universeId: select.value,
          scopes,
          ipWhitelist: ipInput.value,
          expirationDays: Number(expSelect.value) || 0,
        });
        if (handle) handle.close();
        showTokenOnceModal(rec);
        renderSection();
      } catch (e) {
        errEl.textContent = String((e && e.message) || e);
        errEl.hidden = false;
      }
    }),
  );
  handle = openModal({ title: "Create API Key", body, footer: foot, width: 480 });
}

function showTokenOnceModal(rec) {
  const body = el("div", "rsw-cdash__savebody");
  const warn = el("div", "rsw-cdash__note rsw-cdash__note--warn");
  warn.textContent = "Copie o token agora. Por seguran\u00e7a (anti-exploit), ele n\u00e3o ser\u00e1 exibido novamente na interface.";
  const tokenBox = document.createElement("input");
  tokenBox.type = "text";
  tokenBox.readOnly = true;
  tokenBox.className = "rsw-cdash__input rsw-cdash__mono";
  tokenBox.value = rec.token;
  const copyBtn = smallBtn("Copy token", () => {
    if (copyText(rec.token)) {
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy token"; }, 1200);
    }
  }, "primary");
  body.append(warn, tokenBox, copyBtn);
  let handle = null;
  const foot = el("div", "rsw-modal__btnrow");
  foot.append(makeButton("Done", "primary", () => { if (handle) handle.close(); }));
  handle = openModal({ title: 'API Key "' + rec.name + '" criada', body, footer: foot, width: 480, closeOnBackdrop: false });
  setTimeout(() => { tokenBox.select(); }, 0);
}

async function renderAssets() {
  const target = _contentEl;
  target.appendChild(heading("Asset Manager (Global)", "Assets da nuvem, fora da hierarquia do DataModel."));
  const universes = await cloudStore.listUniverses();
  if (_section !== "assets" || target !== _contentEl) return;
  if (!universes.length) {
    const empty = el("div", "rsw-cdash__empty");
    empty.appendChild(el("div", "rsw-cdash__emptytitle", "Nenhum Universe"));
    empty.appendChild(el("div", "rsw-cdash__emptydesc", "Crie um Universe na se\u00e7\u00e3o Creations antes de enviar assets."));
    target.appendChild(empty);
    return;
  }
  if (!_assetsUniverseId || !universes.some((u) => u.id === _assetsUniverseId)) {
    _assetsUniverseId = universes[0].id;
  }

  const bar = el("div", "rsw-cdash__toolbar");
  const select = document.createElement("select");
  select.className = "rsw-cdash__input rsw-cdash__input--inline";
  for (const u of universes) {
    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = u.name;
    if (u.id === _assetsUniverseId) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => {
    _assetsUniverseId = select.value;
    renderSection();
  });
  bar.appendChild(select);
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = cloudAssets.acceptAttribute();
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = "";
    if (files.length) startUpload(files);
  });
  bar.appendChild(smallBtn("Upload files\u2026", () => fileInput.click(), "primary"));
  bar.appendChild(fileInput);
  bar.appendChild(el("span", "rsw-cdash__rowmeta", "Aceita: .png .jpg .jpeg .bmp .mp3 .ogg .wav .obj .glb .gltf (m\u00e1x. 20MB)"));
  target.appendChild(bar);

  const drop = el("div", "rsw-cdash__dropzone");
  drop.appendChild(createIcon("create", 22));
  drop.appendChild(el("div", "", "Arraste e solte m\u00faltiplos arquivos aqui"));
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("is-over");
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (files.length) startUpload(files);
  });
  target.appendChild(drop);

  const progressWrap = el("div", "rsw-cdash__progress");
  progressWrap.hidden = true;
  const progressFill = el("div", "rsw-cdash__progressfill");
  const progressLabel = el("div", "rsw-cdash__progresslabel");
  progressWrap.append(progressFill, progressLabel);
  target.appendChild(progressWrap);

  async function startUpload(files) {
    if (_uploading) return;
    _uploading = true;
    progressWrap.hidden = false;
    progressFill.style.width = "0%";
    progressLabel.textContent = "Enviando 0/" + files.length + "\u2026";
    try {
      const results = await cloudAssets.uploadFiles({
        universeId: _assetsUniverseId,
        files,
        onProgress: (done, total, name, ok, reason) => {
          progressFill.style.width = Math.round((done / total) * 100) + "%";
          progressLabel.textContent = "Enviando " + done + "/" + total + " \u2014 " + name + (ok ? "" : " (falhou)");
          if (!ok && reason) logger.warn("Cloud upload: " + name + ": " + reason, { source: "Studio" });
        },
      });
      const okCount = results.filter((r) => r.ok).length;
      const failCount = results.length - okCount;
      NotificationService.notify(
        failCount ? "warning" : "success",
        "Upload: " + okCount + " asset(s) enviado(s)" + (failCount ? ", " + failCount + " falha(s) \u2014 veja o Output" : ""),
      );
    } catch (e) {
      NotificationService.notify("error", "Upload failed: " + ((e && e.message) || e));
    } finally {
      _uploading = false;
      if (_open && _section === "assets") renderSection();
    }
  }

  const assets = await cloudStore.listAssets(_assetsUniverseId);
  if (_section !== "assets" || target !== _contentEl) return;
  const grid = el("div", "rsw-cdash__assetgrid");
  if (!assets.length) {
    grid.appendChild(el("div", "rsw-cdash__rowmeta", "Nenhum asset neste Universe ainda."));
  }
  const link = await cloudPublish.findLink();
  const currentUid = link ? link.universe.id : null;
  for (const a of assets) {
    grid.appendChild(buildAssetCard(a, currentUid));
  }
  target.appendChild(grid);
}

function buildAssetCard(a, currentUid) {
  const card = el("div", "rsw-cdash__asset");
  const thumb = el("div", "rsw-cdash__assetthumb");
  if (a.status === "Rejected") {
    card.classList.add("is-rejected");
    const img = document.createElement("img");
    img.alt = "Content Deleted";

    markThumbnailFailureOnError(img, thumb);
    const cd = cloudAssets.contentDeletedThumb();
    if (cd) img.src = cd;
    thumb.appendChild(img);
  } else if (a.kind === "image") {
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    markThumbnailFailureOnError(img, thumb);           
    thumb.appendChild(img);
    cloudAssets.getThumbnail(a).then((url) => {
      if (url) img.src = url;
      else thumb.replaceChildren(createIcon("decal", 26));
    });
  } else {
    thumb.appendChild(createIcon(a.kind === "audio" ? "soundservice" : "meshpart", 26));
  }
  card.appendChild(thumb);
  const name = el("div", "rsw-cdash__assetname", a.status === "Rejected" ? "[Content Deleted]" : a.name);
  name.title = a.name;
  card.appendChild(name);

  const statusRow = el("div", "rsw-cdash__assetmeta");
  statusRow.appendChild(chip(a.status, a.status === "Approved" ? "ok" : a.status === "Pending" ? "warn" : "muted"));
  statusRow.appendChild(el("span", "rsw-cdash__rowmeta", cloudAssets.KIND_LABELS[a.kind] + " \u00b7 " + persistence.formatBytes(a.size)));
  card.appendChild(statusRow);

  const idRow = el("div", "rsw-cdash__assetmeta");
  idRow.appendChild(el("code", "rsw-cdash__mono", "rbxassetid://" + a.assetId));
  const copyBtn = smallBtn("Copy", () => {
    if (copyText("rbxassetid://" + a.assetId)) setStatus("Asset ID copied");
  });
  idRow.appendChild(copyBtn);
  card.appendChild(idRow);

  const foot = el("div", "rsw-cdash__assetfoot");
  const pubLabel = el("label", "rsw-cdash__check rsw-cdash__check--inline");
  const pubCb = document.createElement("input");
  pubCb.type = "checkbox";
  pubCb.checked = !!a.isPublic;
  pubCb.addEventListener("change", async () => {
    await cloudAssets.setAssetPublic(a.id, pubCb.checked);
    a.isPublic = pubCb.checked;
  });
  pubLabel.appendChild(pubCb);
  pubLabel.appendChild(el("span", "", "IsPublic"));
  foot.appendChild(pubLabel);
  foot.appendChild(smallBtn("Insert", async () => {
    const res = await cloudAssets.insertIntoProject(a, currentUid);
    if (res.ok) {
      NotificationService.notify(res.placeholder ? "warning" : "success", res.placeholder ? "Inserted as Content Deleted placeholder" : 'Asset "' + a.name + '" added to Asset Manager');
    } else {
      NotificationService.notify("warning", res.reason);
    }
  }, "primary"));
  foot.appendChild(smallBtn("Delete", () => {
    openConfirm({
      title: "Delete Asset",
      message: 'Excluir "' + a.name + '" da nuvem?',
      buttons: [
        { label: "Delete", value: "del", kind: "primary" },
        { label: "Cancel", value: "cancel", kind: "ghost" },
      ],
    }).then(async (v) => {
      if (v !== "del") return;
      await cloudStore.deleteAsset(a.id);
      renderSection();
    });
  }, "danger"));
  card.appendChild(foot);
  return card;
}

function renderDocs() {
  const target = _contentEl;
  target.appendChild(heading("Documentation", "Refer\u00eancia da Open Cloud simulada e do CloudService."));

  const apiCard = el("div", "rsw-cdash__panel");
  apiCard.appendChild(el("h2", "rsw-cdash__h2", "API Browser (Parte 64)"));
  apiCard.appendChild(el("p", "rsw-cdash__rowmeta", "Documenta\u00e7\u00e3o completa de classes, servi\u00e7os e APIs Luau do Studio."));
  apiCard.appendChild(smallBtn("Open API Browser", () => {
    if (store.get("appMode") === "EDITOR") {
      closeCreatorDashboard();
      openApiBrowser();
    } else {
      NotificationService.notify("info", "Abra um place no editor para usar o API Browser.");
    }
  }, "primary"));
  target.appendChild(apiCard);

  const endpoints = el("div", "rsw-cdash__panel");
  endpoints.appendChild(el("h2", "rsw-cdash__h2", "Endpoints simulados (CloudService:RequestAsync)"));
  const list = [
    ["GET", "universes/{universeId}/data-stores/{name}/entries/{key}", "universe.datastore:read"],
    ["POST", "universes/{universeId}/data-stores/{name}/entries/{key}", "universe.datastore:write (body JSON: { \"value\": ... })"],
    ["DELETE", "universes/{universeId}/data-stores/{name}/entries/{key}", "universe.datastore:write"],
    ["POST", "universes/{universeId}/topics/{topic}", "universe.messaging-service:publish (body: { \"message\": ... })"],
    ["POST", "universes/{universeId}/places/{placeId}/versions", "universe.place:publish"],
    ["GET", "universes/{universeId}/assets", "universe.asset:read"],
  ];
  for (const [m, path, scope] of list) {
    const row = el("div", "rsw-cdash__row");
    row.appendChild(chip(m, m === "GET" ? "ok" : m === "DELETE" ? "muted" : "accent"));
    row.appendChild(el("code", "rsw-cdash__mono rsw-cdash__endpoint", path));
    row.appendChild(el("span", "rsw-cdash__rowmeta", scope));
    endpoints.appendChild(row);
  }
  endpoints.appendChild(el("p", "rsw-cdash__rowmeta", "Rate limit: " + openCloud.RATE_LIMIT_PER_MINUTE + " requests/minuto por chave. Respostas 401/403/404/429 permitem testar tratamento de erros."));
  target.appendChild(endpoints);

  const example = el("div", "rsw-cdash__panel");
  example.appendChild(el("h2", "rsw-cdash__h2", "Exemplo Luau (Script server-side)"));
  const pre = el("pre", "rsw-cdash__code");
  pre.textContent = [
    'local CloudService = game:GetService("CloudService")',
    'local API_KEY = "rbx_SUA_CHAVE_AQUI"',
    'local UNIVERSE = "SEU_UNIVERSE_ID"',
    "",
    'local res = CloudService:RequestAsync(API_KEY,',
    '\t"universes/" .. UNIVERSE .. "/data-stores/PlayerData/entries/coins_1",',
    '\t"POST", \'{"value": 250}\')',
    "print(res.StatusCode, res.Body)",
    "",
    'local msg = CloudService:RequestAsync(API_KEY,',
    '\t"universes/" .. UNIVERSE .. "/topics/GlobalAnnounce",',
    '\t"POST", \'{"message": "Ol\u00e1 de fora do jogo!"}\')',
    "print(msg.StatusCode, msg.Body)",
  ].join("\n");
  example.appendChild(pre);
  example.appendChild(el("p", "rsw-cdash__rowmeta", "Mensagens publicadas em t\u00f3picos s\u00e3o entregues a MessagingService:SubscribeAsync no mesmo t\u00f3pico durante o Playtest."));
  target.appendChild(example);
}

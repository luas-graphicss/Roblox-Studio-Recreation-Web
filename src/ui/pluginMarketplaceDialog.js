import { bus } from "../core/eventBus.js";
import { openModal, makeButton, openInfo } from "./modal.js";
import { createIcon } from "./icons.js";
import {
  MARKETPLACE_PLUGINS,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_SORTS,
} from "../plugins/marketplaceData.js";
import { installPlugin, isInstalled } from "../plugins/pluginHost.js";

const PAGE_SIZE = 9;
const SHOT_ICONS = ["imagelabel", "camera", "viewportframe"];


function starsRow(rating) {
  const wrap = document.createElement("span");
  wrap.className = "rsw-stars";
  const full = Math.round(Math.max(0, Math.min(5, rating)));
  for (let i = 1; i <= 5; i += 1) {
    wrap.appendChild(createIcon(i <= full ? "starFill" : "star", 11));
  }
  const num = document.createElement("span");
  num.className = "rsw-stars__num";
  num.textContent = rating.toFixed(1);
  wrap.appendChild(num);
  return wrap;
}

function fmtInstalls(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return Math.round(n / 1000) + "k";
  return String(n);
}

function metaFor(p) {
  return {
    id: p.id,
    name: p.name,
    creator: p.creator,
    version: p.version,
    icon: p.icon,
    category: p.category,
    hasSettings: !!p.hasSettings,
    buttons: p.buttons || [],
  };
}

export function openPluginMarketplace() {
  const body = document.createElement("div");
  body.className = "rsw-pmkt";

  const state = { query: "", category: "All", sort: "popular", shown: PAGE_SIZE, detail: null };


  const controls = document.createElement("div");
  controls.className = "rsw-pmkt__controls";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "rsw-pmkt__search";
  search.placeholder = "Buscar plugins\u2026";
  search.setAttribute("aria-label", "Buscar plugins no Marketplace");
  const catSel = document.createElement("select");
  catSel.className = "rsw-pmkt__select";
  catSel.setAttribute("aria-label", "Categoria");
  for (const c of MARKETPLACE_CATEGORIES) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    catSel.appendChild(opt);
  }
  const sortSel = document.createElement("select");
  sortSel.className = "rsw-pmkt__select";
  sortSel.setAttribute("aria-label", "Ordena\u00e7\u00e3o");
  for (const s of MARKETPLACE_SORTS) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.label;
    sortSel.appendChild(opt);
  }
  controls.append(search, catSel, sortSel);

  const scroll = document.createElement("div");
  scroll.className = "rsw-pmkt__scroll";
  body.append(controls, scroll);

  function filtered() {
    const q = state.query.toLowerCase();
    const list = MARKETPLACE_PLUGINS.filter(
      (p) =>
        (state.category === "All" || p.category === state.category) &&
        (!q ||
          p.name.toLowerCase().includes(q) ||
          p.creator.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)),
    ).slice();
    if (state.sort === "popular") list.sort((a, b) => b.installs - a.installs);
    else if (state.sort === "recent") list.sort((a, b) => (a.updated < b.updated ? 1 : -1));
    else list.sort((a, b) => b.rating - a.rating);
    return list;
  }

  function installBtnFor(p) {
    if (isInstalled(p.id)) {
      const btn = makeButton("Installed", "ghost", () => {});
      btn.disabled = true;
      return btn;
    }
    const label = p.price > 0 ? `Install (${p.price} Robux)` : "Install";
    return makeButton(label, "primary", (e) => {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      const res = installPlugin(metaFor(p));
      if (!res.ok) openInfo({ title: "Plugin Marketplace", message: res.error });
    });
  }

  function buildCard(p) {
    const card = document.createElement("div");
    card.className = "rsw-pmkt__card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Detalhes de ${p.name}`);

    const thumb = document.createElement("div");
    thumb.className = `rsw-pmkt__thumb rsw-pmkt__thumb--${p.category.toLowerCase()}`;
    thumb.appendChild(createIcon(p.icon, 26));

    const name = document.createElement("div");
    name.className = "rsw-pmkt__name";
    name.textContent = p.name;              
    name.title = p.name;
    const creator = document.createElement("div");
    creator.className = "rsw-pmkt__creator";
    creator.textContent = `por ${p.creator}`;

    const stats = document.createElement("div");
    stats.className = "rsw-pmkt__stats";
    const stars = document.createElement("span");
    stars.className = "rsw-pmkt__stars";
    stars.appendChild(starsRow(p.rating));
    const inst = document.createElement("span");
    inst.className = "rsw-pmkt__inst";
    inst.textContent = fmtInstalls(p.installs) + " instala\u00e7\u00f5es";
    stats.append(stars, inst);

    const bottom = document.createElement("div");
    bottom.className = "rsw-pmkt__bottom";
    const price = document.createElement("span");
    price.className = "rsw-pmkt__price" + (p.price > 0 ? " rsw-pmkt__price--paid" : "");
    price.textContent = p.price > 0 ? `${p.price} Robux` : "Free";
    bottom.append(price, installBtnFor(p));

    card.append(thumb, name, creator, stats, bottom);
    card.addEventListener("click", (e) => {
      if (e.target && e.target.closest("button")) return;                             
      state.detail = p.id;
      render();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        state.detail = p.id;
        render();
      }
    });
    return card;
  }

  function renderGrid() {
    const list = filtered();
    const slice = list.slice(0, state.shown);
    const grid = document.createElement("div");
    grid.className = "rsw-pmkt__grid";
    for (const p of slice) grid.appendChild(buildCard(p));
    scroll.replaceChildren(grid);
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "rsw-pmgr__empty";
      empty.textContent = "Nenhum plugin encontrado com esses filtros.";
      scroll.replaceChildren(empty);
      return;
    }
    const more = document.createElement("div");
    more.className = "rsw-pmkt__more";
    more.textContent = `Mostrando ${slice.length} de ${list.length} plugins`;
    scroll.appendChild(more);
  }

  function renderDetail(p) {
    const wrap = document.createElement("div");
    wrap.className = "rsw-pmkt__detail";

    const back = makeButton("Voltar", "ghost", () => {
      state.detail = null;
      render();
    });
    back.classList.add("rsw-pmkt__back");
    back.prepend(createIcon("arrowLeft", 13));

    const head = document.createElement("div");
    head.className = "rsw-pmkt__dhead";
    const thumb = document.createElement("div");
    thumb.className = `rsw-pmkt__thumb rsw-pmkt__thumb--big rsw-pmkt__thumb--${p.category.toLowerCase()}`;
    thumb.appendChild(createIcon(p.icon, 34));
    const info = document.createElement("div");
    info.className = "rsw-pmkt__dinfo";
    const dname = document.createElement("div");
    dname.className = "rsw-pmkt__dname";
    dname.textContent = p.name;
    const dmeta1 = document.createElement("div");
    dmeta1.className = "rsw-pmkt__dmeta";
    dmeta1.textContent = `por ${p.creator} \u2022 v${p.version} \u2022 ${p.category}`;
    const dmeta2 = document.createElement("div");
    dmeta2.className = "rsw-pmkt__dmeta";
    dmeta2.appendChild(starsRow(p.rating));
    dmeta2.appendChild(
      document.createTextNode(
        ` \u2022 ${fmtInstalls(p.installs)} instala\u00e7\u00f5es \u2022 ${p.price > 0 ? p.price + " Robux" : "Free"}`,
      ),
    );
    info.append(dname, dmeta1, dmeta2);
    head.append(thumb, info, installBtnFor(p));

    const desc = document.createElement("div");
    desc.className = "rsw-pmkt__ddesc";
    desc.textContent = p.longDescription || p.description;

    const shotsTitle = document.createElement("div");
    shotsTitle.className = "rsw-pmkt__dtitle";
    shotsTitle.textContent = "Screenshots";
    const shots = document.createElement("div");
    shots.className = "rsw-pmkt__shots";
    for (let i = 0; i < 3; i += 1) {
      const shot = document.createElement("div");
      shot.className = "rsw-pmkt__shot";
      const ph = document.createElement("span");
      ph.className = "rsw-pmkt__shot-icon";
      ph.appendChild(createIcon(SHOT_ICONS[i % SHOT_ICONS.length], 22));
      const cap = document.createElement("div");
      cap.textContent = `Screenshot ${i + 1} (simulada)`;
      shot.append(ph, cap);
      shots.appendChild(shot);
    }

    const logTitle = document.createElement("div");
    logTitle.className = "rsw-pmkt__dtitle";
    logTitle.textContent = "Changelog";
    const log = document.createElement("ul");
    log.className = "rsw-pmkt__changelog";
    for (const entry of p.changelog || []) {
      const li = document.createElement("li");
      li.textContent = `v${entry.version} \u2014 ${entry.notes}`;
      log.appendChild(li);
    }

    wrap.append(back, head, desc, shotsTitle, shots, logTitle, log);
    scroll.replaceChildren(wrap);
    scroll.scrollTop = 0;
  }

  function render() {
    if (state.detail) {
      const p = MARKETPLACE_PLUGINS.find((x) => x.id === state.detail);
      if (p) {
        renderDetail(p);
        return;
      }
      state.detail = null;
    }
    renderGrid();
  }

  search.addEventListener("input", () => {
    state.query = search.value.trim();
    state.shown = PAGE_SIZE;
    state.detail = null;
    render();
  });
  catSel.addEventListener("change", () => {
    state.category = catSel.value;
    state.shown = PAGE_SIZE;
    state.detail = null;
    render();
  });
  sortSel.addEventListener("change", () => {
    state.sort = sortSel.value;
    state.shown = PAGE_SIZE;
    state.detail = null;
    render();
  });

  scroll.addEventListener("scroll", () => {
    if (state.detail) return;
    if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 60) {
      const total = filtered().length;
      if (state.shown < total) {
        state.shown = Math.min(total, state.shown + PAGE_SIZE);
        render();
      }
    }
  });


  const offChanged = bus.on("plugins:changed", render);

  const foot = document.createElement("div");
  foot.className = "rsw-pmkt__footer";
  let handle = null;
  foot.appendChild(makeButton("Fechar", "primary", () => handle && handle.close()));

  handle = openModal({
    title: "Plugin Marketplace",
    width: 780,
    body,
    footer: foot,
    onClose: () => offChanged(),
  });

  render();
  search.focus();
}

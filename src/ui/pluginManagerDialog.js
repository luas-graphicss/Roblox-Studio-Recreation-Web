import { bus } from "../core/eventBus.js";
import { openModal, makeButton, openConfirm } from "./modal.js";
import { createIcon } from "./icons.js";
import {
  listInstalled,
  getCounts,
  setPluginActive,
  uninstallPlugin,
  uninstallAll,
  enableAll,
  disableAll,
  getPluginSettings,
  updatePluginSettings,
} from "../plugins/pluginHost.js";

function openPluginSettingsDialog(p) {
  const body = document.createElement("div");
  body.className = "rsw-pset";
  const note = document.createElement("div");
  note.className = "rsw-pset__note";
  note.textContent = `Configura\u00e7\u00f5es persistidas de "${p.name}" (valores em JSON).`;
  body.appendChild(note);

  const settings = getPluginSettings(p.id);
  const keys = Object.keys(settings);
  const inputs = new Map();
  if (!keys.length) {
    const empty = document.createElement("div");
    empty.className = "rsw-pset__empty";
    empty.textContent = "Este plugin ainda n\u00e3o salvou configura\u00e7\u00f5es.";
    body.appendChild(empty);
  }
  for (const key of keys) {
    const row = document.createElement("div");
    row.className = "rsw-pset__row";
    const label = document.createElement("span");
    label.className = "rsw-pset__key";
    label.textContent = key;              
    label.title = key;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "rsw-pset__val";
    input.value = JSON.stringify(settings[key]);
    inputs.set(key, input);
    row.append(label, input);
    body.appendChild(row);
  }

  const foot = document.createElement("div");
  foot.className = "rsw-pset__footer";
  let handle = null;
  foot.appendChild(makeButton("Cancelar", "ghost", () => handle && handle.close()));
  foot.appendChild(
    makeButton("Salvar", "primary", () => {
      const next = {};
      for (const [key, input] of inputs) {
        const raw = input.value;
        try {
          next[key] = JSON.parse(raw);
        } catch (_) {
          next[key] = raw;                                              
        }
      }
      updatePluginSettings(p.id, next);
      if (handle) handle.close();
    }),
  );

  handle = openModal({
    title: `Settings \u2014 ${p.name}`,
    width: 440,
    body,
    footer: foot,
  });
}

export function openPluginManager() {
  const body = document.createElement("div");
  body.className = "rsw-pmgr";


  const top = document.createElement("div");
  top.className = "rsw-pmgr__top";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "rsw-pmgr__search";
  search.placeholder = "Buscar plugins instalados\u2026";
  search.setAttribute("aria-label", "Buscar plugins instalados");
  const count = document.createElement("span");
  count.className = "rsw-pmgr__count";
  top.append(search, count);


  const actions = document.createElement("div");
  actions.className = "rsw-pmgr__actions";
  actions.appendChild(makeButton("Enable All", "ghost", () => enableAll()));
  actions.appendChild(makeButton("Disable All", "ghost", () => disableAll()));
  actions.appendChild(
    makeButton("Uninstall All", "danger", async () => {
      const v = await openConfirm({
        title: "Desinstalar todos os plugins",
        message:
          "Isso remove todos os plugins instalados e apaga as configura\u00e7\u00f5es deles. Esta a\u00e7\u00e3o n\u00e3o pode ser desfeita. Continuar?",
        buttons: [
          { label: "Cancelar", value: false, kind: "ghost" },
          { label: "Uninstall All", value: true, kind: "danger" },
        ],
      });
      if (v) uninstallAll();
    }),
  );

  const list = document.createElement("div");
  list.className = "rsw-pmgr__list";
  list.setAttribute("role", "list");

  body.append(top, actions, list);

  function buildRow(p) {
    const row = document.createElement("div");
    row.className = "rsw-pmgr__row" + (p.active ? "" : " rsw-pmgr__row--off");
    row.setAttribute("role", "listitem");

    const thumb = document.createElement("div");
    thumb.className = "rsw-pmgr__thumb";
    thumb.appendChild(createIcon(p.icon, 20));

    const info = document.createElement("div");
    info.className = "rsw-pmgr__info";
    const name = document.createElement("div");
    name.className = "rsw-pmgr__name";
    name.textContent = p.name + (p.temporary ? " (tempor\u00e1rio)" : "");              
    name.title = p.name;
    const meta = document.createElement("div");
    meta.className = "rsw-pmgr__meta";
    meta.textContent = `por ${p.creator} \u2022 v${p.version}`;
    info.append(name, meta);

    const state = document.createElement("span");
    state.className = "rsw-pmgr__state";
    state.textContent = p.active ? "Ativo" : "Inativo";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "rsw-toggle" + (p.active ? " rsw-toggle--on" : "");
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", p.active ? "true" : "false");
    toggle.setAttribute("aria-label", `Ativar ou desativar ${p.name}`);
    const knob = document.createElement("span");
    knob.className = "rsw-toggle__knob";
    toggle.appendChild(knob);
    toggle.addEventListener("click", () => setPluginActive(p.id, !p.active));

    const btns = document.createElement("div");
    btns.className = "rsw-pmgr__btns";
    if (p.hasSettings) {
      btns.appendChild(makeButton("Settings", "ghost", () => openPluginSettingsDialog(p)));
    }
    btns.appendChild(makeButton("Uninstall", "danger", () => uninstallPlugin(p.id)));

    row.append(thumb, info, state, toggle, btns);
    return row;
  }

  function render() {
    const counts = getCounts();
    count.textContent = `${counts.active} ativos de ${counts.installed}`;
    const q = search.value.trim().toLowerCase();
    const plugins = listInstalled().filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.creator.toLowerCase().includes(q),
    );
    list.replaceChildren();
    if (!plugins.length) {
      const empty = document.createElement("div");
      empty.className = "rsw-pmgr__empty";
      empty.textContent = q
        ? "Nenhum plugin corresponde \u00e0 busca."
        : "Nenhum plugin instalado. Use o Plugin Marketplace para instalar.";
      list.appendChild(empty);
      return;
    }
    for (const p of plugins) list.appendChild(buildRow(p));
  }

  search.addEventListener("input", render);
  const offChanged = bus.on("plugins:changed", render);

  const foot = document.createElement("div");
  foot.className = "rsw-pmgr__footer";
  let handle = null;
  foot.appendChild(makeButton("Fechar", "primary", () => handle && handle.close()));

  handle = openModal({
    title: "Plugin Management",
    width: 680,
    body,
    footer: foot,
    onClose: () => offChanged(),
  });

  render();
  search.focus();
}

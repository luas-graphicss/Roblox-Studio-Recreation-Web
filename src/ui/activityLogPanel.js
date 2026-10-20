import { bus } from "../core/eventBus.js";
import { createWidgetWindow } from "../plugins/pluginWidgets.js";
import * as teamCreate from "../collab/teamCreate.js";

const TYPE_OPTIONS = [
  { value: "", label: "Todas as a\u00e7\u00f5es" },
  { value: "create", label: "Cria\u00e7\u00f5es" },
  { value: "delete", label: "Exclus\u00f5es" },
  { value: "move", label: "Movimenta\u00e7\u00f5es" },
  { value: "color", label: "Cores" },
  { value: "property", label: "Propriedades" },
  { value: "scriptStart", label: "Scripts (in\u00edcio)" },
  { value: "scriptStop", label: "Scripts (fim)" },
  { value: "commit", label: "Commits" },
  { value: "revert", label: "Reverts" },
  { value: "connect", label: "Conex\u00f5es" },
  { value: "disconnect", label: "Desconex\u00f5es" },
  { value: "session", label: "Sess\u00e3o" },
];

let handle = null;
let listEl = null;
let actorSel = null;
let typeSel = null;
let unsubs = [];
let refreshTimer = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function cleanup() {
  for (const off of unsubs) {
    try {
      off();
    } catch (_) {}
  }
  unsubs = [];
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = 0;
  }
  handle = null;
  listEl = null;
  actorSel = null;
  typeSel = null;
}

function scheduleRender() {
  if (refreshTimer || !handle) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = 0;
    render();
  }, 80);
}

function rebuildActorOptions() {
  if (!actorSel) return;
  const current = actorSel.value;
  actorSel.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "Todos os colaboradores";
  actorSel.appendChild(all);
  for (const c of teamCreate.listCollaborators()) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name + (c.owner ? " (Owner)" : "");
    actorSel.appendChild(opt);
  }
  actorSel.value = current;
  if (actorSel.value !== current) actorSel.value = "";
}

function render() {
  if (!handle || !listEl) return;
  const filter = {};
  if (actorSel && actorSel.value) filter.actorId = actorSel.value;
  if (typeSel && typeSel.value) filter.type = typeSel.value;
  const items = teamCreate.getActivity(filter);

  listEl.replaceChildren();
  if (!teamCreate.isEnabled() && !items.length) {
    listEl.appendChild(el("div", "rsw-tcpanel__empty", "Ative o Team Create para registrar atividades da sess\u00e3o."));
    return;
  }
  if (!items.length) {
    listEl.appendChild(el("div", "rsw-tcpanel__empty", "Nenhuma atividade registrada com esse filtro."));
    return;
  }
  for (const rec of items) {
    const row = el("div", "rsw-actlog__row");
    const dot = el("span", "rsw-actlog__dot");
    dot.style.background = rec.color;
    const msg = el("span", "rsw-actlog__msg", rec.message + " \u00e0s " + teamCreate.formatActivityTime(rec.at));
    row.append(dot, msg);
    listEl.appendChild(row);
  }
}

export function openActivityLogPanel() {
  if (handle && !handle.isClosed()) {
    handle.setVisible(true);
    handle.bringToFront();
    rebuildActorOptions();
    render();
    return handle;
  }
  handle = createWidgetWindow({
    title: "Activity Log",
    pluginName: "Collaboration",
    width: 360,
    height: 400,
    onClose: cleanup,
  });
  const root = el("div", "rsw-actlog");
  const filters = el("div", "rsw-actlog__filters");
  actorSel = document.createElement("select");
  actorSel.className = "rsw-actlog__select";
  typeSel = document.createElement("select");
  typeSel.className = "rsw-actlog__select";
  for (const t of TYPE_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = t.value;
    opt.textContent = t.label;
    typeSel.appendChild(opt);
  }
  actorSel.addEventListener("change", render);
  typeSel.addEventListener("change", render);
  filters.append(actorSel, typeSel);
  listEl = el("div", "rsw-actlog__list");
  root.append(filters, listEl);
  handle.body.appendChild(root);

  unsubs.push(bus.on("collab:activity", scheduleRender));
  unsubs.push(
    bus.on("collab:changed", () => {
      rebuildActorOptions();
      scheduleRender();
    }),
  );
  unsubs.push(bus.on("collab:enabledChanged", scheduleRender));

  rebuildActorOptions();
  render();
  return handle;
}

export function isActivityLogPanelOpen() {
  return !!(handle && !handle.isClosed() && handle.isVisible());
}

export function toggleActivityLogPanel() {
  if (isActivityLogPanelOpen()) handle.setVisible(false);
  else openActivityLogPanel();
}

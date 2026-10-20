import { bus } from "../core/eventBus.js";
import { createWidgetWindow } from "../plugins/pluginWidgets.js";
import { openPrompt, openInfo } from "./modal.js";
import * as teamCreate from "../collab/teamCreate.js";

let handle = null;
let listEl = null;
let headerEl = null;
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
  headerEl = null;
}

function scheduleRender() {
  if (refreshTimer || !handle) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = 0;
    render();
  }, 60);
}

async function onInvite() {
  const value = await openPrompt({
    title: "Invite to Team Create",
    label: "E-mail ou username do convidado",
    placeholder: "amigo@exemplo.com",
  });
  if (value == null) return;
  const target = String(value).trim();
  if (!target) return;
  await openInfo({
    title: "Convite enviado",
    content:
      'Convite simulado enviado para "' + target.slice(0, 80) + '". Em um servidor real, a pessoa receberia um e-mail para entrar na sess\u00e3o.',
  });
}

async function onAddCollaborator() {
  const value = await openPrompt({
    title: "Adicionar colaborador virtual",
    label: "Nome do colaborador",
    placeholder: "Ex.: Ana, Rob_Builder...",
  });
  if (value == null) return;
  const collab = teamCreate.addCollaborator(value);
  if (collab) teamCreate.setConnected(collab.id, true);
}

function statusClass(status) {
  if (status === "Editing") return "rsw-tcpanel__status--editing";
  if (status === "Idle") return "rsw-tcpanel__status--idle";
  if (status === "Offline") return "rsw-tcpanel__status--offline";
  return "rsw-tcpanel__status--online";
}

function render() {
  if (!handle || !listEl || !headerEl) return;
  const enabled = teamCreate.isEnabled();

  headerEl.replaceChildren();
  const state = el("div", "rsw-tcpanel__state");
  const dot = el("span", "rsw-tcpanel__statedot");
  dot.classList.toggle("rsw-tcpanel__statedot--on", enabled);
  state.append(dot, el("span", null, enabled ? "Team Create ativo" : "Team Create desativado"));
  const toggleBtn = el("button", "rsw-tcpanel__btn rsw-tcpanel__btn--primary", enabled ? "Turn Off" : "Turn On");
  toggleBtn.type = "button";
  toggleBtn.addEventListener("click", () => teamCreate.setEnabled(!teamCreate.isEnabled()));
  const inviteBtn = el("button", "rsw-tcpanel__btn", "Invite");
  inviteBtn.type = "button";
  inviteBtn.disabled = !enabled;
  inviteBtn.addEventListener("click", onInvite);
  const addBtn = el("button", "rsw-tcpanel__btn", "+ Colaborador");
  addBtn.type = "button";
  addBtn.disabled = !enabled;
  addBtn.addEventListener("click", onAddCollaborator);
  headerEl.append(state, toggleBtn, inviteBtn, addBtn);

  listEl.replaceChildren();
  if (!enabled) {
    listEl.appendChild(
      el("div", "rsw-tcpanel__empty", "Ative o Team Create para colaborar com editores virtuais."),
    );
    return;
  }
  const follow = teamCreate.getFollow();
  for (const c of teamCreate.listCollaborators()) {
    const row = el("div", "rsw-tcpanel__row");
    const avatar = el("span", "rsw-tcpanel__avatar", c.name.slice(0, 1).toUpperCase());
    avatar.style.background = c.color;
    const info = el("div", "rsw-tcpanel__info");
    const nameLine = el("div", "rsw-tcpanel__name", c.name + (c.owner ? " (Owner)" : ""));
    const statusLine = el("div", "rsw-tcpanel__status " + statusClass(c.status), c.status + (c.action ? " \u2014 " + c.action : ""));
    info.append(nameLine, statusLine);
    const actions = el("div", "rsw-tcpanel__actions");
    if (!c.owner) {
      const connBtn = el("button", "rsw-tcpanel__btn", c.online ? "Disconnect" : "Connect");
      connBtn.type = "button";
      connBtn.addEventListener("click", () => teamCreate.setConnected(c.id, !c.online));
      actions.appendChild(connBtn);
      const followBtn = el("button", "rsw-tcpanel__btn", follow === c.id ? "Unfollow" : "Follow");
      followBtn.type = "button";
      followBtn.disabled = !c.online;
      followBtn.classList.toggle("rsw-tcpanel__btn--active", follow === c.id);
      followBtn.addEventListener("click", () => teamCreate.setFollow(follow === c.id ? null : c.id));
      actions.appendChild(followBtn);
      const rmBtn = el("button", "rsw-tcpanel__btn rsw-tcpanel__btn--danger", "\u2715");
      rmBtn.type = "button";
      rmBtn.title = "Remover colaborador";
      rmBtn.addEventListener("click", () => teamCreate.removeCollaborator(c.id));
      actions.appendChild(rmBtn);
    }
    row.append(avatar, info, actions);
    listEl.appendChild(row);
  }
}

export function openTeamCreatePanel() {
  if (handle && !handle.isClosed()) {
    handle.setVisible(true);
    handle.bringToFront();
    render();
    return handle;
  }
  handle = createWidgetWindow({
    title: "Team Create",
    pluginName: "Collaboration",
    width: 340,
    height: 380,
    onClose: cleanup,
  });
  const root = el("div", "rsw-tcpanel");
  headerEl = el("div", "rsw-tcpanel__header");
  listEl = el("div", "rsw-tcpanel__list");
  root.append(headerEl, listEl);
  handle.body.appendChild(root);

  unsubs.push(bus.on("collab:changed", scheduleRender));
  unsubs.push(bus.on("collab:enabledChanged", scheduleRender));
  unsubs.push(bus.on("collab:followChanged", scheduleRender));

  render();
  return handle;
}

export function isTeamCreatePanelOpen() {
  return !!(handle && !handle.isClosed() && handle.isVisible());
}

export function toggleTeamCreatePanel() {
  if (isTeamCreatePanelOpen()) handle.setVisible(false);
  else openTeamCreatePanel();
}

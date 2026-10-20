import { bus } from "../core/eventBus.js";
import { createWidgetWindow } from "../plugins/pluginWidgets.js";
import { openModal, openConfirm, makeButton } from "./modal.js";
import { diffLines, sideBySideRows, changeSummary, changedLinePreview } from "../collab/lineDiff.js";
import * as drafts from "../collab/drafts.js";

let handle = null;
let listEl = null;
let topEl = null;
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
  topEl = null;
}

function scheduleRender() {
  if (refreshTimer || !handle) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = 0;
    render();
  }, 60);
}

function formatWhen(ts) {
  const d = new Date(Number(ts) || Date.now());
  return d.toLocaleDateString() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

export function openDraftDiff(draft) {
  const diff = diffLines(draft.baseText, draft.draftText);
  const rows = sideBySideRows(diff.ops);
  const body = el("div", "rsw-draftdiff");
  if (diff.truncated) {
    body.appendChild(
      el("div", "rsw-draftdiff__warn", "Diff truncado: o script excede 50.000 linhas."),
    );
  }
  const head = el("div", "rsw-draftdiff__head");
  head.append(
    el("span", "rsw-draftdiff__side", "Publicado (base)"),
    el("span", "rsw-draftdiff__side", "Seu draft \u2014 " + changeSummary(diff)),
  );
  body.appendChild(head);
  const grid = el("div", "rsw-draftdiff__grid");
  for (const r of rows) {
    const left = el("div", "rsw-draftdiff__cell rsw-draftdiff__cell--" + (r.kind === "add" ? "empty" : r.kind));
    const lNo = el("span", "rsw-draftdiff__no", r.leftNo ? String(r.leftNo) : "");
    const lTx = el("span", "rsw-draftdiff__tx", r.leftText != null ? r.leftText : "");
    left.append(lNo, lTx);
    const right = el("div", "rsw-draftdiff__cell rsw-draftdiff__cell--" + (r.kind === "del" ? "empty" : r.kind));
    const rNo = el("span", "rsw-draftdiff__no", r.rightNo ? String(r.rightNo) : "");
    const rTx = el("span", "rsw-draftdiff__tx", r.rightText != null ? r.rightText : "");
    right.append(rNo, rTx);
    grid.append(left, right);
  }
  body.appendChild(grid);
  const foot = el("div", "rsw-modal__btnrow");
  let h = null;
  foot.appendChild(makeButton("Fechar", "default", () => h && h.close()));
  h = openModal({
    title: "Diff \u2014 " + draft.name,
    body,
    footer: foot,
    width: 900,
    className: "rsw-draftdiff-modal",
  });
  return h;
}

function render() {
  if (!handle || !listEl || !topEl) return;
  const items = drafts.list();

  topEl.replaceChildren();
  const count = el("span", "rsw-draftspanel__count", items.length + " draft" + (items.length === 1 ? "" : "s") + " pendente" + (items.length === 1 ? "" : "s"));
  const commitAll = el("button", "rsw-tcpanel__btn rsw-tcpanel__btn--primary", "Commit All");
  commitAll.type = "button";
  commitAll.disabled = !items.length;
  commitAll.addEventListener("click", async () => {
    const ok = await openConfirm({
      title: "Commit All",
      message: "Publicar todos os " + items.length + " drafts pendentes?",
      buttons: [
        { label: "Cancelar", value: null, kind: "default" },
        { label: "Commit All", value: true, kind: "primary" },
      ],
    });
    if (ok) drafts.commitAll();
  });
  const revertAll = el("button", "rsw-tcpanel__btn rsw-tcpanel__btn--danger", "Revert All");
  revertAll.type = "button";
  revertAll.disabled = !items.length;
  revertAll.addEventListener("click", async () => {
    const ok = await openConfirm({
      title: "Revert All",
      message: "Descartar todos os " + items.length + " drafts pendentes? Essa a\u00e7\u00e3o n\u00e3o pode ser desfeita.",
      buttons: [
        { label: "Cancelar", value: null, kind: "default" },
        { label: "Revert All", value: true, kind: "danger" },
      ],
    });
    if (ok) drafts.revertAll();
  });
  topEl.append(count, commitAll, revertAll);

  listEl.replaceChildren();
  if (!drafts.isEnabled() && !items.length) {
    listEl.appendChild(
      el("div", "rsw-tcpanel__empty", "Com o Team Create ativo, edi\u00e7\u00f5es de script viram drafts pendentes de Commit."),
    );
    return;
  }
  if (!items.length) {
    listEl.appendChild(el("div", "rsw-tcpanel__empty", "Nenhum draft pendente."));
    return;
  }
  for (const d of items) {
    const diff = diffLines(d.baseText, d.draftText);
    const row = el("div", "rsw-draftspanel__row");
    if (d.conflicted) row.classList.add("rsw-draftspanel__row--conflict");
    const head = el("div", "rsw-draftspanel__rowhead");
    const name = el("span", "rsw-draftspanel__name", d.name);
    name.title = d.path;
    const meta = el("span", "rsw-draftspanel__meta", d.author + " \u00b7 " + formatWhen(d.updatedAt) + " \u00b7 " + changeSummary(diff));
    head.append(name, meta);
    if (d.conflicted) {
      head.appendChild(el("span", "rsw-draftspanel__conflict", "Conflito"));
    }
    const preview = el("div", "rsw-draftspanel__preview");
    for (const line of changedLinePreview(diff, 3)) {
      preview.appendChild(el("div", "rsw-draftspanel__line rsw-draftspanel__line--" + line.type, (line.type === "add" ? "+ " : "- ") + line.text));
    }
    const actions = el("div", "rsw-draftspanel__actions");
    const diffBtn = el("button", "rsw-tcpanel__btn", "Diff");
    diffBtn.type = "button";
    diffBtn.addEventListener("click", () => openDraftDiff(d));
    const commitBtn = el("button", "rsw-tcpanel__btn rsw-tcpanel__btn--primary", d.conflicted ? "Commit (manter meu)" : "Commit");
    commitBtn.type = "button";
    commitBtn.addEventListener("click", () => {
      if (!drafts.commit(d.path)) scheduleRender();
    });
    const revertBtn = el("button", "rsw-tcpanel__btn rsw-tcpanel__btn--danger", "Revert");
    revertBtn.type = "button";
    revertBtn.addEventListener("click", async () => {
      const ok = await openConfirm({
        title: "Revert draft",
        message: 'Descartar o draft de "' + d.name + '"?',
        buttons: [
          { label: "Cancelar", value: null, kind: "default" },
          { label: "Revert", value: true, kind: "danger" },
        ],
      });
      if (ok) drafts.revert(d.path);
    });
    actions.append(diffBtn, commitBtn, revertBtn);
    row.append(head, preview, actions);
    listEl.appendChild(row);
  }
}

export function openDraftsPanel() {
  if (handle && !handle.isClosed()) {
    handle.setVisible(true);
    handle.bringToFront();
    render();
    return handle;
  }
  handle = createWidgetWindow({
    title: "Drafts",
    pluginName: "Collaboration",
    width: 380,
    height: 420,
    onClose: cleanup,
  });
  const root = el("div", "rsw-draftspanel");
  topEl = el("div", "rsw-draftspanel__top");
  listEl = el("div", "rsw-draftspanel__list");
  root.append(topEl, listEl);
  handle.body.appendChild(root);

  unsubs.push(bus.on("drafts:changed", scheduleRender));
  unsubs.push(bus.on("collab:enabledChanged", scheduleRender));

  render();
  return handle;
}

export function isDraftsPanelOpen() {
  return !!(handle && !handle.isClosed() && handle.isVisible());
}

export function toggleDraftsPanel() {
  if (isDraftsPanelOpen()) handle.setVisible(false);
  else openDraftsPanel();
}

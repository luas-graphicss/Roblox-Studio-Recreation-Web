import { openModal, openConfirm, openInfo, makeButton } from "./modal.js";
import { project } from "../core/project.js";
import { formatDiffValue } from "../collab/treeDiff.js";
import * as versionHistory from "../collab/versionHistory.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || "?");
  return d.toLocaleDateString() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function formatKB(size) {
  const kb = (Number(size) || 0) / 1024;
  return (kb >= 100 ? Math.round(kb) : Math.round(kb * 10) / 10) + " KB";
}

function thumbEl(meta, big) {
  if (meta.thumbnail) {
    const img = document.createElement("img");
    img.className = big ? "rsw-vhist__thumb rsw-vhist__thumb--big" : "rsw-vhist__thumb";
    img.alt = "Thumbnail v" + meta.num;
    img.src = meta.thumbnail;
    return img;
  }
  return el("div", "rsw-vhist__thumb rsw-vhist__thumb--empty", "sem\npreview");
}

function openPreview(meta) {
  const body = el("div", "rsw-vhist__preview");
  body.appendChild(thumbEl(meta, true));
  const info = el("div", "rsw-vhist__previewinfo");
  info.append(
    el("div", "rsw-vhist__previewrow", "Vers\u00e3o: v" + meta.num),
    el("div", "rsw-vhist__previewrow", "Salva em: " + formatWhen(meta.savedAt)),
    el("div", "rsw-vhist__previewrow", "Autor: " + meta.author),
    el("div", "rsw-vhist__previewrow", "Tamanho: " + formatKB(meta.size)),
    el("div", "rsw-vhist__previewrow", "Coment\u00e1rio: " + (meta.comment || "(nenhum)")),
  );
  body.appendChild(info);
  const foot = el("div", "rsw-modal__btnrow");
  let h = null;
  foot.appendChild(makeButton("Fechar", "default", () => h && h.close()));
  h = openModal({ title: "Preview \u2014 v" + meta.num + " (somente leitura)", body, footer: foot, width: 560 });
}

function renderCompareResult(result) {
  const body = el("div", "rsw-vhist__compare");
  const head = el("div", "rsw-vhist__comparehead");
  head.append(
    el("span", "rsw-vhist__compareside", "A: v" + result.a.num + " (" + formatWhen(result.a.savedAt) + ")"),
    el("span", "rsw-vhist__compareside", "B: v" + result.b.num + " (" + formatWhen(result.b.savedAt) + ")"),
  );
  body.appendChild(head);
  const diff = result.diff;
  body.appendChild(el("div", "rsw-vhist__comparesummary", "+" + diff.added.length + " adicionados, \u2212" + diff.removed.length + " removidos, \u0394" + diff.modified.length + " modificados"));

  const onlyChanges = document.createElement("input");
  onlyChanges.type = "checkbox";
  onlyChanges.checked = true;
  const filterLab = el("label", "rsw-vhist__filter");
  filterLab.append(onlyChanges, document.createTextNode(" Mostrar apenas altera\u00e7\u00f5es"));
  body.appendChild(filterLab);

  const tree = el("div", "rsw-vhist__comparetree");
  const detail = el("div", "rsw-vhist__comparedetail");
  detail.textContent = "Clique em um item modificado para ver as propriedades.";

  function renderTree() {
    tree.replaceChildren();
    const rows = [];
    for (const e of diff.added) rows.push({ kind: "added", path: e.path, className: e.className });
    for (const e of diff.removed) rows.push({ kind: "removed", path: e.path, className: e.className });
    for (const e of diff.modified) rows.push({ kind: "modified", path: e.path, className: e.className, changes: e.changes });
    if (!onlyChanges.checked) {
      for (const e of diff.unchanged) rows.push({ kind: "same", path: e.path, className: e.className });
    }
    rows.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
    if (!rows.length) {
      tree.appendChild(el("div", "rsw-tcpanel__empty", "As duas vers\u00f5es t\u00eam a mesma \u00e1rvore de objetos."));
      return;
    }
    for (const r of rows) {
      const row = el("div", "rsw-vhist__comparerow rsw-vhist__comparerow--" + r.kind);
      const badge = r.kind === "added" ? "+" : r.kind === "removed" ? "\u2212" : r.kind === "modified" ? "\u0394" : "=";
      row.append(el("span", "rsw-vhist__comparebadge", badge), el("span", "rsw-vhist__comparepath", r.path + " (" + r.className + ")"));
      if (r.kind === "modified") {
        row.addEventListener("click", () => {
          detail.replaceChildren();
          detail.appendChild(el("div", "rsw-vhist__detailtitle", r.path));
          for (const ch of r.changes) {
            detail.appendChild(
              el("div", "rsw-vhist__detailrow", ch.prop + ": " + formatDiffValue(ch.from) + " \u2192 " + formatDiffValue(ch.to)),
            );
          }
        });
      }
      tree.appendChild(row);
    }
  }
  onlyChanges.addEventListener("change", renderTree);
  renderTree();
  const cols = el("div", "rsw-vhist__comparecols");
  cols.append(tree, detail);
  body.appendChild(cols);

  const foot = el("div", "rsw-modal__btnrow");
  let h = null;
  foot.appendChild(makeButton("Fechar", "default", () => h && h.close()));
  h = openModal({ title: "Compare \u2014 v" + result.a.num + " vs v" + result.b.num, body, footer: foot, width: 860, className: "rsw-vhist-modal" });
}

export function openVersionHistoryDialog() {
  const body = el("div", "rsw-vhist");
  const topBar = el("div", "rsw-vhist__top");
  const hint = el("span", "rsw-vhist__hint", "Selecione 2 vers\u00f5es para comparar. Cada Ctrl+S cria uma vers\u00e3o (m\u00e1x. " + versionHistory.MAX_VERSIONS + ").");
  const compareBtn = el("button", "rsw-tcpanel__btn", "Compare");
  compareBtn.type = "button";
  compareBtn.disabled = true;
  topBar.append(hint, compareBtn);
  const listEl = el("div", "rsw-vhist__list");
  body.append(topBar, listEl);

  const selected = new Set();
  let versions = [];
  let h = null;

  function updateCompareBtn() {
    compareBtn.disabled = selected.size !== 2;
  }

  async function doCompare() {
    const pair = versions.filter((v) => selected.has(v.id));
    if (pair.length !== 2) return;
    const result = await versionHistory.compareVersions(pair[0], pair[1]);
    if (!result) {
      await openInfo({ title: "Compare", content: "N\u00e3o foi poss\u00edvel carregar as duas vers\u00f5es para compara\u00e7\u00e3o." });
      return;
    }
    renderCompareResult(result);
  }
  compareBtn.addEventListener("click", doCompare);

  async function doRestore(meta) {
    const first = await openConfirm({
      title: "Restore v" + meta.num,
      message: 'Restaurar o projeto para a vers\u00e3o v' + meta.num + " de " + formatWhen(meta.savedAt) + "?",
      buttons: [
        { label: "Cancelar", value: null, kind: "default" },
        { label: "Continuar", value: true, kind: "primary" },
      ],
    });
    if (!first) return;
    const second = await openConfirm({
      title: "Confirma\u00e7\u00e3o final",
      message: "Tem certeza? A vers\u00e3o atual ser\u00e1 salva como uma nova vers\u00e3o de backup antes do restore.",
      buttons: [
        { label: "Cancelar", value: null, kind: "default" },
        { label: "Restore", value: true, kind: "danger" },
      ],
    });
    if (!second) return;
    const ok = await versionHistory.restoreVersion(meta);
    if (ok && h) h.close();
  }

  async function doDelete(meta) {
    const ok = await openConfirm({
      title: "Delete v" + meta.num,
      message: 'Apagar a vers\u00e3o v' + meta.num + " permanentemente? Apenas o Owner pode fazer isso.",
      buttons: [
        { label: "Cancelar", value: null, kind: "default" },
        { label: "Delete", value: true, kind: "danger" },
      ],
    });
    if (!ok) return;
    selected.delete(meta.id);
    await versionHistory.deleteVersion(meta.id);
    await refresh();
  }

  async function doDownload(meta) {
    const text = await versionHistory.getVersionText(meta.id);
    if (typeof text !== "string") {
      await openInfo({ title: "Download", content: "N\u00e3o foi poss\u00edvel carregar o conte\u00fado dessa vers\u00e3o." });
      return;
    }
    versionHistory.downloadVersion(meta, text, project.getName());
  }

  async function refresh() {
    versions = await versionHistory.listVersions();
    listEl.replaceChildren();
    if (!versions.length) {
      listEl.appendChild(el("div", "rsw-tcpanel__empty", "Nenhuma vers\u00e3o salva ainda. Salve o projeto (Ctrl+S) para criar a primeira vers\u00e3o."));
      updateCompareBtn();
      return;
    }
    for (const meta of versions) {
      const row = el("div", "rsw-vhist__row");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "rsw-vhist__check";
      check.checked = selected.has(meta.id);
      check.addEventListener("change", () => {
        if (check.checked) {
          if (selected.size >= 2) {
            check.checked = false;
            return;
          }
          selected.add(meta.id);
        } else {
          selected.delete(meta.id);
        }
        updateCompareBtn();
      });
      const info = el("div", "rsw-vhist__info");
      const title = el("div", "rsw-vhist__title", "v" + meta.num + " \u2014 " + formatWhen(meta.savedAt));
      const sub = el("div", "rsw-vhist__sub", meta.author + " \u00b7 " + formatKB(meta.size) + (meta.comment ? " \u00b7 " + meta.comment : ""));
      info.append(title, sub);
      const actions = el("div", "rsw-vhist__actions");
      const previewBtn = el("button", "rsw-tcpanel__btn", "Preview");
      previewBtn.type = "button";
      previewBtn.addEventListener("click", () => openPreview(meta));
      const restoreBtn = el("button", "rsw-tcpanel__btn rsw-tcpanel__btn--primary", "Restore");
      restoreBtn.type = "button";
      restoreBtn.addEventListener("click", () => doRestore(meta));
      const dlBtn = el("button", "rsw-tcpanel__btn", "Download");
      dlBtn.type = "button";
      dlBtn.addEventListener("click", () => doDownload(meta));
      const delBtn = el("button", "rsw-tcpanel__btn rsw-tcpanel__btn--danger", "Delete");
      delBtn.type = "button";
      delBtn.addEventListener("click", () => doDelete(meta));
      actions.append(previewBtn, restoreBtn, dlBtn, delBtn);
      row.append(check, thumbEl(meta, false), info, actions);
      listEl.appendChild(row);
    }
    updateCompareBtn();
  }

  const foot = el("div", "rsw-modal__btnrow");
  foot.appendChild(makeButton("Fechar", "default", () => h && h.close()));
  h = openModal({
    title: "Version History \u2014 " + project.getName(),
    body,
    footer: foot,
    width: 760,
    className: "rsw-vhist-modal",
  });
  refresh();
  return h;
}

import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { openModal, makeButton, openConfirm, openPrompt } from "./modal.js";
import {
  convertToPackage,
  copiesOf,
  publishFromCopy,
  renamePackage,
  deletePackageEverywhere,
  restorePackageVersion,
  refreshAllStatuses,
} from "../packages/packages.js";
import { packageStore } from "../packages/packageStore.js";

const ICON_OPTIONS = ["package", "model", "gear", "star", "tool"];

function el(tag, cls, text) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  return d;
}

function fmtDate(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "\u2014";
  try {
    return new Date(n).toLocaleString();
  } catch (_) {
    return "\u2014";
  }
}

function field(labelText, input) {
  const wrap = el("div");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:4px;margin-bottom:10px;";
  const lab = el("label", "", labelText);
  lab.style.cssText = "font-size:12px;opacity:.8;";
  wrap.append(lab, input);
  return wrap;
}

export function openConvertToPackageDialog(inst) {
  if (!inst) return;
  let h = null;
  const body = el("div");

  const nameIn = el("input");
  nameIn.type = "text";
  nameIn.maxLength = 60;
  nameIn.value = String(inst.name || "Package");
  nameIn.style.width = "100%";

  const descIn = el("textarea");
  descIn.rows = 3;
  descIn.maxLength = 500;
  descIn.style.cssText = "width:100%;resize:vertical;";

  const iconSel = el("select");
  for (const opt of ICON_OPTIONS) {
    const o = el("option", "", opt);
    o.value = opt;
    iconSel.appendChild(o);
  }

  const errEl = el("div");
  errEl.style.cssText = "color:#e8b339;font-size:12px;min-height:16px;";

  body.append(
    field("Nome do package", nameIn),
    field("Descri\u00e7\u00e3o (opcional)", descIn),
    field("\u00cdcone", iconSel),
    errEl,
  );

  const foot = el("div");
  foot.appendChild(makeButton("Cancelar", "default", () => h && h.close()));
  foot.appendChild(
    makeButton("Converter", "primary", async () => {
      errEl.textContent = "";
      const res = await convertToPackage(inst, {
        name: nameIn.value,
        description: descIn.value,
        icon: iconSel.value,
      });
      if (!res.ok) {
        errEl.textContent = res.error || "Falha ao converter.";
        return;
      }
      if (h) h.close();
    }),
  );

  h = openModal({ title: "Convert to Package", body, footer: foot, width: 440 });
  try { nameIn.focus(); nameIn.select(); } catch (_) {            }
}

export async function openPackageHistoryDialog(packageId, meta) {
  let h = null;
  const body = el("div");
  const list = el("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto;";
  body.appendChild(list);

  async function refresh() {
    list.textContent = "";
    const versions = await packageStore.listVersions(packageId);
    const arr = (versions || []).slice().sort((a, b) => (b.num || 0) - (a.num || 0));
    if (!arr.length) {
      list.appendChild(el("div", "", "Nenhuma vers\u00e3o registrada."));
      return;
    }
    const current = await packageStore.getPackage(packageId);
    for (const v of arr) {
      const row = el("div");
      row.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;gap:8px;" +
        "padding:6px 8px;border:1px solid rgba(128,128,128,.25);border-radius:6px;";
      const info = el("div");
      const isCur = current && Number(current.version) === Number(v.num);
      info.appendChild(el("div", "", "v" + v.num + (isCur ? " (atual)" : "")));
      const sub = el("div", "", fmtDate(v.at || v.createdAt));
      sub.style.cssText = "font-size:11px;opacity:.7;";
      info.appendChild(sub);
      row.appendChild(info);
      if (!isCur) {
        row.appendChild(
          makeButton("Restore", "default", async () => {
            const ok = await openConfirm({
              title: "Restore vers\u00e3o",
              message: "Restaurar a v" + v.num + " como nova vers\u00e3o publicada?",
              buttons: [
                { label: "Cancelar", value: false, kind: "default" },
                { label: "Restore", value: true, kind: "primary" },
              ],
            });
            if (!ok) return;
            const res = await restorePackageVersion(packageId, v.num);
            if (!res || !res.ok) logger.warn("Restore falhou: " + ((res && res.error) || "erro"));
            await refresh();
          }),
        );
      }
      list.appendChild(row);
    }
  }

  await refresh();
  const foot = el("div");
  foot.appendChild(makeButton("Fechar", "default", () => h && h.close()));
  h = openModal({
    title: "History \u2014 " + ((meta && meta.name) || "Package"),
    body,
    footer: foot,
    width: 480,
  });
}

export async function openPackageManagerDialog() {
  let h = null;
  let offChanged = null;
  const body = el("div");
  const list = el("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:8px;max-height:380px;overflow:auto;";
  body.appendChild(list);


  let refreshBusy = false;
  let refreshQueued = false;
  async function refresh() {
    if (refreshBusy) {
      refreshQueued = true;
      return;
    }
    refreshBusy = true;
    try {
      do {
        refreshQueued = false;
        await refreshOnce();
      } while (refreshQueued);
    } finally {
      refreshBusy = false;
    }
  }
  async function refreshOnce() {
    await refreshAllStatuses();
    list.textContent = "";
    const metas = await packageStore.safeListPackages();
    if (!metas.length) {
      const empty = el("div", "", "Nenhum package neste projeto. Use \"Convert to Package\" no Explorer.");
      empty.style.cssText = "opacity:.7;padding:12px 4px;";
      list.appendChild(empty);
      return;
    }
    for (const meta of metas) {
      const copies = copiesOf(meta.id);
      const row = el("div");
      row.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;gap:8px;" +
        "padding:8px 10px;border:1px solid rgba(128,128,128,.25);border-radius:6px;";
      const info = el("div");
      info.style.cssText = "min-width:0;";
      const nameEl = el("div", "", meta.name);
      nameEl.style.cssText = "font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      const subEl = el(
        "div", "",
        "v" + meta.version + " \u00b7 " + copies.length + " c\u00f3pia(s) \u00b7 " + fmtDate(meta.updatedAt),
      );
      subEl.style.cssText = "font-size:11px;opacity:.7;";
      info.append(nameEl, subEl);
      row.appendChild(info);

      const actions = el("div");
      actions.style.cssText = "display:flex;gap:6px;flex-shrink:0;";
      actions.appendChild(
        makeButton("Rename", "default", async () => {
          const name = await openPrompt({
            title: "Rename package",
            label: "Novo nome",
            placeholder: meta.name,
          });
          if (!name) return;
          await renamePackage(meta.id, name);
          await refresh();
        }),
      );
      actions.appendChild(
        makeButton("Publish", "default", async () => {
          const copy = copiesOf(meta.id)[0];
          if (!copy) {
            logger.warn("Nenhuma c\u00f3pia no projeto para publicar.");
            return;
          }
          const res = await publishFromCopy(copy);
          if (!res || !res.ok) logger.warn("Publish falhou: " + ((res && res.error) || "erro"));
          await refresh();
        }),
      );
      actions.appendChild(
        makeButton("History", "default", () => openPackageHistoryDialog(meta.id, meta)),
      );
      actions.appendChild(
        makeButton("Delete", "danger", async () => {
          const ok = await openConfirm({
            title: "Delete package",
            message:
              "Excluir \"" + meta.name + "\"? Todas as c\u00f3pias ser\u00e3o desvinculadas (o conte\u00fado permanece).",
            buttons: [
              { label: "Cancelar", value: false, kind: "default" },
              { label: "Delete", value: true, kind: "danger" },
            ],
          });
          if (!ok) return;
          await deletePackageEverywhere(meta.id);
          await refresh();
        }),
      );
      row.appendChild(actions);
      list.appendChild(row);
    }
  }

  await refresh();
  offChanged = bus.on("packages:changed", () => refresh());
  const foot = el("div");
  foot.appendChild(makeButton("Fechar", "default", () => h && h.close()));
  h = openModal({
    title: "Package Manager",
    body,
    footer: foot,
    width: 560,
    onClose: () => {
      if (typeof offChanged === "function") offChanged();
    },
  });
}

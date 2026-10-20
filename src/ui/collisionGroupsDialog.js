import { openModal, makeButton } from "./modal.js";
import { logger } from "../core/logger.js";
import { selection } from "../core/selection.js";
import {
  MAX_GROUPS,
  DEFAULT_GROUP,
  getGroups,
  registerGroup,
  unregisterGroup,
  setCollidable,
  areCollidable,
} from "../physics/collisionGroups.js";

let _open = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function openCollisionGroupsDialog() {
  if (_open) return null;
  _open = true;

  const root = el("div", "rsw-cg");


  const groupsSection = el("div");
  groupsSection.appendChild(el("p", "rsw-cg__section-title", "Grupos registrados"));
  const list = el("div", "rsw-cg__list");
  groupsSection.appendChild(list);

  const addRow = el("div", "rsw-cg__row");
  const input = el("input", "rsw-cg__input");
  input.type = "text";
  input.placeholder = "Nome do novo grupo";
  input.maxLength = 50;
  const addBtn = makeButton("Adicionar", "primary", () => {
    const name = input.value.trim();
    if (!name) return;
    const res = registerGroup(name);
    if (!res.ok) {
      logger.warn(res.error, { source: "Studio" });
    } else {
      input.value = "";
    }
    refresh();
  });
  addRow.append(input, addBtn);
  groupsSection.appendChild(addRow);
  groupsSection.appendChild(
    el("p", "rsw-cg__hint", `At\u00e9 ${MAX_GROUPS} grupos. O grupo Default n\u00e3o pode ser removido.`),
  );
  root.appendChild(groupsSection);


  const matrixSection = el("div");
  matrixSection.appendChild(el("p", "rsw-cg__section-title", "Matriz de colis\u00e3o (marcado = colide)"));
  const matrixWrap = el("div", "rsw-cg__matrix-wrap");
  matrixSection.appendChild(matrixWrap);
  root.appendChild(matrixSection);


  const applySection = el("div");
  applySection.appendChild(el("p", "rsw-cg__section-title", "Atribuir grupo \u00e0 sele\u00e7\u00e3o"));
  const applyRow = el("div", "rsw-cg__row");
  const select = el("select", "rsw-cg__select");
  const applyMsg = el("span", "rsw-cg__hint");
  const applyBtn = makeButton("Aplicar \u00e0 sele\u00e7\u00e3o", "default", () => {
    const group = select.value || DEFAULT_GROUP;
    const sel = selection.get().filter(
      (inst) => inst && inst.hasProperty && inst.hasProperty("CollisionGroup") &&
        !(typeof inst.isDestroyed === "function" && inst.isDestroyed()),
    );
    if (sel.length === 0) {
      applyMsg.textContent = "Selecione uma ou mais Parts primeiro.";
      return;
    }
    let applied = 0;
    for (const inst of sel) {
      if (inst.getProperty("CollisionGroup") === group) continue;
      inst.setProperty("CollisionGroup", group);                               
      applied += 1;
    }
    applyMsg.textContent = applied > 0
      ? `Grupo "${group}" aplicado a ${applied} Part(s).`
      : "A sele\u00e7\u00e3o j\u00e1 est\u00e1 nesse grupo.";
  });
  applyRow.append(select, applyBtn, applyMsg);
  applySection.appendChild(applyRow);
  root.appendChild(applySection);

  function refresh() {
    const groups = getGroups();


    list.replaceChildren();
    for (const g of groups) {
      const item = el("div", "rsw-cg__item");
      item.appendChild(el("span", "rsw-cg__item-name", g));
      if (g !== DEFAULT_GROUP) {
        const rm = el("button", "rsw-cg__remove", "Remover");
        rm.type = "button";
        rm.title = `Remover o grupo "${g}"`;
        rm.addEventListener("click", () => {
          const res = unregisterGroup(g);
          if (!res.ok) logger.warn(res.error, { source: "Studio" });
          refresh();
        });
        item.appendChild(rm);
      }
      list.appendChild(item);
    }


    matrixWrap.replaceChildren();
    const table = el("table", "rsw-cg__matrix");
    const head = el("tr");
    head.appendChild(el("th", "rsw-cg__rowhead", ""));
    for (const g of groups) head.appendChild(el("th", null, g));
    table.appendChild(head);
    groups.forEach((rowG, i) => {
      const tr = el("tr");
      tr.appendChild(el("th", "rsw-cg__rowhead", rowG));
      groups.forEach((colG, j) => {
        const td = el("td");
        if (j >= i) {
          const cb = el("input");
          cb.type = "checkbox";
          cb.checked = areCollidable(rowG, colG);
          cb.title = `${rowG} \u00d7 ${colG}`;
          cb.addEventListener("change", () => {
            const res = setCollidable(rowG, colG, cb.checked);
            if (!res.ok) logger.warn(res.error, { source: "Studio" });
            refresh();
          });
          td.appendChild(cb);
        }
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    matrixWrap.appendChild(table);


    const prev = select.value;
    select.replaceChildren();
    for (const g of groups) {
      const opt = el("option", null, g);
      opt.value = g;
      select.appendChild(opt);
    }
    if (groups.includes(prev)) select.value = prev;
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addBtn.click(); }
  });

  let handle = null;
  const foot = el("div", "rsw-modal__btnrow");
  foot.appendChild(makeButton("Fechar", "primary", () => { if (handle) handle.close(); }));

  refresh();
  handle = openModal({
    title: "Collision Groups",
    body: root,
    footer: foot,
    width: 560,
    className: "rsw-modal--cg",
    onClose: () => { _open = false; },
  });
  return handle;
}

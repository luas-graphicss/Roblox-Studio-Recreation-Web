import { openModal, makeButton } from "./modal.js";
import { logger } from "../core/logger.js";
import { assetStore } from "../assets/assetStore.js";
import {
  BODY_COLOR_MEMBERS,
  BODY_MESH_TYPES,
  getBodyMeshState,
  applyBodyMesh,
  hasCharacter,
} from "../avatar/avatarOps.js";

const NONE_VALUE = "";
const TYPE_PREFIX = "type:";
const FILE_PREFIX = "file:";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function valueForState(state) {
  if (!state) return NONE_VALUE;
  if (state.meshType === "FileMesh") {
    return state.meshId ? FILE_PREFIX + state.meshId : NONE_VALUE;
  }
  return TYPE_PREFIX + state.meshType;
}

function specForValue(value) {
  if (typeof value !== "string" || value === NONE_VALUE) return null;
  if (value.indexOf(TYPE_PREFIX) === 0) return { meshType: value.slice(TYPE_PREFIX.length) };
  if (value.indexOf(FILE_PREFIX) === 0) {
    return { meshType: "FileMesh", meshId: value.slice(FILE_PREFIX.length) };
  }
  return null;
}

let activeDialog = null;

export function isBodyMeshDialogOpen() {
  return !!activeDialog;
}

export function openBodyMeshDialog() {
  if (activeDialog) return;
  if (!hasCharacter()) {
    logger.warn("Body Mesh: selecione um personagem (Model com Humanoid).");
    return;
  }

  const meshes = assetStore.list("meshes");
  const state = getBodyMeshState();

  const body = el("div", "rsw-form");
  body.appendChild(
    el(
      "p",
      "rsw-modal__hint",
      "Escolha a malha de cada membro. A troca é aplicada na hora em todas as Parts do membro e pode ser desfeita com Undo.",
    ),
  );

  const status = el("span", "rsw-avatar-panel__status");

  for (const m of BODY_COLOR_MEMBERS) {
    const row = el("label", "rsw-avatar-field");
    row.appendChild(el("span", "rsw-avatar-field__label", m.label));
    const sel = el("select", "rsw-avatar-field__input");

    const optNone = el("option", null, "Sem malha (Part)");
    optNone.value = NONE_VALUE;
    sel.appendChild(optNone);

    const ogTypes = el("optgroup");
    ogTypes.label = "Formas nativas";
    for (const t of BODY_MESH_TYPES) {
      const o = el("option", null, t);
      o.value = TYPE_PREFIX + t;
      ogTypes.appendChild(o);
    }
    sel.appendChild(ogTypes);

    if (meshes.length) {
      const ogFiles = el("optgroup");
      ogFiles.label = "Malhas importadas (FileMesh)";
      for (const rec of meshes) {
        const o = el("option", null, rec.name);
        o.value = FILE_PREFIX + rec.id;
        ogFiles.appendChild(o);
      }
      sel.appendChild(ogFiles);
    }

    const cur = valueForState(state[m.key]);
    if (cur.indexOf(FILE_PREFIX) === 0 && !meshes.some((r) => FILE_PREFIX + r.id === cur)) {
      const o = el("option", null, `FileMesh atual (${cur.slice(FILE_PREFIX.length)})`);
      o.value = cur;
      sel.appendChild(o);
    }
    sel.value = cur;
    if (sel.value !== cur) sel.value = NONE_VALUE;

    sel.addEventListener("change", () => {
      const ok = applyBodyMesh(m.key, specForValue(sel.value));
      if (ok) {
        status.textContent = `Aplicado em ${m.label}.`;
      } else {
        status.textContent = "Não foi possível aplicar. Veja o Output.";
        const st = getBodyMeshState();
        sel.value = valueForState(st[m.key]);
      }
    });

    row.appendChild(sel);
    body.appendChild(row);
  }

  if (!meshes.length) {
    body.appendChild(
      el(
        "p",
        "rsw-modal__hint",
        "Dica: importe malhas (.obj) no Asset Manager para usá-las aqui como FileMesh.",
      ),
    );
  }

  const foot = el("div", "rsw-modal__btnrow");
  foot.appendChild(status);
  foot.appendChild(
    makeButton("Fechar", "primary", () => {
      if (activeDialog) activeDialog.close({ reason: "button" });
    }),
  );

  activeDialog = openModal({
    title: "Body Mesh",
    body,
    footer: foot,
    width: 460,
    className: "rsw-modal--bodymesh",
    onClose: () => {
      activeDialog = null;
    },
  });
}

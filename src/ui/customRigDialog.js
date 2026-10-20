import { openModal, makeButton } from "./modal.js";
import { logger } from "../core/logger.js";
import { buildCustomRig, canBuildRig, SCALE_FIELDS } from "../avatar/avatarOps.js";


const COLOR_FIELDS = Object.freeze([
  { key: "skin", label: "Pele (cabeça/braços)", hex: "#f3c690" },
  { key: "torso", label: "Torso", hex: "#0a69ac" },
  { key: "leg", label: "Pernas", hex: "#00a400" },
]);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function hexToRgb01(hex) {
  const s = String(hex || "").replace("#", "");
  if (s.length !== 6) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return { r: r / 255, g: g / 255, b: b / 255 };
}

function fieldRow(labelText, inputEl) {
  const row = el("label", "rsw-avatar-field");
  row.appendChild(el("span", "rsw-avatar-field__label", labelText));
  if (inputEl.classList) inputEl.classList.add("rsw-avatar-field__input");
  row.appendChild(inputEl);
  return row;
}

let activeDialog = null;

export function isCustomRigDialogOpen() {
  return !!activeDialog;
}

export function openCustomRigDialog() {
  if (activeDialog) return;
  if (!canBuildRig()) {
    logger.warn("Custom Rig: Workspace indisponível.");
    return;
  }

  const body = el("div", "rsw-form");

  const nameInput = el("input");
  nameInput.type = "text";
  nameInput.maxLength = 50;
  nameInput.value = "Custom Rig";
  nameInput.spellcheck = false;
  body.appendChild(fieldRow("Nome do modelo", nameInput));

  const baseSel = el("select");
  for (const opt of [
    { v: "R15", t: "R15 \u2014 moderno (15 partes)" },
    { v: "R6", t: "R6 \u2014 clássico (6 partes)" },
  ]) {
    const o = el("option", null, opt.t);
    o.value = opt.v;
    baseSel.appendChild(o);
  }
  body.appendChild(fieldRow("Base do rig", baseSel));

  body.appendChild(el("div", "rsw-avatar-panel__sectiontitle", "Proporções"));
  const sliders = new Map();
  for (const f of SCALE_FIELDS) {
    const wrap = el("span");
    wrap.style.display = "inline-flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "8px";
    const range = el("input");
    range.type = "range";
    range.min = String(f.min);
    range.max = String(f.max);
    range.step = "0.05";
    range.value = String(f.def);
    const val = el("span", null, Number(f.def).toFixed(2));
    range.addEventListener("input", () => {
      val.textContent = Number(range.value).toFixed(2);
    });
    wrap.appendChild(range);
    wrap.appendChild(val);
    sliders.set(f.key, range);
    body.appendChild(fieldRow(f.label, wrap));
  }

  body.appendChild(el("div", "rsw-avatar-panel__sectiontitle", "Membros"));
  const armsChk = el("input");
  armsChk.type = "checkbox";
  armsChk.checked = true;
  body.appendChild(fieldRow("Incluir braços", armsChk));
  const legsChk = el("input");
  legsChk.type = "checkbox";
  legsChk.checked = true;
  body.appendChild(fieldRow("Incluir pernas", legsChk));

  body.appendChild(el("div", "rsw-avatar-panel__sectiontitle", "Cores"));
  const colorInputs = new Map();
  for (const c of COLOR_FIELDS) {
    const input = el("input");
    input.type = "color";
    input.value = c.hex;
    colorInputs.set(c.key, input);
    body.appendChild(fieldRow(c.label, input));
  }

  const status = el("span", "rsw-avatar-panel__status");
  const foot = el("div", "rsw-modal__btnrow");
  const cancelBtn = makeButton("Cancelar", "ghost", () => {
    if (activeDialog) activeDialog.close({ reason: "button" });
  });
  const buildBtn = makeButton("Build", "primary", () => {
    const colors = {};
    for (const [key, input] of colorInputs) {
      const rgb = hexToRgb01(input.value);
      if (rgb) colors[key] = rgb;
    }
    const scales = {};
    for (const [key, range] of sliders) scales[key] = Number(range.value);
    const ok = buildCustomRig({
      name: nameInput.value,
      base: baseSel.value,
      scales,
      includeArms: armsChk.checked,
      includeLegs: legsChk.checked,
      colors,
    });
    if (ok) {
      if (activeDialog) activeDialog.close({ reason: "built" });
    } else {
      status.textContent = "Não foi possível construir o rig. Veja o Output.";
    }
  });
  foot.appendChild(status);
  foot.appendChild(cancelBtn);
  foot.appendChild(buildBtn);

  activeDialog = openModal({
    title: "Custom Rig",
    body,
    footer: foot,
    width: 480,
    className: "rsw-modal--customrig",
    onClose: () => {
      activeDialog = null;
    },
  });
  nameInput.focus();
  nameInput.select();
}

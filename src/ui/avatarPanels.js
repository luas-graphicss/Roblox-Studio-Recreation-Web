import { createIcon } from "./icons.js";
import {
  DESC_ASSET_FIELDS,
  BODY_COLOR_MEMBERS,
  applyHumanoidDescription,
  readHumanoidDescription,
  setBodyColor,
  getBodyColor,
  hasHumanoid,
} from "../avatar/avatarOps.js";


const BRICK_PALETTE = Object.freeze([
  ["Institutional white", "#f2f3f3"],
  ["White", "#f8f8f8"],
  ["Light stone grey", "#c7c7c8"],
  ["Medium stone grey", "#a3a2a5"],
  ["Dark stone grey", "#6d6e6c"],
  ["Black", "#1b2a35"],
  ["Really black", "#0e1111"],
  ["Brick yellow", "#d7c59a"],
  ["Nougat", "#cc8e69"],
  ["Light orange", "#f3c690"],
  ["Pastel brown", "#ffcb99"],
  ["Bright red", "#c4281c"],
  ["Really red", "#ff0000"],
  ["Crimson", "#a4001e"],
  ["Bright orange", "#d96b27"],
  ["Neon orange", "#ff5e00"],
  ["Bright yellow", "#f5cd30"],
  ["New Yeller", "#ffff00"],
  ["Bright green", "#4b974b"],
  ["Lime green", "#00ff00"],
  ["Dark green", "#287f47"],
  ["Earth green", "#27462d"],
  ["Teal", "#008f9c"],
  ["Bright bluish green", "#00a3a3"],
  ["Cyan", "#00ffff"],
  ["Pastel blue", "#b1cee2"],
  ["Bright blue", "#0a5cb0"],
  ["Navy blue", "#001f7a"],
  ["Royal blue", "#234e9e"],
  ["Bright violet", "#6b327c"],
  ["Lavender", "#a672cd"],
  ["Magenta", "#d52b81"],
  ["Pink", "#ff66b3"],
  ["Hot pink", "#ff009e"],
  ["Reddish brown", "#6b3f29"],
  ["Dark taupe", "#5a4c42"],
]);

function hexToRgb01(hex) {
  const s = String(hex).replace("#", "");
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  return { r, g, b };
}

function rgb01ToCss(rgb) {
  const o = rgb && typeof rgb === "object" ? rgb : {};
  const c = (n) => Math.max(0, Math.min(255, Math.round((Number(n) || 0) * 255)));
  return `rgb(${c(o.r)}, ${c(o.g)}, ${c(o.b)})`;
}

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}


function sanitizeDigits(value) {
  return String(value == null ? "" : value).replace(/[^0-9]/g, "");
}




let activePalette = null;

export function closeColorPalette() {
  if (activePalette) {
    activePalette.dispose();
    activePalette = null;
  }
}

function openColorPalette(anchorEl, onPick) {
  closeColorPalette();
  const pop = el("div", "rsw-brickpalette");
  for (const [name, hex] of BRICK_PALETTE) {
    const sw = el("button", "rsw-brickpalette__sw");
    sw.type = "button";
    sw.style.background = hex;
    sw.title = name;
    sw.setAttribute("aria-label", name);
    sw.addEventListener("click", () => {
      const rgb = hexToRgb01(hex);
      closeColorPalette();
      if (typeof onPick === "function") onPick(rgb, name);
    });
    pop.appendChild(sw);
  }
  document.body.appendChild(pop);


  const rect = anchorEl.getBoundingClientRect();
  const pw = pop.offsetWidth || 220;
  const ph = pop.offsetHeight || 180;
  let left = rect.left;
  let top = rect.bottom + 4;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, rect.top - ph - 4);
  pop.style.left = `${Math.max(8, Math.round(left))}px`;
  pop.style.top = `${Math.round(top)}px`;

  const onDown = (e) => {
    if (!pop.contains(e.target) && e.target !== anchorEl) closeColorPalette();
  };
  const onKey = (e) => {
    if (e.key === "Escape") closeColorPalette();
  };

  setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
  document.addEventListener("keydown", onKey, true);

  activePalette = {
    dispose() {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      if (pop.parentNode) pop.parentNode.removeChild(pop);
    },
  };
}


let activeBodyDialog = null;

export function closeBodyColorDialog() {
  closeColorPalette();
  if (activeBodyDialog) {
    activeBodyDialog.dispose();
    activeBodyDialog = null;
  }
}

export function openBodyColorDialog() {
  closeBodyColorDialog();

  const overlay = el("div", "rsw-modal-overlay");
  const modal = el("div", "rsw-modal rsw-modal--bodycolor");
  const header = el("div", "rsw-modal__header");
  const title = el("div", "rsw-modal__title");
  title.textContent = "Body Colors";
  const closeBtn = el("button", "rsw-modal__close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Fechar");
  closeBtn.appendChild(createIcon("close", 14));
  header.append(title, closeBtn);

  const grid = el("div", "rsw-bodycolor__grid");
  for (const m of BODY_COLOR_MEMBERS) {
    const cell = el("div", "rsw-bodycolor__cell");
    const sw = el("button", "rsw-bodycolor__sw");
    sw.type = "button";
    const cur = getBodyColor(m.key);
    sw.style.background = rgb01ToCss(cur);
    sw.setAttribute("aria-label", `Cor: ${m.label}`);
    sw.addEventListener("click", () => {
      openColorPalette(sw, (rgb) => {

        const ok = setBodyColor(m.key, rgb);
        if (ok) sw.style.background = rgb01ToCss(rgb);
      });
    });
    const lbl = el("div", "rsw-bodycolor__label");
    lbl.textContent = m.label;
    cell.append(sw, lbl);
    grid.appendChild(cell);
  }

  const hint = el("div", "rsw-modal__hint");
  hint.textContent = "Clique em um membro e escolha uma cor BrickColor.";

  modal.append(header, grid, hint);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const onOverlay = (e) => {
    if (e.target === overlay) closeBodyColorDialog();
  };
  const onKey = (e) => {
    if (e.key === "Escape" && !activePalette) closeBodyColorDialog();
  };
  overlay.addEventListener("mousedown", onOverlay);
  closeBtn.addEventListener("click", closeBodyColorDialog);
  document.addEventListener("keydown", onKey, true);

  activeBodyDialog = {
    dispose() {
      document.removeEventListener("keydown", onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    },
  };
}




let activeDescPanel = null;

export function isDescriptionPanelOpen() {
  return !!activeDescPanel;
}

export function closeHumanoidDescriptionPanel() {
  closeColorPalette();
  if (activeDescPanel) {
    activeDescPanel.dispose();
    activeDescPanel = null;
  }
}

export function openHumanoidDescriptionPanel() {

  if (activeDescPanel) {
    closeHumanoidDescriptionPanel();
    return;
  }

  const state = readHumanoidDescription();                      

  const panel = el("aside", "rsw-avatar-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "HumanoidDescription");

  const header = el("div", "rsw-avatar-panel__header");
  const title = el("div", "rsw-avatar-panel__title");
  title.appendChild(createIcon("shirt", 16));
  const titleText = el("span");
  titleText.textContent = "HumanoidDescription";
  title.appendChild(titleText);
  const closeBtn = el("button", "rsw-avatar-panel__close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Fechar");
  closeBtn.appendChild(createIcon("close", 14));
  header.append(title, closeBtn);

  const bodyEl = el("div", "rsw-avatar-panel__body");

  if (!hasHumanoid()) {
    const warn = el("div", "rsw-avatar-panel__warn");
    warn.textContent = "Selecione um personagem (Humanoid) para aplicar.";
    bodyEl.appendChild(warn);
  }


  const inputs = new Map();
  const fieldsSection = el("div", "rsw-avatar-panel__section");
  const fieldsTitle = el("div", "rsw-avatar-panel__sectiontitle");
  fieldsTitle.textContent = "Asset IDs";
  fieldsSection.appendChild(fieldsTitle);

  for (const field of DESC_ASSET_FIELDS) {
    const row = el("label", "rsw-avatar-field");
    const name = el("span", "rsw-avatar-field__label");
    name.textContent = field.label;
    const input = el("input", "rsw-avatar-field__input");
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.value = String(state.assets[field.prop] || 0);

    input.addEventListener("input", () => {
      const clean = sanitizeDigits(input.value);
      if (clean !== input.value) input.value = clean;
    });
    inputs.set(field.prop, input);
    row.append(name, input);
    fieldsSection.appendChild(row);
  }
  bodyEl.appendChild(fieldsSection);


  const colorsState = {};
  for (const m of BODY_COLOR_MEMBERS) {
    const c = state.colors[m.prop] || { r: 1, g: 1, b: 1 };
    colorsState[m.prop] = { r: c.r, g: c.g, b: c.b };
  }

  const colorSection = el("div", "rsw-avatar-panel__section");
  const colorTitle = el("div", "rsw-avatar-panel__sectiontitle");
  colorTitle.textContent = "BodyColors";
  colorSection.appendChild(colorTitle);
  const colorGrid = el("div", "rsw-avatar-panel__colors");
  for (const m of BODY_COLOR_MEMBERS) {
    const cell = el("div", "rsw-bodycolor__cell");
    const sw = el("button", "rsw-bodycolor__sw rsw-bodycolor__sw--sm");
    sw.type = "button";
    sw.style.background = rgb01ToCss(colorsState[m.prop]);
    sw.setAttribute("aria-label", `Cor: ${m.label}`);
    sw.addEventListener("click", () => {
      openColorPalette(sw, (rgb) => {
        colorsState[m.prop] = rgb;
        sw.style.background = rgb01ToCss(rgb);
      });
    });
    const lbl = el("div", "rsw-bodycolor__label");
    lbl.textContent = m.label;
    cell.append(sw, lbl);
    colorGrid.appendChild(cell);
  }
  colorSection.appendChild(colorGrid);
  bodyEl.appendChild(colorSection);


  const footer = el("div", "rsw-avatar-panel__footer");
  const applyBtn = el("button", "rsw-avatar-panel__apply");
  applyBtn.type = "button";
  applyBtn.textContent = "Apply";
  const status = el("span", "rsw-avatar-panel__status");
  applyBtn.addEventListener("click", () => {
    const assets = {};
    for (const [field, input] of inputs) assets[field] = sanitizeDigits(input.value);
    const ok = applyHumanoidDescription({ assets, colors: colorsState });
    status.textContent = ok ? "Aplicado." : "Selecione um Humanoid.";
    if (ok) setTimeout(() => { status.textContent = ""; }, 1500);
  });
  footer.append(applyBtn, status);
  bodyEl.appendChild(footer);

  panel.append(header, bodyEl);
  document.body.appendChild(panel);

  const onKey = (e) => {
    if (e.key === "Escape" && !activePalette) closeHumanoidDescriptionPanel();
  };
  closeBtn.addEventListener("click", closeHumanoidDescriptionPanel);
  document.addEventListener("keydown", onKey, true);

  activeDescPanel = {
    dispose() {
      document.removeEventListener("keydown", onKey, true);
      if (panel.parentNode) panel.parentNode.removeChild(panel);
    },
  };
}

export function closeAllAvatarPanels() {
  closeColorPalette();
  closeBodyColorDialog();
  closeHumanoidDescriptionPanel();
}

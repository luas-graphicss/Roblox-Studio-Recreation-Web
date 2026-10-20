import { createIcon } from "./icons.js";
import { attachTooltip } from "./tooltip.js";
import { openContextMenu, closeContextMenu } from "./contextMenu.js";
import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { openAnimationEditor } from "./animationEditor.js";
import { getSelectableRig } from "../animation/animationStore.js";
import { openCustomRigDialog } from "./customRigDialog.js";
import { openBodyMeshDialog } from "./bodyMeshDialog.js";
import { openAnimationImportDialog, canImportAnimation } from "./animationImport.js";
import {
  buildRig,
  canBuildRig,
  hasHumanoid,
  hasCharacter,
  hasAccessorySelected,
  getRigTypeLabel,
  addAccessory,
  fitToCharacter,
  removeAllAccessories,
  resetToDefault,
  applyHumanoidDescription,
  readHumanoidDescription,
  SCALE_FIELDS,
  getScale,
  setScale,
  getProportionsEnabled,
  setProportionsEnabled,
  HIP_HEIGHT,
  getHipHeight,
  setHipHeight,
  getExtentsMode,
  setExtentsMode,
  getCollisionType,
  setCollisionType,
  VISIBILITY_GROUPS,
  getVisibility,
  toggleVisibility,
} from "../avatar/avatarOps.js";
import {
  openAvatarImporter,
  isImporterOpen,
  openAvatarDebugPanel,
  isAvatarDebugOpen,
} from "./avatarImporterDialog.js";
import {
  openHumanoidDescriptionPanel,
  isDescriptionPanelOpen,
  openBodyColorDialog,
  closeAllAvatarPanels,
} from "./avatarPanels.js";

const CLICK_COOLDOWN = 120;                                       
const SLIDER_THROTTLE = 120;                                          

const ACCESSORY_TYPES = ["Hat", "Hair", "Face", "Neck", "Shoulder", "Front", "Back", "Waist"];
const EXTENTS_MODES = ["Full", "Disabled"];
const COLLISION_TYPES = ["OuterBox", "InnerBox"];




function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function safe(fn) {
  try {
    return fn();
  } catch (err) {
    console.error("[RSW] AvatarRibbon: erro ao avaliar estado:", err);
    return false;
  }
}


function throttle(fn, wait) {
  let last = 0;
  let timer = null;
  let lastArgs = null;
  return function (...args) {
    const now = Date.now();
    lastArgs = args;
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      last = now;
      fn(...lastArgs);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...lastArgs);
      }, remaining);
    }
  };
}

function placeholder(name) {
  if (logger && typeof logger.info === "function") {
    logger.info(`[Avatar] "${name}" será implementado em uma parte futura.`);
  }
}


function buildButton(entry, ctx) {
  const btn = el("button", `rsw-rtool rsw-rtool--${entry.size}`);
  btn.type = "button";
  btn.dataset.rb = entry.id;
  if (entry.options) btn.classList.add("rsw-rtool--hasdrop");

  const iconWrap = el("span", "rsw-rtool__icon");
  iconWrap.appendChild(createIcon(entry.icon, entry.size === "large" ? 26 : 16));
  btn.appendChild(iconWrap);

  const label = el("span", "rsw-rtool__label");
  label.textContent = entry.label;
  btn.appendChild(label);

  if (entry.options) {
    const arrow = el("span", "rsw-rtool__arrow");
    arrow.dataset.rbArrow = "1";
    arrow.textContent = "\u25BE";
    btn.appendChild(arrow);
  }

  let lastClick = 0;
  btn.addEventListener("click", (e) => {
    if (btn.getAttribute("aria-disabled") === "true") return;

    if (entry.options && e.target.closest && e.target.closest("[data-rb-arrow]")) {
      e.preventDefault();
      openDropdown(entry, btn);
      return;
    }

    const now = Date.now();
    if (now - lastClick < CLICK_COOLDOWN) return;
    lastClick = now;

    try {
      if (entry.options) openDropdown(entry, btn);
      else if (typeof entry.onRun === "function") entry.onRun();
      if (ctx && typeof ctx.afterRun === "function") ctx.afterRun();
    } catch (err) {


      console.error(
        `[RSW] AvatarRibbon: erro ao executar "${entry.id}": ` + ((err && err.message) || String(err)),
        (err && err.stack) || err,
      );
    }
  });

  if (entry.toggle && !entry.stateToggle) entry.getActive = () => !!entry.toggled;

  const dispose = attachTooltip(btn, { title: entry.label, desc: entry.desc, shortcut: entry.shortcut });
  ctx.disposers.push(dispose);
  entry.el = btn;
  ctx.entries.push(entry);
  return btn;
}

function openDropdown(entry, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const items = entry.options.map((opt) => ({
    label: opt.label,
    icon: opt.icon,
    onSelect: () => {
      if (typeof opt.run === "function") opt.run();
    },
  }));
  openContextMenu({ x: Math.round(rect.left), y: Math.round(rect.bottom + 2), items });
}






function buildInfoText(cfg, ctx) {
  const wrap = el("div", "rsw-ainfo");
  const lbl = el("span", "rsw-ainfo__label");
  lbl.textContent = cfg.label;
  const val = el("span", "rsw-ainfo__value");
  val.textContent = safe(cfg.get) || "\u2014";
  wrap.append(lbl, val);
  ctx.syncers.push(() => {
    val.textContent = safe(cfg.get) || "\u2014";
  });
  return wrap;
}


function buildScaleSlider(field, ctx) {
  const wrap = el("div", "rsw-aslider");
  wrap.dataset.rb = `scale-${field.key}`;

  const head = el("div", "rsw-aslider__head");
  const lbl = el("span", "rsw-aslider__label");
  lbl.textContent = field.label;
  const readout = el("span", "rsw-aslider__value");
  head.append(lbl, readout);

  const input = el("input", "rsw-aslider__range");
  input.type = "range";
  input.min = String(field.min);
  input.max = String(field.max);
  input.step = "0.05";

  function setReadout(v) {
    readout.textContent = Number(v).toFixed(2);
  }


  const commitThrottled = throttle((v) => {
    setScale(field.key, v);
  }, SLIDER_THROTTLE);

  input.addEventListener("input", () => {
    const v = Number(input.value);
    setReadout(v);
    if (!input.disabled) commitThrottled(v);
  });

  input.addEventListener("change", () => {
    if (!input.disabled) setScale(field.key, Number(input.value));
  });

  function sync() {
    const enabled = hasHumanoid();
    input.disabled = !enabled;
    wrap.classList.toggle("rsw-aslider--disabled", !enabled);
    const v = enabled ? Number(safe(() => getScale(field.key))) : field.def;
    const val = Number.isFinite(v) ? v : field.def;
    if (document.activeElement !== input) input.value = String(val);
    setReadout(val);
  }
  ctx.syncers.push(sync);
  sync();

  head.appendChild(input);
  wrap.append(head);
  return wrap;
}


function buildToggle(cfg, ctx) {
  const btn = el("button", "rsw-atoggle");
  btn.type = "button";
  btn.dataset.rb = cfg.id;
  if (cfg.icon) btn.appendChild(createIcon(cfg.icon, 14));
  const lbl = el("span", "rsw-atoggle__label");
  lbl.textContent = cfg.label;
  btn.appendChild(lbl);

  btn.addEventListener("click", () => {
    if (btn.getAttribute("aria-disabled") === "true") return;
    safe(() => cfg.onToggle());
    if (ctx && typeof ctx.afterRun === "function") ctx.afterRun();
  });

  const dispose = attachTooltip(btn, { title: cfg.label, desc: cfg.desc });
  ctx.disposers.push(dispose);

  function sync() {
    const enabled = cfg.getEnabled ? !!safe(cfg.getEnabled) : true;
    btn.classList.toggle("rsw-atoggle--disabled", !enabled);
    btn.setAttribute("aria-disabled", enabled ? "false" : "true");
    const active = !!safe(cfg.getActive);
    btn.classList.toggle("rsw-atoggle--active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
  ctx.syncers.push(sync);
  sync();
  return btn;
}


function buildNumberField(cfg, ctx) {
  const wrap = el("div", "rsw-afield");
  wrap.dataset.rb = cfg.id;
  const lbl = el("span", "rsw-afield__label");
  lbl.textContent = cfg.label;
  const input = el("input", "rsw-afield__input");
  input.type = "number";
  input.min = String(cfg.min);
  input.max = String(cfg.max);
  input.step = cfg.step || "0.05";

  function commit() {
    if (input.disabled) return;
    safe(() => cfg.set(Number(input.value)));
    sync();
  }
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      input.blur();
    }
  });

  function sync() {
    const enabled = hasHumanoid();
    input.disabled = !enabled;
    wrap.classList.toggle("rsw-afield--disabled", !enabled);
    if (document.activeElement !== input) {
      const v = enabled ? Number(safe(cfg.get)) : cfg.def;
      input.value = String(Number.isFinite(v) ? v : cfg.def);
    }
  }
  ctx.syncers.push(sync);
  sync();

  wrap.append(lbl, input);
  return wrap;
}


function buildSelect(cfg, ctx) {
  const wrap = el("div", "rsw-aselect");
  wrap.dataset.rb = cfg.id;
  const lbl = el("span", "rsw-aselect__label");
  lbl.textContent = cfg.label;
  const btn = el("button", "rsw-aselect__btn");
  btn.type = "button";
  const valText = el("span", "rsw-aselect__value");
  const arrow = el("span", "rsw-aselect__arrow");
  arrow.textContent = "\u25BE";
  btn.append(valText, arrow);

  btn.addEventListener("click", () => {
    if (btn.getAttribute("aria-disabled") === "true") return;
    const rect = btn.getBoundingClientRect();
    const items = cfg.options.map((opt) => ({
      label: opt,
      onSelect: () => {
        safe(() => cfg.set(opt));
        sync();
      },
    }));
    openContextMenu({ x: Math.round(rect.left), y: Math.round(rect.bottom + 2), items });
  });

  function sync() {
    const enabled = hasHumanoid();
    btn.classList.toggle("rsw-aselect__btn--disabled", !enabled);
    btn.setAttribute("aria-disabled", enabled ? "false" : "true");
    valText.textContent = enabled ? safe(cfg.get) || cfg.options[0] : "\u2014";
  }
  ctx.syncers.push(sync);
  sync();

  wrap.append(lbl, btn);
  return wrap;
}


function buildGroups(ctx) {
  const groups = [];


  groups.push({
    title: "Rig Builder",
    items: [
      buildButton(
        {
          id: "build-rig",
          label: "Build Rig",
          icon: "rig",
          size: "large",
          desc: "Insere um rig de personagem no Workspace.",
          getEnabled: () => safe(canBuildRig),
          options: [
            { label: "R6 \u2014 clássico (6 partes)", run: () => buildRig("R6") },
            { label: "R15 \u2014 moderno (15 partes)", run: () => buildRig("R15") },
            { label: "Custom\u2026 \u2014 nome, propor\u00e7\u00f5es e cores", run: () => openCustomRigDialog() },
          ],
        },
        ctx,
      ),
    ],
  });


  const animateCol = el("div", "rsw-rgroup__col");
  animateCol.appendChild(
    buildButton(
      {
        id: "import-animation",
        label: "Import Animation",
        icon: "effect",
        size: "small",
        desc: "Importa animação de arquivo .json ou de uma salva (AnimSaves) para o rig atual; também exporta a atual.",
        getEnabled: () => safe(canImportAnimation),
        onRun: () => openAnimationImportDialog(),
      },
      ctx,
    ),
  );
  animateCol.appendChild(buildInfoText({ label: "Rig Type", get: () => safe(getRigTypeLabel) }, ctx));
  groups.push({
    title: "Animate",
    items: [
      buildButton(
        {
          id: "animation-editor",
          label: "Animation Editor",
          icon: "run",
          size: "large",
          desc: "Abre o Animation Editor para o rig selecionado (R6/R15).",
          getEnabled: () => !!getSelectableRig(),
          onRun: () => openAnimationEditor(),
        },
        ctx,
      ),
      animateCol,
    ],
  });


  const setupCol = el("div", "rsw-rgroup__col");
  setupCol.appendChild(
    buildButton(
      {
        id: "apply-description",
        label: "Apply Description",
        icon: "shirt",
        size: "small",
        desc: "Aplica a HumanoidDescription ao Humanoid selecionado.",
        getEnabled: () => safe(hasHumanoid),
        onRun: () => {
          const ok = applyHumanoidDescription(readHumanoidDescription());
          if (!ok) placeholder("Apply Description (sem Humanoid)");
        },
      },
      ctx,
    ),
  );
  setupCol.appendChild(
    buildButton(
      {
        id: "reset-default",
        label: "Reset to Default",
        icon: "undo",
        size: "small",
        desc: "Reseta o personagem para a aparência padrão.",
        getEnabled: () => safe(hasHumanoid),
        onRun: () => resetToDefault(),
      },
      ctx,
    ),
  );
  groups.push({
    title: "Avatar Setup",
    items: [
      buildButton(
        {
          id: "humanoid-description",
          label: "HumanoidDescription",
          icon: "avatar",
          size: "large",
          stateToggle: true,
          desc: "Abre o painel de configuração do HumanoidDescription.",
          getEnabled: () => safe(hasHumanoid),
          getActive: () => safe(isDescriptionPanelOpen),
          onRun: () => openHumanoidDescriptionPanel(),
        },
        ctx,
      ),
      setupCol,
    ],
  });


  const accCol = el("div", "rsw-rgroup__col");
  accCol.appendChild(
    buildButton(
      {
        id: "fit-accessory",
        label: "Fit to Character",
        icon: "move",
        size: "small",
        desc: "Ajusta o acessório selecionado ao personagem.",
        getEnabled: () => safe(hasAccessorySelected),
        onRun: () => fitToCharacter(),
      },
      ctx,
    ),
  );
  accCol.appendChild(
    buildButton(
      {
        id: "remove-accessories",
        label: "Remove All Accessories",
        icon: "trash",
        size: "small",
        desc: "Remove todos os acessórios do personagem.",
        getEnabled: () => safe(hasCharacter),
        onRun: () => removeAllAccessories(),
      },
      ctx,
    ),
  );
  groups.push({
    title: "Accessories",
    items: [
      buildButton(
        {
          id: "add-accessory",
          label: "Add Accessory",
          icon: "accessory",
          size: "large",
          desc: "Adiciona um acessório com o Attachment correto.",
          getEnabled: () => safe(hasCharacter),
          options: ACCESSORY_TYPES.map((t) => ({ label: t, run: () => addAccessory(t) })),
        },
        ctx,
      ),
      accCol,
    ],
  });


  const importerCol = el("div", "rsw-rgroup__col");
  importerCol.appendChild(
    buildButton(
      {
        id: "avatar-debug",
        label: "Avatar Debug",
        icon: "wraptarget",
        size: "small",
        stateToggle: true,
        desc: "Painel de debug: acessórios, cages e attachments.",
        getEnabled: () => true,
        getActive: () => safe(isAvatarDebugOpen),
        onRun: () => openAvatarDebugPanel(),
      },
      ctx,
    ),
  );
  groups.push({
    title: "Importer",
    items: [
      buildButton(
        {
          id: "avatar-importer",
          label: "Avatar Importer",
          icon: "wraplayer",
          size: "large",
          stateToggle: true,
          desc: "Importa acessórios, layered clothing e body meshes.",
          getEnabled: () => true,
          getActive: () => safe(isImporterOpen),
          onRun: () => openAvatarImporter(),
        },
        ctx,
      ),
      importerCol,
    ],
  });


  const bodyCol = el("div", "rsw-rgroup__col");
  bodyCol.appendChild(
    buildButton(
      {
        id: "body-mesh",
        label: "Body Mesh",
        icon: "part",
        size: "small",
        desc: "Define a malha (SpecialMesh) de cada membro do personagem selecionado.",
        getEnabled: () => safe(hasCharacter),
        onRun: () => openBodyMeshDialog(),
      },
      ctx,
    ),
  );
  const visRow = el("div", "rsw-avis");
  for (const g of VISIBILITY_GROUPS) {
    visRow.appendChild(
      buildToggle(
        {
          id: `vis-${g.key}`,
          label: g.label,
          icon: "eye",
          desc: `Alterna a visibilidade: ${g.label}.`,
          getEnabled: () => safe(hasCharacter),
          getActive: () => safe(() => getVisibility(g.key)),
          onToggle: () => toggleVisibility(g.key),
        },
        ctx,
      ),
    );
  }
  bodyCol.appendChild(visRow);
  groups.push({
    title: "Body Parts",
    items: [
      buildButton(
        {
          id: "body-color",
          label: "Body Color",
          icon: "body",
          size: "large",
          desc: "Abre o dialog de cores do corpo (BodyColors).",
          getEnabled: () => safe(hasCharacter),
          onRun: () => openBodyColorDialog(),
        },
        ctx,
      ),
      bodyCol,
    ],
  });


  const scaleItems = [];
  const scaleColA = el("div", "rsw-rgroup__col rsw-rgroup__col--wide");
  const scaleColB = el("div", "rsw-rgroup__col rsw-rgroup__col--wide");
  SCALE_FIELDS.forEach((f, i) => {
    const slider = buildScaleSlider(f, ctx);
    (i < 2 ? scaleColA : scaleColB).appendChild(slider);
  });
  const scaleColC = el("div", "rsw-rgroup__col rsw-rgroup__col--wide");
  scaleColC.appendChild(
    buildToggle(
      {
        id: "proportions-enabled",
        label: "ProportionsEnabled",
        icon: "ruler",
        desc: "Mantém as proporções durante a escala (AutomaticScalingEnabled).",
        getEnabled: () => safe(hasHumanoid),
        getActive: () => safe(getProportionsEnabled),
        onToggle: () => setProportionsEnabled(!getProportionsEnabled()),
      },
      ctx,
    ),
  );
  scaleItems.push(scaleColA, scaleColB, scaleColC);
  groups.push({ title: "Scale", items: scaleItems });


  const collColA = el("div", "rsw-rgroup__col rsw-rgroup__col--wide");
  const collColB = el("div", "rsw-rgroup__col rsw-rgroup__col--wide");
  collColA.appendChild(
    buildNumberField(
      {
        id: "hip-height",
        label: "HipHeight",
        min: HIP_HEIGHT.min,
        max: HIP_HEIGHT.max,
        def: HIP_HEIGHT.def,
        step: "0.05",
        get: () => getHipHeight(),
        set: (v) => setHipHeight(v),
      },
      ctx,
    ),
  );
  collColA.appendChild(
    buildSelect(
      {
        id: "extents-mode",
        label: "AutomaticExtentsMode",
        options: EXTENTS_MODES,
        get: () => getExtentsMode(),
        set: (v) => setExtentsMode(v),
      },
      ctx,
    ),
  );
  collColB.appendChild(
    buildSelect(
      {
        id: "collision-type",
        label: "CollisionType",
        options: COLLISION_TYPES,
        get: () => getCollisionType(),
        set: (v) => setCollisionType(v),
      },
      ctx,
    ),
  );
  groups.push({ title: "Collision", items: [collColA, collColB] });

  return groups;
}

function buildGroupEl(group) {
  const groupEl = el("div", "rsw-rgroup");
  const toolsRow = el("div", "rsw-rgroup__tools");
  for (const item of group.items) toolsRow.appendChild(item);
  const titleEl = el("div", "rsw-rgroup__title");
  titleEl.textContent = group.title;
  groupEl.append(toolsRow, titleEl);
  return groupEl;
}


export function buildRibbonAvatar() {
  const ctx = { entries: [], disposers: [], syncers: [] };
  const root = el("div", "rsw-ribbon rsw-ribbon--avatar");
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "Avatar");

  const groups = buildGroups(ctx);
  groups.forEach((group, i) => {
    if (i > 0) root.appendChild(el("div", "rsw-rsep"));
    root.appendChild(buildGroupEl(group));
  });

  function refresh() {
    for (const entry of ctx.entries) {
      if (!entry.el) continue;
      if (entry.getActive) {
        entry.el.classList.toggle("rsw-rtool--active", !!safe(entry.getActive));
      }
      if (entry.getEnabled) {
        const enabled = !!safe(entry.getEnabled);
        entry.el.classList.toggle("rsw-rtool--disabled", !enabled);
        entry.el.setAttribute("aria-disabled", enabled ? "false" : "true");
      }
    }
    for (const sync of ctx.syncers) {
      try {
        sync();
      } catch (_) {

      }
    }
  }
  ctx.afterRun = refresh;

  const offSel = bus.on("selection:changed", refresh);
  const offHist = bus.on("history:changed", refresh);

  refresh();

  function destroy() {
    if (typeof offSel === "function") offSel();
    if (typeof offHist === "function") offHist();
    for (const d of ctx.disposers) {
      try {
        d();
      } catch (_) {

      }
    }
    closeContextMenu();
    closeAllAvatarPanels();
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return { el: root, refresh, destroy };
}

import { openModal, makeButton, openConfirm, openPrompt, openInfo } from "../modal.js";
import {
  project,
  GENRES,
  WHO_CAN_PLAY,
  WHO_CAN_EDIT,
  PRIVACY,
  AVATAR_TYPES,
  SCALING,
  COLLISION,
  ANIMATION,
  LIGHTING_TECH,
  RANGES,
  TEXT_LIMITS,
  defaultGameSettings,
  generateMonetizationId,
  MONETIZATION_LIMITS,
  setStatus,
} from "../../core/project.js";
import { logger } from "../../core/logger.js";
import { store } from "../../core/state.js";            
import { commands } from "../../core/commands.js";            
import { COMMON_LOCALES, primaryLocalizationTable, sanitizeLocaleId } from "../../datamodel/localization.js";            
import {
  field,
  textInput,
  textArea,
  numberInput,
  selectInput,
  checkboxField,
  colorInput,
  slider,
  charCounter,
  sectionTitle,
  _el as el,
} from "./fields.js";
import { createIcon } from "../icons.js";

const TABS = [
  { id: "general", label: "General", icon: "settings" },
  { id: "permissions", label: "Permissions", icon: "lock" },
  { id: "avatar", label: "Avatar", icon: "avatar" },
  { id: "world", label: "World", icon: "globe" },
  { id: "security", label: "Security", icon: "shield" },
  { id: "monetization", label: "Monetization", icon: "coin" },
  { id: "places", label: "Places", icon: "pin" },
  { id: "advanced", label: "Advanced", icon: "warning" },
];

const AVATAR_OPTS = AVATAR_TYPES.map((v) => ({ value: v, label: v === "PlayerChoice" ? "Player Choice" : v }));
const ANIM_OPTS = ANIMATION.map((v) => ({ value: v, label: v === "PlayerChoice" ? "Player Choice" : v }));

let _open = false;


function makePreviewImg(url) {
  const img = document.createElement("img");
  img.className = "rsw-gs__preview-img";
  img.alt = "";
  img.addEventListener("error", () => {
    const empty = el("span", "rsw-gs__preview-empty", "Falha ao carregar");
    if (img.parentNode) img.parentNode.replaceChild(empty, img);
  });
  img.src = url;
  return img;
}

export function openGameSettings(initialTab) {
  if (_open) return null;
  _open = true;

  let draft = project.getWorkingCopy();
  const session = project.beginEditSession();
  let saved = false;
  let liveTimer = null;
  let nameInput = null;

  const applyLive = (immediate) => {
    if (immediate) {
      if (liveTimer) {
        clearTimeout(liveTimer);
        liveTimer = null;
      }
      try {
        project.previewLive(draft);
      } catch (e) {
        logger.warn("GameSettings: previewLive: " + (e && e.message));
      }
      return;
    }
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      liveTimer = null;
      try {
        project.previewLive(draft);
      } catch (e) {
        logger.warn("GameSettings: previewLive: " + (e && e.message));
      }
    }, 150);
  };

  const multiConfirm = async (n, title, message) => {
    for (let i = 0; i < n; i++) {
      const suffix = n > 1 ? " (confirmacao " + (i + 1) + "/" + n + ")" : "";
      const ok = await openConfirm({
        title,
        message: message + suffix,
        buttons: [
          { label: "Cancel", value: false, kind: "ghost" },
          { label: "Confirm", value: true, kind: "danger" },
        ],
      });
      if (!ok) return false;
    }
    return true;
  };

  const iconRow = (kind, label) => {
    const row = el("div", "rsw-gs__assetrow");
    const prev = el("div", "rsw-gs__preview");
    const url = draft.general[kind];
    if (url) prev.appendChild(makePreviewImg(url));
    else prev.appendChild(el("span", "rsw-gs__preview-empty", "Sem imagem"));
    const btn = makeButton(label, "default", async () => {
      const id = await openPrompt({
        title: label,
        label: "Asset ID ou URL da imagem",
        value: draft.general[kind],
        placeholder: "rbxassetid://... ou https://...",
        maxLength: 300,
      });
      if (id == null) return;
      draft.general[kind] = id.trim();
      applyLive(true);
      showTab("general");
    });
    row.append(prev, btn);
    return row;
  };

  const configurePlace = (idx) => {
    const p = draft.places[idx];
    if (!p) return;
    const body = el("div", "rsw-form");
    const ni = textInput(p.name, null, { maxLength: 50 });
    body.appendChild(field("Place name", ni));
    const foot = el("div", "rsw-modal__btnrow");
    let h = null;
    foot.appendChild(makeButton("Cancel", "ghost", () => h && h.close({ reason: "cancel" })));
    foot.appendChild(makeButton("Done", "primary", () => {

      const nm = ni.value.trim();
      if (nm) p.name = nm;
      applyLive(true);
      if (h) h.close({ reason: "done" });
      showTab("places");
    }));
    h = openModal({ title: "Configure Place", body, footer: foot, width: 420 });
  };

  const MON_KIND_LABEL = { passes: "Game Pass", products: "Developer Product", badges: "Badge" };
  const MON_ID_LABEL = { passes: "Pass ID", products: "Product ID", badges: "Badge ID" };

  const monInitials = (name) => {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    const a = parts[0].charAt(0);
    const b = parts.length > 1 ? parts[parts.length - 1].charAt(0) : (parts[0].charAt(1) || "");
    return (a + b).toUpperCase();
  };

  const monIconPreview = (item) => {
    const prev = el("div", "rsw-mon__icon");
    if (item.icon) {
      const img = document.createElement("img");
      img.className = "rsw-mon__icon-img";
      img.alt = "";
      img.addEventListener("error", () => {
        img.remove();
        prev.appendChild(el("span", "rsw-mon__icon-initials", monInitials(item.name)));
      });
      img.src = item.icon;
      prev.appendChild(img);
    } else {
      prev.appendChild(el("span", "rsw-mon__icon-initials", monInitials(item.name)));
    }
    return prev;
  };

  const clampMonPrice = (v) =>
    Math.max(MONETIZATION_LIMITS.priceMin, Math.min(MONETIZATION_LIMITS.priceMax, Math.round(Number(v) || 0)));

  const openMonItemEditor = (kind, item, onDone) => {
    const isBadge = kind === "badges";
    const draftItem = {
      name: item ? item.name : "",
      description: item ? item.description || "" : "",
      price: item ? item.price || 0 : 0,
      icon: item ? item.icon || "" : "",
      enabled: item ? item.enabled !== false : true,
    };
    const body = el("div", "rsw-form");
    const ni = textInput(draftItem.name, (v) => {
      draftItem.name = v;
      ni.classList.remove("rsw-input--error");
    }, { maxLength: MONETIZATION_LIMITS.nameMax, placeholder: "Name" });
    body.appendChild(field("Name", ni, { hint: "Obrigatorio, ate " + MONETIZATION_LIMITS.nameMax + " caracteres" }));
    const di = textArea(draftItem.description, (v) => {
      draftItem.description = v;
    }, { rows: 3, maxLength: MONETIZATION_LIMITS.descriptionMax, placeholder: "Description" });
    body.appendChild(field("Description", di));
    if (!isBadge) {
      body.appendChild(field("Price (Robux)", numberInput(draftItem.price, (v) => {
        draftItem.price = v;
      }, { min: MONETIZATION_LIMITS.priceMin, max: MONETIZATION_LIMITS.priceMax, step: 1 }), { hint: "0 (gratis) a 999999" }));
    }
    const ii = textInput(draftItem.icon, (v) => {
      draftItem.icon = v;
    }, { maxLength: 300, placeholder: "rbxassetid://... ou https://..." });
    body.appendChild(field("Icon", ii, { hint: "Asset do Asset Manager ou URL; vazio usa placeholder com as iniciais do nome" }));
    if (isBadge) {
      body.appendChild(checkboxField("Enabled", draftItem.enabled, (v) => {
        draftItem.enabled = v;
      }));
    }
    if (item && item.id) {
      const idInput = textInput(String(item.id), null, {});
      idInput.disabled = true;
      body.appendChild(field(MON_ID_LABEL[kind], idInput, { hint: "Gerado automaticamente (nao editavel)" }));
    }
    const foot = el("div", "rsw-modal__btnrow");
    let h = null;
    foot.appendChild(makeButton("Cancel", "ghost", () => h && h.close({ reason: "cancel" })));
    foot.appendChild(makeButton(item ? "Save" : "Create", "primary", () => {
      const nm = (draftItem.name || "").trim();
      if (!nm) {
        ni.classList.add("rsw-input--error");
        try { ni.focus(); } catch (_) {            }
        return;
      }
      onDone(draftItem);
      if (h) h.close({ reason: "done" });
    }));
    h = openModal({
      title: (item ? "Edit " : "Add ") + MON_KIND_LABEL[kind],
      body,
      footer: foot,
      width: 460,
    });
  };

  const monItemList = (kind, addLabel) => {
    const arr = draft.monetization[kind] || (draft.monetization[kind] = []);
    const wrap = el("div", "rsw-gs__moneyblock");
    const list = el("div", "rsw-gs__list");
    arr.forEach((it) => {
      const row = el("div", "rsw-gs__listitem rsw-mon__row");
      row.appendChild(monIconPreview(it));
      const info = el("div", "rsw-mon__info");
      const nameEl = el("div", "rsw-mon__name", it.name);
      if (kind === "badges" && it.enabled === false) nameEl.appendChild(el("span", "rsw-mon__off", " (disabled)"));
      info.appendChild(nameEl);
      const meta = kind === "badges" ? "ID " + it.id : "R$ " + it.price + " \u2022 ID " + it.id;
      info.appendChild(el("div", "rsw-mon__meta", meta));
      row.appendChild(info);
      row.appendChild(makeButton("Edit", "default", () => {
        openMonItemEditor(kind, it, (d) => {
          it.name = d.name.trim();
          it.description = d.description;
          it.icon = d.icon.trim();
          if (kind === "badges") it.enabled = d.enabled !== false;
          else it.price = clampMonPrice(d.price);
          applyLive(true);
          showTab("monetization");
        });
      }));
      row.appendChild(makeButton("Remove", "ghost", async () => {
        const ok = await openConfirm({
          title: "Remove " + MON_KIND_LABEL[kind],
          message: `Remover "${it.name}" (ID ${it.id})?`,
          buttons: [
            { label: "Cancel", value: false, kind: "ghost" },
            { label: "Remove", value: true, kind: "danger" },
          ],
        });
        if (!ok) return;
        const idx = arr.indexOf(it);
        if (idx >= 0) arr.splice(idx, 1);
        applyLive(true);
        showTab("monetization");
      }));
      list.appendChild(row);
    });
    if (!arr.length) list.appendChild(el("div", "rsw-gs__listitem rsw-mon__empty", "Nenhum item ainda."));
    const add = makeButton(addLabel, "default", () => {
      if (arr.length >= MONETIZATION_LIMITS.maxItems) {
        setStatus("Limite de " + MONETIZATION_LIMITS.maxItems + " itens atingido");
        return;
      }
      openMonItemEditor(kind, null, (d) => {
        const used = new Set(arr.map((x) => x.id));
        const item = {
          id: generateMonetizationId(used),
          name: d.name.trim(),
          description: d.description,
          icon: d.icon.trim(),
        };
        if (kind === "badges") item.enabled = d.enabled !== false;
        else item.price = clampMonPrice(d.price);
        arr.push(item);
        applyLive(true);
        showTab("monetization");
      });
    });
    wrap.append(list, add);
    return wrap;
  };

  const builders = {
    general() {
      const out = [sectionTitle("General")];
      nameInput = textInput(draft.general.name, (v) => {
        draft.general.name = v;
        nameInput.classList.remove("rsw-input--error");
        applyLive(true);
      }, { maxLength: TEXT_LIMITS.name, placeholder: "Game name" });
      out.push(field("Name", nameInput, { hint: "Maximo " + TEXT_LIMITS.name + " caracteres" }));

      const counter = charCounter((draft.general.description || "").length, TEXT_LIMITS.description);
      const desc = textArea(draft.general.description, (v) => {
        draft.general.description = v;
        counter.update(v.length);
        applyLive(true);
      }, { rows: 4, maxLength: TEXT_LIMITS.description, placeholder: "Description" });
      const descField = field("Description", desc);
      descField.appendChild(counter);
      out.push(descField);

      out.push(field("Genre", selectInput(draft.general.genre, GENRES, (v) => {
        draft.general.genre = v;
        applyLive(true);
      })));

      const locTable = primaryLocalizationTable(store.getDataModel());
      if (locTable) {
        const currentSource = sanitizeLocaleId(locTable.getProperty("SourceLocaleId")) || "en-us";
        const sourceOptions = COMMON_LOCALES.map((l) => l.id);
        if (!sourceOptions.includes(currentSource)) sourceOptions.unshift(currentSource);
        out.push(field("Source Language (Localization)", selectInput(currentSource, sourceOptions, (v) => {
          const beforeValue = String(locTable.getProperty("SourceLocaleId") || "en-us");
          if (v === beforeValue) return;
          commands.execute({
            name: "Set SourceLocaleId",
            do() { locTable.setProperty("SourceLocaleId", v); },
            undo() { locTable.setProperty("SourceLocaleId", beforeValue); },
          });
        })));
      } else {
        const noTableHint = document.createElement("span");
        noTableHint.textContent = "Nenhuma LocalizationTable no projeto (crie uma no Localization Editor)";
        noTableHint.style.opacity = "0.7";
        out.push(field("Source Language (Localization)", noTableHint));
      }

      const mp = slider(draft.general.maxPlayers, (v, imm) => {
        if (project.isRunning()) {
          setStatus("MaxPlayers nao pode ser alterado durante o Playtest");
          mp.setValue(draft.general.maxPlayers);
          return;
        }
        draft.general.maxPlayers = v;
        applyLive(imm);
      }, { min: 1, max: 100, step: 1 });
      out.push(field("Max Players", mp, { hint: "1 a 100" }));

      out.push(field("Game Icon", iconRow("icon", "Change Icon")));
      out.push(field("Thumbnail", iconRow("thumbnail", "Change Thumbnail")));

      out.push(checkboxField("Allow Copying", draft.general.allowCopying, (v) => {
        draft.general.allowCopying = v;
        applyLive(true);
      }));
      out.push(checkboxField("Enable Studio Access (DataStore / HTTP)", draft.general.studioAccessToApis, (v) => {
        draft.general.studioAccessToApis = v;
        applyLive(true);
      }));
      return out;
    },
    permissions() {
      const out = [sectionTitle("Permissions")];
      out.push(field("Who can play", selectInput(draft.permissions.whoCanPlay, WHO_CAN_PLAY, (v) => {
        draft.permissions.whoCanPlay = v;
        applyLive(true);
      })));
      out.push(field("Who can edit", selectInput(draft.permissions.whoCanEdit, WHO_CAN_EDIT, (v) => {
        draft.permissions.whoCanEdit = v;
        applyLive(true);
      }), { hint: "Team Create (placeholder)" }));
      out.push(checkboxField("Allow Third Party Sales", draft.permissions.allowThirdPartySales, (v) => {
        draft.permissions.allowThirdPartySales = v;
        applyLive(true);
      }));
      out.push(checkboxField("Allow Third Party Teleports", draft.permissions.allowThirdPartyTeleports, (v) => {
        draft.permissions.allowThirdPartyTeleports = v;
        applyLive(true);
      }));
      out.push(field("Privacy", selectInput(draft.permissions.privacy, PRIVACY, (v) => {
        draft.permissions.privacy = v;
        applyLive(true);
      })));
      return out;
    },
    avatar() {
      const out = [sectionTitle("Avatar")];
      out.push(field("Avatar Type", selectInput(draft.avatar.avatarType, AVATAR_OPTS, (v) => {
        draft.avatar.avatarType = v;
        applyLive(true);
      })));
      out.push(field("Scaling", selectInput(draft.avatar.scaling, SCALING, (v) => {
        draft.avatar.scaling = v;
        applyLive(true);
      })));
      out.push(field("Collision", selectInput(draft.avatar.collision, COLLISION, (v) => {
        draft.avatar.collision = v;
        applyLive(true);
      })));
      out.push(field("Animation", selectInput(draft.avatar.animation, ANIM_OPTS, (v) => {
        draft.avatar.animation = v;
        applyLive(true);
      })));
      out.push(checkboxField("Allow Custom Animations", draft.avatar.allowCustomAnimations, (v) => {
        draft.avatar.allowCustomAnimations = v;
        applyLive(true);
      }));
      out.push(checkboxField("Allow Custom Faces", draft.avatar.allowCustomFaces, (v) => {
        draft.avatar.allowCustomFaces = v;
        applyLive(true);
      }));
      out.push(checkboxField("Allow Custom Accessories", draft.avatar.allowCustomAccessories, (v) => {
        draft.avatar.allowCustomAccessories = v;
        applyLive(true);
      }));
      return out;
    },
    world() {
      const out = [sectionTitle("World")];
      const grav = slider(draft.world.gravity, (v, imm) => {
        draft.world.gravity = v;
        applyLive(imm);
      }, { min: RANGES.gravity.min, max: RANGES.gravity.max, step: 0.1 });
      out.push(field("Gravity", grav, { hint: "0 a 500" }));
      out.push(field("Jump Power", numberInput(draft.world.jumpPower, (v) => {
        draft.world.jumpPower = v;
        applyLive(true);
      }, { min: RANGES.jumpPower.min, max: RANGES.jumpPower.max, step: 1 })));
      out.push(field("Walk Speed", numberInput(draft.world.walkSpeed, (v) => {
        draft.world.walkSpeed = v;
        applyLive(true);
      }, { min: RANGES.walkSpeed.min, max: RANGES.walkSpeed.max, step: 1 })));
      out.push(field("Respawn Time", numberInput(draft.world.respawnTime, (v) => {
        draft.world.respawnTime = v;
        applyLive(true);
      }, { min: RANGES.respawnTime.min, max: RANGES.respawnTime.max, step: 0.5 }), { hint: "segundos" }));
      out.push(field("Lighting Technology", selectInput(draft.world.lightingTechnology, LIGHTING_TECH, (v) => {
        draft.world.lightingTechnology = v;
        applyLive(true);
      })));
      out.push(field("Ambient", colorInput(draft.world.ambient, (v) => {
        draft.world.ambient = v;
        applyLive(true);
      })));
      out.push(field("Outdoor Ambient", colorInput(draft.world.outdoorAmbient, (v) => {
        draft.world.outdoorAmbient = v;
        applyLive(true);
      })));
      const bright = slider(draft.world.brightness, (v, imm) => {
        draft.world.brightness = v;
        applyLive(imm);
      }, { min: RANGES.brightness.min, max: RANGES.brightness.max, step: 0.1 });
      out.push(field("Brightness", bright, { hint: "0 a 10" }));
      out.push(checkboxField("Global Shadows", draft.world.globalShadows, (v) => {
        draft.world.globalShadows = v;
        applyLive(true);
      }));
      out.push(checkboxField("Fog Enabled", draft.world.fogEnabled, (v) => {
        draft.world.fogEnabled = v;
        applyLive(true);
      }));
      out.push(field("Fog Color", colorInput(draft.world.fogColor, (v) => {
        draft.world.fogColor = v;
        applyLive(true);
      })));
      out.push(field("Fog Start", numberInput(draft.world.fogStart, (v) => {
        draft.world.fogStart = v;
        applyLive(true);
      }, { min: RANGES.fogStart.min, max: RANGES.fogStart.max, step: 1 })));
      out.push(field("Fog End", numberInput(draft.world.fogEnd, (v) => {
        draft.world.fogEnd = v;
        applyLive(true);
      }, { min: RANGES.fogEnd.min, max: RANGES.fogEnd.max, step: 1 })));
      return out;
    },
    security() {
      const out = [sectionTitle("Security")];
      out.push(checkboxField("Enable HTTP Requests", draft.security.allowHttp, (v) => {
        draft.security.allowHttp = v;
        applyLive(true);
      }));
      out.push(checkboxField("Filter Enabled", draft.security.filterEnabled, (v) => {
        draft.security.filterEnabled = v;
        applyLive(true);
      }));
      out.push(checkboxField("Allow In-Experience Purchases", draft.security.purchasesEnabled, (v) => {
        draft.security.purchasesEnabled = v;
        applyLive(true);
      }));
      out.push(checkboxField("Enable Analytics", draft.security.enableAnalytics, (v) => {
        draft.security.enableAnalytics = v;
        applyLive(true);
      }));
      out.push(checkboxField("Enable Studio Access to API Services", draft.general.studioAccessToApis, (v) => {
        draft.general.studioAccessToApis = v;
        applyLive(true);
      }));
      return out;
    },
    monetization() {
      const out = [sectionTitle("Monetization")];
      out.push(checkboxField("Enable In-Experience Purchases", draft.monetization.purchasesEnabled, (v) => {
        draft.monetization.purchasesEnabled = v;
        applyLive(true);
      }));
      out.push(sectionTitle("Game Passes"));
      out.push(monItemList("passes", "+ Add Game Pass"));
      out.push(sectionTitle("Developer Products"));
      out.push(monItemList("products", "+ Add Developer Product"));
      out.push(sectionTitle("Badges"));
      out.push(monItemList("badges", "+ Add Badge"));
      out.push(checkboxField("Enable Premium Benefits", draft.monetization.premiumBenefits, (v) => {
        draft.monetization.premiumBenefits = v;
        applyLive(true);
      }));
      out.push(el("p", "rsw-field__hint", "Subscriptions nao sao suportadas nesta parte."));
      return out;
    },
    places() {
      const out = [sectionTitle("Places")];
      const list = el("div", "rsw-gs__list");
      draft.places.forEach((p, i) => {
        const row = el("div", "rsw-gs__listitem");
        row.appendChild(el("span", "rsw-gs__listname", p.name + (p.isStart ? "  (Start Place)" : "")));
        row.appendChild(makeButton("Configure Place", "default", () => configurePlace(i)));
        if (!p.isStart) {
          row.appendChild(makeButton("Remove", "ghost", () => {
            draft.places.splice(i, 1);
            applyLive(true);
            showTab("places");
          }));
        }
        list.appendChild(row);
      });
      out.push(list);
      out.push(makeButton("Add New Place", "primary", async () => {
        const name = await openPrompt({ title: "Add New Place", label: "Place name", value: "New Place", maxLength: 50 });
        if (name == null) return;
        draft.places.push({ name: name.trim() || "New Place", isStart: false });
        applyLive(true);
        showTab("places");
      }));
      return out;
    },
    advanced() {
      const out = [sectionTitle("Advanced")];
      out.push(el("p", "rsw-gs__warn", "Acoes perigosas. Use com cuidado."));
      const b1 = makeButton("Reset Player Data", "danger", async () => {
        const ok = await multiConfirm(2, "Reset Player Data", "Deseja resetar TODOS os dados de jogador?");
        if (ok) project.resetPlayerData();
      });
      const b2 = makeButton("Clear All DataStores", "danger", async () => {
        if (project.isRunning()) {
          setStatus("Indisponivel durante o Playtest");
          openInfo({ title: "Indisponivel", content: "Clear All DataStores nao pode ser usado durante o Playtest." });
          return;
        }
        const ok = await multiConfirm(3, "Clear All DataStores", "Acao IRREVERSIVEL. Confirmar limpeza de TODOS os DataStores?");
        if (ok) project.clearAllDataStores();
      });
      const b3 = makeButton("Force Reset All Players", "default", async () => {
        const ok = await multiConfirm(1, "Force Reset All Players", "Forcar reset de todos os jogadores conectados?");
        if (ok) project.forceResetAllPlayers();
      });
      [b1, b2, b3].forEach((b) => {
        const r = el("div", "rsw-gs__advrow");
        r.appendChild(b);
        out.push(r);
      });
      return out;
    },
  };

  const onResetTab = async (id) => {
    const ok = await openConfirm({
      title: "Reset to Defaults",
      message: "Restaurar os valores padrao desta aba?",
      buttons: [
        { label: "Cancel", value: false, kind: "ghost" },
        { label: "Reset", value: true, kind: "primary" },
      ],
    });
    if (!ok) return;
    const d = defaultGameSettings();
    if (id === "general") draft.general = d.general;
    else if (id === "permissions") draft.permissions = d.permissions;
    else if (id === "avatar") draft.avatar = d.avatar;
    else if (id === "world") draft.world = d.world;
    else if (id === "security") {
      draft.security = d.security;
      draft.general.studioAccessToApis = d.general.studioAccessToApis;
    } else if (id === "monetization") draft.monetization = d.monetization;
    else if (id === "places") draft.places = d.places;
    applyLive(true);
    showTab(id);
  };

  const onResetAll = async () => {
    const ok = await openConfirm({
      title: "Reset to Defaults",
      message: "Restaurar TODAS as configuracoes para os valores padrao do Roblox?",
      buttons: [
        { label: "Cancel", value: false, kind: "ghost" },
        { label: "Reset All", value: true, kind: "danger" },
      ],
    });
    if (!ok) return;
    draft = defaultGameSettings();
    applyLive(true);
    showTab(activeTab);
  };

  const onSave = () => {
    const nm = (draft.general.name || "").trim();
    if (!nm) {
      showTab("general");
      if (nameInput) {
        nameInput.classList.add("rsw-input--error");
        try {
          nameInput.focus();
        } catch (_) {

        }
      }
      setStatus("O nome do jogo e obrigatorio");
      return;
    }


    try {
      project.applySettings(draft);
    } catch (e) {
      logger.warn("GameSettings: applySettings: " + (e && e.message));
      setStatus("Falha ao salvar as configuracoes");
      return;
    }
    saved = true;
    if (handle) handle.close({ reason: "save" });
  };

  const layout = el("div", "rsw-gs");
  const side = el("div", "rsw-gs__side");
  side.setAttribute("role", "tablist");
  const content = el("div", "rsw-gs__content");
  layout.append(side, content);

  let activeTab = initialTab && TABS.some((t) => t.id === initialTab) ? initialTab : "general";
  const tabBtns = {};

  function buildPane(id) {
    const pane = el("div", "rsw-gs__pane");
    const nodes = builders[id] ? builders[id]() : [];
    for (const n of nodes) if (n) pane.appendChild(n);
    if (id !== "advanced") {
      const wrap = el("div", "rsw-gs__tabreset");
      wrap.appendChild(makeButton("Reset to Defaults (esta aba)", "ghost", () => onResetTab(id)));
      pane.appendChild(wrap);
    }
    return pane;
  }

  function showTab(id) {
    activeTab = id;
    for (const t of TABS) {
      const b = tabBtns[t.id];
      if (b) b.classList.toggle("is-active", t.id === id);
    }
    content.replaceChildren(buildPane(id));
  }

  for (const t of TABS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rsw-gs__tab";
    btn.setAttribute("role", "tab");
    const tabIcon = el("span", "rsw-gs__tabicon");
    tabIcon.appendChild(createIcon(t.icon, 16));
    tabIcon.setAttribute("aria-hidden", "true");
    btn.append(tabIcon, el("span", "rsw-gs__tablabel", t.label));
    btn.addEventListener("click", () => showTab(t.id));
    tabBtns[t.id] = btn;
    side.appendChild(btn);
  }

  const foot = el("div", "rsw-gs__foot");
  const spacer = el("div", "rsw-gs__foot-spacer");
  foot.append(
    makeButton("Reset to Defaults", "ghost", onResetAll),
    spacer,
    makeButton("Cancel", "default", () => handle && handle.close({ reason: "cancel" })),
    makeButton("Save", "primary", onSave),
  );

  const handle = openModal({
    title: "Game Settings",
    body: layout,
    footer: foot,
    width: 820,
    className: "rsw-modal--gs",
    closeOnBackdrop: false,
    onClose: () => {
      if (liveTimer) {
        clearTimeout(liveTimer);
        liveTimer = null;
      }
      if (!saved) {
        try {
          project.cancelEditSession(session);
        } catch (e) {
          logger.warn("GameSettings: cancel: " + (e && e.message));
        }
      }
      _open = false;
    },
  });

  showTab(activeTab);
  return handle;
}

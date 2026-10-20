import { bus } from "../../core/eventBus.js";

import { registerFrameCallback } from "../../core/frameDriver.js";


import { createListenerScope } from "../../core/listenerScope.js";
import { project } from "../../core/project.js";
import { store } from "../../core/state.js";
import { settings } from "../../config/settings.js";
import { getProjection } from "../../viewport/projection.js";
import { raycastWorkspace } from "../../physics/raycast.js";
import { createPathfinder, PF_LIMITS } from "../pathfinding.js";

import { getStaticCollisionGeometryVersion } from "../staticCollisionGeometryVersion.js";

import { createPathfindingWatcher } from "../pathfindingWatcher.js";
import { getTestLocale } from "../localization.js";
import { emulation } from "../emulation.js";
import * as social from "../social.js";
import { cameraSys } from "../cameraSystem.js";                                
import { getPlayerSettings, setPlayerSetting } from "./playerSettings.js";
import { createPauseMenu } from "./pauseMenu.js";
import { createPlayerList } from "./playerList.js";
import { createEmotesMenu, isValidEmote } from "./emotesMenu.js";

const RESET_COOLDOWN_MS = 5000;                  
const CTM_RAY_MAX = 500;
const CTM_WAYPOINT_RADIUS = 1.4;

const STR = {
  en: {
    menu: "Game menu", chat: "Chat", playerList: "Player list", emotes: "Emotes",
    backpack: "Backpack", captures: "Captures", captureTaken: "Screenshot captured (simulated).",
    resume: "Resume", resetCharacter: "Reset Character", leave: "Leave",
    cancel: "Cancel", reset: "Reset",
    resetConfirm: "Are you sure you want to reset your character?",
    leaveConfirm: "Leave the game and return to the editor?",
    resetDisabledTip: "Reset was disabled by this game",
    resetTooSoon: "Please wait a few seconds before resetting again.",
    resetRedirected: "Reset was handled by this game.",
    emoteUnknown: "Unknown emote. Try: wave, point, dance1, dance2, dance3, laugh, cheer, salute.",
    tab_people: "People", tab_settings: "Settings", tab_report: "Report", tab_help: "Help",
    volume: "Volume", cameraMode: "Camera Mode", movementMode: "Movement Mode",
    shiftLock: "Shift Lock Switch", sensitivity: "Camera Sensitivity",
    graphics: "Graphics Quality", auto: "Auto", fullscreen: "Fullscreen",
    perfStats: "Performance Stats",
    noPlayers: "No players in this session.",
    viewProfile: "View Profile", addFriend: "Add Friend", report: "Report",
    reportThanks: "Report sent (simulated). Thank you!",
    placeholderAction: "Not available in the simulator.",
    reportDesc: "Use this to report inappropriate content or behavior (simulated).",
    reportSend: "Send Report", reportConfirm: "Send this report?",
    helpMove: "Move", helpJump: "Jump", helpRmb: "Right mouse", helpCamera: "Rotate camera",
    helpZoom: "Zoom", helpShiftLock: "Shift lock", helpPlayerList: "Player list",
    helpEmotes: "Emotes", helpChat: "Chat", helpMenu: "Game menu", helpConsole: "Developer Console",
    emoteWave: "Wave", emotePoint: "Point", emoteDance1: "Dance 1", emoteDance2: "Dance 2",
    emoteDance3: "Dance 3", emoteLaugh: "Laugh", emoteCheer: "Cheer", emoteSalute: "Salute",
    tips: [
      "Tip: press Tab to see the player list.",
      "Tip: press / to chat and Esc for the game menu.",
      "Tip: press . to open the emotes wheel.",
      "Tip: hold right mouse button to rotate the camera.",
      "Tip: press F9 to open the Developer Console.",
    ],
  },
  pt: {
    menu: "Menu do jogo", chat: "Chat", playerList: "Lista de jogadores", emotes: "Emotes",
    backpack: "Mochila", captures: "Capturas", captureTaken: "Screenshot capturada (simulado).",
    resume: "Continuar", resetCharacter: "Resetar Personagem", leave: "Sair",
    cancel: "Cancelar", reset: "Resetar",
    resetConfirm: "Tem certeza de que deseja resetar seu personagem?",
    leaveConfirm: "Sair do jogo e voltar ao editor?",
    resetDisabledTip: "O reset foi desativado por este jogo",
    resetTooSoon: "Aguarde alguns segundos antes de resetar novamente.",
    resetRedirected: "O reset foi tratado por este jogo.",
    emoteUnknown: "Emote desconhecido. Tente: wave, point, dance1, dance2, dance3, laugh, cheer, salute.",
    tab_people: "Pessoas", tab_settings: "Configura\u00e7\u00f5es", tab_report: "Denunciar", tab_help: "Ajuda",
    volume: "Volume", cameraMode: "Modo de C\u00e2mera", movementMode: "Modo de Movimento",
    shiftLock: "Shift Lock", sensitivity: "Sensibilidade da C\u00e2mera",
    graphics: "Qualidade Gr\u00e1fica", auto: "Auto", fullscreen: "Tela Cheia",
    perfStats: "Estat\u00edsticas de Desempenho",
    noPlayers: "Nenhum jogador nesta sess\u00e3o.",
    viewProfile: "Ver Perfil", addFriend: "Adicionar Amigo", report: "Denunciar",
    reportThanks: "Den\u00fancia enviada (simulado). Obrigado!",
    placeholderAction: "Indispon\u00edvel no simulador.",
    reportDesc: "Use para denunciar conte\u00fado ou comportamento inadequado (simulado).",
    reportSend: "Enviar Den\u00fancia", reportConfirm: "Enviar esta den\u00fancia?",
    helpMove: "Mover", helpJump: "Pular", helpRmb: "Bot\u00e3o direito", helpCamera: "Girar c\u00e2mera",
    helpZoom: "Zoom", helpShiftLock: "Shift lock", helpPlayerList: "Lista de jogadores",
    helpEmotes: "Emotes", helpChat: "Chat", helpMenu: "Menu do jogo", helpConsole: "Developer Console",
    emoteWave: "Acenar", emotePoint: "Apontar", emoteDance1: "Dan\u00e7a 1", emoteDance2: "Dan\u00e7a 2",
    emoteDance3: "Dan\u00e7a 3", emoteLaugh: "Rir", emoteCheer: "Vibrar", emoteSalute: "Bater Contin\u00eancia",
    tips: [
      "Dica: pressione Tab para ver a lista de jogadores.",
      "Dica: pressione / para conversar e Esc para o menu do jogo.",
      "Dica: pressione . para abrir a roda de emotes.",
      "Dica: segure o bot\u00e3o direito do mouse para girar a c\u00e2mera.",
      "Dica: pressione F9 para abrir o Developer Console.",
    ],
  },
};

function lang() {
  let loc = "en";
  try { loc = String(getTestLocale() || "en"); } catch (_) { loc = "en"; }
  return loc.toLowerCase().startsWith("pt") ? "pt" : "en";
}

function t(key) {
  const d = STR[lang()];
  return (d && d[key]) || STR.en[key] || key;
}


const EMOTE_DEFS = {
  wave: { dur: 0, fn: (tt, p) => { p.armR = -2.8 + Math.sin(tt * 7) * 0.45; } },
  point: { dur: 2.5, fn: (tt, p) => { p.armR = -1.55; } },
  dance1: { dur: 0, fn: (tt, p) => {
    const s = Math.sin(tt * 6);
    p.armL = -0.9 + s * 0.7; p.armR = -0.9 - s * 0.7;
    p.legL = s * 0.3; p.legR = -s * 0.3;
    p.bob = Math.abs(Math.cos(tt * 6)) * 0.14;
  } },
  dance2: { dur: 0, fn: (tt, p) => {
    const s = Math.sin(tt * 5);
    p.armL = -2.4 + s * 0.5; p.armR = -2.4 - s * 0.5;
    p.legL = -s * 0.35; p.legR = s * 0.35;
    p.bob = Math.abs(Math.sin(tt * 5)) * 0.12;
  } },
  dance3: { dur: 0, fn: (tt, p) => {
    const s = Math.sin(tt * 8);
    p.armL = -1.6 + s * 1.1; p.armR = -1.6 - s * 1.1;
    p.legL = s * 0.25; p.legR = -s * 0.25;
    p.bob = Math.abs(Math.cos(tt * 4)) * 0.18;
  } },
  laugh: { dur: 3, fn: (tt, p) => {
    const s = Math.sin(tt * 14);
    p.armL = -0.5 + s * 0.12; p.armR = -0.5 - s * 0.12;
    p.bob = Math.abs(s) * 0.07;
  } },
  cheer: { dur: 3, fn: (tt, p) => {
    const s = Math.sin(tt * 8);
    p.armL = -2.9 + s * 0.3; p.armR = -2.9 - s * 0.3;
    p.bob = Math.abs(Math.cos(tt * 8)) * 0.1;
  } },
  salute: { dur: 2.5, fn: (tt, p) => { p.armR = -2.65; } },
};


let active = false;
let api = null;
let root = null;
let topbarEl = null;
let crosshairEl = null;
let markerEl = null;
let perfEl = null;
let loadingEl = null;
let loadingTipEl = null;
let loadingTimer = 0;
let tipTimer = 0;
let pauseMenu = null;
let playerList = null;
let emotesMenu = null;
let buttons = {};
let offs = [];


const playSessionListeners = createListenerScope("coreGui");
let unregisterFrameCallback = null;
let lastPlistUpdate = 0;
let perfFrames = 0;
let perfLastT = 0;
let shiftLockActive = false;
let activeEmote = null;                 
let lastResetAt = 0;
let pf = null;
let ctm = { waypoints: null, index: 0, target: null };
let ctmWatcher = null;                                                   
let ctmTickAt = 0;                                                    
let ctmLastRoot = null;                                                   
let origVolumeScale = null;
let origPerfStats = null;
let enteredFullscreen = false;
const emotePoseObj = { armL: 0, armR: 0, legL: 0, legR: 0, bob: 0, key: "" };

function notify(msg) {
  try { social.chat.sendSystem(msg); } catch (_) {            }
}

function soundService() {
  const dm = api && api.getDataModel();
  return dm && dm.findFirstChild ? dm.findFirstChild("SoundService") : null;
}

function isTypingTarget(node) {
  const tag = node && node.tagName ? node.tagName.toLowerCase() : "";
  return tag === "input" || tag === "textarea" || tag === "select" || (node && node.isContentEditable);
}


const CG_SVG_NS = "http://www.w3.org/2000/svg";
const CG_PILL_PATHS = {
  menu: ["M8 1.8 L13.4 4.9 V11.1 L8 14.2 L2.6 11.1 V4.9 Z"],
  chat: ["M2.5 3.5 H13.5 V10.5 H8.5 L5.5 13.2 V10.5 H2.5 Z"],
  playerList: [
    "M6 7.6 A2.1 2.1 0 1 0 6 3.4 A2.1 2.1 0 0 0 6 7.6",
    "M2.4 13 C2.4 10.6 4 9.2 6 9.2 C8 9.2 9.6 10.6 9.6 13",
    "M10.6 7.4 A1.8 1.8 0 1 0 10.6 3.8",
    "M11.2 9.4 C12.8 9.7 13.8 11 13.8 13",
  ],
  emotes: [
    "M8 14 A6 6 0 1 1 8 2 A6 6 0 0 1 8 14",
    "M5.6 6.4 H6.2 M9.8 6.4 H10.4",
    "M5.2 9.2 A3.2 3.2 0 0 0 10.8 9.2",
  ],
  backpack: [
    "M5.2 5.5 V4.6 A2.8 2.8 0 0 1 10.8 4.6 V5.5",
    "M3.5 7.2 C3.5 6.3 4.3 5.5 5.2 5.5 H10.8 C11.7 5.5 12.5 6.3 12.5 7.2 V12 C12.5 12.9 11.7 13.7 10.8 13.7 H5.2 C4.3 13.7 3.5 12.9 3.5 12 Z",
    "M5.6 10.8 H10.4",
  ],
  captures: [
    "M2.5 5.5 H5.2 L6.4 3.8 H9.6 L10.8 5.5 H13.5 V12.5 H2.5 Z",
    "M8 11.2 A2.2 2.2 0 1 0 8 6.8 A2.2 2.2 0 0 0 8 11.2",
  ],
};

function pillIcon(name) {
  const svg = document.createElementNS(CG_SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of CG_PILL_PATHS[name] || ["M4 4 H12 V12 H4 Z"]) {
    const p = document.createElementNS(CG_SVG_NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

function pill(id, icon, title, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "rsw-cg__pill";
  b.style.display = "inline-flex";
  b.style.alignItems = "center";
  b.style.justifyContent = "center";
  b.appendChild(pillIcon(icon));
  b.title = title;
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  buttons[id] = b;
  return b;
}

function buildTopbar() {
  topbarEl = document.createElement("div");
  topbarEl.className = "rsw-cg__topbar";
  const left = document.createElement("div");
  left.className = "rsw-cg__pillgroup";
  const right = document.createElement("div");
  right.className = "rsw-cg__pillgroup";

  left.appendChild(pill("menu", "menu", t("menu") + " (Esc)", () => pauseMenu.toggle()));
  left.appendChild(pill("chat", "chat", t("chat") + " (/)", () => {
    const on = !social.chat.isWindowVisible();
    social.chat.setWindowVisible(on);
    buttons.chat.classList.toggle("is-on", on);
  }));

  right.appendChild(pill("playerList", "playerList", t("playerList") + " (Tab)", () => togglePlayerList()));
  right.appendChild(pill("emotes", "emotes", t("emotes") + " (.)", () => toggleEmotesMenu()));
  right.appendChild(pill("backpack", "backpack", t("backpack"), () => {
    const hotbar = document.querySelector(".rsw-hotbar");
    if (!hotbar) return;
    const wasHidden = hotbar.style.visibility === "hidden";
    hotbar.style.visibility = wasHidden ? "" : "hidden";

    buttons.backpack.classList.toggle("is-on", wasHidden);
  }));
  buttons.backpack.classList.add("is-on");
  right.appendChild(pill("captures", "captures", t("captures"), () => notify(t("captureTaken"))));

  topbarEl.append(left, right);
  root.appendChild(topbarEl);
  syncTopbar();
  syncButtons();
}

function syncTopbar() {
  const enabled = social.getCoreParam("TopbarEnabled") !== false;
  if (topbarEl) topbarEl.style.display = enabled ? "" : "none";
}

function syncButtons() {
  const map = { chat: "Chat", playerList: "PlayerList", emotes: "EmotesMenu", backpack: "Backpack", captures: "Captures" };
  for (const [id, type] of Object.entries(map)) {
    if (buttons[id]) buttons[id].hidden = !social.getCoreGuiEnabled(type);
  }
  if (playerList && !social.getCoreGuiEnabled("PlayerList")) playerList.setVisible(false);


  if (playerList && buttons.playerList) {
    buttons.playerList.classList.toggle("is-on", playerList.isVisible());
  }
  if (emotesMenu && !social.getCoreGuiEnabled("EmotesMenu")) emotesMenu.close();
}

function togglePlayerList() {
  if (!social.getCoreGuiEnabled("PlayerList")) return;
  const on = !playerList.isVisible();
  playerList.setVisible(on);
  if (on) { playerList.update(); lastPlistUpdate = Date.now(); }
  buttons.playerList.classList.toggle("is-on", on);
}

function toggleEmotesMenu() {
  if (!social.getCoreGuiEnabled("EmotesMenu")) return;
  emotesMenu.toggle();
}


function buildLoading() {
  let minSec = 1;
  try {
    const v = Number(settings.get("loadingScreenMinSec"));
    if (Number.isFinite(v)) minSec = Math.min(10, Math.max(0, v));
  } catch (_) { minSec = 1; }
  if (minSec <= 0) return;

  let gameName = "Roblox Studio Web";
  let thumb = "";
  try {
    const gs = project.getWorkingCopy();
    if (gs && gs.general) {
      if (gs.general.name) gameName = String(gs.general.name);
      if (gs.general.thumbnail) thumb = String(gs.general.thumbnail);
    }
  } catch (_) {            }

  loadingEl = document.createElement("div");
  loadingEl.className = "rsw-cg__loading";
  if (thumb) {
    const img = document.createElement("img");
    img.className = "rsw-cg__loading-thumb";
    img.src = thumb;
    img.alt = "";
    img.addEventListener("error", () => { if (img.parentNode) img.parentNode.removeChild(img); });
    loadingEl.appendChild(img);
  }
  const title = document.createElement("div");
  title.className = "rsw-cg__loading-title";
  title.textContent = gameName;
  const spinner = document.createElement("div");
  spinner.className = "rsw-cg__spinner";
  loadingTipEl = document.createElement("div");
  loadingTipEl.className = "rsw-cg__loading-tip";
  const tips = STR[lang()].tips;
  let tipIdx = Math.floor(Math.random() * tips.length);
  loadingTipEl.textContent = tips[tipIdx];
  tipTimer = setInterval(() => {
    tipIdx = (tipIdx + 1) % tips.length;
    if (loadingTipEl) loadingTipEl.textContent = tips[tipIdx];
  }, 2500);
  loadingEl.append(title, spinner, loadingTipEl);
  (root || document.body).appendChild(loadingEl);                           
  loadingTimer = setTimeout(hideLoading, minSec * 1000);
}

function hideLoading() {
  if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = 0; }
  if (tipTimer) { clearInterval(tipTimer); tipTimer = 0; }
  const el = loadingEl;
  loadingEl = null;
  loadingTipEl = null;
  if (!el) return;
  el.classList.add("is-out");
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
}


function getResetState() {
  const cb = social.getCoreParam("ResetButtonCallback");
  if (cb === false) return "disabled";
  if (cb && cb.__isInstance === true && cb.className === "BindableEvent") return "redirected";
  return "enabled";
}

function performReset() {
  const now = Date.now();
  if (now - lastResetAt < RESET_COOLDOWN_MS) { notify(t("resetTooSoon")); return; }
  const state = getResetState();
  if (state === "disabled") return;
  lastResetAt = now;
  if (state === "redirected") {
    bus.emit("coregui:fireResetBindable", {});
    notify(t("resetRedirected"));
    return;
  }
  api.resetCharacter();
}


function startEmote(id) {
  const name = String(id || "").toLowerCase();
  if (!isValidEmote(name)) { notify(t("emoteUnknown")); return; }                  


  if (!api || !api.getCharacter()) return;
  activeEmote = { id: name, start: Date.now() };
}

function getEmotePose() {
  if (!activeEmote) return null;
  const def = EMOTE_DEFS[activeEmote.id];
  if (!def) { activeEmote = null; return null; }
  const tt = (Date.now() - activeEmote.start) / 1000;
  if (def.dur > 0 && tt >= def.dur) { activeEmote = null; return null; }
  emotePoseObj.armL = 0; emotePoseObj.armR = 0;
  emotePoseObj.legL = 0; emotePoseObj.legR = 0; emotePoseObj.bob = 0;
  def.fn(tt, emotePoseObj);
  emotePoseObj.key = activeEmote.id + "|" + ((tt * 30) | 0);
  return emotePoseObj;
}

function cancelEmote() {
  activeEmote = null;
}


function isUnder(inst, ancestor) {
  let cur = inst;
  while (cur) {
    if (cur === ancestor) return true;
    cur = typeof cur.getParent === "function" ? cur.getParent() : null;
  }
  return false;
}

function isClickToMoveActive() {
  if (!active) return false;
  let dev = "UserChoice";
  try {
    const lp = api.getLocalPlayer();
    if (lp && lp.getProperty) dev = String(lp.getProperty("DevComputerMovementMode") || "UserChoice");
  } catch (_) { dev = "UserChoice"; }
  if (dev === "ClickToMove") return true;
  if (dev === "KeyboardMouse" || dev === "Scriptable") return false;
  return getPlayerSettings().movementMode === "ClickToMove";
}

function buildGeometry() {
  const dm = api ? api.getDataModel() : null;
  const ws = dm && dm.findFirstChild ? dm.findFirstChild("Workspace") : null;
  const character = api ? api.getCharacter() : null;
  const parts = [];
  if (ws) {
    for (const d of ws.getDescendants()) {
      if (parts.length >= 4000) break;
      if (!d.hasProperty || !d.hasProperty("Size") || !d.hasProperty("Position")) continue;
      if (character && isUnder(d, character)) continue;
      const p = d.getProperty("Position");
      const s = d.getProperty("Size");
      if (!p || !s) continue;
      parts.push({
        minX: p.x - s.x / 2, maxX: p.x + s.x / 2,
        minY: p.y - s.y / 2, maxY: p.y + s.y / 2,
        minZ: p.z - s.z / 2, maxZ: p.z + s.z / 2,
        canCollide: !d.hasProperty("CanCollide") || d.getProperty("CanCollide") !== false,
        anchored: true,
        material: "Plastic",
        isTruss: d.className === "TrussPart",
      });
    }
  }
  return { parts, modifiers: [], links: [] };
}


function ensurePathfinder() {
  if (!pf) {
    pf = createPathfinder({
      getGeometry: buildGeometry,
      getGeometryVersion: getStaticCollisionGeometryVersion,
    });
  }
  return pf;
}

function computeCtmWaypoints(startPos, targetPos) {
  let gen = null;
  try {
    gen = ensurePathfinder().computePath(


      { AgentRadius: 2, AgentHeight: 5, AgentCanJump: false, AgentAutoRepath: true },
      { x: startPos.x, y: startPos.y, z: startPos.z },
      { x: targetPos.x, y: targetPos.y, z: targetPos.z },
      () => {},
    );
  } catch (_) {
    return null;
  }
  let step;
  let guard = 0;
  try {
    for (;;) {
      step = gen.next();
      if (step.done) break;
      if (++guard > 50000) return null;
    }
  } catch (_) {
    return null;
  }
  const res = step.value;
  if (res && res.status === "Success" && Array.isArray(res.waypoints) && res.waypoints.length) {
    return res.waypoints;
  }
  return null;
}


function buildCtmDynamicGeometry() {
  const dm = api ? api.getDataModel() : null;
  const ws = dm && dm.findFirstChild ? dm.findFirstChild("Workspace") : null;
  const character = api ? api.getCharacter() : null;
  const parts = [];
  const wps = ctm.waypoints || [];
  if (!ws || !wps.length) return { parts, modifiers: [], links: [] };
  const lim = (name, def) => {
    const v = PF_LIMITS && PF_LIMITS[name];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : def;
  };
  const radius = lim("dynamicRadius", 250);
  const maxDyn = lim("maxDynamicParts", 300);
  const stride = Math.max(1, Math.floor(wps.length / 8));
  const centers = [];
  for (let i = 0; i < wps.length; i += stride) centers.push(wps[i]);
  centers.push(wps[wps.length - 1]);
  for (const d of ws.getDescendants()) {
    if (parts.length >= maxDyn) break;
    if (!d.hasProperty || !d.hasProperty("Size") || !d.hasProperty("Position") || !d.hasProperty("CanCollide")) continue;
    if (character && isUnder(d, character)) continue;
    if (d.getProperty("CanCollide") === false) continue;
    if (!d.hasProperty("Anchored") || d.getProperty("Anchored") !== false) continue;
    const p = d.getProperty("Position");
    const s = d.getProperty("Size");
    if (!p || !s) continue;
    let near = false;
    for (let i = 0; i < centers.length; i++) {
      const c = centers[i];
      if (Math.abs(p.x - c.x) <= radius && Math.abs(p.y - c.y) <= radius && Math.abs(p.z - c.z) <= radius) { near = true; break; }
    }
    if (!near) continue;
    const v = d.hasProperty("AssemblyLinearVelocity") ? d.getProperty("AssemblyLinearVelocity") : null;
    parts.push({
      id: String(d.id || ""),
      dynamic: true,
      minX: p.x - s.x / 2, maxX: p.x + s.x / 2,
      minY: p.y - s.y / 2, maxY: p.y + s.y / 2,
      minZ: p.z - s.z / 2, maxZ: p.z + s.z / 2,
      canCollide: true,
      anchored: false,
      vx: v ? Number(v.x) || 0 : 0,
      vy: v ? Number(v.y) || 0 : 0,
      vz: v ? Number(v.z) || 0 : 0,
      material: "Plastic",
      isTruss: false,
    });
  }
  return { parts, modifiers: [], links: [] };
}


function ctmHandleRepath() {
  if (!ctm.target || !ctm.waypoints) return;
  const startPos = ctmLastRoot || ctm.waypoints[Math.min(ctm.index, ctm.waypoints.length - 1)] || null;
  if (!startPos) { cancelClickToMove(); return; }
  const waypoints = computeCtmWaypoints(startPos, ctm.target);
  if (!waypoints || !waypoints.length) { cancelClickToMove(); return; }
  ctm.waypoints = waypoints;
  ctm.index = ctmAnchorIndex(waypoints, startPos);
  ctm.lastDist = Infinity;
  ctm.lastProgressAt = Date.now();
  if (ctmWatcher) ctmWatcher.updatePath("ctm", waypoints);
}


function ctmAnchorIndex(waypoints, rootPos) {
  for (let i = 0; i < waypoints.length; i++) {
    const dx = waypoints[i].x - rootPos.x;
    const dz = waypoints[i].z - rootPos.z;
    if (Math.hypot(dx, dz) > CTM_WAYPOINT_RADIUS) return i;
  }
  return Math.max(0, waypoints.length - 1);
}

function ensureCtmWatcher() {
  if (!ctmWatcher) {
    ctmWatcher = createPathfindingWatcher({


      pathfinder: null,
      getGeometry: buildCtmDynamicGeometry,
      limits: PF_LIMITS,


      requestRepath: () => ctmHandleRepath(),
      warn: () => {},
    });
  }
  return ctmWatcher;
}


function ctmTickWatcher(rootPos) {
  ctmLastRoot = rootPos;
  if (!ctmWatcher || !ctmWatcher.hasPaths()) return;
  const now = Date.now();
  const dt = ctmTickAt ? Math.min(0.25, (now - ctmTickAt) / 1000) : 0;
  ctmTickAt = now;
  if (dt > 0) {
    try { ctmWatcher.tick(dt); } catch (_) {                            }
  }
}

function screenRay(clientX, clientY) {
  const canvas = document.querySelector(".rsw-viewport__canvas");
  const pose = api && typeof api.getCameraPose === "function" ? api.getCameraPose() : null;
  if (!canvas || !pose) return null;
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
  const ndcX = ((clientX - r.left) / r.width) * 2 - 1;
  const ndcY = -(((clientY - r.top) / r.height) * 2 - 1);
  let fx = pose.tx - pose.px;
  let fy = pose.ty - pose.py;
  let fz = pose.tz - pose.pz;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz);


  if (rl < 1e-6) { rx = 1; rz = 0; } else { rx /= rl; rz /= rl; }
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;

  const tf = Math.tan(((cameraSys.getRenderFov() * Math.PI) / 180) / 2);
  const aspect = r.width / r.height;
  let dx = fx + rx * ndcX * tf * aspect + ux * ndcY * tf;
  let dy = fy + uy * ndcY * tf;
  let dz = fz + rz * ndcX * tf * aspect + uz * ndcY * tf;
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  return {
    origin: { x: pose.px, y: pose.py, z: pose.pz },
    dir: { x: dx * CTM_RAY_MAX, y: dy * CTM_RAY_MAX, z: dz * CTM_RAY_MAX },
  };
}

function handleCtmClick(e) {
  if (!active || e.button !== 0) return;
  if (!isClickToMoveActive()) return;
  if (pauseMenu.isOpen() || emotesMenu.isOpen()) return;
  if (social.chat.isTyping()) return;
  if (isTypingTarget(e.target)) return;
  const canvas = document.querySelector(".rsw-viewport__canvas");
  if (!canvas || (e.target !== canvas && !canvas.contains(e.target))) return;
  const ray = screenRay(e.clientX, e.clientY);
  if (!ray) return;
  const dm = api.getDataModel();
  const ws = dm && dm.findFirstChild ? dm.findFirstChild("Workspace") : null;
  const character = api.getCharacter();
  if (!ws || !character) return;
  let hit = null;
  try {
    hit = raycastWorkspace(ws, ray.origin, ray.dir, { filterType: "Exclude", filterList: [character] });
  } catch (_) {
    hit = null;
  }
  if (!hit || !hit.position) return;
  const target = { x: hit.position.x, y: hit.position.y, z: hit.position.z };
  const rootPart = character.findFirstChild ? character.findFirstChild("HumanoidRootPart") : null;
  const rp = rootPart && rootPart.getProperty ? rootPart.getProperty("Position") : null;
  const startPos = rp || target;
  const waypoints = computeCtmWaypoints(startPos, target);
  ctm.waypoints = waypoints || [{ x: target.x, y: target.y, z: target.z, action: "Walk" }];
  ctm.index = 0;
  ctm.target = target;
  ctm.lastDist = Infinity;
  ctm.lastProgressAt = Date.now();


  ctmLastRoot = { x: startPos.x, y: startPos.y, z: startPos.z };
  ctmTickAt = 0;
  ensureCtmWatcher().registerPath("ctm", { waypoints: ctm.waypoints, autoRepath: true });
  if (markerEl) {


    markerEl.style.display = "none";
    markerEl.hidden = false;
  }
}

function getAutoMoveDir(rootPos) {
  if (!ctm.waypoints) return null;


  if (!isClickToMoveActive()) { cancelClickToMove(); return null; }


  ctmTickWatcher(rootPos);
  if (!ctm.waypoints) return null;
  for (;;) {
    const wp = ctm.waypoints[ctm.index];
    if (!wp) { cancelClickToMove(); return null; }
    const dx = wp.x - rootPos.x;
    const dz = wp.z - rootPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= CTM_WAYPOINT_RADIUS) {
      ctm.index++;
      ctm.lastDist = Infinity;
      ctm.lastProgressAt = Date.now();
      if (ctm.index >= ctm.waypoints.length) { cancelClickToMove(); return null; }
      continue;
    }


    if (dist < ctm.lastDist - 0.1) {
      ctm.lastDist = dist;
      ctm.lastProgressAt = Date.now();
    } else if (Date.now() - (ctm.lastProgressAt || 0) > 2500) {
      cancelClickToMove();
      return null;
    }
    return { x: dx / dist, z: dz / dist };
  }
}

function cancelClickToMove() {
  ctm.waypoints = null;
  ctm.index = 0;
  ctm.target = null;
  ctm.lastDist = Infinity;
  ctm.lastProgressAt = 0;


  if (ctmWatcher) { try { ctmWatcher.reset(); } catch (_) {            } }
  ctmTickAt = 0;
  ctmLastRoot = null;
  if (markerEl) markerEl.hidden = true;
}


function applySetting(key, value) {
  const applied = setPlayerSetting(key, value);                            
  if (key === "volume") applyVolume();
  else if (key === "movementMode" && applied !== "ClickToMove") cancelClickToMove();
  else if (key === "shiftLockSwitch" && applied === false) setShiftLock(false);
  else if (key === "graphicsQuality") bus.emit("coregui:graphicsQuality", { value: applied, play: true });
  else if (key === "fullscreen") applyFullscreen(applied);
  else if (key === "perfStats") applyPerfStats(applied);
  return applied;
}

function applyVolume() {
  const ss = soundService();
  if (!ss || !ss.hasProperty || !ss.hasProperty("VolumeScale")) return;
  const v = getPlayerSettings().volume / 10;
  try {
    if (origVolumeScale === null) {
      const cur = Number(ss.getProperty("VolumeScale"));


      origVolumeScale = Number.isFinite(cur) ? cur : 1;
    }
    ss.setProperty("VolumeScale", Math.min(1, Math.max(0, v)));
  } catch (_) {            }
}

function restoreVolume() {
  if (origVolumeScale === null) return;
  const ss = soundService();
  if (ss && ss.hasProperty && ss.hasProperty("VolumeScale")) {
    try { ss.setProperty("VolumeScale", origVolumeScale); } catch (_) {            }
  }
  origVolumeScale = null;
}


function syncFullscreenPrefOff() {
  try { setPlayerSetting("fullscreen", false); } catch (_) {            }
  if (pauseMenu) { try { pauseMenu.refreshSettings(); } catch (_) {            } }
}

function applyFullscreen(on) {
  try {
    if (on && document.documentElement.requestFullscreen) {


      document.documentElement.requestFullscreen().then(
        () => { enteredFullscreen = true; },
        () => { syncFullscreenPrefOff(); },
      );
    } else if (on) {

      syncFullscreenPrefOff();
    } else if (!on && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  } catch (_) {            }
}

function applyPerfStats(on) {
  if (origPerfStats === null) {
    try { origPerfStats = store.getState().viewOptions.perfStats === true; } catch (_) { origPerfStats = false; }
  }
  if (perfEl) perfEl.hidden = !on;
}


function devMouseLockAllowed() {
  try {
    const lp = api && api.getLocalPlayer ? api.getLocalPlayer() : null;
    if (lp && lp.getProperty) return lp.getProperty("DevEnableMouseLock") !== false;
  } catch (_) {            }
  return true;
}

function setShiftLock(on) {
  const want = on === true;
  if (want) {
    if (!getPlayerSettings().shiftLockSwitch) return;
    if (!devMouseLockAllowed()) return;
  }
  shiftLockActive = want;
  if (crosshairEl) crosshairEl.hidden = !want;
}


function handleKeyDown(e) {
  if (!active) return;


  if (e.defaultPrevented) return;
  if (isTypingTarget(e.target) || social.chat.isTyping()) return;
  if (e.key === "Escape") {
    if (emotesMenu.isOpen()) { emotesMenu.close(); return; }
    pauseMenu.toggle();
    return;
  }
  if (e.key === "Tab") {


    e.preventDefault();
    if (!social.getCoreGuiEnabled("PlayerList")) return;
    togglePlayerList();
    return;
  }
  if (e.key === ".") {
    if (pauseMenu.isOpen()) return;
    e.preventDefault();
    toggleEmotesMenu();
    return;
  }
  if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && !e.repeat) {
    if (pauseMenu.isOpen()) return;
    setShiftLock(!shiftLockActive);
  }
}


function tickUi() {
  if (!active) return;
  const now = Date.now();


  perfFrames++;
  if (perfEl && !perfEl.hidden && now - perfLastT >= 500) {
    const fps = Math.round((perfFrames * 1000) / Math.max(1, now - perfLastT));
    perfEl.textContent = `FPS ${fps} \u00b7 ${(1000 / Math.max(1, fps)).toFixed(1)} ms`;
    perfFrames = 0;
    perfLastT = now;
  } else if (now - perfLastT >= 500) {
    perfFrames = 0;
    perfLastT = now;
  }


  if (playerList && playerList.isVisible() && now - lastPlistUpdate >= 500) {
    lastPlistUpdate = now;
    playerList.update();
  }


  if (markerEl && !markerEl.hidden) {
    if (!ctm.target || !isClickToMoveActive()) {
      markerEl.hidden = true;
    } else {
      const proj = getProjection();
      const scr = proj && proj.project ? proj.project(ctm.target.x, ctm.target.y + 0.3, ctm.target.z) : null;
      if (scr && scr.visible !== false) {
        markerEl.style.left = scr.x + "px";
        markerEl.style.top = scr.y + "px";
        markerEl.style.display = "";
      } else {
        markerEl.style.display = "none";
      }
    }
  }
}


export const coreGui = {
  start(options) {
    if (active) this.stop();
    if (!options || options.mode !== "play" || typeof document === "undefined") return;
    active = true;
    api = options;
    buttons = {};
    offs = [];
    shiftLockActive = false;
    activeEmote = null;
    lastResetAt = 0;
    cancelClickToMove();
    origVolumeScale = null;
    origPerfStats = null;
    enteredFullscreen = false;
    pf = null;


    const proj = getProjection();
    let mount = proj && proj.container ? proj.container : null;
    if (!mount) mount = document.querySelector(".rsw-viewport") || document.body;
    try {
      const cs = window.getComputedStyle(mount);
      if (cs && cs.position === "static") mount.style.position = "relative";
    } catch (_) {            }
    root = document.createElement("div");
    root.className = "rsw-cg";
    root.classList.toggle("is-touch", emulation.getState().touch === true);
    mount.appendChild(root);

    crosshairEl = document.createElement("div");
    crosshairEl.className = "rsw-cg__crosshair";
    crosshairEl.textContent = "\u2295";
    crosshairEl.hidden = true;
    root.appendChild(crosshairEl);

    markerEl = document.createElement("div");
    markerEl.className = "rsw-cg__ctm-marker";
    markerEl.hidden = true;
    root.appendChild(markerEl);

    perfEl = document.createElement("div");
    perfEl.className = "rsw-cg__perf";
    perfEl.hidden = true;
    root.appendChild(perfEl);

    buildTopbar();

    playerList = createPlayerList({
      root,
      t,
      getDataModel: () => api.getDataModel(),
      getLocalPlayer: () => api.getLocalPlayer(),
      notify,
    });
    playerList.update();

    emotesMenu = createEmotesMenu({ root, t, onSelect: (id) => startEmote(id) });

    pauseMenu = createPauseMenu({
      root,
      t,
      notify,
      getPlayers: () => {
        const dm = api.getDataModel();
        const svc = dm && dm.findFirstChild ? dm.findFirstChild("Players") : null;
        return svc ? svc.getChildren().filter((c) => c.className === "Player") : [];
      },
      applySetting,
      getResetState,
      onResetConfirmed: () => performReset(),
      onLeave: () => api.requestStop(),                                     
      onClosed: () => {},
      blurAllowed: () => {
        const q = getPlayerSettings().graphicsQuality;
        return q === 0 || q >= 4;                                             
      },
    });


    syncButtons();
    buttons.playerList.classList.toggle("is-on", playerList.isVisible());

    buildLoading();

    playSessionListeners.add(window, "keydown", handleKeyDown, false);
    buttons.chat.classList.toggle("is-on", social.chat.isWindowVisible());
    playSessionListeners.add(window, "mousedown", handleCtmClick, true);
    playSessionListeners.add(document, "fullscreenchange", () => {

      if (!document.fullscreenElement) syncFullscreenPrefOff();
    });

    offs.push(bus.on("coregui:changed", () => syncButtons()));
    offs.push(bus.on("coregui:topbar", () => syncTopbar()));
    offs.push(bus.on("coregui:chatActive", (p) => {
      const on = !!(p && p.active);
      social.chat.setWindowVisible(on);
      if (buttons.chat) buttons.chat.classList.toggle("is-on", on);
    }));
    offs.push(bus.on("coregui:emote", (p) => startEmote(p && p.name)));
    offs.push(bus.on("coregui:removeLoadingScreen", () => hideLoading()));


    offs.push(bus.on("coregui:resetButton", () => { if (pauseMenu) pauseMenu.syncResetButton(); }));
    offs.push(bus.on("emulation:changed", (p) => {
      if (root) root.classList.toggle("is-touch", !!(p && p.touch));
    }));


    applyVolume();
    applyPerfStats(getPlayerSettings().perfStats);
    if (getPlayerSettings().fullscreen) applyFullscreen(true);


    bus.emit("coregui:graphicsQuality", { value: getPlayerSettings().graphicsQuality, play: true });

    perfLastT = Date.now();
    perfFrames = 0;
    lastPlistUpdate = 0;
    unregisterFrameCallback = registerFrameCallback("overlay", tickUi, "coreGui:playerHud");
  },

  stop() {
    if (!active && !root) return;
    active = false;
    if (unregisterFrameCallback) { unregisterFrameCallback(); unregisterFrameCallback = null; }
    playSessionListeners.disposeAll();
    for (const off of offs) { try { off(); } catch (_) {            } }
    offs = [];
    hideLoading();
    restoreVolume();

    bus.emit("coregui:graphicsQuality", { value: 0, play: false });
    if (enteredFullscreen && document.fullscreenElement && document.exitFullscreen) {
      try { document.exitFullscreen().catch(() => {}); } catch (_) {            }
    }
    if (pauseMenu) { try { pauseMenu.destroy(); } catch (_) {            } pauseMenu = null; }
    if (playerList) { try { playerList.destroy(); } catch (_) {            } playerList = null; }
    if (emotesMenu) { try { emotesMenu.destroy(); } catch (_) {            } emotesMenu = null; }
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null; topbarEl = null; crosshairEl = null; markerEl = null; perfEl = null;
    buttons = {};
    shiftLockActive = false;
    activeEmote = null;
    cancelClickToMove();
    pf = null;
    api = null;
    origPerfStats = null;
  },


  isActive: () => active,
  isMenuOpen: () => !!(pauseMenu && pauseMenu.isOpen()),


  isShiftLockActive: () => {
    if (!active || !shiftLockActive) return false;
    if (!devMouseLockAllowed()) { setShiftLock(false); return false; }
    return true;
  },
  getSensitivity: () => (active ? getPlayerSettings().sensitivity : 1),
  getCameraFollowMode: () => active && getPlayerSettings().cameraMode === "Follow",
  getAutoMoveDir: (rootPos) => (active ? getAutoMoveDir(rootPos) : null),
  cancelClickToMove: () => cancelClickToMove(),
  getEmotePose: () => (active ? getEmotePose() : null),
  cancelEmote: () => cancelEmote(),
};

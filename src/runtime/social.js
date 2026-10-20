import { bus } from "../core/eventBus.js";
import { createInstance } from "../datamodel/index.js";
import { makeColor } from "../datamodel/types.js";
import { getProjection } from "../viewport/projection.js";

const CHAT_MAX_CHARS = 200;
const CHAT_RATE_MS = 1000;
const CHAT_HISTORY = 200;
const CHAT_VISIBLE = 50;
const CHAT_FADE_MS = 10000;
const BUBBLE_LIFETIME_MS = 8000;
const BUBBLE_MAX_PER_CHAR = 5;
const BUBBLE_MAX_DIST = 100;
const BUBBLE_MAX_DIST_SQ = BUBBLE_MAX_DIST * BUBBLE_MAX_DIST;

const BRICK_RGB = Object.freeze({
  "Medium stone grey": [163, 162, 165],
  "White": [242, 243, 243],
  "Dark stone grey": [99, 95, 98],
  "Black": [27, 42, 53],
  "Bright red": [196, 40, 28],
  "Bright orange": [218, 133, 65],
  "Bright yellow": [245, 205, 48],
  "Bright green": [75, 151, 75],
  "Dark green": [40, 127, 71],
  "Bright blue": [13, 105, 172],
  "Steel blue": [82, 124, 174],
  "Navy blue": [0, 32, 96],
  "Bright violet": [107, 50, 124],
  "Magenta": [170, 0, 170],
  "Pink": [255, 102, 172],
  "Brown": [124, 92, 70],
  "Reddish brown": [105, 64, 40],
});

export function brickRgb(name) {
  return BRICK_RGB[name] || BRICK_RGB["Medium stone grey"];
}

function brickCss(name) {
  const c = brickRgb(name);
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function findDataModel(inst) {
  let cur = inst;
  while (cur) {
    if (cur.className === "DataModel") return cur;
    cur = typeof cur.getParent === "function" ? cur.getParent() : null;
  }
  return null;
}

export function getServiceFrom(inst, name) {
  const dm = findDataModel(inst);
  if (!dm) return null;
  const svc = dm.findFirstChild(name);
  return svc || null;
}

export function listTeams(inst) {
  const svc = inst && inst.className === "Teams" ? inst : getServiceFrom(inst, "Teams");
  if (!svc) return [];
  return svc.getChildren().filter((c) => c.className === "Team");
}

function listPlayers(inst) {
  const svc = getServiceFrom(inst, "Players");
  if (!svc) return [];
  return svc.getChildren().filter((c) => c.className === "Player");
}

let teamCacheVersion = 0;
const teamCache = new WeakMap();

export function bumpTeamCache() {
  teamCacheVersion++;
}

export function teamPlayers(team) {
  if (!team) return [];
  const cached = teamCache.get(team);
  if (cached && cached.version === teamCacheVersion) return cached.list.slice();
  const list = listPlayers(team).filter((pl) => {
    let t = null;
    try { t = pl.getProperty("Team"); } catch (_) { t = null; }
    return t === team;
  });
  teamCache.set(team, { version: teamCacheVersion, list });
  return list.slice();
}

function fireTeamEvent(team, type, player) {
  bus.emit("teams:event", { team, type, args: [player] });
}

function firePlayerEvent(player, type, args) {
  bus.emit("player:event", { instance: player, type, args: args || [] });
}

export function applyAutoColor(player) {
  if (!player) return;
  let team = null;
  let character = null;
  try { team = player.getProperty("Team"); } catch (_) { team = null; }
  try { character = player.getProperty("Character"); } catch (_) { character = null; }
  if (!team || !character) return;
  let auto = true;
  try { auto = team.getProperty("AutoColorCharacters") !== false; } catch (_) { auto = true; }
  if (!auto) return;
  const rgb = brickRgb(team.getProperty("TeamColor"));
  const col = makeColor(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
  const parts = typeof character.getDescendants === "function" ? character.getDescendants() : [];
  for (const part of parts) {
    if (part.hasProperty && part.hasProperty("Color") && part.hasProperty("Size")) {
      try { part.setProperty("Color", col); } catch (_) {            }
    }
  }
}

export function assignPlayerToTeam(player, team) {
  if (!player) return;
  let old = null;
  try { old = player.getProperty("Team"); } catch (_) { old = null; }
  if (old === team) return;
  try { player.setProperty("Team", team || null); } catch (_) {            }
  if (team) {
    try { player.setProperty("TeamColor", team.getProperty("TeamColor")); } catch (_) {            }
    try { player.setProperty("Neutral", false); } catch (_) {            }
  } else {
    try { player.setProperty("Neutral", true); } catch (_) {            }
  }
  bumpTeamCache();
  if (old) fireTeamEvent(old, "PlayerRemoved", player);
  if (team) fireTeamEvent(team, "PlayerAdded", player);
  applyAutoColor(player);
}

export function assignPlayerTeamColor(player, colorName) {
  if (!player) return;
  const teams = listTeams(player);
  let match = null;
  for (const t of teams) {
    if (t.getProperty("TeamColor") === colorName) { match = t; break; }
  }
  if (match) { assignPlayerToTeam(player, match); return; }
  let old = null;
  try { old = player.getProperty("Team"); } catch (_) { old = null; }
  try { player.setProperty("TeamColor", colorName); } catch (_) {            }
  try { player.setProperty("Team", null); } catch (_) {            }
  try { player.setProperty("Neutral", true); } catch (_) {            }
  if (old) { bumpTeamCache(); fireTeamEvent(old, "PlayerRemoved", player); }
}

export function autoAssignTeam(player) {
  if (!player) return;
  let cur = null;
  try { cur = player.getProperty("Team"); } catch (_) { cur = null; }
  if (cur) return;
  const teams = listTeams(player).filter((t) => t.getProperty("AutoAssignable") !== false);
  if (!teams.length) return;
  let best = null;
  let bestCount = Infinity;
  for (const t of teams) {
    const c = teamPlayers(t).length;
    if (c < bestCount) { bestCount = c; best = t; }
  }
  if (best) assignPlayerToTeam(player, best);
}

export function spawnForceField(character, durationSeconds) {
  if (!character) return null;
  const existing = character.getChildren().filter((c) => c.className === "ForceField");
  for (const ff of existing) { try { ff.destroy(); } catch (_) {            } }
  const ff = createInstance("ForceField", { name: "ForceField", parent: character });
  if (ff) { try { ff.setProperty("Visible", true); } catch (_) {            } }
  const secs = Number(durationSeconds);
  const ms = Number.isFinite(secs) && secs > 0 ? secs * 1000 : 0;
  if (ff && ms > 0) ff._expiresAt = Date.now() + ms;
  if (ff && ms > 0 && typeof setTimeout === "function") {
    setTimeout(() => { try { if (ff && !ff._destroyed) ff.destroy(); } catch (_) {            } }, ms);
  }
  return ff;
}

const CORE_GUI_TYPES = ["Backpack", "Chat", "Health", "PlayerList", "EmotesMenu", "SelfView", "Captures"];
const coreGuiState = {};
for (const t of CORE_GUI_TYPES) coreGuiState[t] = true;
const coreParams = {};

export function setCoreGuiEnabled(type, enabled) {
  const on = enabled !== false;
  if (type === "All") {
    for (const t of CORE_GUI_TYPES) coreGuiState[t] = on;
  } else if (Object.prototype.hasOwnProperty.call(coreGuiState, type)) {
    coreGuiState[type] = on;
  } else {
    return;
  }
  bus.emit("coregui:changed", { type, enabled: on });
}

export function getCoreGuiEnabled(type) {
  if (type === "All") return CORE_GUI_TYPES.every((t) => coreGuiState[t]);
  return coreGuiState[type] !== false;
}

export function setCoreParam(name, value) {
  coreParams[String(name)] = value;
}

export function getCoreParam(name) {
  return Object.prototype.hasOwnProperty.call(coreParams, String(name)) ? coreParams[String(name)] : null;
}

export function resetCoreGui() {
  for (const t of CORE_GUI_TYPES) coreGuiState[t] = true;
  for (const k of Object.keys(coreParams)) delete coreParams[k];
}

export function ensureTextChatDefaults(anchor) {
  const svc = getServiceFrom(anchor, "TextChatService");
  if (!svc) return;
  let channels = svc.findFirstChild("TextChannels");
  if (!channels) channels = createInstance("Folder", { name: "TextChannels", parent: svc });
  let cmds = svc.findFirstChild("TextChatCommands");
  if (!cmds) cmds = createInstance("Folder", { name: "TextChatCommands", parent: svc });
  if (channels && svc.getProperty("CreateDefaultTextChannels") !== false) {
    for (const n of ["RBXGeneral", "RBXTeam", "RBXWhisper", "RBXSystem"]) {
      if (!channels.getChildren().some((c) => c.name === n)) {
        createInstance("TextChannel", { name: n, parent: channels });
      }
    }
  }
  if (cmds && svc.getProperty("CreateDefaultCommands") !== false) {
    const defs = [["RBXTeamCommand", "/team", "/t"], ["RBXMeCommand", "/me", ""], ["RBXHelpCommand", "/help", "/?"]];
    for (const def of defs) {
      if (!cmds.getChildren().some((c) => c.name === def[0])) {
        const cmd = createInstance("TextChatCommand", { name: def[0], parent: cmds });
        if (cmd) { cmd.setProperty("PrimaryAlias", def[1]); cmd.setProperty("SecondaryAlias", def[2]); }
      }
    }
  }
}

function sanitizeChat(text) {
  let s = String(text == null ? "" : text);
  s = s.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > CHAT_MAX_CHARS) s = s.slice(0, CHAT_MAX_CHARS);
  return s;
}

function playerColorCss(player) {
  if (!player) return "#ffffff";
  let team = null;
  try { team = player.getProperty("Team"); } catch (_) { team = null; }
  if (team) return brickCss(team.getProperty("TeamColor"));
  return "#ffffff";
}

function playerName(player) {
  if (!player) return "Player";
  let dn = "";
  try { dn = player.getProperty("DisplayName"); } catch (_) { dn = ""; }
  if (dn) return String(dn);
  return String(player.name || "Player");
}

function routeToTextChannels(player, text, teamOnly) {
  const svc = getServiceFrom(player, "TextChatService");
  if (!svc) return;
  let version = "TextChatService";
  try { version = svc.getProperty("ChatVersion"); } catch (_) { version = "TextChatService"; }
  if (version !== "TextChatService") return;
  const folder = svc.findFirstChild("TextChannels");
  if (!folder) return;
  const wanted = teamOnly ? "RBXTeam" : "RBXGeneral";
  const channels = folder.getChildren().filter((c) => c.className === "TextChannel");
  for (const ch of channels) {
    if (ch.name === wanted) {
      bus.emit("chat:event", { instance: ch, type: "MessageReceived", args: [text] });
    }
  }
}

function tryTextChatCommands(player, raw) {
  const svc = getServiceFrom(player, "TextChatService");
  if (!svc) return false;
  const folder = svc.findFirstChild("TextChatCommands");
  if (!folder) return false;
  const first = raw.split(" ")[0];
  const cmds = folder.getChildren().filter((c) => c.className === "TextChatCommand");
  for (const cmd of cmds) {
    if (cmd.getProperty("Enabled") === false) continue;
    const a = cmd.getProperty("PrimaryAlias");
    const b = cmd.getProperty("SecondaryAlias");
    if (first === a || first === b) {
      bus.emit("chat:event", { instance: cmd, type: "Triggered", args: [player, raw] });
      return true;
    }
  }
  return false;
}

function makeChatManager() {
  let dataModel = null;
  let getLocalPlayer = () => null;
  let host = null;
  let listEl = null;
  let inputWrap = null;
  let inputEl = null;
  let bubbleLayer = null;
  let started = false;
  let inputOpen = false;
  let hovered = false;
  let lastActivity = 0;
  const history = [];
  const rate = new WeakMap();
  const bubbles = new Map();
  const bubblePool = [];
  let onKeyDown = null;

  function ensureHost() {
    if (host || typeof document === "undefined") return;
    const proj = getProjection();
    const mount = proj && proj.container ? proj.container : document.body;
    const posMode = proj && proj.container ? "absolute" : "fixed";
    host = document.createElement("div");
    host.className = "rsw-chat";
    Object.assign(host.style, {
      position: posMode, top: "12px", left: "12px", zIndex: "4300",
      width: "320px", maxWidth: "40vw", display: "flex", flexDirection: "column",
      gap: "4px", font: "12px system-ui, sans-serif", color: "#f2f4f8",
      transition: "opacity 0.4s ease", opacity: "1",
    });
    listEl = document.createElement("div");
    Object.assign(listEl.style, {
      display: "flex", flexDirection: "column", gap: "2px", maxHeight: "34vh",
      overflowY: "auto", padding: "6px 8px", borderRadius: "8px",
      background: "rgba(20, 22, 28, 0.55)", border: "1px solid rgba(255,255,255,0.12)",
      backdropFilter: "blur(2px)",
    });
    inputWrap = document.createElement("div");
    Object.assign(inputWrap.style, { display: "none" });
    inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.maxLength = CHAT_MAX_CHARS;
    inputEl.placeholder = "Pressione Enter para enviar (/help)";
    Object.assign(inputEl.style, {
      width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: "8px",
      border: "1px solid rgba(255,255,255,0.25)", background: "rgba(10,12,16,0.85)",
      color: "#f2f4f8", font: "inherit", outline: "none",
    });
    inputWrap.appendChild(inputEl);
    host.append(listEl, inputWrap);
    host.addEventListener("mouseenter", () => { hovered = true; host.style.opacity = "1"; });
    host.addEventListener("mouseleave", () => { hovered = false; });
    host.addEventListener("click", () => { if (!inputOpen) openInput(""); });
    inputEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { submitInput(); }
      else if (e.key === "Escape") { closeInput(); }
    });
    inputEl.addEventListener("keyup", (e) => { e.stopPropagation(); });
    mount.appendChild(host);
    ensureBubbleLayer();
  }

  function ensureBubbleLayer() {
    const proj = getProjection();
    if (!proj || !proj.container) { bubbleLayer = null; return null; }
    if (bubbleLayer && bubbleLayer.parentNode === proj.container) return bubbleLayer;
    if (bubbleLayer && bubbleLayer.parentNode) bubbleLayer.parentNode.removeChild(bubbleLayer);
    bubbleLayer = document.createElement("div");
    bubbleLayer.className = "rsw-chat-bubbles";
    bubbleLayer.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:35;";
    try {
      const cs = window.getComputedStyle(proj.container);
      if (cs && cs.position === "static") proj.container.style.position = "relative";
    } catch (_) {            }
    proj.container.appendChild(bubbleLayer);
    return bubbleLayer;
  }


  let windowVisible = true;

  function setWindowVisible(v) {
    windowVisible = v !== false;
    ensureHost();
    if (host) host.style.display = windowVisible ? "" : "none";
    if (!windowVisible) closeInput();
  }

  function openInput(prefill) {
    ensureHost();
    if (!inputWrap || !getCoreGuiEnabled("Chat") || !windowVisible) return;
    inputOpen = true;
    inputWrap.style.display = "";
    inputEl.value = prefill || "";
    host.style.opacity = "1";
    try { inputEl.focus(); } catch (_) {            }
  }

  function closeInput() {
    inputOpen = false;
    if (inputWrap) inputWrap.style.display = "none";
    if (inputEl) { try { inputEl.blur(); } catch (_) {            } }
  }

  function submitInput() {
    const text = inputEl ? inputEl.value : "";
    closeInput();
    if (text && text.trim()) sendFromPlayer(getLocalPlayer(), text);
  }

  function appendLine(entry) {
    if (!listEl) return;
    const line = document.createElement("div");
    line.style.wordBreak = "break-word";
    if (entry.kind === "system") {
      line.textContent = entry.text;
      line.style.color = "#ffd24a";
    } else {
      const who = document.createElement("span");
      who.textContent = (entry.teamOnly ? "[Time] " : "") + entry.name + ": ";
      who.style.color = entry.color || "#ffffff";
      who.style.fontWeight = "700";
      const msg = document.createElement("span");
      msg.textContent = entry.text;
      msg.style.color = "#f2f4f8";
      line.append(who, msg);
    }
    listEl.appendChild(line);
    while (listEl.childNodes.length > CHAT_VISIBLE) listEl.removeChild(listEl.firstChild);
    listEl.scrollTop = listEl.scrollHeight;
  }

  function pushEntry(entry) {
    ensureHost();
    if (!getCoreGuiEnabled("Chat")) return;
    history.push(entry);
    while (history.length > CHAT_HISTORY) history.shift();
    appendLine(entry);
    lastActivity = Date.now();
    if (host) host.style.opacity = "1";
  }

  function sendSystem(text) {
    pushEntry({ kind: "system", text: sanitizeChat(text), ts: Date.now() });
  }

  function addBubble(character, text) {
    if (!character) return;
    ensureBubbleLayer();
    if (!bubbleLayer) return;
    let arr = bubbles.get(character);
    if (!arr) { arr = []; bubbles.set(character, arr); }
    while (arr.length >= BUBBLE_MAX_PER_CHAR) {
      const old = arr.shift();
      releaseBubble(old.el);
    }
    const el = acquireBubble();
    el.textContent = text;
    bubbleLayer.appendChild(el);
    arr.push({ el, ts: Date.now() });
    const ch = getServiceFrom(character, "TextChatService");
    if (ch) {
      const folder = ch.findFirstChild("TextChannels");
      if (folder) {
        for (const c of folder.getChildren()) {
          if (c.className === "TextChannel" && c.name === "RBXGeneral") {
            bus.emit("chat:event", { instance: c, type: "OnBubbleAdded", args: [text] });
          }
        }
      }
    }
  }

  function acquireBubble() {
    const el = bubblePool.pop() || document.createElement("div");
    el.style.cssText =
      "position:absolute;transform:translate(-50%,-100%);max-width:200px;padding:4px 9px;" +
      "border-radius:12px;background:rgba(255,255,255,0.85);color:#15171c;" +
      "font:12px system-ui,sans-serif;white-space:normal;word-break:break-word;" +
      "box-shadow:0 1px 4px rgba(0,0,0,0.3);pointer-events:none;";
    el.style.display = "";
    return el;
  }

  function releaseBubble(el) {
    if (!el) return;
    if (el.parentNode) el.parentNode.removeChild(el);
    el.textContent = "";
    if (bubblePool.length < 64) bubblePool.push(el);
  }

  function bubbleChatOn() {
    const players = getServiceFrom(dataModel || (getLocalPlayer() || {}), "Players");
    if (!players) return false;
    try { return players.getProperty("BubbleChat") !== false; } catch (_) { return true; }
  }

  function sendFromPlayer(player, rawText, opts) {
    const o = opts || {};
    let text = sanitizeChat(rawText);
    if (!text) return;
    if (!o.system && player) {
      const now = Date.now();
      const last = rate.get(player) || 0;
      if (now - last < CHAT_RATE_MS) return;
      rate.set(player, now);
    }
    let teamOnly = false;
    let body = text;
    const lower = text.toLowerCase();
    if (lower === "/console") {
      bus.emit("devconsole:open");
      return;
    }
    if (lower === "/help") {
      sendSystem("Comandos: /team (ou /t) mensagem -> chat do time, /e nome -> emote, /console -> Developer Console, /help -> ajuda.");
      return;
    }


    if (lower.startsWith("/e ") || lower.startsWith("/emote ")) {
      const emoteName = text.slice(text.indexOf(" ") + 1).trim().toLowerCase();
      if (emoteName) bus.emit("coregui:emote", { name: emoteName, player });
      return;
    }
    if (lower.startsWith("/team ") || lower.startsWith("/t ")) {
      teamOnly = true;
      body = text.slice(text.indexOf(" ") + 1).trim();
      if (!body) return;
    }
    if (text.startsWith("/") && tryTextChatCommands(player, text)) {
      if (!teamOnly) return;
    }
    const entry = {
      kind: "player", name: playerName(player), color: playerColorCss(player),
      text: body, teamOnly, ts: Date.now(),
    };
    pushEntry(entry);
    if (player) firePlayerEvent(player, "Chatted", [body, o.recipient || undefined]);
    routeToTextChannels(player, body, teamOnly);
    if (bubbleChatOn() && player) {
      let character = null;
      try { character = player.getProperty("Character"); } catch (_) { character = null; }
      if (character) addBubble(character, body);
    }
  }

  function tick() {
    const now = Date.now();
    if (host && !inputOpen && !hovered) {
      host.style.opacity = now - lastActivity > CHAT_FADE_MS ? "0.25" : "1";
    }
    if (!bubbles.size) return;
    const proj = getProjection();
    ensureBubbleLayer();
    for (const [character, arr] of bubbles) {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (now - arr[i].ts > BUBBLE_LIFETIME_MS) {
          releaseBubble(arr[i].el);
          arr.splice(i, 1);
        }
      }
      if (!arr.length) { bubbles.delete(character); continue; }
      const head = character.findFirstChild ? (character.findFirstChild("Head") || character.findFirstChild("HumanoidRootPart")) : null;
      let pos = null;
      if (head && head.getProperty) pos = head.getProperty("Position");
      if (!proj || !proj.project || !pos) { for (const b of arr) b.el.style.display = "none"; continue; }
      const scr = proj.project(pos.x, pos.y + 3, pos.z);
      const farSq = scr && typeof scr.dist === "number" ? scr.dist * scr.dist : Infinity;
      if (!scr || scr.visible === false || farSq > BUBBLE_MAX_DIST_SQ) {
        for (const b of arr) b.el.style.display = "none";
        continue;
      }
      let stackY = scr.y;
      for (let i = arr.length - 1; i >= 0; i--) {
        const b = arr[i];
        b.el.style.display = "";
        b.el.style.left = scr.x + "px";
        b.el.style.top = stackY + "px";
        stackY -= (b.el.offsetHeight || 22) + 4;
      }
    }
  }

  function start(options) {
    if (started) stop();
    started = true;
    dataModel = options.dataModel || null;
    getLocalPlayer = options.getLocalPlayer || (() => null);
    ensureHost();
    onKeyDown = (e) => {
      if (!started || !getCoreGuiEnabled("Chat")) return;
      if (inputOpen) return;
      const ae = document.activeElement;
      const tag = ae && ae.tagName ? ae.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || (ae && ae.isContentEditable)) return;
      if (e.key === "/" || e.code === "Slash" || e.code === "NumpadDivide") {
        e.preventDefault();
        openInput("");
      }
    };
    if (typeof window !== "undefined") window.addEventListener("keydown", onKeyDown, true);
    sendSystem("Chat pronto. Pressione / para conversar (/help para comandos).");
  }

  function stop() {
    started = false;
    closeInput();
    if (onKeyDown && typeof window !== "undefined") window.removeEventListener("keydown", onKeyDown, true);
    onKeyDown = null;
    for (const [, arr] of bubbles) for (const b of arr) releaseBubble(b.el);
    bubbles.clear();
    if (bubbleLayer && bubbleLayer.parentNode) bubbleLayer.parentNode.removeChild(bubbleLayer);
    bubbleLayer = null;
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null; listEl = null; inputWrap = null; inputEl = null;
    windowVisible = true;                                                        
    history.length = 0;
    lastActivity = 0;
    dataModel = null;
    getLocalPlayer = () => null;
  }

  return {
    start, stop, tick, sendFromPlayer, sendSystem,
    isTyping: () => inputOpen,

    setWindowVisible,
    isWindowVisible: () => windowVisible,
  };
}

export const chat = makeChatManager();

function leaderstatsSummary(player) {
  if (!player || typeof player.findFirstChild !== "function") return "";
  const folder = player.findFirstChild("leaderstats");
  if (!folder || (folder.className !== "Folder" && folder.className !== "Model")) return "";
  const parts = [];
  for (const c of folder.getChildren()) {
    let v = "";
    try { v = c.getProperty("Value"); } catch (_) { v = ""; }
    if (v != null) parts.push(c.name + ": " + String(v));
    if (parts.length >= 3) break;
  }
  return parts.join("  ·  ");
}

export function createTeamsLeaderboardHud() {
  let host = null;
  let body = null;
  let lastSig = "";
  const expanded = new Set();
  const rows = new Map();

  function ensureHost() {
    if (host || typeof document === "undefined") return;
    host = document.createElement("div");
    host.className = "rsw-teams-board";
    Object.assign(host.style, {
      position: "fixed", top: "12px", right: "12px", zIndex: "4250",
      minWidth: "170px", maxWidth: "260px", display: "none", padding: "6px",
      borderRadius: "8px", background: "rgba(18, 20, 26, 0.72)",
      border: "1px solid rgba(255,255,255,0.16)", backdropFilter: "blur(2px)",
      font: "12px system-ui, sans-serif", color: "#f2f4f8",
    });
    body = document.createElement("div");
    Object.assign(body.style, { display: "flex", flexDirection: "column", gap: "3px" });
    host.appendChild(body);
    document.body.appendChild(host);
  }

  function hide() { if (host) host.style.display = "none"; }

  function rebuild(teams) {
    rows.clear();
    body.replaceChildren();
    for (const team of teams) {
      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex", flexDirection: "column", gap: "2px", padding: "3px 4px",
        borderRadius: "6px", cursor: "pointer", background: "rgba(255,255,255,0.04)",
      });
      const headRow = document.createElement("div");
      Object.assign(headRow.style, { display: "flex", alignItems: "center", gap: "6px" });
      const swatch = document.createElement("span");
      Object.assign(swatch.style, { width: "10px", height: "10px", borderRadius: "2px", flex: "0 0 auto" });
      swatch.style.background = brickCss(team.getProperty("TeamColor"));
      const nameEl = document.createElement("span");
      nameEl.textContent = team.name;
      Object.assign(nameEl.style, { fontWeight: "700", flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
      const scoreEl = document.createElement("span");
      Object.assign(scoreEl.style, { fontVariantNumeric: "tabular-nums", opacity: "0.9" });
      const playersEl = document.createElement("div");
      Object.assign(playersEl.style, { display: "none", flexDirection: "column", gap: "1px", paddingLeft: "16px", fontSize: "11px", opacity: "0.85" });
      headRow.append(swatch, nameEl, scoreEl);
      row.append(headRow, playersEl);
      const key = team.id || team.name;
      row.addEventListener("click", () => {
        if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      });
      body.appendChild(row);
      rows.set(team, { scoreEl, playersEl, nameEl, swatch, lastScore: null, lastPlayers: "", key });
    }
  }

  function update(localPlayer, anchor) {
    const teams = listTeams(anchor || localPlayer);
    if (!teams.length) { hide(); lastSig = ""; return false; }
    ensureHost();
    if (!host) return false;
    if (!getCoreGuiEnabled("PlayerList")) { hide(); return false; }
    const sig = teams.map((t) => (t.id || t.name) + ":" + t.name).join("|");
    if (sig !== lastSig) { rebuild(teams); lastSig = sig; }
    for (const team of teams) {
      const r = rows.get(team);
      if (!r) continue;
      const score = Number(team.getProperty("Score")) || 0;
      if (r.lastScore !== score) { r.scoreEl.textContent = String(score); r.lastScore = score; }
      r.swatch.style.background = brickCss(team.getProperty("TeamColor"));
      r.nameEl.textContent = team.name;
      const open = expanded.has(r.key);
      r.playersEl.style.display = open ? "flex" : "none";
      if (open) {
        const players = teamPlayers(team);
        const desc = players.map((pl) => {
          const s = leaderstatsSummary(pl);
          return playerName(pl) + (s ? "  (" + s + ")" : "");
        }).join("\n");
        if (desc !== r.lastPlayers) {
          r.playersEl.replaceChildren();
          for (const pl of players) {
            const li = document.createElement("div");
            const s = leaderstatsSummary(pl);
            li.textContent = playerName(pl) + (s ? "  (" + s + ")" : "");
            r.playersEl.appendChild(li);
          }
          r.lastPlayers = desc;
        }
      }
    }
    host.style.display = "";
    return true;
  }

  function destroy() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null; body = null; lastSig = ""; rows.clear(); expanded.clear();
  }

  return { update, destroy };
}

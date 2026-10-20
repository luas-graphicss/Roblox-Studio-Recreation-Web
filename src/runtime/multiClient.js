import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { engine, RuntimeEvents } from "./engine.js";
import { playtest } from "./playtest.js";
import { createInstance, getService } from "../datamodel/index.js";

export const MAX_CLIENTS = 8;

let desired = 1;
let sessions = [];
let activeId = 1;
let wired = false;

function emitChanged() {
  bus.emit("multiclient:changed", { count: sessions.length, activeId });
}

function cloneChildrenInto(container, target, out) {
  if (!container || !target) return;
  for (const ch of container.getChildren()) {
    let c = null;
    try { c = ch.clone(); } catch (_) { c = null; }
    if (!c) continue;
    c.setParent(target);
    if (out) out.push(c);
  }
}

function collectLocalScripts(roots) {
  const found = [];
  for (const root of roots || []) {
    if (!root) continue;
    const all = [root].concat(root.getDescendants ? root.getDescendants() : []);
    for (const inst of all) {
      const isLocal = inst.className === "LocalScript";

      const isClientRc = inst.className === "Script" && inst.hasProperty("RunContext")
        && inst.getProperty("RunContext") === "Client";
      if (!isLocal && !isClientRc) continue;
      if (inst.hasProperty("Disabled") && inst.getProperty("Disabled") === true) continue;
      found.push(inst);
    }
  }
  return found;
}

function makePlaytestApi(session) {
  return {
    getLocalPlayer: () => session.player,
    getCharacter: () => session.character || null,
    createLocalPlayer: () => session.player,
    loadCharacter: () => session.character || null,
  };
}

function spawnExtra(index) {
  const dm = engine.getDataModel();
  const players = dm ? getService(dm, "Players") : null;
  if (!players) return null;
  const player = createInstance("Player", { name: "Player" + index, parent: players });
  if (!player) return null;
  try { player.setProperty("UserId", index); } catch (_) {            }
  const playerGui = createInstance("PlayerGui", { name: "PlayerGui", parent: player });
  const backpack = createInstance("Backpack", { name: "Backpack", parent: player });
  createInstance("StarterGear", { name: "StarterGear", parent: player });
  const playerScripts = createInstance("PlayerScripts", { name: "PlayerScripts", parent: player });
  const cloned = [];
  const sp = getService(dm, "StarterPlayer");
  cloneChildrenInto(sp && sp.findFirstChild ? sp.findFirstChild("StarterPlayerScripts") : null, playerScripts, cloned);
  cloneChildrenInto(getService(dm, "StarterGui"), playerGui, cloned);
  cloneChildrenInto(getService(dm, "StarterPack"), backpack, cloned);
  const session = {
    id: index,
    name: "Client " + index,
    player,
    character: null,
    env: null,
    status: "loading",
    minimized: false,
  };
  session.env = engine.startExtraClient(makePlaytestApi(session));
  bus.emit("playtest:playerAdded", { player });
  if (session.env) engine.runScriptsIn(session.env, collectLocalScripts(cloned));
  setTimeout(() => {
    if (session.status === "loading") {
      session.status = "connected";
      emitChanged();
    }
  }, 350);
  logger.info(session.name + " conectado (" + player.name + " em Players).", { source: "Playtest" });
  return session;
}

function cleanup() {
  let had = sessions.length > 0;
  for (const s of sessions) {
    if (s.env) {
      try { engine.stopExtraClient(s.env); } catch (_) {            }
      s.env = null;
    }
  }
  sessions = [];
  activeId = 1;
  if (had) emitChanged();
}

function wire() {
  if (wired) return;
  wired = true;
  bus.on(RuntimeEvents.ModeChanged, () => {
    if (!engine.isRunning()) cleanup();
  });
}

export const multiClient = {
  MAX_CLIENTS,

  getPlayerCount: () => desired,

  setPlayerCount(n) {
    const v = Math.max(1, Math.min(MAX_CLIENTS, Math.floor(Number(n) || 1)));
    if (v !== desired) {
      desired = v;
      emitChanged();
    }
    return desired;
  },

  getSessions: () => sessions.slice(),

  getSession(id) {
    return sessions.find((s) => s.id === id) || null;
  },

  getActiveId: () => activeId,

  setActive(id) {
    const s = this.getSession(id);
    if (!s || s.status === "disconnected" || activeId === id) return false;
    activeId = id;
    bus.emit("multiclient:activeChanged", { id });
    emitChanged();
    return true;
  },

  setMinimized(id, v) {
    const s = this.getSession(id);
    if (!s) return;
    s.minimized = v === true;
    emitChanged();
  },

  isMultiRunning: () => engine.isRunning() && sessions.length > 0,

  start() {
    wire();
    if (engine.isRunning()) engine.stop();
    sessions = [];
    activeId = 1;
    engine.play();
    if (!engine.isRunning() || engine.getMode() !== "play") {
      emitChanged();
      return false;
    }
    sessions.push({
      id: 1,
      name: "Client 1",
      player: typeof playtest.getLocalPlayer === "function" ? playtest.getLocalPlayer() : null,
      character: typeof playtest.getCharacter === "function" ? playtest.getCharacter() : null,
      env: null,
      status: "connected",
      minimized: false,
    });
    for (let i = 2; i <= desired; i++) {
      const s = spawnExtra(i);
      if (s) sessions.push(s);
    }
    if (desired > 1) {
      logger.info("Playtest multi-cliente: " + sessions.length + " cliente(s) simultaneo(s) (Server unico em paralelo).", { source: "Playtest" });
    }
    emitChanged();
    return true;
  },

  disconnect(id) {
    const s = this.getSession(id);
    if (!s || s.status === "disconnected") return false;
    s.status = "disconnected";
    bus.emit("playtest:playerRemoving", { player: s.player });
    if (s.env) {
      try { engine.stopExtraClient(s.env); } catch (_) {            }
      s.env = null;
    }
    if (id !== 1 && s.player) {
      try {
        if (typeof s.player.destroy === "function") s.player.destroy();
        else s.player.setParent(null);
      } catch (_) {            }
    }
    logger.info(s.name + " desconectado - Players.PlayerRemoving disparado no Server.", { source: "Playtest" });
    if (activeId === id) {
      const next = sessions.find((x) => x.status !== "disconnected");
      if (next) activeId = next.id;
    }
    emitChanged();
    return true;
  },
};

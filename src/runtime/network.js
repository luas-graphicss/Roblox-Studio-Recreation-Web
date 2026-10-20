import { logger as baseLogger } from "../core/logger.js";

import { registerFrameCallback } from "../core/frameDriver.js";
import { LuaTable, LuaError, LuaFunction } from "./lua/interpreter.js";
import { profiler } from "../core/profiler.js";

export const LATENCY_OPTIONS = Object.freeze([0, 50, 100, 200, 500]);
export const PACKET_LOSS_OPTIONS = Object.freeze([0, 1, 5, 10]);


const settings = { latencyMs: 0, packetLossPct: 0, debug: false, filteringEnabled: true };

const counters = { bytesSent: 0, bytesReceived: 0, packetsSent: 0, packetsReceived: 0, packetsDropped: 0, remoteEvents: 0, remoteFunctions: 0 };

function payloadSize(args) {
  let n = 24;
  for (const a of args || []) n += typeof a === "string" ? a.length + 8 : 16;
  return n;
}

export function getNetworkSettings() {
  return { ...settings };
}

export function setNetworkSetting(key, value) {
  if (key === "filteringEnabled") {
    settings.filteringEnabled = value === true;
    return;
  }
  if (key === "latencyMs") {
    settings.latencyMs = LATENCY_OPTIONS.includes(Number(value)) ? Number(value) : 0;
  } else if (key === "packetLossPct") {
    settings.packetLossPct = PACKET_LOSS_OPTIONS.includes(Number(value)) ? Number(value) : 0;
  } else if (key === "debug") {
    settings.debug = value === true;
  }
  return { ...settings };
}


const MAX_DEPTH = 16;
const MAX_NODES = 2000;
const MAX_STRING = 16384;
const RATE_LIMIT_PER_SEC = 60;
const RATE_WARN_COOLDOWN_MS = 2000;


let active = false;
let opts = {};
let log = baseLogger;
let unregisterFrameCallback = null;
let queue = [];                                                   
const remoteSignals = new Map();                                                        
const invokeCallbacks = new Map();                                                
const rateState = new Map();                                              

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function netLog(msg) {
  if (!settings.debug) return;
  log.info(msg, { context: "Network" });
}

function sideName(side) {
  return side === "client" ? "Client" : "Server";
}

function argCountText(n) {
  return `${n} arg${n === 1 ? "" : "s"}`;
}


function failArg(what) {
  throw new LuaError(
    `Argumento não serializável em chamada remota: ${what}. Apenas nil, boolean, number, string, tabelas sem ciclos, Instances e datatypes (Vector3, Color3...) podem ser enviados.`,
  );
}

const ALLOWED_UD = new Set(["Vector3", "Vector2", "Color3", "CFrame", "UDim", "UDim2", "EnumItem"]);

function copyValue(v, depth, seen, state) {
  if (v === undefined || v === null) return v;
  const t = typeof v;
  if (t === "boolean" || t === "number") return v;
  if (t === "string") {
    if (v.length > MAX_STRING) {
      throw new LuaError(`String muito grande para envio remoto (máx ${MAX_STRING} caracteres).`);
    }
    return v;
  }
  if (t === "function") failArg("função JS");
  if (t !== "object") failArg(t);

  if (v instanceof LuaFunction || v.__native === true) failArg("function");

  if (typeof Node !== "undefined" && v instanceof Node) failArg("objeto DOM");
  if (v.__isInstance === true) {


    if (v.__streamStale === true) return undefined;
    return v;                                           
  }
  if (typeof v.__ud === "string") {
    if (!ALLOWED_UD.has(v.__ud)) failArg(v.__ud);
    return { ...v };
  }
  if (v instanceof LuaTable) {
    if (depth >= MAX_DEPTH) throw new LuaError("Tabela profunda demais para envio remoto.");
    if (seen.has(v)) {
      throw new LuaError("Tabela com referência circular não pode ser enviada por um remote.");
    }
    seen.add(v);
    const copy = new LuaTable();
    for (const [k, val] of v.map) {
      state.nodes++;
      if (state.nodes > MAX_NODES) {
        throw new LuaError(`Payload remoto grande demais (máx ${MAX_NODES} valores).`);
      }
      if (typeof k !== "string" && typeof k !== "number" && typeof k !== "boolean") {
        failArg("chave de tabela não serializável");
      }
      copy.rawset(k, copyValue(val, depth + 1, seen, state));
    }
    seen.delete(v);
    return copy;
  }
  return failArg("objeto desconhecido");
}


export function sanitizeRemoteArgs(args) {
  const state = { nodes: 0 };
  const seen = new Set();
  const out = [];
  for (const v of args || []) out.push(copyValue(v, 0, seen, state));
  return out;
}


function rateAllow(inst, dir) {
  let m = rateState.get(inst);
  if (!m) {
    m = {};
    rateState.set(inst, m);
  }
  const now = nowMs();
  let s = m[dir];
  if (!s || now - s.t0 >= 1000) {
    s = { count: 0, t0: now, warnedAt: s ? s.warnedAt : 0 };
    m[dir] = s;
  }
  s.count++;
  if (s.count <= RATE_LIMIT_PER_SEC) return true;
  if (now - (s.warnedAt || 0) > RATE_WARN_COOLDOWN_MS) {
    s.warnedAt = now;
    log.warn(
      `Rate limit: "${inst.name}" excedeu ${RATE_LIMIT_PER_SEC} chamadas/s (${dir}); chamadas extras foram descartadas.`,
      { context: "Network" },
    );
  }
  return false;
}

function dropPacket() {
  if (settings.filteringEnabled === false) return false;
  const drop = settings.packetLossPct > 0 && Math.random() * 100 < settings.packetLossPct;
  if (drop) counters.packetsDropped++;
  return drop;
}


function enqueue(fn) {
  const run = () => {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    fn();
    profiler.report("network", (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0, "delivery");
    counters.packetsReceived++;
    counters.bytesReceived += counters.packetsSent > 0 ? Math.round(counters.bytesSent / counters.packetsSent) : 32;
  };
  queue.push({ at: nowMs() + (settings.filteringEnabled === false ? 0 : settings.latencyMs), fn: run });
}


function deliverDuePackets() {
  if (!active) return;
  const paused = typeof opts.isPaused === "function" && opts.isPaused();
  if (!paused && queue.length) {
    const now = nowMs();
    const remaining = [];
    for (const item of queue) {
      if (item.at <= now) {
        try {
          item.fn();
        } catch (e) {
          log.error("Erro ao entregar pacote simulado: " + ((e && e.message) || e), { context: "Network" });
        }
      } else {
        remaining.push(item);
      }
    }
    queue = remaining;
  }
}

function getInvokeCallbackInternal(inst, side) {
  const rec = invokeCallbacks.get(inst);
  return rec ? rec[side] || undefined : undefined;
}


export const network = {
  start(options = {}) {
    active = true;
    opts = options;
    log = options.logger || baseLogger;
    queue = [];
    remoteSignals.clear();
    invokeCallbacks.clear();
    rateState.clear();
    if (!unregisterFrameCallback) {
      unregisterFrameCallback = registerFrameCallback("simulation", deliverDuePackets, "network:delivery");
    }
  },

  stop() {
    active = false;
    if (unregisterFrameCallback) {
      unregisterFrameCallback();
      unregisterFrameCallback = null;
    }
    queue = [];
    remoteSignals.clear();
    invokeCallbacks.clear();
    rateState.clear();
    opts = {};
    log = baseLogger;
  },

  isActive: () => active,


  registerRemoteSignal(inst, side, sig, getLocalPlayer) {
    let rec = remoteSignals.get(inst);
    if (!rec) {
      rec = { server: null, clients: new Map() };
      remoteSignals.set(inst, rec);
    }
    if (side === "client") {
      rec.clients.set(sig, typeof getLocalPlayer === "function" ? getLocalPlayer : null);
    } else {
      rec.server = sig;
    }
  },

  setInvokeCallback(inst, side, fn) {
    let rec = invokeCallbacks.get(inst);
    if (!rec) {
      rec = { server: null, client: null };
      invokeCallbacks.set(inst, rec);
    }
    rec[side] = fn || null;
  },

  getInvokeCallback(inst, side) {
    return getInvokeCallbackInternal(inst, side);
  },


  fireServer(inst, player, args) {
    if (!active) return;
    if (!rateAllow(inst, "Client→Server")) return;
    netLog(`Client → Server RemoteEvent "${inst.name}" fired with ${argCountText(args.length)}`);
    if (dropPacket()) {
      netLog(`RemoteEvent "${inst.name}": pacote descartado (Simulated Packet Loss)`);
      return;
    }
    enqueue(() => {
      const rec = remoteSignals.get(inst);
      if (rec && rec.server) rec.server.fire([player, ...args]);
    });
  },


  fireClient(inst, player, args, all) {
    if (!active) return;
    if (!rateAllow(inst, "Server→Client")) return;
    netLog(`Server → ${all ? "All Clients" : "Client"} RemoteEvent "${inst.name}" fired with ${argCountText(args.length)}`);
    if (dropPacket()) {
      netLog(`RemoteEvent "${inst.name}": pacote descartado (Simulated Packet Loss)`);
      return;
    }
    enqueue(() => {
      const rec = remoteSignals.get(inst);
      if (!rec || rec.clients.size === 0) return;
      for (const [sig, getLp] of rec.clients) {
        if (typeof getLp === "function") {
          let lp = null;
          try { lp = getLp(); } catch (_) { lp = null; }

          if (!lp || (typeof lp.isDestroyed === "function" && lp.isDestroyed())) continue;

          if (!all && player && lp !== player) continue;
        }
        sig.fire(args.slice());
      }
    });
  },


  invoke(inst, targetSide, args, callerPlayer) {
    const ticket = {
      done: false,
      results: null,
      error: null,
      cancelled: false,
      cancel() {
        this.cancelled = true;
      },
    };
    if (!active) {
      ticket.error = "Rede simulada indisponível (Playtest encerrado).";
      ticket.done = true;
      return ticket;
    }
    const dirText = targetSide === "server" ? "Client → Server" : "Server → Client";
    const cbName = targetSide === "server" ? "OnServerInvoke" : "OnClientInvoke";
    if (!rateAllow(inst, dirText)) {
      ticket.error = `RemoteFunction "${inst.name}": rate limit excedido — chamada descartada.`;
      ticket.done = true;
      return ticket;
    }
    netLog(`${dirText} RemoteFunction "${inst.name}" invoked with ${argCountText(args.length)}`);
    if (dropPacket()) {
      enqueue(() => {
        ticket.error = `RemoteFunction "${inst.name}": pacote perdido (Simulated Packet Loss).`;
        ticket.done = true;
      });
      return ticket;
    }
    enqueue(() => {
      if (ticket.cancelled) return;
      const env = typeof opts.getEnv === "function" ? opts.getEnv(targetSide) : null;
      const cb = getInvokeCallbackInternal(inst, targetSide);
      if (!env) {
        ticket.error = `RemoteFunction "${inst.name}": contexto ${sideName(targetSide)} indisponível.`;
        ticket.done = true;
        return;
      }
      if (!cb) {
        ticket.error = `RemoteFunction "${inst.name}": ${cbName} não está definido no ${sideName(targetSide)}.`;
        ticket.done = true;
        return;
      }
      const callArgs = targetSide === "server" ? [callerPlayer, ...args] : args.slice();

      const gen = (function* () {
        let res;
        try {
          res = yield* env.interp.call(cb, callArgs, 0);
        } catch (e) {
          const msg = (e && e.message) || String(e);
          try {
            env.logger.error(`RemoteFunction "${inst.name}" (${cbName}): ${msg}`);
          } catch (_) {            }
          ticket.error = `RemoteFunction "${inst.name}": erro no ${cbName} — ${msg}`;
          ticket.done = true;
          return;
        }
        let out;
        try {
          out = sanitizeRemoteArgs(res || []);
        } catch (e) {
          ticket.error = `RemoteFunction "${inst.name}": retorno não serializável — ${(e && e.message) || e}`;
          ticket.done = true;
          return;
        }

        enqueue(() => {
          if (!ticket.cancelled) ticket.results = out;
          ticket.done = true;
        });
      })();
      env.scheduler.spawnGen(gen, { name: `Remote:${inst.name}` });
    });
    return ticket;
  },
};


export function getNetCounters() {
  return {
    ...counters,
    queueSize: queue.length,
    latencyMs: settings.latencyMs,
    packetLossPct: settings.packetLossPct,
    filteringEnabled: settings.filteringEnabled !== false,
  };
}


const MAX_REMOTE_STATS = 200;
const remoteStats = new Map();

function recordRemote(inst, dir, bytes, kind) {
  const name = inst && inst.name ? String(inst.name) : "Remote";
  let r = remoteStats.get(name);
  if (!r) {
    if (remoteStats.size >= MAX_REMOTE_STATS) return;
    r = { name, kind, calls: 0, bytes: 0, toServer: 0, toClient: 0 };
    remoteStats.set(name, r);
  }
  r.calls++;
  r.bytes += bytes;
  if (dir === "toServer") r.toServer++;
  else r.toClient++;
}

export function getRemoteStats() {
  return [...remoteStats.values()].map((r) => ({ ...r }));
}

export function resetRemoteStats() {
  remoteStats.clear();
}

const _origFireServer = network.fireServer;
const _origFireClient = network.fireClient;
const _origInvoke = network.invoke;

network.fireServer = function (...a) {
  counters.remoteEvents++;
  counters.packetsSent++;
  const size = payloadSize(a[2]);
  counters.bytesSent += size;
  recordRemote(a[0], "toServer", size, "RemoteEvent");
  return _origFireServer.apply(network, a);
};

network.fireClient = function (...a) {
  counters.remoteEvents++;
  counters.packetsSent++;
  const size = payloadSize(a[2]);
  counters.bytesSent += size;
  recordRemote(a[0], "toClient", size, "RemoteEvent");
  return _origFireClient.apply(network, a);
};

network.invoke = function (...a) {
  counters.remoteFunctions++;
  counters.packetsSent++;
  const size = payloadSize(a[2]);
  counters.bytesSent += size;
  recordRemote(a[0], a[1] === "server" ? "toServer" : "toClient", size, "RemoteFunction");
  return _origInvoke.apply(network, a);
};

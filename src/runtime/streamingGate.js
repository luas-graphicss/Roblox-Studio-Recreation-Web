import { streaming } from "./streaming.js";
import { LuaTable } from "./lua/interpreter.js";

export function createStreamGate(options) {
  const opts = options || {};
  const api = opts.streamingApi || streaming;
  const isClient = opts.context === "client";
  const getLocalPlayer = typeof opts.getLocalPlayer === "function" ? opts.getLocalPlayer : () => null;
  let cachedId = null;

  function clientId() {
    if (cachedId != null) return cachedId;
    try {
      const lp = getLocalPlayer();
      const id = lp ? api.clientIdForPlayer(lp) : null;
      if (id != null) cachedId = id;
      return id;
    } catch (_) {
      return null;
    }
  }

  function loadedHere(node) {
    if (!isClient) return true;


    if (node && node.__streamStale === true) return false;
    try {
      if (!api.isStreamingActive()) return true;
      const id = clientId();
      return id == null ? true : api.isLoadedFor(id, node);
    } catch (_) {
      return true;
    }
  }

  function isHusk(inst) {
    if (!isClient) return false;
    if (!inst || inst.__isInstance !== true) return false;
    return !loadedHere(inst);
  }

  function gateSignal(sig, inst) {
    if (!isClient || !sig || typeof sig.fire !== "function") return sig;
    if (!inst || inst.__isInstance !== true) return sig;
    const rawFire = sig.fire.bind(sig);
    sig.fire = (args) => {
      if (!loadedHere(inst)) return;
      rawFire(args);
    };


    if (typeof sig.connect === "function") sig.connGen = () => genOf(inst);
    return sig;
  }

  const staleCache = new WeakMap();                                   


  function genOf(inst) {
    if (!isClient || !inst || inst.__isInstance !== true) return 0;
    if (inst.__streamStale === true) return 0;
    try {
      const id = clientId();
      if (id == null || typeof api.genFor !== "function") return 0;
      return api.genFor(id, inst) || 0;
    } catch (_) {
      return 0;
    }
  }


  function staleFacade(inst, gen) {
    let byGen = staleCache.get(inst);
    if (!byGen) { byGen = new Map(); staleCache.set(inst, byGen); }
    let f = byGen.get(gen);
    if (f) return f;
    f = Object.create(inst);
    Object.defineProperties(f, {
      __streamStale: { value: true },
      __streamStaleOf: { value: inst },
      __streamStaleGen: { value: gen },
      getParent: { value: () => null },
      getChildren: { value: () => [] },
      getDescendants: { value: () => [] },
      findFirstChild: { value: () => null },
      findByPath: { value: () => null },
      setParent: { value: () => false },
      destroy: { value: () => false },
    });
    byGen.set(gen, f);
    return f;
  }


  function receiveMap(v, depth) {
    if (!v || typeof v !== "object") return v;
    if (v.__isInstance === true) return loadedHere(v) ? v : undefined;
    if (v instanceof LuaTable && depth < 24) {
      const copy = new LuaTable();
      for (const [k, val] of v.map) {
        const m = receiveMap(val, depth + 1);
        if (m !== undefined) copy.rawset(k, m);
      }
      return copy;
    }
    return v;
  }

  function receiveArgs(args) {
    if (!isClient) return args || [];
    return (args || []).map((v) => receiveMap(v, 0));
  }

  const identityHook = { genOf, staleFacade };


  return { isClient, clientId, loadedHere, isHusk, gateSignal, genOf, staleFacade, receiveArgs, identityHook };
}

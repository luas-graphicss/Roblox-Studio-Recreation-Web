import {
  LuaTable,
  LuaFunction,
  LuaError,
  luaToDisplay,
  luaTypeName,
} from "./interpreter.js";
import { LUA } from "./luau/luauModule.js";
import {
  LuauState,
  WasmLuaTable,
  WasmLuaFunction,
  WasmLuaThread,
  WasmOpaque,
  FN,
} from "./luau/luauState.js";


const NATIVE_GLOBALS = new Set([
  "math", "string", "table", "os", "coroutine", "utf8", "buffer", "bit32",
  "vector", "pairs", "ipairs", "next", "select", "rawget", "rawset",
  "rawequal", "rawlen", "setmetatable", "getmetatable", "unpack", "pcall",
  "xpcall", "type", "typeof", "tostring", "tonumber", "assert", "error",
  "newproxy", "load", "gcinfo", "_G", "_VERSION",
]);

function isDynamicGlobalValue(v) {
  if (!v || typeof v !== "object") return false;
  if (v instanceof LuaTable) {
    return !!(v.__wasm || v.metatable || typeof v.__ud === "string");
  }
  if (v.__native || v instanceof LuaFunction) return false;
  return true;
}

class FacadeGlobals extends LuaTable {
  constructor(interp) {
    super();
    this.__interp = interp;
  }
  rawset(name, value) {
    super.rawset(name, value);
    if (typeof name === "string" && isDynamicGlobalValue(value)) {
      this.__interp._markDynamicGlobal(name);
    }
    if (typeof name === "string" && NATIVE_GLOBALS.has(name)) return;
    this.__interp._state.setGlobal(name, value);
  }
  rawget(name) {
    const local = super.rawget(name);
    if (local !== undefined) return local;
    return this.__interp._state.getGlobal(name);
  }
}

function normalize(ret) {
  if (Array.isArray(ret)) return ret;
  if (ret === undefined) return [];
  return [ret];
}

const stateFinalizer = new FinalizationRegistry((state) => {
  try { state.close(); } catch (_) {                            }
});


export function stepPauseDecision(session, hit) {
  if (!session || !hit || session.T !== hit.T || !hit.chunk) return false;
  const samePos = hit.depth === session.depth && hit.line === session.line && hit.chunk === session.chunk;
  if (session.mode === "into") return !samePos;
  if (session.mode === "over") return hit.depth <= session.depth && !samePos;
  if (session.mode === "out") return hit.depth < session.depth;
  return false;
}


export function coroutineStepPauseDecision(session, hit, ctx) {
  if (!session || !session.multi || !hit || !hit.chunk) return false;
  if (!ctx || !ctx.driveOwned) return false;
  if (hit.T === session.T) return false;
  if (session.mode === "into") return true;
  if (session.mode === "over" || session.mode === "out") return !ctx.sessionThreadRunnable;
  return false;
}


export function frameAssignmentTarget(text, names) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*[A-Za-z_][A-Za-z0-9_]*\s*)*(?:\+|-|\*|\/{1,2}|%|\^|\.\.)?=(?!=)/.exec(String(text || ""));
  if (!m) return null;
  return names && typeof names.has === "function" && names.has(m[1]) ? m[1] : null;
}

export class WasmInterpreter {
  constructor(luauModule, options = {}) {
    this._state = new LuauState(luauModule, {
      facade: this,
      sliceBudgetMs: options.sliceBudgetMs || 12,
      onPanic: (code) => {
        if (this._logger) this._logger.error("Luau VM panic (" + code + ")");
      },
    });
    stateFinalizer.register(this, this._state, this);
    this._logger = options.logger || null;
    this.isWasm = true;
    this.engineName = "Luau VM (WASM)";
    this.globals = new FacadeGlobals(this);
    this.bridge = options.bridge || null;
    this.sliceBudget = options.sliceBudget || 4000;
    this.steps = 0;
    this.totalSteps = 0;
    this.currentThread = null;
    this._debug = null;
    this._debugWarned = false;
    this._debugActive = false;
    this._evalActive = false;
    this._stepSession = null;
    this._driveStack = [];
    this._chunks = new Set();
    this._chunksBySource = new Map();
    this._state.onDebugBreak = (L, line, isStep, srcPtr) => this._onVmBreak(L, line, isStep, srcPtr);
    this._state.onThreadSpawned = (parentPtr, threadPtr) => this._onThreadSpawned(parentPtr, threadPtr);
    this._disposed = false;
    this._dynamicGlobals = new Set(["game", "Game", "workspace", "Workspace", "script", "plugin", "shared"]);
    this._dynamicGlobalsDirty = true;

    this._installVMGlobals();
  }




  setIdentityHook(hook) {
    if (!this._disposed) this._state.setIdentityHook(hook);
  }

  get debug() {
    return this._debug;
  }

  set debug(adapter) {
    this._debug = adapter;
    if (adapter && !this._state.debugSupported && !this._debugWarned) {
      this._debugWarned = true;
      if (this._logger) {
        this._logger.warn(
          "Esta build da VM Luau (WASM) não expõe a API de debug — recompile o .wasm com tools/luau-wasm/build.cmd (Parte 76) para breakpoints.",
        );
      }
    }
  }

  get debugCapable() {
    return !this._disposed && this._state.debugSupported;
  }

  debugSetActive(active) {
    const want = !!active && this._state.debugSupported && !this._disposed;
    this._debugActive = want;
    if (!want) this.debugCancelStep();
    this._syncBreakpoints();
  }

  _syncBreakpoints() {
    if (this._disposed || !this._state.debugSupported) return;
    for (const chunk of this._chunks) this._syncChunk(chunk);
  }

  _syncChunk(chunk) {
    const adapter = this._debug;
    let lines = [];
    if (this._debugActive && adapter && typeof adapter.linesFor === "function" && chunk.script) {
      try { lines = adapter.linesFor(chunk.script) || []; } catch (_) { lines = []; }
    }
    const want = new Set(lines);
    for (const [jsLine, vmLine] of [...chunk.applied]) {
      if (!want.has(jsLine)) {
        try { this._state.setFunctionBreakpoint(chunk.funcRef, vmLine, false); } catch (_) {                                    }
        chunk.applied.delete(jsLine);
      }
    }
    for (const jsLine of want) {
      if (!chunk.applied.has(jsLine)) {
        try {
          const vmLine = this._state.setFunctionBreakpoint(chunk.funcRef, jsLine, true);
          if (vmLine >= 0) chunk.applied.set(jsLine, vmLine);
        } catch (_) {                                      }
      }
    }
  }

  debugCancelStep() {
    const s = this._stepSession;
    this._stepSession = null;
    if (s && !this._disposed && !this._state.closed) {
      if (s.multi) {
        try { this._state.setSingleStepAll(false); } catch (_) {                      }
      } else {
        try { this._state.setSingleStep(s.T, false); } catch (_) {                            }
      }
    }
  }

  _beginStep(th, dbg, mode) {
    if (this._disposed || !this._state.debugSupported) return false;
    const T = (dbg && dbg.T) || th.T;
    let depth = 0;
    try { depth = this._state.stackDepth(T); } catch (_) { return false; }
    this.debugCancelStep();
    try { this._state.setSingleStep(T, true); } catch (_) { return false; }


    const multi = this._state.debugStepInCoroutinesSupported;
    if (multi) {
      try { this._state.setSingleStepAll(true); } catch (_) {                      }
    }
    this._stepSession = { T, chunk: dbg ? dbg.chunk : null, mode, depth, line: dbg ? dbg.line : 0, ownerT: th.T, multi };
    return true;
  }

  _onThreadSpawned(parentPtr, threadPtr) {
    if (this._disposed || this._evalActive) return;
    const s = this._stepSession;
    if (s && s.multi) {
      try { this._state.setSingleStep(threadPtr, true); } catch (_) {                      }
    }
  }

  _sessionThreadRunnable(s) {
    if (!this._state.isThreadLive(s.T)) return false;
    let st;
    try { st = this._state.coroutineStatus(s.T); } catch (_) { return false; }
    return st === LUA.CORUN || st === LUA.COSUS || st === LUA.CONOR;
  }

  _onVmBreak(Lptr, line, isStep, srcPtr) {
    if (this._disposed || this._evalActive) return 0;
    const source = this._state.readDebugString(srcPtr);
    const chunk = this._chunksBySource.get(source) || null;
    if (isStep) {
      const s = this._stepSession;
      if (!s) return 0;
      if (s.T !== Lptr) {
        if (!s.multi || !chunk) return 0;
        const ctx = {
          driveOwned: this._driveStack.indexOf(s.ownerT) !== -1,
          sessionThreadRunnable: this._sessionThreadRunnable(s),
        };
        if (!coroutineStepPauseDecision(s, { T: Lptr, chunk, line }, ctx)) return 0;
      } else {
        let depth = 0;
        try { depth = this._state.stackDepth(Lptr); } catch (_) { return 0; }
        if (!stepPauseDecision(s, { T: Lptr, chunk, line, depth })) return 0;
      }
      this.debugCancelStep();
      this._state.pendingDebugBreak = { type: "step", chunk, line, jsLine: line, T: Lptr };
      return 1;
    }
    if (!this._debugActive || !this._debug || !chunk) return 0;
    let jsLine = line;
    for (const [jl, vl] of chunk.applied) {
      if (vl === line) { jsLine = jl; break; }
    }
    this._state.pendingDebugBreak = { type: "breakpoint", chunk, line, jsLine, T: Lptr };
    return 1;
  }

  _captureForDebug(T) {
    let frames = [];
    try { frames = this._state.captureFrames(T); } catch (_) { frames = []; }
    for (const f of frames) {
      const rec = this._chunksBySource.get(f.source);
      f.script = rec ? rec.script : null;
    }
    return frames;
  }

  _makePauseCommand(dbg, th) {
    const adapter = this._debug;
    if (!dbg || !adapter || typeof adapter.onParked !== "function") return { kind: "throttle" };
    const facade = this;
    const info = {
      isStep: dbg.type === "step",
      script: dbg.chunk ? dbg.chunk.script : null,
      line: dbg.line,
      jsLine: dbg.jsLine != null ? dbg.jsLine : dbg.line,
      stack: null,
      capture: () => facade._captureForDebug(dbg.T || th.T),
      evalInFrame: (text, frame) => facade.debugEval(text, frame),
      beginStep: (mode) => facade._beginStep(th, dbg, mode),
      cancelStep: () => facade.debugCancelStep(),
    };
    return {
      kind: "debugPause",
      onPause: (thread) => adapter.onParked(thread, info),
    };
  }

  debugEval(exprText, frame) {
    if (this._disposed) return { error: "VM Luau já descartada" };
    if (!this._state.debugSupported) return { error: "esta build da VM não suporta avaliação no debugger" };
    const text = String(exprText == null ? "" : exprText).trim();
    if (!text) return { error: "expressão vazia", syntaxError: true };
    if (text.length > 1000) return { error: "expressão muito longa", syntaxError: true };
    let bytecode = null;
    try {
      bytecode = this._state.compile("return (" + text + ")", "=eval");
    } catch (_) {
      try {
        bytecode = this._state.compile(text, "=eval");
      } catch (e2) {
        return { error: (e2 && e2.message) || "erro de sintaxe", syntaxError: true };
      }
    }
    const byName = new Map();
    if (frame) {
      for (const loc of frame.locals || []) byName.set(loc.name, { entry: loc, kind: "local" });
      for (const up of frame.upvalues || []) {
        if (!byName.has(up.name)) byName.set(up.name, { entry: up, kind: "upvalue" });
      }
    }
    const entries = [...byName].map(([name, info]) => ({ name, value: info.entry.value }));
    const canWrite =
      !!frame &&
      typeof frame.t === "number" &&
      typeof frame.level === "number" &&
      this._state.debugWriteVarsSupported &&
      this._state.isThreadLive(frame.t);
    if (!canWrite && byName.size && frameAssignmentTarget(text, byName)) {
      if (!this._state.debugWriteVarsSupported) {
        return { error: "esta build da VM não escreve em locals — recompile o .wasm com tools/luau-wasm/build.cmd (Parte 77)" };
      }
      return { error: "não é possível escrever: o frame pausado não está mais ativo" };
    }
    this._evalActive = true;
    try {
      const res = this._state.evalInFrame(bytecode, entries, 100, canWrite);
      if (res.error) return { error: res.error };
      const wrote =
        canWrite && Array.isArray(res.writes) && res.writes.length
          ? this._applyFrameWrites(frame, byName, res.writes)
          : [];
      const vals = res.values || [];
      let value = vals.length > 1 ? vals : vals[0];
      if (value === undefined && vals.length === 0 && wrote.length) {
        const winfo = byName.get(wrote[0]);
        if (winfo) value = winfo.entry.value;
      }
      return {
        value,
        sideEffects: /\(/.test(text) || /(^|[^=~<>])=(?!=)/.test(text),
        wrote,
      };
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    } finally {
      this._evalActive = false;
    }
  }


  _applyFrameWrites(frame, byName, writes) {
    const wrote = [];
    for (const w of writes) {
      const info = byName.get(w.name);
      if (!info || typeof info.entry.n !== "number") continue;
      let ok = false;
      try {
        ok =
          info.kind === "local"
            ? this._state.writeLocal(frame.t, frame.level, info.entry.n, w.value)
            : this._state.writeUpvalue(frame.t, frame.level, info.entry.n, w.value);
      } catch (_) {
        ok = false;
      }
      if (ok) {
        info.entry.value = w.value;
        wrote.push(w.name);
      }
    }
    return wrote;
  }

  _installVMGlobals() {
    const st = this._state;
    const ex = st.ex;
    const L = st.L;
    ex.lw_checkstack(L, 3);
    ex.lw_pushglobaltable(L);
    ex.lw_pushjsclosure(L, FN.LOAD, st._cstr("load"));
    ex.lw_rawsetfield(L, -2, st._cstr("load"));
    ex.lw_settop(L, -2);
  }

  dispose() {
    if (this._disposed) return;
    this.debugCancelStep();
    this._disposed = true;
    this._chunks.clear();
    this._chunksBySource.clear();
    stateFinalizer.unregister(this);
    this._state.close();
  }

  setGlobal(name, value) {
    this.globals.rawset(name, value);
  }

  getGlobal(name) {
    return this.globals.rawget(name);
  }


  tonumber(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const s = v.trim();

      if (!s) return undefined;


      const hex = /^([+-]?)0[xX]([0-9a-fA-F]+)$/.exec(s);
      if (hex) return (hex[1] === "-" ? -1 : 1) * parseInt(hex[2], 16);
      const bin = /^([+-]?)0[bB]([01]+)$/.exec(s);
      if (bin) return (bin[1] === "-" ? -1 : 1) * parseInt(bin[2], 2);


      if (/^[+-]?0[oO]/.test(s)) return undefined;

      if (/infinity/i.test(s)) return undefined;
      const n = Number(s);
      return isNaN(n) ? undefined : n;
    }
    return undefined;
  }

  tostring(v) {
    if (this.bridge && this.bridge.tostring) {
      const s = this.bridge.tostring(v);
      if (s !== undefined) return s;
    }
    if (v && v.__wasm && v.__state === this._state) {
      const s = this._state.tostringValue(v);
      if (s !== undefined) return s;
    }
    return luaToDisplay(v);
  }


  _markDynamicGlobal(name) {
    if (!this._dynamicGlobals.has(name)) {
      this._dynamicGlobals.add(name);
      this._dynamicGlobalsDirty = true;
    }
  }

  compile(source) {
    if (this._disposed) throw new LuaError("VM Luau já descartada");
    if (this._dynamicGlobalsDirty) {
      this._dynamicGlobalsDirty = false;
      this._state.setMutableGlobals([...this._dynamicGlobals]);
    }
    const bytecode = this._state.compile(String(source == null ? "" : source), "");
    return { __wasmChunk: true, bytecode };
  }


  *run(chunk, scriptEnv, chunkArgs) {
    if (this._disposed) throw new LuaError("VM Luau já descartada");
    if (!chunk || !chunk.__wasmChunk) {
      throw new LuaError("chunk inválido para a VM Luau (recompile o script)");
    }
    this._state.sandbox();
    const script = scriptEnv && scriptEnv.script ? scriptEnv.script : null;
    const chunkname = "=" + ((script && script.name) || "chunk");
    const th = this._state.createThread(true);
    try {
      this._state.loadChunkIntoThread(th, chunk.bytecode, chunkname);
      if (script && this._state.debugSupported && this._chunks.size < 400) {
        try {
          const chunkRec = {
            script,
            source: chunkname,
            funcRef: this._state.refThreadFunction(th),
            applied: new Map(),
          };
          this._chunks.add(chunkRec);
          this._chunksBySource.set(chunkname, chunkRec);
          if (this._debugActive) this._syncChunk(chunkRec);
        } catch (_) {                                       }
      }
      if (scriptEnv) {
        for (const key of Object.keys(scriptEnv)) {
          this._state.setThreadGlobal(th, key, scriptEnv[key]);
        }
      }



      const argv = Array.isArray(chunkArgs) ? chunkArgs : [];
      return yield* this._drive(th, () => this._state.startThreadChunk(th, argv));
    } finally {
      if (this._stepSession && (this._stepSession.ownerT === th.T || this._stepSession.T === th.T)) {
        this.debugCancelStep();
      }
      this._state.releaseThread(th);
    }
  }

  *call(fn, args, line) {
    const list = args || [];
    if (fn && fn.__native) {
      if (fn.isGen) {
        const ret = yield* fn.fn(list, this);
        return normalize(ret);
      }
      return normalize(fn.fn(list, this));
    }
    if (
      fn instanceof WasmLuaFunction ||
      fn instanceof WasmLuaTable ||
      fn instanceof WasmOpaque ||
      fn instanceof WasmLuaThread
    ) {
      if (this._disposed) throw new LuaError("VM Luau já descartada");
      this._state.sandbox();
      const th = this._state.createThread(false);
      try {
        return yield* this._drive(th, () => this._state.startThreadCall(th, fn, list));
      } finally {
        if (this._stepSession && (this._stepSession.ownerT === th.T || this._stepSession.T === th.T)) {
          this.debugCancelStep();
        }
        this._state.releaseThread(th);
      }
    }
    if (fn instanceof LuaTable && fn.metatable) {
      const call = fn.metatable.rawget("__call");
      if (call) return yield* this.call(call, [fn, ...list], line);
    }
    if (fn instanceof LuaFunction) {


      const home = fn.__interp;
      if (!home || typeof home.call !== "function") {
        throw new LuaError("função do interpretador legado sem engine de origem não pode ser chamada na VM Luau");
      }
      return yield* home.call(fn, list, line);
    }
    throw new LuaError(
      `attempt to call a ${luaTypeName(fn, this.bridge)} value` + (line ? ` (linha ${line})` : ""),
    );
  }

  *callValue(fn, args) {
    return yield* this.call(fn, args || [], 0);
  }


  _resumeGuarded(th, fn) {
    this._driveStack.push(th.T);
    try {
      return fn();
    } finally {
      this._driveStack.pop();
    }
  }

  *_drive(th, start) {
    let res = this._resumeGuarded(th, start);
    for (;;) {
      this.steps++;
      this.totalSteps++;
      if (res.status === LUA.OK) {
        return res.values || [];
      }
      if (res.status === LUA.YIELD || res.status === LUA.BREAK) {
        let cmd = res.command || { kind: "defer" };
        if (cmd.kind === "debugPause") cmd = this._makePauseCommand(cmd.debug, th);
        const injected = yield cmd;
        const values = Array.isArray(injected) ? injected : injected === undefined ? [] : [injected];
        const prevStatus = res.status;
        res = this._resumeGuarded(th, () => this._state.resumeThread(th, values, prevStatus));
        continue;
      }
      const err = new LuaError(res.message || "erro de execução Luau");
      err.traceback = res.traceback || "";
      throw err;
    }
  }
}

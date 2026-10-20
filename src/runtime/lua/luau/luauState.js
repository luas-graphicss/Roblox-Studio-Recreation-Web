import { LUA } from "./luauModule.js";
import { LuaTable, LuaFunction, LuaError } from "../interpreter.js";

const FN = Object.freeze({
  NSTART: 1,
  NPENDING: 2,
  NYIELD: 3,
  NSTEP: 4,
  NRESULTS: 5,
  PROXY_INDEX: 6,
  PROXY_NEWINDEX: 7,
  PROXY_CALL: 9,
  PROXY_TOSTRING: 10,
  PROXY_EQ: 11,
  PROXY_LEN: 12,
  PROXY_ITER: 13,
  ARITH_ADD: 20,
  ARITH_SUB: 21,
  ARITH_MUL: 22,
  ARITH_DIV: 23,
  ARITH_MOD: 24,
  ARITH_POW: 25,
  ARITH_UNM: 26,
  ARITH_IDIV: 27,
  LOAD: 30,
  DYNAMIC_BASE: 100,
});

const ARITH_OPS = {
  [FN.ARITH_ADD]: "+",
  [FN.ARITH_SUB]: "-",
  [FN.ARITH_MUL]: "*",
  [FN.ARITH_DIV]: "/",
  [FN.ARITH_MOD]: "%",
  [FN.ARITH_POW]: "^",
  [FN.ARITH_UNM]: "unm",
  [FN.ARITH_IDIV]: "//",
};

const MAX_PROXIES = 300000;
const MAX_GEN_HANDLES = 100000;
const SYNC_CALL_GUARD = 200000;

const HELPER_SOURCE = `
local nstart, npending, nyield, nstep, nresults = ...
local M = {}
function M.genwrap(fnid, name)
  local function genwrapper(...)
    local h = nstart(fnid, ...)
    while npending(h) do
      nstep(h, nyield(h))
    end
    return nresults(h)
  end
  return genwrapper
end
function M.invoke(f, ...)
  return f(...)
end
function M.tostr(v)
  return tostring(v)
end
function M.iterpairs(t)
  return next, t
end
return M
`;




export class WasmLuaTable extends LuaTable {
  constructor(state, ref, ptr) {
    super();
    this.__wasm = true;
    this.__state = state;
    this.__ref = ref;
    this.__ptr = ptr;
  }
  rawget(key) {
    return this.__state.tableRawGet(this.__ref, key);
  }
  rawset(key, value) {
    this.__state.tableRawSet(this.__ref, key, value);
  }
  length() {
    return this.__state.tableLength(this.__ref);
  }
  get map() {
    return this.__state.tableSnapshot(this.__ref);
  }
  set map(_) {                                                           }
  get metatable() {
    return this.__state.tableGetMetatable(this.__ref);
  }
  set metatable(mt) {
    if (mt === null || mt === undefined) return;
    this.__state.tableSetMetatable(this.__ref, mt);
  }
  get frozen() {
    return this.__state.tableIsReadonly(this.__ref);
  }
  set frozen(_) {                          }
}

export class WasmLuaFunction extends LuaFunction {
  constructor(state, ref, ptr) {
    super(null, null, "luau");
    this.__wasm = true;
    this.__state = state;
    this.__ref = ref;
    this.__ptr = ptr;
  }
}

export class WasmLuaThread {
  constructor(state, ref, ptr) {
    this.__wasm = true;
    this.__ud = "thread";
    this.__state = state;
    this.__ref = ref;
    this.__ptr = ptr;
  }
}

export class WasmOpaque {
  constructor(state, ref, ptr, kind) {
    this.__wasm = true;
    this.__ud = kind;
    this.__state = state;
    this.__ref = ref;
    this.__ptr = ptr;
  }
}

function normalizeResults(ret) {
  if (Array.isArray(ret)) return ret;
  if (ret === undefined) return [];
  return [ret];
}


export function sameVmValue(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (a.__wasm && b.__wasm) {
    return a.__state === b.__state && !!a.__ptr && a.__ptr === b.__ptr;
  }
  if (a.__ud === "vector" && b.__ud === "vector" && !a.__wasm && !b.__wasm) {
    return Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z);
  }
  return false;
}

export class LuauState {
  constructor(mod, options = {}) {
    this.mod = mod;
    this.ex = mod.exports;
    this.facade = options.facade || null;
    this.onPanic = options.onPanic || null;
    this.sliceBudgetMs = options.sliceBudgetMs || 12;
    this.closed = false;

    this.L = this.ex.lw_newstate();
    if (!this.L) throw new Error("Luau VM: falha ao criar lua_State");
    mod.registerState(this.L, this);

    this.fnRegistry = new Map();
    this.nextFnId = FN.DYNAMIC_BASE;
    this.genHandles = new Map();
    this.nextGenHandle = 1;
    this.pendingCommand = null;
    this.pendingDebugBreak = null;
    this.onDebugBreak = null;
    this.liveThreads = new Set();
    this.onThreadSpawned = null;

    this.proxyIdToObj = new Map();
    this.proxyByObj = new Map();


    this.identityHook = null;                                                        
    this.proxyGenById = new Map();                                            
    this.staleFacadeById = new Map();                                              
    this.metatableRefs = new Map();

    this._lenPtr = this.ex.lw_malloc(16);
    this.legacyValueRefs = new WeakMap();




    this.jsFnWrappers = new WeakMap();


    this.legacyFnBridges = new WeakMap();
    this.wrapperByPtr = new Map();
    this.wrapperGc = new FinalizationRegistry((held) => {
      if (!this.closed) this.ex.lw_unref(this.L, held.ref);


      const cur = this.wrapperByPtr.get(held.ptr);
      if (cur && cur.deref() === undefined) this.wrapperByPtr.delete(held.ptr);
    });

    this._initHelpers();
  }


  _initHelpers() {
    const L = this.L;
    const bc = this.compile(HELPER_SOURCE, "=LuauBridgeHelpers");
    this._loadBytecode(L, bc, "=LuauBridgeHelpers");
    this.ex.lw_pushjsclosure(L, FN.NSTART, this._cstr("nstart"));
    this.ex.lw_pushjsclosure(L, FN.NPENDING, this._cstr("npending"));
    this.ex.lw_pushjsclosure(L, FN.NYIELD, this._cstr("nyield"));
    this.ex.lw_pushjsclosure(L, FN.NSTEP, this._cstr("nstep"));
    this.ex.lw_pushjsclosure(L, FN.NRESULTS, this._cstr("nresults"));
    const status = this.ex.lw_pcall(L, 5, 1);
    if (status !== LUA.OK) {
      const err = this._popErrorMessage(L);
      throw new Error("Luau VM: falha ao inicializar helpers: " + err);
    }
    this.helperRefs = {};
    for (const name of ["genwrap", "invoke", "tostr", "iterpairs"]) {
      this.ex.lw_rawgetfield(L, -1, this._cstr(name));
      this.helperRefs[name] = this.ex.lw_ref(L, -1);
      this.ex.lw_settop(L, -2);
    }
    this.ex.lw_settop(L, -2);

    this.ex.lw_pushglobaltable(L);
    this.ex.lw_rawgetfield(L, -1, this._cstr("next"));
    this.nextFnRef = this.ex.lw_ref(L, -1);
    this.ex.lw_settop(L, -3);

    this.genWrapperRefs = new Map();
    this._sandboxed = false;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.mod.unregisterState(this.L);
    this.ex.lw_close(this.L);
    this.proxyIdToObj.clear();
    this.proxyGenById.clear();
    this.staleFacadeById.clear();
    this.proxyByObj = new WeakMap();
    this.genHandles.clear();
    this.wrapperByPtr.clear();
    this.liveThreads.clear();
  }

  _cstr(str) {
    return this.mod.scratchWrite(str).ptr;
  }

  get debugSupported() {
    return typeof this.ex.lw_breakpoint === "function" &&
      typeof this.ex.lw_singlestep === "function" &&
      typeof this.ex.lw_stackdepth === "function" &&
      typeof this.ex.lw_getinfo === "function" &&
      typeof this.ex.lw_getlocal === "function" &&
      typeof this.ex.lw_remove === "function";
  }

  setMutableGlobals(names) {
    const csv = names.join(";");
    const s = this.mod.scratchWrite(csv);
    this.ex.lw_set_mutable_globals(s.ptr);
  }


  compile(source, chunkname) {
    const data = this.mod.encoder.encode(String(source));
    const srcPtr = this.mod.allocBytes(data.length ? data : new Uint8Array([0]));
    const outLenPtr = this.ex.lw_malloc(8);
    let bcPtr = 0;
    try {
      bcPtr = this.ex.lw_compile(srcPtr, data.length, outLenPtr, 1, 2);
      const bcLen = this.mod.view().getUint32(outLenPtr, true);
      if (!bcPtr || bcLen === 0) throw new LuaError("Luau: falha interna de compilação");
      const bytecode = this.mod.bytes().slice(bcPtr, bcPtr + bcLen);
      if (bytecode[0] === 0) {
        const msg = this.mod.decoder.decode(bytecode.subarray(1));
        const err = new LuaError((chunkname || "chunk") + msg);
        err.isSyntaxError = true;
        throw err;
      }
      return bytecode;
    } finally {
      this.ex.lw_free(srcPtr);
      this.ex.lw_free(outLenPtr);
      if (bcPtr) this.ex.lw_free(bcPtr);
    }
  }

  _loadBytecode(L, bytecode, chunkname) {
    const bcPtr = this.mod.allocBytes(bytecode);
    try {
      const name = this.mod.scratchWrite(chunkname || "=chunk");
      const status = this.ex.lw_load(L, name.ptr, bcPtr, bytecode.length, 0);
      if (status !== 0) {
        const msg = this._popErrorMessage(L);
        throw new LuaError(msg || "Luau: falha ao carregar bytecode");
      }
    } finally {
      this.ex.lw_free(bcPtr);
    }
  }


  createThread(sandboxed) {
    const L = this.L;
    const T = this.ex.lw_newthread(L);
    const ref = this.ex.lw_ref(L, -1);
    this.ex.lw_settop(L, -2);
    if (sandboxed) this.ex.lw_sandboxthread(T);
    return { T, ref };
  }

  releaseThread(handle) {
    if (this.closed || !handle) return;
    try { this.ex.lw_resetthread(handle.T); } catch (_) {                     }
    this.ex.lw_unref(this.L, handle.ref);
  }

  loadChunkIntoThread(handle, bytecode, chunkname) {
    this._loadBytecode(handle.T, bytecode, chunkname);
  }

  refThreadFunction(handle) {
    return this.ex.lw_ref(handle.T, -1);
  }

  setFunctionBreakpoint(funcRef, line, enabled) {
    const L = this.L;
    this.ex.lw_checkstack(L, 2);
    this.ex.lw_getref(L, funcRef);
    let target = -1;
    try {
      target = this.ex.lw_breakpoint(L, -1, line, enabled ? 1 : 0);
    } finally {
      this.ex.lw_settop(L, -2);
    }
    return target;
  }

  setSingleStep(threadPtr, enabled) {
    this.ex.lw_singlestep(threadPtr, enabled ? 1 : 0);
  }


  get debugStepInCoroutinesSupported() {
    return this.debugSupported && typeof this.ex.lw_costatus === "function";
  }

  get debugWriteVarsSupported() {
    return (
      this.debugSupported &&
      typeof this.ex.lw_setlocal === "function" &&
      typeof this.ex.lw_setupvalue === "function"
    );
  }


  onThreadEvent(parentPtr, threadPtr) {
    if (this.closed || !threadPtr) return;
    if (parentPtr) {
      this.liveThreads.add(threadPtr);
      if (this.onThreadSpawned) this.onThreadSpawned(parentPtr, threadPtr);
    } else {
      this.liveThreads.delete(threadPtr);


      for (const [h, e] of this.genHandles) {
        if (e.threadPtr === threadPtr) this.genHandles.delete(h);
      }
    }
  }

  isThreadLive(threadPtr) {
    return this.liveThreads.has(threadPtr);
  }


  coroutineStatus(threadPtr) {
    if (!this.liveThreads.has(threadPtr)) return LUA.COFIN;
    return this.ex.lw_costatus(this.L, threadPtr);
  }

  setSingleStepAll(enabled) {
    const flag = enabled ? 1 : 0;
    for (const ptr of this.liveThreads) {
      try {
        this.ex.lw_singlestep(ptr, flag);
      } catch (_) {                                     }
    }
  }

  writeLocal(threadPtr, level, n, value) {
    if (!this.debugWriteVarsSupported || !this.liveThreads.has(threadPtr)) return false;
    const ex = this.ex;
    ex.lw_checkstack(threadPtr, 2);


    const base = ex.lw_gettop(threadPtr);
    this.pushValue(threadPtr, value);
    let okW = false;
    try {
      okW = !!ex.lw_setlocal(threadPtr, level, n);
    } finally {
      ex.lw_settop(threadPtr, base);
    }
    return okW;
  }

  writeUpvalue(threadPtr, level, n, value) {
    if (!this.debugWriteVarsSupported || !this.liveThreads.has(threadPtr)) return false;
    const ex = this.ex;
    ex.lw_checkstack(threadPtr, 3);


    const base = ex.lw_gettop(threadPtr);
    let okW = false;
    try {
      if (!ex.lw_getinfo(threadPtr, level, this._cstr("f"))) return false;
      this.pushValue(threadPtr, value);
      okW = !!ex.lw_setupvalue(threadPtr, -2, n);
    } finally {
      ex.lw_settop(threadPtr, base);
    }
    return okW;
  }

  stackDepth(threadPtr) {
    return this.ex.lw_stackdepth(threadPtr);
  }

  readDebugString(ptr) {
    return ptr ? this.mod.readCString(ptr) || "" : "";
  }

  captureFrames(threadPtr) {
    const T = threadPtr;
    const ex = this.ex;
    const depth = ex.lw_stackdepth(T);
    const frames = [];
    for (let level = 0; level < depth && level < 128; level++) {
      if (!ex.lw_getinfo(T, level, this._cstr("sln"))) continue;
      const line = ex.lw_debug_currentline();
      const source = this.mod.readCString(ex.lw_debug_source()) || "";
      const name = this.mod.readCString(ex.lw_debug_name()) || "";
      const what = this.mod.readCString(ex.lw_debug_what()) || "";
      const locals = [];
      const upvalues = [];
      if (what !== "C") {
        ex.lw_checkstack(T, 3);
        for (let n = 1; n <= 200; n++) {
          const namePtr = ex.lw_getlocal(T, level, n);
          if (!namePtr) break;
          const lname = this.mod.readCString(namePtr) || "";
          const value = this.readValue(T, -1);
          ex.lw_settop(T, -2);
          if (lname && lname[0] !== "(") locals.push({ name: lname, value, n });
        }
        if (ex.lw_getinfo(T, level, this._cstr("f"))) {
          for (let n = 1; n <= 60; n++) {
            const upPtr = ex.lw_getupvalue(T, -1, n);
            if (!upPtr) break;
            const uname = this.mod.readCString(upPtr) || "";
            const value = this.readValue(T, -1);
            ex.lw_settop(T, -2);
            if (uname) upvalues.push({ name: uname, value, n });
          }
          ex.lw_settop(T, -2);
        }
      }
      frames.push({ level, line, source, name, what, locals, upvalues, t: T });
    }
    return frames;
  }

  evalInFrame(bytecode, entries, budgetMs, collectWrites) {
    const th = this.createThread(false);
    const T = th.T;
    const ex = this.ex;
    let envRef = 0;
    try {
      ex.lw_checkstack(T, entries.length > 4 ? 8 : 6);
      ex.lw_createtable(T, 0, entries.length + 1);
      for (const e of entries) {
        this.pushValue(T, String(e.name));
        this.pushValue(T, e.value);
        ex.lw_rawset(T, -3);
      }
      ex.lw_createtable(T, 0, 1);
      ex.lw_pushglobaltable(T);
      ex.lw_rawsetfield(T, -2, this._cstr("__index"));
      ex.lw_setmetatable(T, -2);
      if (collectWrites) envRef = ex.lw_ref(T, -1);
      const bcPtr = this.mod.allocBytes(bytecode);
      try {
        const name = this.mod.scratchWrite("=eval");
        const status = ex.lw_load(T, name.ptr, bcPtr, bytecode.length, 1);
        if (status !== 0) return { error: this._popErrorMessage(T) || "erro ao carregar a expressão" };
      } finally {
        ex.lw_free(bcPtr);
      }
      ex.lw_remove(T, 1);
      ex.lw_setdeadline(budgetMs || 100);
      const status = ex.lw_resume(T, 0, 0);
      ex.lw_setdeadline(-1);
      if (status === LUA.OK) {
        const values = this._readStack(T);
        ex.lw_settop(T, 0);


        let writes;
        if (collectWrites && envRef) {
          writes = [];
          ex.lw_checkstack(T, 3);
          ex.lw_getref(T, envRef);
          for (const e of entries) {
            ex.lw_rawgetfield(T, -1, this._cstr(String(e.name)));
            const now = this.readValue(T, -1);
            ex.lw_settop(T, -2);
            if (!sameVmValue(now, e.value)) writes.push({ name: e.name, value: now });
          }
          ex.lw_settop(T, 0);
        }
        return { values, writes };
      }
      if (status === LUA.BREAK) return { error: "avaliação excedeu o tempo limite" };
      if (status === LUA.YIELD) return { error: "a expressão não pode ceder (yield) durante a avaliação" };
      return { error: this._safeToString(T, -1) };
    } finally {
      if (envRef) ex.lw_unref(this.L, envRef);
      this.releaseThread(th);
    }
  }

  setThreadGlobal(handle, name, value) {
    const T = handle.T;
    this.ex.lw_checkstack(T, 3);
    this.ex.lw_pushglobaltable(T);
    this.pushValue(T, value);
    this.ex.lw_rawsetfield(T, -2, this._cstr(name));
    this.ex.lw_settop(T, -2);
  }

  resumeThread(handle, args, lastStatus) {
    const T = handle.T;
    if (lastStatus === LUA.BREAK) {
      return this._doResume(T, 0);
    }
    const list = args || [];
    if (lastStatus === LUA.YIELD) this.ex.lw_settop(T, 0);
    this.ex.lw_checkstack(T, list.length + 2);
    for (const v of list) this.pushValue(T, v);
    return this._doResume(T, list.length);
  }

  startThreadCall(handle, fnValue, args) {
    const T = handle.T;
    const list = args || [];
    this.ex.lw_checkstack(T, list.length + 3);
    this.ex.lw_getref(T, this.helperRefs.invoke);
    this.pushValue(T, fnValue);
    for (const v of list) this.pushValue(T, v);
    return this._doResume(T, list.length + 1);
  }

  startThreadChunk(handle, args) {
    const T = handle.T;
    const list = args || [];
    this.ex.lw_checkstack(T, list.length + 2);
    for (const v of list) this.pushValue(T, v);
    return this._doResume(T, list.length);
  }

  _doResume(T, nargs) {
    this.pendingDebugBreak = null;


    this.pendingCommand = null;
    this.ex.lw_setdeadline(this.sliceBudgetMs);
    const status = this.ex.lw_resume(T, 0, nargs);
    this.ex.lw_setdeadline(-1);
    if (status === LUA.OK) {
      const values = this._readStack(T);
      this.ex.lw_settop(T, 0);
      return { status, values };
    }
    if (status === LUA.YIELD) {
      const command = this.pendingCommand;
      this.pendingCommand = null;
      return { status, command };
    }
    if (status === LUA.BREAK) {
      const dbg = this.pendingDebugBreak;
      this.pendingDebugBreak = null;
      if (dbg) return { status, command: { kind: "debugPause", debug: dbg } };
      return { status, command: { kind: "throttle" } };
    }
    const message = this._safeToString(T, -1);
    let traceback = "";
    try {
      const tracePtr = this.ex.lw_debugtrace(T);
      traceback = this.mod.readCString(tracePtr) || "";
    } catch (_) {                               }
    this.ex.lw_settop(T, 0);
    return { status, message, traceback };
  }

  _readStack(T) {
    const top = this.ex.lw_gettop(T);
    const out = [];
    for (let i = 1; i <= top; i++) out.push(this.readValue(T, i));
    return out;
  }

  _popErrorMessage(L) {
    const msg = this._safeToString(L, -1);
    this.ex.lw_settop(L, -2);
    return msg;
  }

  _safeToString(L, idx) {
    const t = this.ex.lw_type(L, idx);
    if (t === LUA.TSTRING) {
      const ptr = this.ex.lw_tolstring(L, idx, this._lenPtr);
      const len = this.mod.view().getUint32(this._lenPtr, true);
      return this.mod.readString(ptr, len) || "";
    }
    if (t === LUA.TNUMBER || t === LUA.TINTEGER) return String(this.ex.lw_tonumber(L, idx));
    if (t === LUA.TBOOLEAN) return this.ex.lw_toboolean(L, idx) ? "true" : "false";
    if (t === LUA.TNIL) return "nil";
    if (t === LUA.TVECTOR && typeof this.ex.lw_tovector === "function") {


      this.ex.lw_tovector(L, idx, this._lenPtr);
      const dv = this.mod.view();
      return (
        String(dv.getFloat32(this._lenPtr, true)) + ", " +
        String(dv.getFloat32(this._lenPtr + 4, true)) + ", " +
        String(dv.getFloat32(this._lenPtr + 8, true))
      );
    }
    const namePtr = this.ex.lw_typename(L, t);
    return (this.mod.readCString(namePtr) || "value") + ": 0x0";
  }


  setGlobal(name, value) {
    const L = this.L;
    this.ex.lw_checkstack(L, 3);
    const base = this.ex.lw_gettop(L);
    this.ex.lw_pushglobaltable(L);
    const wasReadonly = this.ex.lw_getreadonly(L, -1);
    try {
      if (wasReadonly) this.ex.lw_setreadonly(L, -1, 0);
      this.pushValue(L, value);
      this.ex.lw_rawsetfield(L, -2, this._cstr(name));
    } finally {


      if (wasReadonly) this.ex.lw_setreadonly(L, base + 1, 1);
      this.ex.lw_settop(L, base);
    }
  }

  getGlobal(name) {
    const L = this.L;
    this.ex.lw_checkstack(L, 2);
    this.ex.lw_pushglobaltable(L);
    this.ex.lw_rawgetfield(L, -1, this._cstr(name));
    const v = this.readValue(L, -1);
    this.ex.lw_settop(L, -3);
    return v;
  }

  sandbox() {
    if (this._sandboxed) return;
    this._sandboxed = true;
    this.ex.lw_sandbox(this.L);
    const L = this.L;
    this.ex.lw_pushglobaltable(L);
    this.ex.lw_setreadonly(L, -1, 0);
    this.ex.lw_createtable(L, 0, 0);
    this.ex.lw_rawsetfield(L, -2, this._cstr("_G"));
    this.ex.lw_setreadonly(L, -1, 1);
    this.ex.lw_settop(L, -2);
  }

  tostringValue(v) {
    if (this.closed) return undefined;                                   
    const L = this.L;
    this.ex.lw_checkstack(L, 3);
    this.ex.lw_getref(L, this.helperRefs.tostr);
    this.pushValue(L, v);
    const status = this.ex.lw_pcall(L, 1, 1);
    if (status !== LUA.OK) {
      this.ex.lw_settop(L, 0);
      return undefined;
    }
    const s = this._safeToString(L, -1);
    this.ex.lw_settop(L, -2);
    return s;
  }


  _withRef(ref, fn, closedValue) {
    if (this.closed) return closedValue;
    const L = this.L;
    this.ex.lw_checkstack(L, 4);
    this.ex.lw_getref(L, ref);
    try {
      return fn(L);
    } finally {
      this.ex.lw_settop(L, -2);
    }
  }

  tableRawGet(ref, key) {
    return this._withRef(ref, (L) => {
      this.pushValue(L, key);
      this.ex.lw_rawget(L, -2);
      const v = this.readValue(L, -1);
      this.ex.lw_settop(L, -2);
      return v;
    });
  }

  tableRawSet(ref, key, value) {
    this._withRef(ref, (L) => {
      if (key === undefined || key === null) throw new LuaError("table index is nil");


      if (this.ex.lw_getreadonly(L, -1)) throw new LuaError("attempt to modify a readonly table");
      this.pushValue(L, key);
      this.pushValue(L, value);
      this.ex.lw_rawset(L, -3);
    });
  }

  tableLength(ref) {
    return this._withRef(ref, (L) => this.ex.lw_objlen(L, -1), 0);
  }

  tableSnapshot(ref) {
    return this._withRef(ref, (L) => {
      const map = new Map();
      let iter = 0;
      for (;;) {
        iter = this.ex.lw_rawiter(L, -1, iter);
        if (iter < 0) break;
        const k = this.readValue(L, -2);
        const v = this.readValue(L, -1);
        map.set(k, v);
        this.ex.lw_settop(L, -3);
      }
      return map;
    }, new Map());
  }

  tableGetMetatable(ref) {
    return this._withRef(ref, (L) => {
      if (!this.ex.lw_getmetatable(L, -1)) return null;
      const mt = this.readValue(L, -1);
      this.ex.lw_settop(L, -2);
      return mt instanceof LuaTable ? mt : null;
    }, null);
  }

  tableSetMetatable(ref, mt) {
    this._withRef(ref, (L) => {


      if (this.ex.lw_getreadonly(L, -1)) throw new LuaError("attempt to modify a readonly table");
      this.pushValue(L, mt);
      this.ex.lw_setmetatable(L, -2);
    });
  }

  tableIsReadonly(ref) {
    return this._withRef(ref, (L) => !!this.ex.lw_getreadonly(L, -1), false);
  }


  pushValue(L, v) {
    const ex = this.ex;
    if (v === undefined || v === null) return ex.lw_pushnil(L);
    const t = typeof v;
    if (t === "boolean") return ex.lw_pushboolean(L, v ? 1 : 0);
    if (t === "number") return ex.lw_pushnumber(L, v);
    if (t === "string") {
      const s = this.mod.scratchWrite(v);
      return ex.lw_pushlstring(L, s.ptr, s.len);
    }
    if (t === "function") {
      let nf = this.jsFnWrappers.get(v);
      if (!nf) {
        nf = { __native: true, fn: (args) => v(...args), name: v.name || "jsfn" };
        this.jsFnWrappers.set(v, nf);
      }
      return this._pushLegacyNative(L, nf);
    }
    if (t !== "object") return ex.lw_pushnil(L);

    if (v.__wasm && v.__state === this) {
      return ex.lw_getref(L, v.__ref);
    }
    if (v.__wasm && v.__state !== this) {
      throw new LuaError("valor Luau de outra VM não pode cruzar contextos");
    }
    if (v.__native) return this._pushLegacyNative(L, v);
    if (
      v.__ud === "vector" &&
      typeof v.x === "number" &&
      typeof v.y === "number" &&
      typeof v.z === "number" &&
      typeof ex.lw_pushvector === "function"
    ) {
      return ex.lw_pushvector(L, v.x, v.y, v.z);
    }
    if (v instanceof LuaTable) {
      if (v.metatable || typeof v.__ud === "string") return this._pushProxy(L, v, "table");
      return this._pushConvertedTable(L, v, new Set());
    }
    if (v instanceof LuaFunction) {

      return this._pushLegacyFunction(L, v);
    }
    const typeName = this._proxyTypeName(v);
    return this._pushProxy(L, v, typeName);
  }

  _proxyTypeName(v) {
    const bridge = this.facade ? this.facade.bridge : null;
    if (bridge && bridge.isUserdata && bridge.isUserdata(v)) {
      const n = bridge.typeName ? bridge.typeName(v) : null;
      return n || (typeof v.__ud === "string" ? v.__ud : "userdata");
    }
    if (typeof v.__ud === "string") return v.__ud;
    if (v.__isInstance) return "Instance";
    return "userdata";
  }

  _pushConvertedTable(L, table, seen) {
    if (seen.has(table)) throw new LuaError("tabela com ciclo não pode ser convertida para a VM Luau");
    if (seen.size > 64) throw new LuaError("tabela profunda demais para conversão");
    seen.add(table);
    const ex = this.ex;
    ex.lw_checkstack(L, 4);
    ex.lw_createtable(L, 0, table.map.size);
    for (const [k, val] of table.map) {
      if (val instanceof LuaTable && !val.metatable && typeof val.__ud !== "string" && !val.__wasm) {
        this.pushValue(L, k);
        this._pushConvertedTable(L, val, seen);
        ex.lw_rawset(L, -3);
      } else {
        this.pushValue(L, k);
        this.pushValue(L, val);
        ex.lw_rawset(L, -3);
      }
    }
    seen.delete(table);
  }

  _pushLegacyNative(L, nf) {
    const cached = this.legacyValueRefs.get(nf);
    if (cached !== undefined) return this.ex.lw_getref(L, cached);

    let ref;
    if (nf.isGen) {
      ref = this._makeGenWrapper(nf);
    } else {
      const fnid = this._registerFn({ kind: "plain", native: nf });
      this.ex.lw_pushjsclosure(this.L, fnid, this._cstr(nf.name || "native"));
      ref = this.ex.lw_ref(this.L, -1);
      this.ex.lw_settop(this.L, -2);
    }
    this.legacyValueRefs.set(nf, ref);
    return this.ex.lw_getref(L, ref);
  }


  _pushLegacyFunction(L, fn) {
    let nf = this.legacyFnBridges.get(fn);
    if (!nf) {
      const home = fn.__interp;
      if (!home || typeof home.call !== "function") {
        throw new LuaError("função do interpretador legado sem engine de origem não pode cruzar para a VM Luau");
      }
      nf = {
        __native: true,
        isGen: true,
        name: typeof fn.name === "string" && fn.name ? fn.name : "legacyfn",
        fn: function* (args) {
          return yield* home.call(fn, args || [], 0);
        },
      };
      this.legacyFnBridges.set(fn, nf);
    }
    return this._pushLegacyNative(L, nf);
  }

  _makeGenWrapper(nf) {
    const fnid = this._registerFn({ kind: "gen", native: nf });
    const L = this.L;
    this.ex.lw_checkstack(L, 4);
    this.ex.lw_getref(L, this.helperRefs.genwrap);
    this.ex.lw_pushnumber(L, fnid);
    const s = this.mod.scratchWrite(nf.name || "native");
    this.ex.lw_pushlstring(L, s.ptr, s.len);
    const status = this.ex.lw_pcall(L, 2, 1);
    if (status !== LUA.OK) {
      const msg = this._popErrorMessage(L);
      throw new LuaError("Luau VM: falha ao criar wrapper: " + msg);
    }
    const ref = this.ex.lw_ref(L, -1);
    this.ex.lw_settop(L, -2);
    return ref;
  }

  _registerFn(entry) {
    const id = this.nextFnId++;
    this.fnRegistry.set(id, entry);
    return id;
  }

  _pushProxy(L, obj, typeName) {
    const hook = this.identityHook;
    const gen = hook && obj && obj.__isInstance === true ? hook.genOf(obj) : 0;
    const existing = this.proxyByObj.get(obj);
    if (existing && (existing.gen || 0) === gen) return this.ex.lw_getref(L, existing.ref);
    if (existing) {


      this.ex.lw_unref(this.L, existing.ref);
      this.proxyByObj.delete(obj);
    }

    if (this.proxyIdToObj.size >= MAX_PROXIES) {
      throw new LuaError("limite de objetos expostos à VM Luau excedido");
    }
    const id = this.mod.nextSharedProxyId();
    this.proxyIdToObj.set(id, obj);
    if (gen > 0) this.proxyGenById.set(id, gen);
    const mainL = this.L;
    this.ex.lw_checkstack(mainL, 3);
    this.ex.lw_newproxy(mainL, id);
    this.ex.lw_getref(mainL, this._metatableFor(typeName, obj instanceof LuaTable));
    this.ex.lw_setmetatable(mainL, -2);


    const ref = this.ex.lw_ref(mainL, -1);
    this.proxyByObj.set(obj, { id, ref, gen });
    this.ex.lw_settop(mainL, -2);
    this.ex.lw_getref(L, ref);
  }

  ownsProxyId(id) {
    return this.proxyIdToObj.has(id);
  }

  releaseProxyId(id) {
    const obj = this.proxyIdToObj.get(id);
    if (obj !== undefined) {
      this.proxyIdToObj.delete(id);
      const cur = this.proxyByObj.get(obj);
      if (cur && cur.id === id) this.proxyByObj.delete(obj);
    }
    this.proxyGenById.delete(id);
    this.staleFacadeById.delete(id);
  }

  setIdentityHook(hook) {
    this.identityHook =
      hook && typeof hook.genOf === "function" && typeof hook.staleFacade === "function" ? hook : null;
  }


  _proxyObjFor(id) {
    const obj = this.proxyIdToObj.get(id);
    if (obj === undefined) return undefined;
    const hook = this.identityHook;
    if (!hook || !obj || obj.__isInstance !== true) return obj;
    const gen = this.proxyGenById.get(id) || 0;
    if (hook.genOf(obj) <= gen) return obj;
    let facade = this.staleFacadeById.get(id);
    if (facade === undefined) {
      facade = hook.staleFacade(obj, gen);
      this.staleFacadeById.set(id, facade);
    }
    return facade;
  }

  _metatableFor(typeName, isTable) {
    const key = typeName + (isTable ? "#t" : "#u");
    const cached = this.metatableRefs.get(key);
    if (cached !== undefined) return cached;

    const L = this.L;
    const ex = this.ex;
    ex.lw_checkstack(L, 4);
    ex.lw_createtable(L, 0, 16);

    const setClosure = (name, fnid) => {
      ex.lw_pushjsclosure(L, fnid, this._cstr(name));
      ex.lw_rawsetfield(L, -2, this._cstr(name));
    };
    setClosure("__index", FN.PROXY_INDEX);
    setClosure("__newindex", FN.PROXY_NEWINDEX);
    setClosure("__call", FN.PROXY_CALL);
    setClosure("__tostring", FN.PROXY_TOSTRING);
    setClosure("__eq", FN.PROXY_EQ);
    setClosure("__add", FN.ARITH_ADD);
    setClosure("__sub", FN.ARITH_SUB);
    setClosure("__mul", FN.ARITH_MUL);
    setClosure("__div", FN.ARITH_DIV);
    setClosure("__mod", FN.ARITH_MOD);
    setClosure("__pow", FN.ARITH_POW);
    setClosure("__unm", FN.ARITH_UNM);
    setClosure("__idiv", FN.ARITH_IDIV);
    if (isTable) {
      setClosure("__len", FN.PROXY_LEN);
      setClosure("__iter", FN.PROXY_ITER);
    }
    const s = this.mod.scratchWrite(isTable ? "table" : typeName);
    ex.lw_pushlstring(L, s.ptr, s.len);
    ex.lw_rawsetfield(L, -2, this._cstr("__type"));
    ex.lw_setreadonly(L, -1, 1);
    const ref = ex.lw_ref(L, -1);
    ex.lw_settop(L, -2);
    this.metatableRefs.set(key, ref);
    return ref;
  }


  readValue(L, idx) {
    const ex = this.ex;
    const t = ex.lw_type(L, idx);
    switch (t) {
      case LUA.TNIL:
        return undefined;
      case LUA.TBOOLEAN:
        return !!ex.lw_toboolean(L, idx);
      case LUA.TNUMBER:
      case LUA.TINTEGER:
        return ex.lw_tonumber(L, idx);
      case LUA.TSTRING: {
        const ptr = ex.lw_tolstring(L, idx, this._lenPtr);
        const len = this.mod.view().getUint32(this._lenPtr, true);
        return this.mod.readString(ptr, len);
      }
      case LUA.TVECTOR: {
        ex.lw_tovector(L, idx, this._lenPtr);
        const dv = this.mod.view();
        return {
          __ud: "vector",
          x: dv.getFloat32(this._lenPtr, true),
          y: dv.getFloat32(this._lenPtr + 4, true),
          z: dv.getFloat32(this._lenPtr + 8, true),
        };
      }
      case LUA.TUSERDATA: {
        const id = ex.lw_proxyid(L, idx);
        if (id >= 0) {
          const obj = this._proxyObjFor(id);
          if (obj !== undefined) return obj;
        }
        return this._wrap(L, idx, WasmOpaque, "userdata");
      }
      case LUA.TTABLE:
        return this._wrap(L, idx, WasmLuaTable);
      case LUA.TFUNCTION:
        return this._wrap(L, idx, WasmLuaFunction);
      case LUA.TTHREAD:
        return this._wrap(L, idx, WasmLuaThread);
      case LUA.TBUFFER:
        return this._wrap(L, idx, WasmOpaque, "buffer");
      default:
        return undefined;
    }
  }

  _wrap(L, idx, Ctor, kind) {
    const ptr = this.ex.lw_topointer(L, idx);
    const cached = this.wrapperByPtr.get(ptr);
    if (cached) {
      const w = cached.deref();
      if (w) return w;
      this.wrapperByPtr.delete(ptr);
    }
    this.ex.lw_pushvalue(L, idx);
    const ref = this.ex.lw_ref(L, -1);
    this.ex.lw_settop(L, -2);
    const wrapper = kind ? new Ctor(this, ref, ptr, kind) : new Ctor(this, ref, ptr);
    this.wrapperByPtr.set(ptr, new WeakRef(wrapper));
    this.wrapperGc.register(wrapper, { ref, ptr });
    return wrapper;
  }


  handleNativeCall(L, fnid, nargs) {
    try {
      return this._dispatch(L, fnid, nargs);
    } catch (e) {
      const msg =
        e instanceof LuaError
          ? typeof e.luaMessage === "string"
            ? e.luaMessage
            : e.message
          : (e && e.message) || String(e);
      this.ex.lw_settop(L, 0);
      const s = this.mod.scratchWrite(String(msg));
      this.ex.lw_pushlstring(L, s.ptr, s.len);
      return LUA.RC_ERROR;
    }
  }

  _readArgs(L, from, nargs) {
    const args = [];
    for (let i = from; i <= nargs; i++) args.push(this.readValue(L, i));
    return args;
  }

  _pushResults(L, results) {
    this.ex.lw_settop(L, 0);
    this.ex.lw_checkstack(L, results.length + 1);
    for (const v of results) this.pushValue(L, v);
    return results.length;
  }

  _dispatch(L, fnid, nargs) {
    switch (fnid) {
      case FN.NSTART: {
        const targetId = this.ex.lw_tonumber(L, 1);
        const entryReg = this.fnRegistry.get(targetId);
        if (!entryReg) throw new LuaError("função nativa desconhecida");
        if (this.genHandles.size >= MAX_GEN_HANDLES) {
          throw new LuaError("limite de chamadas nativas suspensas excedido");
        }
        const args = this._readArgs(L, 2, nargs);


        const entry = { gen: entryReg.native.fn(args, this.facade), cmd: null, done: false, results: [], threadPtr: L };
        this._advanceGen(entry, undefined);
        const h = this.nextGenHandle++;
        this.genHandles.set(h, entry);
        this.ex.lw_settop(L, 0);
        this.ex.lw_pushnumber(L, h);
        return 1;
      }
      case FN.NPENDING: {
        const entry = this._genEntry(L);
        this.ex.lw_settop(L, 0);
        this.ex.lw_pushboolean(L, entry.done ? 0 : 1);
        return 1;
      }
      case FN.NYIELD: {
        const entry = this._genEntry(L);
        this.pendingCommand = entry.cmd || { kind: "defer" };
        this.ex.lw_settop(L, 0);
        return LUA.RC_YIELD_BASE;
      }
      case FN.NSTEP: {
        const entry = this._genEntry(L);
        const input = this._readArgs(L, 2, nargs);
        this._advanceGen(entry, input);
        this.ex.lw_settop(L, 0);
        return 0;
      }
      case FN.NRESULTS: {
        const h = this.ex.lw_tonumber(L, 1);
        const entry = this._genEntry(L);
        this.genHandles.delete(h);
        return this._pushResults(L, entry.results);
      }
      case FN.PROXY_INDEX: {
        const obj = this._proxyArg(L, 1);
        const key = this.readValue(L, 2);
        const v = this._legacyIndex(obj, key);
        this.ex.lw_settop(L, 0);
        this.pushValue(L, v);
        return 1;
      }
      case FN.PROXY_NEWINDEX: {
        const obj = this._proxyArg(L, 1);
        const key = this.readValue(L, 2);
        const value = this.readValue(L, 3);
        this._legacyNewIndex(obj, key, value);
        this.ex.lw_settop(L, 0);
        return 0;
      }
      case FN.PROXY_CALL: {
        const obj = this._proxyArg(L, 1);
        const args = this._readArgs(L, 2, nargs);
        const results = this._legacyCallSync(obj, args, true);
        return this._pushResults(L, results);
      }
      case FN.PROXY_TOSTRING: {
        const obj = this._proxyArg(L, 1);
        const str = this.facade ? this.facade.tostring(obj) : "userdata";
        return this._pushResults(L, [str]);
      }
      case FN.PROXY_EQ: {
        const a = this.readValue(L, 1);
        const b = this.readValue(L, 2);
        let eq;
        const bridge = this.facade ? this.facade.bridge : null;
        if (bridge && bridge.eq) eq = bridge.eq(a, b);
        if (eq === undefined) eq = a === b;
        return this._pushResults(L, [!!eq]);
      }
      case FN.PROXY_LEN: {
        const obj = this._proxyArg(L, 1);
        if (obj instanceof LuaTable) return this._pushResults(L, [obj.length()]);
        throw new LuaError("attempt to get length of a userdata value");
      }
      case FN.PROXY_ITER: {
        const obj = this._proxyArg(L, 1);
        if (!(obj instanceof LuaTable)) throw new LuaError("attempt to iterate over a userdata value");
        this.ex.lw_settop(L, 0);
        this.ex.lw_checkstack(L, 3);
        this.ex.lw_getref(L, this.nextFnRef);
        this.ex.lw_createtable(L, 0, obj.map.size);
        for (const [k, v] of obj.map) {
          this.pushValue(L, k);
          this.pushValue(L, v);
          this.ex.lw_rawset(L, -3);
        }
        return 2;
      }
      case FN.ARITH_ADD:
      case FN.ARITH_SUB:
      case FN.ARITH_MUL:
      case FN.ARITH_DIV:
      case FN.ARITH_MOD:
      case FN.ARITH_POW:
      case FN.ARITH_UNM:
      case FN.ARITH_IDIV: {
        const op = ARITH_OPS[fnid];
        const a = this.readValue(L, 1);
        const b = fnid === FN.ARITH_UNM ? a : this.readValue(L, 2);
        const bridge = this.facade ? this.facade.bridge : null;
        if (bridge && bridge.arith) {
          const res = bridge.arith(op === "//" ? "/" : op, a, b);
          if (res !== undefined) {
            return this._pushResults(L, [op === "//" && typeof res === "number" ? Math.floor(res) : res]);
          }
        }
        throw new LuaError("attempt to perform arithmetic (" + op + ") on a userdata value");
      }
      case FN.LOAD: {
        const chunk = this.readValue(L, 1);
        const chunknameArg = this.readValue(L, 2);
        if (typeof chunk !== "string") return this._pushResults(L, [undefined, "load: chunk deve ser string"]);
        let bytecode;
        try {
          bytecode = this.compile(chunk, "=load");
        } catch (e) {
          return this._pushResults(L, [undefined, (e && e.message) || "erro de sintaxe"]);
        }
        this.ex.lw_settop(L, 0);
        const bcPtr = this.mod.allocBytes(bytecode);
        try {
          const name = this.mod.scratchWrite(typeof chunknameArg === "string" ? "=" + chunknameArg : "=load");
          const status = this.ex.lw_load(L, name.ptr, bcPtr, bytecode.length, 0);
          if (status !== 0) {
            const msg = this._popErrorMessage(L);
            this.ex.lw_settop(L, 0);
            this.ex.lw_pushnil(L);
            const s = this.mod.scratchWrite(msg || "erro ao carregar");
            this.ex.lw_pushlstring(L, s.ptr, s.len);
            return 2;
          }
        } finally {
          this.ex.lw_free(bcPtr);
        }
        return 1;
      }
      default: {
        const reg = this.fnRegistry.get(fnid);
        if (!reg) throw new LuaError("função nativa desconhecida (" + fnid + ")");
        const args = this._readArgs(L, 1, nargs);
        const ret = reg.native.fn(args, this.facade);
        return this._pushResults(L, normalizeResults(ret));
      }
    }
  }

  _genEntry(L) {
    const h = this.ex.lw_tonumber(L, 1);
    const entry = this.genHandles.get(h);
    if (!entry) throw new LuaError("handle de chamada nativa inválido");
    return entry;
  }

  _advanceGen(entry, input) {
    let inject = input;
    for (;;) {
      const res = entry.gen.next(inject);
      inject = undefined;
      if (res.done) {
        entry.done = true;
        entry.cmd = null;
        entry.results = normalizeResults(res.value);
        return;
      }
      const cmd = res.value;
      if (cmd && typeof cmd.kind === "string") {
        entry.cmd = cmd;
        return;
      }
    }
  }

  _proxyArg(L, idx) {
    const id = this.ex.lw_proxyid(L, idx);
    const obj = id >= 0 ? this._proxyObjFor(id) : undefined;
    if (obj === undefined) throw new LuaError("proxy inválido");
    return obj;
  }


  _legacyIndex(obj, key, depth) {


    if ((depth || 0) > 100) throw new LuaError("'__index' chain too long; possible loop");
    if (obj instanceof LuaTable) {
      const raw = obj.rawget(key);
      if (raw !== undefined) return raw;
      const mt = obj.metatable;
      if (mt) {
        const idx = mt.rawget("__index");
        if (idx instanceof LuaTable) return this._legacyIndex(idx, key, (depth || 0) + 1);
        if (idx && (idx.__native || idx instanceof LuaFunction)) {
          return this._legacyCallSync(idx, [obj, key], false)[0];
        }
      }
      return undefined;
    }
    const bridge = this.facade ? this.facade.bridge : null;
    if (bridge && bridge.isUserdata && bridge.isUserdata(obj)) {
      return bridge.getIndex(obj, key, 0);
    }
    throw new LuaError("attempt to index a userdata value");
  }

  _legacyNewIndex(obj, key, value, depth) {
    if ((depth || 0) > 100) throw new LuaError("'__newindex' chain too long; possible loop");
    if (obj instanceof LuaTable) {
      if (obj.rawget(key) === undefined && obj.metatable) {
        const ni = obj.metatable.rawget("__newindex");
        if (ni instanceof LuaTable) return this._legacyNewIndex(ni, key, value, (depth || 0) + 1);
        if (ni && (ni.__native || ni instanceof LuaFunction)) {
          this._legacyCallSync(ni, [obj, key, value], false);
          return;
        }
      }
      if (key === undefined || key === null) throw new LuaError("table index is nil");
      obj.rawset(key, value);
      return;
    }
    const bridge = this.facade ? this.facade.bridge : null;
    if (bridge && bridge.isUserdata && bridge.isUserdata(obj)) {
      bridge.setIndex(obj, key, value, 0);
      return;
    }
    throw new LuaError("attempt to index a userdata value");
  }

  _legacyCallSync(fn, args, viaCallMeta) {
    let target = fn;
    if (viaCallMeta && target instanceof LuaTable) {
      const mt = target.metatable;
      const call = mt ? mt.rawget("__call") : undefined;
      if (!call) throw new LuaError("attempt to call a table value");
      return this._legacyCallSync(call, [target, ...args], false);
    }
    if (!this.facade) throw new LuaError("VM sem facade");
    const gen = this.facade.call(target, args, 0);
    let step = gen.next();
    let guard = 0;
    while (!step.done) {
      if (++guard > SYNC_CALL_GUARD) throw new LuaError("metamétodo demorou demais");
      step = gen.next();
    }
    return step.value || [];
  }
}

export { FN };

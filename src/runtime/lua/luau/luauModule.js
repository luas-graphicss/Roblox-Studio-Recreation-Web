import { createWasiShim } from "./wasiShim.js";

const LUA = Object.freeze({
  OK: 0,
  YIELD: 1,
  ERRRUN: 2,
  ERRSYNTAX: 3,
  ERRMEM: 4,
  ERRERR: 5,
  BREAK: 6,
  CORUN: 0,
  COSUS: 1,
  CONOR: 2,
  COFIN: 3,
  COERR: 4,
  TNIL: 0,
  TBOOLEAN: 1,
  TLIGHTUSERDATA: 2,
  TNUMBER: 3,
  TINTEGER: 4,                                                                  

  TVECTOR: 6,
  TSTRING: 7,
  TTABLE: 8,
  TFUNCTION: 9,
  TUSERDATA: 10,
  TTHREAD: 11,
  TBUFFER: 12,
  TCLASS: 13,
  TOBJECT: 14,
  RC_ERROR: -2,
  RC_YIELD_BASE: -3,
});

export { LUA };

export class LuauModule {
  constructor(instance) {
    this.instance = instance;
    this.exports = instance.exports;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder("utf-8");
    this.states = new Map();
    this._scratchLen = 0;
    this._scratchPtr = 0;


    this._nextProxyId = 1;
  }

  get memory() {
    return this.exports.memory;
  }

  bytes() {
    return new Uint8Array(this.exports.memory.buffer);
  }

  view() {
    return new DataView(this.exports.memory.buffer);
  }

  nextSharedProxyId() {
    return this._nextProxyId++;
  }

  registerState(mainPtr, state) {
    this.states.set(mainPtr, state);
  }

  unregisterState(mainPtr) {
    this.states.delete(mainPtr);
  }

  stateFor(L) {
    const main = this.exports.lw_mainthread(L);
    return this.states.get(main) || null;
  }

  readString(ptr, len) {
    if (!ptr) return null;
    return this.decoder.decode(this.bytes().subarray(ptr, ptr + len));
  }

  readCString(ptr) {
    if (!ptr) return null;
    const mem = this.bytes();
    let end = ptr;


    while (end < mem.length && mem[end] !== 0) end++;
    return this.decoder.decode(mem.subarray(ptr, end));
  }


  scratchWrite(str) {
    const data = this.encoder.encode(str);
    if (data.length + 1 > this._scratchLen) {


      const newLen = Math.max(256, data.length + 1);
      const newPtr = this.exports.lw_malloc(newLen);
      if (!newPtr) throw new Error("Luau VM: sem memória para alocação");
      if (this._scratchPtr) this.exports.lw_free(this._scratchPtr);
      this._scratchPtr = newPtr;
      this._scratchLen = newLen;
    }
    this.bytes().set(data, this._scratchPtr);
    this.bytes()[this._scratchPtr + data.length] = 0;
    return { ptr: this._scratchPtr, len: data.length };
  }

  allocBytes(data) {
    const ptr = this.exports.lw_malloc(data.length || 1);
    if (!ptr) throw new Error("Luau VM: sem memória para alocação");
    this.bytes().set(data, ptr);
    return ptr;
  }
}

export async function instantiateLuauModule(wasmBytesOrResponse, options = {}) {
  let module = null;
  let memoryRef = null;
  const hooks = {
    nativeCall: null,
    proxyDtor: null,
    panic: null,
    stdout: options.onStdout || null,
  };

  const wasi = createWasiShim(
    () => memoryRef,
    {
      onStdout: (line, fd) => {
        if (hooks.stdout) hooks.stdout(line, fd);
      },
    },
  );

  const imports = {
    wasi_snapshot_preview1: wasi,
    env: {
      js_native_call: (L, fnid, nargs) => {
        const state = module ? module.stateFor(L) : null;
        if (!state) {


          if (module) {
            module.exports.lw_settop(L, 0);
            const s = module.scratchWrite("estado Luau já finalizado");
            module.exports.lw_pushlstring(L, s.ptr, s.len);
          }
          return LUA.RC_ERROR;
        }
        return state.handleNativeCall(L, fnid, nargs);
      },
      js_proxy_dtor: (jsid) => {
        for (const state of module.states.values()) {
          if (state.ownsProxyId(jsid)) {
            state.releaseProxyId(jsid);
            return;
          }
        }
      },
      js_panic: (L, errcode) => {
        const state = module.stateFor(L);
        if (state && state.onPanic) state.onPanic(errcode);
      },
      js_debugbreak: (L, line, isStep, srcPtr) => {
        const state = module.stateFor(L);
        if (!state || typeof state.onDebugBreak !== "function") return 0;
        try {
          return state.onDebugBreak(L, line, !!isStep, srcPtr) ? 1 : 0;
        } catch (_) {
          return 0;
        }
      },


      js_thread_event: (parent, thread) => {
        if (!module || !thread) return;
        const state = module.stateFor(thread);
        if (!state || typeof state.onThreadEvent !== "function") return;
        try {
          state.onThreadEvent(parent, thread);
        } catch (_) {                                            }
      },


      emscripten_notify_memory_growth: () => {},
    },
  };

  let instance;
  if (typeof WebAssembly.instantiateStreaming === "function" &&
      typeof Response !== "undefined" && wasmBytesOrResponse instanceof Response) {
    const res = await WebAssembly.instantiateStreaming(wasmBytesOrResponse, imports);
    instance = res.instance;
  } else {
    const res = await WebAssembly.instantiate(wasmBytesOrResponse, imports);
    instance = res.instance || res;
  }

  memoryRef = instance.exports.memory;
  if (typeof instance.exports._initialize === "function") {
    instance.exports._initialize();
  }
  module = new LuauModule(instance);
  module.hooks = hooks;
  return module;
}

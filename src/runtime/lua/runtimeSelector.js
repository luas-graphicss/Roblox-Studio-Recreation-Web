import { instantiateLuauModule } from "./luau/luauModule.js";
import { loadLuauVmGzipBytes } from "./luau/luauVmSource.js";
import { WasmInterpreter } from "./wasmInterpreter.js";
import { logger } from "../../core/logger.js";
import { exposeDebugHandle } from "../../core/debugSurface.js";


try {
  if (typeof localStorage !== "undefined") localStorage.removeItem("rsw.luauEngine");
} catch (_) {                            }

let _module = null;
let _loadPromise = null;
let _loadError = null;

export function preloadLuauVM(baseUrl) {
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    try {
      if (typeof WebAssembly === "undefined") {
        throw new Error("WebAssembly indisponível neste ambiente");
      }
      if (typeof DecompressionStream !== "function") {
        throw new Error("DecompressionStream indisponível (navegador antigo)");
      }
      const gzBytes = await loadLuauVmGzipBytes(baseUrl || "");
      const ds = new DecompressionStream("gzip");
      const decompressed = new Response(new Blob([gzBytes]).stream().pipeThrough(ds));
      const bytes = await decompressed.arrayBuffer();
      const mod = await instantiateLuauModule(bytes);
      _module = mod;
      logger.info("Engine Luau VM (WASM) carregada — scripts com Luau completo.", { source: "Studio" });
      return mod;
    } catch (e) {
      _loadError = e;


      logger.error(
        "VM Luau (WASM) indisponível (" + ((e && e.message) || e) + ") — a engine única de scripts não carregou; Play/Run ficarão indisponíveis. Recarregue a página; se persistir, verifique os assets em assets/luau/.",
        { source: "Studio" },
      );
      return null;
    }
  })();
  return _loadPromise;
}


export function injectLuauModule(mod) {
  _module = mod;
  _loadPromise = Promise.resolve(mod);
}

export function luauRuntimeInfo() {
  let wasmDebug = false;
  try {
    wasmDebug = !!(_module && _module.exports && typeof _module.exports.lw_breakpoint === "function");
  } catch (_) {
    wasmDebug = false;
  }




  return {
    wasmReady: !!_module,
    wasmDebug,
    wasmError: _loadError ? String((_loadError && _loadError.message) || _loadError) : null,
    active: "wasm",
    debugFeatures: {
      breakpoints: wasmDebug,
      step: wasmDebug,
      callStack: wasmDebug,
      locals: wasmDebug,
      watch: wasmDebug,
      logpoints: wasmDebug,
      coroutineStep: wasmDebug,
      watchWrite: wasmDebug,
      streamIdentity: true,
    },
  };
}

export function createRuntimeInterpreter(options = {}) {


  if (!_module) {
    throw new Error(
      "VM Luau (WASM) não carregada" +
        (_loadError ? " (" + String((_loadError && _loadError.message) || _loadError) + ")" : "") +
        " — a engine única de scripts exige a VM (Parte 174). Recarregue a página; se persistir, verifique os assets em assets/luau/.",
    );
  }
  return new WasmInterpreter(_module, options);
}









exposeDebugHandle("__rswLuaRuntime", {
  preloadLuauVM,
  createRuntimeInterpreter,
  luauRuntimeInfo,
});

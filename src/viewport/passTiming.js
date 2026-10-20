import { createPassLedger } from "../lighting/passTimingCore.js";
import { createGpuTimingFrameBuffer } from './gpuTimingFrameBuffer.js';
const ADD_CPU = Object.freeze({ kind: "cpu" });
const ADD_CPU_EST = Object.freeze({ kind: "cpu-estimado", estimated: true });


const MAX_PENDING = 96;
const MAX_GL_ERRORS = 3;

export function createPassTiming({ renderer }) {
  const ledger = createPassLedger({});
  const gpuFrames = createGpuTimingFrameBuffer({ publish: ledger.recordResolvedFrame });
  let gl = null;
  try {
    gl = renderer && typeof renderer.getContext === "function" ? renderer.getContext() : null;
  } catch (_e) {
    gl = null;
  }
  let ext = null;
  try {
    const isGl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    ext = isGl2 && typeof gl.getExtension === "function" ? gl.getExtension("EXT_disjoint_timer_query_webgl2") : null;
  } catch (_e) {
    ext = null;
  }
  let gpuMode = !!(ext && gl);
  ledger.setMode(
    gpuMode ? "gpu-timer" : "cpu-estimado",
    gpuMode
      ? "EXT_disjoint_timer_query_webgl2 ativo"
      : "timer query de GPU indisponível nesta GPU/driver — estimativa por CPU (contrato declarado na F1)",
  );

  const freeQueries = [];
  const pending = [];                                                  
  const slotPool = [];
  let activeQuery = null;                                              
  let activeCpuName = "";
  let activeCpuT0 = -1;                             
  let cpuName = "";
  let cpuT0 = -1;                                                
  let selfMs = 0;
  let glErrors = 0;
  let recovered = 0;
  let disposed = false;

  function now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }

  function takeSlot(q, name) {
    const s = slotPool.length ? slotPool.pop() : { q: null, name: "" };
    s.q = q;
    s.name = name;
    s.frame = gpuFrames.captureQuery();
    return s;
  }

  function releaseSlot(s, keepQuery) {
    if (s.frame) { gpuFrames.discardQuery(s.frame); s.frame = null; }
    if (s.q && !keepQuery) {
      try { gl.deleteQuery(s.q); } catch (_e) {                                }
    }
    s.q = null;
    s.name = "";
    slotPool.push(s);
  }

  function dropToCpu(reason) {
    if (!gpuMode) return;
    gpuMode = false;
    ledger.setMode("cpu-estimado", reason);
    try {
      while (pending.length) releaseSlot(pending.pop(), false);
      while (freeQueries.length) {
        const q = freeQueries.pop();
        try { gl.deleteQuery(q); } catch (_e) {                  }
      }
    } catch (_e) {                   }
  }

  function pollPending() {
    if (!gpuMode || pending.length === 0) return;
    try {
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {

        while (pending.length) {
          const s = pending.shift();
          freeQueries.push(s.q);
          s.q = null;
          releaseSlot(s, true);
        }
        return;
      }

      while (pending.length) {
        const s = pending[0];
        if (!gl.getQueryParameter(s.q, gl.QUERY_RESULT_AVAILABLE)) break;
        const ns = gl.getQueryParameter(s.q, gl.QUERY_RESULT);
        pending.shift();
        freeQueries.push(s.q);
        gpuFrames.resolveQuery(s.frame, s.name, Number(ns) / 1e6);
        s.frame = null;
        s.q = null;
        releaseSlot(s, true);
      }
      if (pending.length > MAX_PENDING) {
        dropToCpu("resultados de timer query nunca ficam prontos nesta GPU/driver — estimativa por CPU");
      }
    } catch (_e) {
      glErrors += 1;
      if (glErrors >= MAX_GL_ERRORS) dropToCpu("erros repetidos ao ler timer queries — estimativa por CPU");
    }
  }


  function begin(name) {
    if (disposed) return;
    const t0 = now();
    if (activeQuery || activeCpuT0 >= 0) end();
    if (gpuMode) {
      let q = null;
      try {
        q = freeQueries.length ? freeQueries.pop() : gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        activeQuery = takeSlot(q, name);
      } catch (_e) {
        glErrors += 1;


        if (q) { try { gl.deleteQuery(q); } catch (_e2) {                       } }
        activeQuery = null;
        activeCpuName = name;
        activeCpuT0 = now();
        if (glErrors >= MAX_GL_ERRORS) dropToCpu("beginQuery falhou repetidamente — estimativa por CPU");
      }
    } else {
      activeCpuName = name;
      activeCpuT0 = now();
    }
    selfMs += now() - t0;
  }


  function end(overrideName) {
    const t0 = now();
    if (activeQuery) {
      try {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        if (typeof overrideName === "string" && overrideName) activeQuery.name = overrideName;
        pending.push(activeQuery);
      } catch (_e) {
        glErrors += 1;
        releaseSlot(activeQuery, false);
        if (glErrors >= MAX_GL_ERRORS) dropToCpu("endQuery falhou — estimativa por CPU");
      }
      activeQuery = null;
    } else if (activeCpuT0 >= 0) {
      const nm = typeof overrideName === "string" && overrideName ? overrideName : activeCpuName;

      ledger.add(nm, t0 - activeCpuT0, ADD_CPU_EST);
      activeCpuT0 = -1;
      activeCpuName = "";
    }
    selfMs += now() - t0;
  }


  function beginCpu(name) {
    if (disposed) return;
    if (cpuT0 >= 0) endCpu();
    cpuName = name;
    cpuT0 = now();
  }

  function endCpu() {
    if (cpuT0 < 0) return;
    ledger.add(cpuName, now() - cpuT0, ADD_CPU);
    cpuT0 = -1;
    cpuName = "";
  }

  function setFrameFlag(name) {
    if (disposed) return;
    ledger.setFlag(name);
    gpuFrames.setFlag(name);
  }


  function frameStart() {
    if (disposed) return;
    const t0 = now();


    let hadOrphan = false;
    if (activeQuery) {
      try { gl.endQuery(ext.TIME_ELAPSED_EXT); } catch (_e) {                  }
      releaseSlot(activeQuery, false);
      activeQuery = null;
      hadOrphan = true;
    }
    if (activeCpuT0 >= 0) {
      activeCpuT0 = -1;
      activeCpuName = "";
      hadOrphan = true;
    }
    if (cpuT0 >= 0) {
      cpuT0 = -1;
      cpuName = "";
      hadOrphan = true;
    }
    if (hadOrphan) recovered += 1;







    ledger.beginFrame();
    gpuFrames.beginFrame();
    pollPending();
    selfMs = now() - t0;
  }


  function frameEnd() {
    if (disposed) return;
    const t0 = now();
    if (activeQuery || activeCpuT0 >= 0) end();
    if (cpuT0 >= 0) endCpu();
    ledger.add("ledger", selfMs + (now() - t0), ADD_CPU);
    ledger.endFrame();
    gpuFrames.endFrame();
  }

  function getLedger() {
    const view = ledger.getLedger();
    view.pendingQueries = pending.length;
    view.recoveredFrames = recovered;
    return view;
  }

  function dispose() {
    if (disposed) return;
    if (activeQuery) {
      try { gl.endQuery(ext.TIME_ELAPSED_EXT); } catch (_e) {                                }
      releaseSlot(activeQuery, false);
      activeQuery = null;
    }


    activeCpuT0 = -1;
    activeCpuName = "";
    cpuT0 = -1;
    cpuName = "";
    dropToCpu("medidor descartado (dispose)");
    gpuFrames.endFrame();
    disposed = true;
  }

  return {
    frameStart,
    frameEnd,
    begin,
    end,
    beginCpu,
    endCpu,
    setFrameFlag,
    getLedger,
    isGpuTimer: () => gpuMode,
    dispose,
  };
}

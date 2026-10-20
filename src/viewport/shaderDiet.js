import { registerFrameCallback } from "../core/frameDriver.js";
import { detectGpuBudget } from "../lighting/gpuBudget.js";
import {
  DIET_GATES,
  applyTextureBudget,
  createRebindAudit,
  dietProfile,
  maskPrecisionHeader,
  maskRtOptions,
  precisionForSignal,
} from "../lighting/shaderDietCore.js";

export function createShaderDiet({ renderer, weakGpu } = {}) {


  let weak = !!weakGpu;
  if (weakGpu === undefined) {
    try {
      const b = renderer ? detectGpuBudget(renderer) : null;
      weak = !!(b && b.weak);
    } catch (_e) {
      weak = false;
    }
  }


  function flagValue() {
    if (typeof window !== "undefined") {
      if (window.__rswDietaF18 === false) return false;
      if (window.__rswDietaF18 === true) return true;
    }
    return undefined;
  }

  function profile() {
    return dietProfile({ weak, flag: flagValue() });
  }

  function active() {
    return profile().active;
  }


  const audit = createRebindAudit();
  let auditOn = false;
  let unregisterFrameCallback = null;
  let wrapped = null;                                                    


  function closeAuditedFrame() {
    if (!auditOn) return;
    audit.endFrame();
  }

  function auditStart() {
    if (auditOn || !renderer || typeof renderer.getContext !== "function") return false;
    let gl = null;
    try {
      gl = renderer.getContext();
    } catch (_e) {
      gl = null;
    }
    if (!gl || typeof gl.useProgram !== "function") return false;
    const orig = {
      gl,
      useProgram: gl.useProgram,
      bindTexture: gl.bindTexture,
      bindFramebuffer: gl.bindFramebuffer,
      activeTexture: gl.activeTexture,
    };


    let curUnit = typeof gl.TEXTURE0 === "number" ? gl.TEXTURE0 : 0x84c0;
    gl.useProgram = function (p) {
      audit.note("program", "", p);
      return orig.useProgram.call(gl, p);
    };
    if (typeof orig.activeTexture === "function") {
      gl.activeTexture = function (unit) {
        curUnit = unit;
        return orig.activeTexture.call(gl, unit);
      };
    }
    gl.bindTexture = function (target, tex) {
      audit.note("texture", target + "@" + curUnit, tex);
      return orig.bindTexture.call(gl, target, tex);
    };
    gl.bindFramebuffer = function (target, fb) {
      audit.note("framebuffer", target, fb);
      return orig.bindFramebuffer.call(gl, target, fb);
    };
    wrapped = orig;
    audit.reset();
    auditOn = true;


    unregisterFrameCallback = registerFrameCallback(
      "overlay",
      closeAuditedFrame,
      "shaderDietRebindAudit",
    );
    return true;
  }

  function auditStop() {
    if (!auditOn) return audit.get();
    auditOn = false;
    if (unregisterFrameCallback) unregisterFrameCallback();
    unregisterFrameCallback = null;
    if (wrapped && wrapped.gl) {
      wrapped.gl.useProgram = wrapped.useProgram;
      wrapped.gl.bindTexture = wrapped.bindTexture;
      wrapped.gl.bindFramebuffer = wrapped.bindFramebuffer;


      if (typeof wrapped.activeTexture === "function") {
        wrapped.gl.activeTexture = wrapped.activeTexture;
      }
    }
    wrapped = null;
    return audit.get();
  }

  function getState() {
    const p = profile();
    return {
      active: p.active,
      weakGpu: weak,
      flag: typeof window !== "undefined" && "__rswDietaF18" in window ? window.__rswDietaF18 : "auto",
      maskPrecision: p.maskPrecision,
      depthPrecision: p.depthPrecision,                                
      rtMaskFormat: p.rtMaskFormat,
      gates: DIET_GATES,
      audit: Object.assign({ on: auditOn }, audit.get()),
    };
  }

  function dispose() {
    auditStop();
    if (
      typeof window !== "undefined" &&
      window.__rswShaderDiet &&
      window.__rswShaderDiet.getState === getState
    ) {
      delete window.__rswShaderDiet;
    }
  }


  if (typeof window !== "undefined" && !window.__rswShaderDiet) {
    window.__rswShaderDiet = { auditStart, auditStop, getState };
  }

  return {
    active,
    profile,
    getState,
    auditStart,
    auditStop,
    dispose,

    maskRtOptions: () => maskRtOptions(profile()),
    maskPrecisionHeader: () => maskPrecisionHeader(profile()),
    precisionForSignal: (signal) => precisionForSignal(signal, profile()),
    applyTextureBudget: (tex) => applyTextureBudget(tex, profile()),
  };
}

export const GPU_BUDGET_LIMITS = Object.freeze({
  weakSunShadowRes: 2048,                                                     
  fullSunShadowRes: 4096,                           
  minSunShadowRes: 512,                         
});


const WEAK_GPU_PATTERNS = Object.freeze([
  /swiftshader/i,
  /llvmpipe/i,
  /software\s*(rasterizer|renderer)/i,
  /microsoft basic render/i,
  /\bmali\b/i,
  /adreno/i,
  /videocore/i,
  /powervr/i,
  /intel(\(r\))?\s*(hd|uhd)\s*graphics/i,


  /\b(vs|ps)_[1-3]_\d\b/i,
  /\b(vs|ps)_4_[01]\b/i,
  /_level_9_\d/i,
  /geforce\s*(?:g\s?|gt\s|gts\s)?[123]\d{2}\b/i,
  /geforce\s*[89]\d{3}\b/i,
  /radeon\s*hd\s*[2-4]\d{3}\b/i,
]);

export function classifyGpu(input) {
  const src = input && typeof input === "object" ? input : {};
  const rs = typeof src.rendererString === "string" ? src.rendererString : "";
  const maxTex = Number.isFinite(src.maxTextureSize) && src.maxTextureSize > 0 ? src.maxTextureSize : 0;
  const maxRb = Number.isFinite(src.maxRenderbufferSize) && src.maxRenderbufferSize > 0 ? src.maxRenderbufferSize : maxTex;

  const hwCap = Math.max(
    GPU_BUDGET_LIMITS.minSunShadowRes,
    Math.min(maxTex || GPU_BUDGET_LIMITS.weakSunShadowRes, maxRb || maxTex || GPU_BUDGET_LIMITS.weakSunShadowRes),
  );
  let weak = false;
  let reason = "";
  for (const re of WEAK_GPU_PATTERNS) {
    if (re.test(rs)) {
      weak = true;
      reason = "GPU de baixo orçamento detectada: " + rs;
      break;
    }
  }
  if (!weak && hwCap < GPU_BUDGET_LIMITS.fullSunShadowRes) {
    weak = true;
    reason = "teto de textura da GPU: " + hwCap + "px";
  }
  if (!weak && !rs && !maxTex) {
    weak = true;
    reason = "sem informação da GPU (perfil conservador)";
  }
  const maxSunShadowRes = Math.max(
    GPU_BUDGET_LIMITS.minSunShadowRes,
    Math.min(weak ? GPU_BUDGET_LIMITS.weakSunShadowRes : GPU_BUDGET_LIMITS.fullSunShadowRes, hwCap),
  );
  return { weak, maxSunShadowRes, reason };
}

export function detectGpuBudget(renderer) {
  try {
    const gl = renderer && typeof renderer.getContext === "function" ? renderer.getContext() : null;
    if (!gl || typeof gl.getParameter !== "function") return classifyGpu({});
    let rendererString = "";
    try {
      const dbg = typeof gl.getExtension === "function" ? gl.getExtension("WEBGL_debug_renderer_info") : null;
      if (dbg) rendererString = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "");
      if (!rendererString) rendererString = String(gl.getParameter(gl.RENDERER) || "");
    } catch (_) {

    }
    return classifyGpu({
      rendererString,
      maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0,
      maxRenderbufferSize: Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 0,
    });
  } catch (_) {
    return classifyGpu({});
  }
}

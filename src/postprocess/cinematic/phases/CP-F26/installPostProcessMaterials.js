import { MATERIAL_SESSION_KEY } from "./materialContract.js";
import { createPostProcessMaterialSession, requireMaterialSession } from "./materialSession.js";
import { createMaterialRuntime } from "./materialRuntime.js";

export function installPostProcessMaterials(services, suppliedSession, { tonemapperOwner = "CP-F26" } = {}) {
  if (!["CP-F26", "CP-F11"].includes(tonemapperOwner)) throw new TypeError("Unknown tonemapper owner");
  const session = requireMaterialSession(suppliedSession ?? services.settings?.get?.(MATERIAL_SESSION_KEY) ?? createPostProcessMaterialSession());
  if (!services.graph?.register || !services.pool?.acquire || !services.pool?.release || !services.rendererAdapter?.createMaterial || !services.rendererAdapter?.draw) throw new TypeError("CP-F26 requires the B00 graph, target pool and renderer adapter");
  if (!services.capabilities?.webgl2 || !services.capabilities.floatColorBuffer) throw new Error("CP-F26 requires WebGL2 and floating-point render targets");
  const passes = session.plan.passes.filter((pass) => tonemapperOwner === "CP-F26" || pass.material.location !== "replacingTonemapper");
  const unregisters = [];
  const runtimes = [];
  let disposed = false;
  function cleanup() {
    if (disposed) return;
    disposed = true;
    for (const unregister of unregisters.reverse()) unregister();
    for (const runtime of runtimes) runtime.dispose();
  }
  try {
    for (const pass of passes) {
      if (pass.material.inputs.length + 1 > services.capabilities.maxTextureUnits) throw new Error("CP-F26 material exceeds the sampler budget");
      const runtime = createMaterialRuntime(services, pass.material, session);
      runtimes.push(runtime);
      unregisters.push(services.graph.register({ ...pass, execute: runtime.execute, dispose: runtime.dispose }));
    }
    services.report?.({ phase: "CP-F26", event: "materials-installed", status: "implemented", activeConsumers: passes.length, tonemapperOwner, invalidPixelPolicy: "identity for same-domain materials; magenta diagnostic for replacement", rejected: session.plan.rejected, referenceVerified: false, certification: "BLOCKED_REFERENCE", sourceProfile: "engineering-post-process-materials-v1" });
  } catch (error) { cleanup(); throw error; }
  cleanup.releaseView = (viewId) => { for (const runtime of runtimes) runtime.releaseView(viewId); };
  return cleanup;
}

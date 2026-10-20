import { DOF_TEMPORAL_OWNER, DOF_TEMPORAL_BINDINGS, DOF_TEMPORAL_RESOURCES } from "./dofTemporalContract.js";
import { resolveDofBindings, assertDofBindingsUnchanged } from "./dofInputBindings.js";
import { createDofGpuMaterials } from "./dofGpuMaterials.js";
import { createDofTemporalSessions } from "./dofTemporalSessions.js";
import { createDofGuidePass } from "./dofGuidePass.js";
import { createDofColorPass } from "./dofColorPass.js";
import { createDofTranslucencyPass } from "./dofTranslucencyPass.js";
import { makeDofValueResource } from "./dofResourceMetadata.js";

export function installDofTemporal(services) {
  if (typeof services.settings?.get !== "function") throw new Error("CP-F20 requires the settings service");
  const bindings = resolveDofBindings(services.settings.get(DOF_TEMPORAL_BINDINGS));
  const removers = [];
  let materials;
  let sessions;
  let disposed = false;
  function cleanup() {
    if (disposed) return;
    disposed = true;
    for (const remove of removers.splice(0).reverse()) remove();
    sessions?.dispose();
    materials?.dispose();
    services.pool?.releaseOwner(DOF_TEMPORAL_OWNER);
  }
  try {
    if (!bindings) {
      removers.push(services.graph.register({ id: "CP-F20.unboundStatus", owner: DOF_TEMPORAL_OWNER, stage: "dof", order: 2000, reads: [], writes: [DOF_TEMPORAL_RESOURCES.diagnostics], transformsColor: false,
        execute(context) {
          assertDofBindingsUnchanged(services.settings, null);
          const status = Object.freeze({ phase: DOF_TEMPORAL_OWNER, status: "blocked-inputs", effectConnected: false, reason: "Bind actual CoC, linear depth, complete velocity, coverage and reactive producers; current color must be recombined bokeh", referenceVerified: false });
          context.publish(DOF_TEMPORAL_RESOURCES.diagnostics, makeDofValueResource(context.frame, status));
          services.report?.(status);
        }
      }));
    } else {
      if (!services.capabilities?.webgl2 || !services.capabilities?.floatColorBuffer || !Number.isInteger(services.capabilities.maxTextureUnits) || services.capabilities.maxTextureUnits < 9) throw new Error("CP-F20 requires WebGL2 float rendering and nine fragment texture units");
      materials = createDofGpuMaterials(services.rendererAdapter, Boolean(bindings.translucencyAfterDof));
      sessions = createDofTemporalSessions(services);
      removers.push(services.graph.register(createDofGuidePass(services, bindings, sessions, materials)));
      removers.push(services.graph.register(createDofColorPass(services, bindings, sessions, materials)));
      if (bindings.translucencyAfterDof) removers.push(services.graph.register(createDofTranslucencyPass(services, bindings, materials)));
    }
    services.report?.({ phase: DOF_TEMPORAL_OWNER, status: bindings ? "implemented-bound" : "blocked-inputs", effectConnected: Boolean(bindings), referenceVerified: false });
    return cleanup;
  } catch (error) { cleanup(); throw error; }
}

import { makeTextureResource } from "../../contracts/frameContract.js";
import { DIAPHRAGM_OWNER, DIAPHRAGM_RESOURCES as resources } from "./diaphragmContract.js";
import { createDiaphragmSettingsReader, resolveDiaphragmBindings } from "./diaphragmSettings.js";
import { createDiaphragmPlan } from "./diaphragmBudget.js";
import { validateDiaphragmInputs } from "./diaphragmInputs.js";
import { createDiaphragmRenderer } from "./createDiaphragmRenderer.js";
import { makeDiaphragmColor, makeDiaphragmLayer, makeDiaphragmDiagnostics } from "./diaphragmOutputResources.js";

export function installDiaphragmDof(services) {
  const { graph, settings: store, rendererAdapter, pool, capabilities, report } = services;
  if (!capabilities?.webgl2 || !capabilities.floatColorBuffer) throw new Error("CP-F19 requires WebGL2 floating-point targets; no RGBA8 fallback");
  const readSettings = createDiaphragmSettingsReader(store);
  const bindings = resolveDiaphragmBindings(store?.get?.("CP-F19.bindings"));
  if (readSettings().enabled && !bindings) throw new Error("CP-F19 BLOCKED_DEPENDENCY: bind CP-F18-compatible CoC and surface before installation");
  const renderer = createDiaphragmRenderer(rendererAdapter, pool);
  let unregister, disposed = false;
  try {
    unregister = graph.register({
      id: "CP-F19.diaphragm", owner: DIAPHRAGM_OWNER, stage: "dof", order: 1900,
      reads: bindings ? ["$color", bindings.coc, bindings.surface] : ["$color"], writes: Object.values(resources), transformsColor: true,
      execute(context) {
        const settings = readSettings();
        const currentBindings = resolveDiaphragmBindings(store?.get?.("CP-F19.bindings"));
        if (bindings?.coc !== currentBindings?.coc || bindings?.surface !== currentBindings?.surface) throw new Error("CP-F19 bindings changed; reinstall to preserve declared dependencies");
        if (settings.enabled && !bindings) throw new Error("CP-F19 BLOCKED_DEPENDENCY: no CoC provider; no synthetic runtime fallback");
        const source = context.read("$color"), coc = bindings ? context.read(bindings.coc) : null, surface = bindings ? context.read(bindings.surface) : null;
        try {
          const metadata = validateDiaphragmInputs(source, coc, surface, context.frame, settings.enabled);
          const plan = createDiaphragmPlan(source, settings, metadata.maxima, capabilities);
          const targets = renderer.render(source, coc, surface, settings, plan, metadata);
          const color = makeDiaphragmColor(targets.color, context.frame, source, metadata);
          context.publish(resources.normalization, makeTextureResource(targets.normalization, context.frame, "reciprocal-aperture-weight-or-negative-invalid-v1"));
          context.publish(resources.near, makeDiaphragmLayer(targets.near, context.frame, "dof-near-straight-radiance-coverage-v1", source, metadata));
          context.publish(resources.far, makeDiaphragmLayer(targets.far, context.frame, "dof-far-straight-radiance-support-v1", source, metadata));
          context.publish(resources.filledFar, makeDiaphragmLayer(targets.filledFar, context.frame, "dof-background-confidence-v1", source, metadata));
          context.publish(resources.color, color);
          context.publish(resources.diagnostics, makeDiaphragmDiagnostics(context.frame, settings, plan, bindings, source, coc, metadata));
          return { color };
        } catch (error) { report?.({ phase: DIAPHRAGM_OWNER, status: "blocked", reason: error.message }); throw error; }
      }
    });
    report?.({ phase: DIAPHRAGM_OWNER, status: "implemented", enabled: readSettings().enabled, bindings, referenceStatus: "BLOCKED_REFERENCE" });
  } catch (error) { renderer.dispose(); throw error; }
  return () => { if (disposed) return; disposed = true; unregister(); renderer.dispose(); };
}

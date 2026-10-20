import { makeTextureResource } from "../../contracts/frameContract.js";
import { MATERIAL_QUALITY_TIERS } from "./materialContract.js";
import { resolveMaterialExtent } from "./materialOutput.js";
import { validateMaterialDomain, describeMaterialInput } from "./materialSampling.js";
import { updateMaterialUniforms } from "./materialUniforms.js";
import { createMaterialProgramCache } from "./materialGpuPrograms.js";
import { createMaterialTargetStore } from "./materialTargets.js";
import { readMaterialVolumeWeight } from "./materialVolumeBridge.js";

export function createMaterialRuntime(services, definition, session) {
  const adapter = services.rendererAdapter;
  const programs = createMaterialProgramCache(adapter, definition);
  const targets = createMaterialTargetStore(services.pool, definition.id);
  const reported = new Set();
  let disposed = false;

  function reportFailure(error, frame, shaderErrors = []) {
    const key = `${frame.generation}:${error.message}`;
    if (reported.has(key)) return;
    if (reported.size >= 64) reported.delete(reported.values().next().value);
    reported.add(key);
    services.report?.({ phase: "CP-F26", material: definition.id, event: "material-isolated", message: error.message, frameId: frame.frameId, viewId: frame.viewId, shaderErrors, fallback: "distinct-target-copy", referenceVerified: false });
  }

  function execute(context) {
    if (disposed) throw new Error("Material runtime is disposed");
    if (context.frame.referenceMode) throw new Error("CP-F26 BLOCKED_REFERENCE: no verified UE5.9 material profile");
    if (adapter.context?.isContextLost?.()) throw new Error("CP-F26 rendering blocked by device context loss");
    const source = context.read(definition.source);
    describeMaterialInput(source, context.frame, definition.source);
    const tier = context.frame.qualityTier;
    if (!MATERIAL_QUALITY_TIERS.includes(tier)) throw new Error(`Unsupported material quality tier: ${tier}`);
    const extent = resolveMaterialExtent(definition.output, source.viewRect ?? source, context.frame, services.capabilities.maxTextureSize);
    const target = targets.acquire(context.frame, extent);
    if (definition.reads.some((name) => context.read(name)?.texture === target.texture)) throw new Error("CP-F26 rejects actual GPU texture read/write feedback");
    const previousErrors = adapter.errors?.() ?? [];
    if (previousErrors.length) throw new Error("CP-F26 refuses to hide a pre-existing renderer shader failure");
    const controls = session.get(definition.id);
    let successful = false;
    let failure = null;
    try {
      const preExposure = validateMaterialDomain(definition, source);
      if (!controls.enabled || controls.weight === 0) programs.copy(source, target, context.frame);
      else {
        const program = programs.get(tier);
        updateMaterialUniforms(program.uniforms, definition, controls, context, source, extent, preExposure, readMaterialVolumeWeight(definition.volumeWeight, context));
        adapter.draw(program, target);
        successful = true;
      }
    } catch (error) {
      failure = error.message;
      const shaderErrors = adapter.errors?.() ?? [];
      reportFailure(error, context.frame, shaderErrors);
      if (shaderErrors.length) adapter.clearErrors?.();
      if (shaderErrors.length || /shader|compile|link|program/i.test(error.message)) programs.refuse(tier, error);
      if (adapter.context) for (let index = 0; index < 8; index += 1) if (adapter.context.getError() === adapter.context.NO_ERROR) break;
      programs.copy(source, target, context.frame);
    }
    const replacing = definition.location === "replacingTonemapper" && successful;
    const encoding = successful && definition.output.encoding !== "preserve" ? definition.output.encoding : source.encoding;
    const resource = Object.freeze({
      ...(encoding === source.encoding ? source : {}),
      ...makeTextureResource(target, context.frame, encoding),
      viewRect: Object.freeze({ x: 0, y: 0, width: target.width, height: target.height }),
      lifetime: definition.output.lifetime,
      storageLifetime: "view-generation-until-resize-or-dispose",
      materialId: definition.id,
      materialApplied: successful,
      invalidPixelPolicy: definition.location === "replacingTonemapper" ? "display-magenta" : "input-identity",
      materialError: failure,
      sourceProvenance: source.provenance,
      ...(replacing ? { preExposure: 1, transfer: encoding === "display-srgb" ? "srgb" : "linear", colorMetadata: Object.freeze({ toneMapper: `CP-F26.${definition.id}`, referenceVerified: false }) } : {})
    });
    context.publish(definition.output.name, resource);
    return definition.output.transformsColor ? { color: resource } : undefined;
  }

  return Object.freeze({
    execute,
    releaseView: (viewId) => targets.releaseView(viewId),
    dispose() { if (disposed) return; disposed = true; programs.dispose(); targets.dispose(); reported.clear(); }
  });
}

import { makeTextureResource } from "../../contracts/frameContract.js";
import { DOF_TEMPORAL_OWNER, DOF_TEMPORAL_RESOURCES } from "./dofTemporalContract.js";
import { validateDofColor, readDofPreExposure, isRepresentableDofExposure } from "./dofInputValidation.js";
import { makeDofColorResource } from "./dofResourceMetadata.js";

export function createDofTranslucencyPass(services, bindings, materials) {
  return {
    id: "CP-F20.composeAfterDof", owner: DOF_TEMPORAL_OWNER, stage: "afterDof", order: 2000,
    reads: ["$color", bindings.translucencyAfterDof],
    writes: [DOF_TEMPORAL_RESOURCES.compositedColor, DOF_TEMPORAL_RESOURCES.compositionRange], transformsColor: true,
    execute(context) {
      const source = validateDofColor(context.read("$color"), context.frame);
      const layer = validateDofColor(context.read(bindings.translucencyAfterDof), context.frame);
      if (layer.alphaMode !== "premultiplied" || layer.compositingStage !== "afterDof" || layer.composited === true) throw new Error("CP-F20 requires an uncomposited premultiplied afterDof layer with explicit ownership");
      const layerExposureScale = readDofPreExposure(source) / readDofPreExposure(layer);
      if (!isRepresentableDofExposure(layerExposureScale)) throw new Error("CP-F20 translucency exposure ratio is unrepresentable");
      const prefix = `CP-F20.composition.${encodeURIComponent(context.frame.viewId)}`;
      const descriptor = { ...context.frame.renderSize, depth: false, filter: "nearest" };
      const outputTarget = services.pool.acquire(DOF_TEMPORAL_OWNER, `${prefix}.color`, { ...descriptor, format: "rgba16f" });
      const rangeTarget = services.pool.acquire(DOF_TEMPORAL_OWNER, `${prefix}.range`, { ...descriptor, format: "rgba8" });
      try {
        const uniforms = { uOpaque: source.texture, uTranslucency: layer.texture, uLayerExposureScale: layerExposureScale };
        materials.draw("translucency", { ...uniforms, uWriteRange: false }, outputTarget);
        materials.draw("translucency", { ...uniforms, uWriteRange: true }, rangeTarget);
        const output = Object.freeze({ ...makeDofColorResource(outputTarget, context.frame, source), alphaMode: "premultiplied", afterDofLayer: bindings.translucencyAfterDof, rangePolicy: "flagged-fp16-saturation", rangeResource: DOF_TEMPORAL_RESOURCES.compositionRange });
        context.publish(DOF_TEMPORAL_RESOURCES.compositedColor, output);
        context.publish(DOF_TEMPORAL_RESOURCES.compositionRange, makeTextureResource(rangeTarget, context.frame, "CP-F20.composition-invalid-range"));
        return { color: output };
      } finally { materials.clearSamplers(); }
    }
  };
}

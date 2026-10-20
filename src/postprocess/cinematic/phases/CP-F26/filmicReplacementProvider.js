import { requireMaterialSession } from "./materialSession.js";
import { createMaterialShader } from "./materialShader.js";
import { createMaterialUniforms, updateMaterialUniforms } from "./materialUniforms.js";
import { MATERIAL_QUALITY_TIERS } from "./materialContract.js";
import { validateMaterialDomain } from "./materialSampling.js";

export function createFilmicMaterialReplacement(session, materialId, qualityTier = "high") {
  requireMaterialSession(session);
  const definition = session.plan.materials.find((material) => material.id === materialId);
  if (!definition || definition.location !== "replacingTonemapper") throw new TypeError("Expected a replacingTonemapper material");
  if (definition.inputs.length || definition.volumeWeight) throw new Error("CP-F11 replacement v1 supports only $color; lateral inputs require an integrator-reviewed extension");
  if (!MATERIAL_QUALITY_TIERS.includes(qualityTier)) throw new TypeError("Unsupported replacement quality tier");
  return Object.freeze({
    id: `CP-F26.${definition.id}`,
    fragmentShader: createMaterialShader(definition, qualityTier),
    outputEncoding: definition.output.encoding,
    outputMetadata: Object.freeze({ materialId, referenceVerified: false, profile: "engineering-post-process-materials-v1", qualityTier }),
    createUniforms: () => createMaterialUniforms(definition),
    updateUniforms({ uniforms, frame, source }) {
      if (frame.referenceMode) throw new Error("CP-F26 BLOCKED_REFERENCE");
      if (frame.qualityTier !== qualityTier) throw new Error("CP-F11 replacement quality changed; recreate the provider instead of silently retaining a shader permutation");
      const preExposure = validateMaterialDomain(definition, source);
      updateMaterialUniforms(uniforms, definition, session.get(materialId), { frame, read: () => source }, source, source, preExposure);
    }
  });
}

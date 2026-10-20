import { createMaterialShader, MATERIAL_COPY_SHADER } from "./materialShader.js";
import { createMaterialUniforms, bindMaterialTexture } from "./materialUniforms.js";

export function createMaterialProgramCache(adapter, definition) {
  const programs = new Map();
  const refused = new Map();
  let copyProgram = null;
  let disposed = false;
  return Object.freeze({
    get(tier) {
      if (disposed) throw new Error("Material program cache is disposed");
      if (refused.has(tier)) throw new Error(refused.get(tier));
      if (!programs.has(tier)) programs.set(tier, adapter.createMaterial(createMaterialShader(definition, tier), createMaterialUniforms(definition)));
      return programs.get(tier);
    },
    refuse(tier, error) {
      programs.get(tier)?.dispose();
      programs.delete(tier);
      refused.set(tier, error.message);
    },
    copy(source, target, frame) {
      if (disposed) throw new Error("Material program cache is disposed");
      copyProgram ??= adapter.createMaterial(MATERIAL_COPY_SHADER, createMaterialUniforms({ inputs: [], parameters: {} }));
      bindMaterialTexture(copyProgram.uniforms, "Input", source, frame);
      adapter.draw(copyProgram, target);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const program of programs.values()) program.dispose();
      copyProgram?.dispose();
      programs.clear();
      refused.clear();
    }
  });
}

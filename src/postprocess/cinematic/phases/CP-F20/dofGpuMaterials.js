import { DOF_COC_STABILIZATION_FRAGMENT } from "./dofCocStabilization.glsl.js";
import { DOF_EDGE_REDUCTION_FRAGMENT } from "./dofEdgeAwareReduction.glsl.js";
import { DOF_TEMPORAL_RESOLVE_FRAGMENT } from "./dofTemporalResolve.glsl.js";
import { DOF_TRANSLUCENCY_FRAGMENT } from "./dofTranslucency.glsl.js";

function createUniforms(fragment) {
  const uniforms = {};
  for (const match of fragment.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)) uniforms[match[1]] = { value: null };
  return uniforms;
}

export function createDofGpuMaterials(adapter, withTranslucency) {
  if (typeof adapter?.createMaterial !== "function" || typeof adapter?.draw !== "function") throw new Error("CP-F20 requires the B00 GPU adapter");
  const materials = {};
  try {
    for (const [name, fragment] of Object.entries({ guide: DOF_COC_STABILIZATION_FRAGMENT, reduction: DOF_EDGE_REDUCTION_FRAGMENT, resolve: DOF_TEMPORAL_RESOLVE_FRAGMENT, ...(withTranslucency ? { translucency: DOF_TRANSLUCENCY_FRAGMENT } : {}) })) materials[name] = adapter.createMaterial(fragment, createUniforms(fragment));
  } catch (error) {
    for (const material of Object.values(materials)) material.dispose();
    throw error;
  }
  let disposed = false;
  return Object.freeze({
    get(name) { if (disposed) throw new Error("CP-F20 materials are disposed"); return materials[name]; },
    draw(name, values, target) {
      if (disposed) throw new Error("CP-F20 materials are disposed");
      const material = materials[name];
      for (const [key, value] of Object.entries(values)) {
        if (!material.uniforms[key]) throw new Error(`Unknown CP-F20 uniform ${key}`);
        material.uniforms[key].value = value;
      }
      adapter.draw(material, target);
    },
    clearSamplers() {
      for (const material of Object.values(materials)) for (const match of material.fragmentShader.matchAll(/uniform\s+sampler2D\s+(\w+)\s*;/g)) material.uniforms[match[1]].value = null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of Object.values(materials)) material.dispose();
    }
  });
}

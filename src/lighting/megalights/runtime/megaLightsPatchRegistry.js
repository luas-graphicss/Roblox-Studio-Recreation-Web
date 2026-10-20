import { mlQa } from "./megaLightsTelemetry.js";


let shaderLibrary = null;


export function setShaderLibrary(library) {
  shaderLibrary = library && library.ShaderChunk ? library : null;
  return !!shaderLibrary;
}

export function hasShaderLibrary() {
  return !!shaderLibrary;
}

export function threeRevision() {
  return shaderLibrary ? shaderLibrary.REVISION : null;
}


export const MGL_ANCHORS = Object.freeze({
  common: Object.freeze({
    chunk: "common",
    signature: /#define PI/,
    description: "where every phase declares its uniforms and helpers",
  }),
  getDistanceAttenuation: Object.freeze({
    chunk: "lights_pars_begin",
    signature: /float\s+getDistanceAttenuation\s*\(/,
    description: "inverse square falloff and range window",
  }),
  getPointLightInfo: Object.freeze({
    chunk: "lights_pars_begin",
    signature: /void\s+getPointLightInfo\s*\(/,
    description: "point light direction and colour (ML-F4, ML-F7)",
  }),
  getSpotLightInfo: Object.freeze({
    chunk: "lights_pars_begin",
    signature: /void\s+getSpotLightInfo\s*\(/,
    description: "spot cone and attenuation (ML-F4, ML-F6)",
  }),
  lightsFragmentBegin: Object.freeze({
    chunk: "lights_fragment_begin",
    signature: /RE_Direct\s*\(/,
    description: "the direct lighting loop: where MegaLights REPLACES shading (ML-F18)",
  }),
  reDirectPhysical: Object.freeze({
    chunk: "lights_physical_pars_fragment",
    signature: /void\s+RE_Direct_Physical\s*\(/,
    description: "direct GGX BRDF, for area specular (ML-F7, ML-F18)",
  }),
  lightsFragmentMaps: Object.freeze({
    chunk: "lights_fragment_maps",
    signature: /irradiance|iblIrradiance/,
    description: "indirect and IBL contribution",
  }),
  shadowmapParsFragment: Object.freeze({
    chunk: "shadowmap_pars_fragment",
    signature: /float\s+getShadow\s*\(/,
    description: "shadow sampling, for the virtual shadow map path (ML-F15)",
  }),
  shadowmapPointParsFragment: Object.freeze({
    chunk: "shadowmap_pars_fragment",
    signature: /float\s+getPointShadow\s*\(/,
    description: "cube/point shadow sampling (ML-F15)",
  }),
});


const sharedUniforms = {};

export function registerUniform(uniformName, initialValue) {
  if (!sharedUniforms[uniformName]) sharedUniforms[uniformName] = { value: initialValue };
  mlQa.uniform(uniformName, summarizeUniformValue(sharedUniforms[uniformName].value));
  return sharedUniforms[uniformName];
}

export function uniformRef(uniformName) {
  return sharedUniforms[uniformName] || null;
}

export function setUniform(uniformName, value) {
  const reference = sharedUniforms[uniformName] || registerUniform(uniformName, value);
  reference.value = value;
  mlQa.uniform(uniformName, summarizeUniformValue(value));
  return reference;
}

export function listUniforms() {
  return Object.keys(sharedUniforms).map((name) => ({
    name,
    value: summarizeUniformValue(sharedUniforms[name].value),
  }));
}

function summarizeUniformValue(value) {
  if (value === null || value === undefined) return null;
  const kind = typeof value;
  if (kind === "number" || kind === "boolean" || kind === "string") return value;
  if (value.isVector2) return [value.x, value.y];
  if (value.isVector3) return [value.x, value.y, value.z];
  if (value.isVector4) return [value.x, value.y, value.z, value.w];
  if (value.isColor) return [value.r, value.g, value.b];
  if (Array.isArray(value)) return "array(" + value.length + ")";
  return value.constructor ? value.constructor.name : "object";
}






export function registerFixedSizeUniformArray(uniformName, length, createElement) {
  const safeLength = Math.max(1, Math.floor(length));
  const filled = new Array(safeLength);
  for (let index = 0; index < safeLength; index++) filled[index] = createElement(index);
  return registerUniform(uniformName, filled);
}


const registeredPatches = [];
let currentCacheKey = "base";







export function registerPatch(definition) {
  if (!definition || !definition.id || typeof definition.apply !== "function") {
    throw new Error("registerPatch: needs { id, apply }");
  }
  const existing = registeredPatches.find((patch) => patch.id === definition.id);
  if (existing) return existing;

  const patch = {
    id: String(definition.id),
    phase: definition.phase || "?",
    anchor: definition.anchor || null,
    order: Number.isFinite(definition.order) ? definition.order : 1000,
    materialPaths: definition.materialPaths || null,
    isActive: typeof definition.isActive === "function" ? definition.isActive : () => true,
    apply: definition.apply,
  };

  const collision = registeredPatches.find(
    (other) => other.anchor && other.anchor === patch.anchor && other.order === patch.order,
  );
  if (collision) {
    mlQa.error(
      'patch "' + patch.id + '" collides with "' + collision.id + '": same anchor "' +
        patch.anchor + '" and same order ' + patch.order + ". Use MGL_PATCH_ORDER.",
      "megaLightsPatchRegistry.registerPatch",
    );
  }

  registeredPatches.push(patch);
  registeredPatches.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return patch;
}

export function listPatches() {
  return registeredPatches.map((patch) => ({
    id: patch.id,
    phase: patch.phase,
    anchor: patch.anchor,
    order: patch.order,
    materialPaths: patch.materialPaths,
  }));
}

export function removePatch(patchId) {
  const index = registeredPatches.findIndex((patch) => patch.id === patchId);
  if (index >= 0) registeredPatches.splice(index, 1);
}

export function clearPatches() {
  registeredPatches.length = 0;
}


export function checkAnchor(anchorName) {
  const anchor = MGL_ANCHORS[anchorName];
  if (!anchor) return { ok: false, reason: 'unknown anchor "' + anchorName + '"' };
  if (!shaderLibrary) return { ok: false, reason: "shader library not provided yet", chunk: anchor.chunk };
  const chunkSource = shaderLibrary.ShaderChunk[anchor.chunk];
  if (typeof chunkSource !== "string") {
    return { ok: false, reason: "chunk " + anchor.chunk + " missing in three r" + shaderLibrary.REVISION };
  }
  const ok = anchor.signature.test(chunkSource);
  return {
    ok,
    reason: ok ? "" : "signature does not match in three r" + shaderLibrary.REVISION,
    chunk: anchor.chunk,
  };
}

export function checkAllAnchors() {
  const report = {};
  Object.keys(MGL_ANCHORS).forEach((anchorName) => {
    const result = checkAnchor(anchorName);
    report[anchorName] = result;
    mlQa.anchor(anchorName, result.ok, result.reason);
  });
  return report;
}


export function patchChunk(shader, stage, chunkName, transform) {
  if (!shaderLibrary) return false;
  const source = stage === "vertex" ? shader.vertexShader : shader.fragmentShader;
  const includeMarker = "#include <" + chunkName + ">";
  const baseChunk = shaderLibrary.ShaderChunk[chunkName];
  if (typeof baseChunk !== "string") return false;

  if (source.indexOf(includeMarker) < 0) {
    const rewritten = transform(source);
    if (typeof rewritten !== "string" || rewritten === source) return false;
    if (stage === "vertex") shader.vertexShader = rewritten;
    else shader.fragmentShader = rewritten;
    return true;
  }

  const transformedChunk = transform(baseChunk);
  if (typeof transformedChunk !== "string") return false;
  const rewritten = source.replace(includeMarker, transformedChunk);
  if (rewritten === source) return false;
  if (stage === "vertex") shader.vertexShader = rewritten;
  else shader.fragmentShader = rewritten;
  return true;
}


export function insertBeforeChunk(shader, stage, chunkName, code) {
  const source = stage === "vertex" ? shader.vertexShader : shader.fragmentShader;
  const includeMarker = "#include <" + chunkName + ">";
  if (source.indexOf(includeMarker) < 0) return false;
  const rewritten = source.replace(includeMarker, code + "\n" + includeMarker);
  if (stage === "vertex") shader.vertexShader = rewritten;
  else shader.fragmentShader = rewritten;
  return true;
}


let resolveContext = () => ({ tier: "medio", flag: () => false, materialPath: "standard" });

export function setContextProvider(provider) {
  resolveContext = typeof provider === "function" ? provider : resolveContext;
}

export function activePatches(materialPath) {
  const context = resolveContext();
  if (context.enabled === false) return [];
  return registeredPatches.filter((patch) => {
    if (patch.materialPaths && materialPath && patch.materialPaths.indexOf(materialPath) < 0) return false;
    try {
      return !!patch.isActive(Object.assign({ materialPath }, context));
    } catch (error) {
      mlQa.error(error, patch.id + ".isActive");
      return false;
    }
  });
}

export function cacheKeyFor(materialPath) {
  const context = resolveContext();
  return (
    "mgl|" +
    context.tier +
    "|" +
    (materialPath || "?") +
    "|" +
    activePatchIds(materialPath).join(",")
  );
}


export function applyPatchesToShader(shader, material, materialPath) {
  const path = materialPath || "standard";
  const patches = activePatches(path);


  if (patches.length === 0) {
    shader.__mglAppliedPatches = [];
    return [];
  }


  Object.keys(sharedUniforms).forEach((uniformName) => {
    shader.uniforms[uniformName] = sharedUniforms[uniformName];
  });

  const appliedPatchIds = [];
  patches.forEach((patch) => {
    if (patch.anchor) {
      const anchorCheck = checkAnchor(patch.anchor);
      mlQa.anchor(patch.anchor, anchorCheck.ok, anchorCheck.reason);
      if (!anchorCheck.ok) {

        mlQa.error(
          'anchor "' + patch.anchor + '" unavailable: patch "' + patch.id +
            '" refused, material stays on the legacy path',
          patch.id,
        );
        return;
      }
    }
    try {
      const result = patch.apply({
        shader,
        material,
        materialPath: path,
        THREE: shaderLibrary,
        patchChunk: (stage, chunkName, transform) => patchChunk(shader, stage, chunkName, transform),
        insertBeforeChunk: (stage, chunkName, code) => insertBeforeChunk(shader, stage, chunkName, code),
        registerUniform,
        registerFixedSizeUniformArray,
        context: resolveContext(),
      });
      if (result !== false) appliedPatchIds.push(patch.id);
    } catch (error) {
      mlQa.error(error, "patch " + patch.id);
    }
  });

  shader.__mglAppliedPatches = appliedPatchIds;
  mlQa.appliedPatches(appliedPatchIds);
  return appliedPatchIds;
}


export function activePatchIds(materialPath) {
  return activePatches(materialPath).map((patch) => patch.id);
}


export function installOnMaterial(material, materialPath) {
  if (!material || material.__mglInstalled) return material;
  const previousHook = typeof material.onBeforeCompile === "function" ? material.onBeforeCompile : null;
  material.__mglMaterialPath = materialPath || "standard";
  material.__mglInstalled = true;

  material.onBeforeCompile = function (shader, renderer) {

    if (previousHook) previousHook.call(this, shader, renderer);

    applyPatchesToShader(shader, material, material.__mglMaterialPath);
  };

  material.customProgramCacheKey = function () {
    return cacheKeyFor(material.__mglMaterialPath);
  };

  return material;
}


export function healMaterials(materials) {
  const nextKey = cacheKeyFor("standard");
  currentCacheKey = nextKey;
  (materials || []).forEach((material) => {
    if (material) material.needsUpdate = true;
  });
  return nextKey;
}

export function currentCacheKeyValue() {
  return currentCacheKey;
}

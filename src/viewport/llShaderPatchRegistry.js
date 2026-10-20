import { describeLocalLightTechnologyGate } from "../lighting/llTechnologyGate.js";


export const LL_MATERIAL_FLAG = "__rswLl";


export const LL_FRAGMENT_DECLARATION_MARKER = "#include <lights_pars_begin>";

function includeDirectiveOf(chunkName) {
  return "#include <" + chunkName + ">";
}

function sortByOrderThenId(a, b) {
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}


export function createLocalLightPatchRegistry(options) {
  const settings = options && typeof options === "object" ? options : {};
  const THREE = settings.THREE;
  const getPatchContext = typeof settings.getPatchContext === "function" ? settings.getPatchContext : () => ({});
  const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;

  const shaderChunks = THREE && THREE.ShaderChunk ? THREE.ShaderChunk : null;
  const supported = !!shaderChunks;


  const patches = new Map();

  const uniformSlots = new Map();

  let lastAppliedPatchIds = [];

  let lastTechnologyGate = null;

  const refusals = [];

  let generation = 0;
  let patchedMaterialCount = 0;
  let masterEnabled = true;

  function recordRefusal(patchId, reason) {
    refusals.push({ patchId, reason, at: Date.now() });
    if (refusals.length > 40) refusals.shift();
    if (logger) logger.warn("[Luzes locais] patch \"" + patchId + "\" recusou: " + reason);
  }


  function registerShaderPatch(definition) {
    const source = definition && typeof definition === "object" ? definition : {};
    const id = typeof source.id === "string" ? source.id.trim() : "";
    if (!id) throw new Error("local-light patch: id is required");
    if (typeof source.apply !== "function") {
      throw new Error("local-light patch \"" + id + "\": apply must be a function");
    }
    if (typeof source.isActive !== "function") {
      throw new Error("local-light patch \"" + id + "\": isActive must be a function");
    }
    if (!Number.isFinite(source.order)) {
      throw new Error("local-light patch \"" + id + "\": order must be a finite number");
    }
    const existing = patches.get(id);
    if (existing && existing.order !== source.order) {
      throw new Error("local-light patch \"" + id + "\" already registered with a different order");
    }
    const patch = Object.freeze({
      id,
      phase: typeof source.phase === "string" ? source.phase : "",
      anchor: typeof source.anchor === "string" ? source.anchor : "",
      order: source.order,
      isActive: source.isActive,
      apply: source.apply,
    });
    patches.set(id, patch);
    return patch;
  }


  function registerUniform(name, initialValue) {
    const key = typeof name === "string" ? name.trim() : "";
    if (!key) throw new Error("local-light uniform: name is required");
    const existing = uniformSlots.get(key);
    if (existing) return existing;
    const slot = { value: initialValue };
    uniformSlots.set(key, slot);
    return slot;
  }

  function getUniformSlot(name) {
    return uniformSlots.get(name) || null;
  }

  function setUniformValue(name, value) {
    const slot = uniformSlots.get(name);
    if (!slot) return null;
    slot.value = value;
    return slot;
  }


  function createSourceEditor(shader) {
    function readStage(stage) {
      return stage === "vertex" ? shader.vertexShader : shader.fragmentShader;
    }
    function writeStage(stage, text) {
      if (stage === "vertex") shader.vertexShader = text;
      else shader.fragmentShader = text;
    }

    return {
      read: readStage,


      patchChunk(stage, chunkName, rewrite) {
        if (!supported) return false;
        const source = readStage(stage);
        if (typeof source !== "string" || !source) return false;
        const directive = includeDirectiveOf(chunkName);

        if (source.indexOf(directive) !== -1) {
          const stockChunk = shaderChunks[chunkName];
          if (typeof stockChunk !== "string" || !stockChunk) return false;
          const rewritten = rewrite(stockChunk);
          if (typeof rewritten !== "string" || rewritten === stockChunk) return false;
          writeStage(stage, source.replace(directive, rewritten));
          return true;
        }


        const rewrittenWhole = rewrite(source);
        if (typeof rewrittenWhole !== "string" || rewrittenWhole === source) return false;
        writeStage(stage, rewrittenWhole);
        return true;
      },






      insertBeforeMarker(stage, marker, text) {
        const source = readStage(stage);
        if (typeof source !== "string" || source.indexOf(marker) === -1) return false;
        writeStage(stage, source.replace(marker, text + "\n" + marker));
        return true;
      },


      contains(stage, text) {
        const source = readStage(stage);
        return typeof source === "string" && source.indexOf(text) !== -1;
      },
    };
  }






  function checkAnchor(chunkName, anchorText) {
    if (!supported) return { found: false, reason: "THREE.ShaderChunk unavailable" };
    const chunk = shaderChunks[chunkName];
    if (typeof chunk !== "string" || !chunk) {
      return { found: false, reason: "chunk \"" + chunkName + "\" does not exist in this three.js build" };
    }
    if (typeof anchorText === "string" && anchorText && chunk.indexOf(anchorText) === -1) {
      return { found: false, reason: "anchor \"" + anchorText + "\" is not in chunk \"" + chunkName + "\"" };
    }
    return { found: true, reason: "" };
  }


  function applyRegisteredPatches(shader) {
    const frameContext = getPatchContext() || {};


    const technologyGate = describeLocalLightTechnologyGate(frameContext.technology);
    lastTechnologyGate = technologyGate;
    if (!technologyGate.allowed) {
      lastAppliedPatchIds = [];
      return [];
    }

    const editor = createSourceEditor(shader);
    const context = Object.assign({}, frameContext, {
      shader,
      THREE,
      patchChunk: editor.patchChunk,
      insertBeforeMarker: editor.insertBeforeMarker,
      contains: editor.contains,
      read: editor.read,
      checkAnchor,
      declarationMarker: LL_FRAGMENT_DECLARATION_MARKER,
      technologyGate,
    });

    const ordered = Array.from(patches.values()).sort(sortByOrderThenId);
    const applied = [];
    for (const patch of ordered) {
      let active = false;
      try {
        active = patch.isActive(context) === true;
      } catch (error) {
        recordRefusal(patch.id, "isActive threw: " + String((error && error.message) || error));
        continue;
      }

      if (!active) continue;
      try {
        if (patch.apply(context) === true) applied.push(patch.id);
      } catch (error) {
        recordRefusal(patch.id, "apply threw: " + String((error && error.message) || error));
      }
    }
    lastAppliedPatchIds = applied;
    return applied;
  }


  function patchMaterial(material) {
    if (!supported || !material) return;
    if (!masterEnabled) return;
    const userData = material.userData || (material.userData = {});
    if (userData[LL_MATERIAL_FLAG]) return;                                           
    userData[LL_MATERIAL_FLAG] = true;
    patchedMaterialCount++;

    const previousCompile = material.onBeforeCompile;
    const previousCacheKey = material.customProgramCacheKey;

    material.onBeforeCompile = function (shader, rendererArg) {
      if (typeof previousCompile === "function") previousCompile.call(this, shader, rendererArg);

      if (typeof shader.fragmentShader !== "string") return;
      if (shader.fragmentShader.indexOf(LL_FRAGMENT_DECLARATION_MARKER) === -1) return;

      uniformSlots.forEach((slot, name) => {
        shader.uniforms[name] = slot;
      });
      applyRegisteredPatches(shader);
    };

    material.customProgramCacheKey = function () {
      const base = typeof previousCacheKey === "function" ? String(previousCacheKey.call(this)) : "";
      return base + "|rswLl" + generation;
    };

    material.needsUpdate = true;
  }

  function setEnabled(on) {
    masterEnabled = on !== false;
    return masterEnabled;
  }

  function bumpGeneration() {
    generation++;
    return generation;
  }

  function getState() {
    return {
      supported,
      enabled: masterEnabled,
      generation,
      patchedMaterials: patchedMaterialCount,
      registeredPatches: Array.from(patches.values()).sort(sortByOrderThenId).map((patch) => ({
        id: patch.id,
        phase: patch.phase,
        anchor: patch.anchor,
        order: patch.order,
      })),
      registeredUniforms: Array.from(uniformSlots.keys()),
      lastAppliedPatchIds: lastAppliedPatchIds.slice(),
      technologyGate: lastTechnologyGate,
      refusals: refusals.slice(),
    };
  }

  return {
    supported,
    materialFlag: LL_MATERIAL_FLAG,
    registerShaderPatch,
    registerUniform,
    getUniformSlot,
    setUniformValue,
    checkAnchor,
    patchMaterial,
    setEnabled,
    bumpGeneration,
    getState,
  };
}

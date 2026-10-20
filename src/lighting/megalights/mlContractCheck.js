import {
  MGL_BUFFERS,
  MGL_DOWNSAMPLE_MODES,
  MGL_LIGHT_BUFFER_LAYOUT,
  MGL_LIGHT_TEXELS_PER_LIGHT,
  MGL_MAX_SAMPLES_PER_PIXEL,
  MGL_PASSES,
  MGL_PASS_OWNER,
  MGL_PATCH_ORDER,
  MGL_TEXTURE_UNITS_RESERVED,
  MGL_TEXTURE_UNIT_CEILING,
  MGL_TIER_DEFAULTS,
  MGL_TRACE_RESULT,
  reservedTextureUnitsByPhase,
  totalReservedTextureUnits,
} from "./mlPipelineContract.js";
import { MGL_BUFFER_LAYOUTS, MGL_LAYOUT_STATUS } from "./mlBufferLayouts.js";
import { MGL_PASS_REFUSALS } from "./mlPassRefusals.js";
import {
  MGL_UNIFORMS,
  MGL_UNIFORM_PREFIX,
  MGL_UNIFORM_SCOPE,
  MGL_UNIFORM_TYPE,
  lightingSamplerCountByPhase,
  uniformNames,
} from "./mlUniformNames.js";


const CHANNELS_BY_FORMAT = Object.freeze({
  depth: ["r"],
  r8: ["r"],
  rg16f: ["r", "g"],
  rgba8: ["r", "g", "b", "a"],
  rgba16f: ["r", "g", "b", "a"],
  rgba32f: ["r", "g", "b", "a"],
});

const PHASE_ID_PATTERN = /^ML-F([1-9]|[12][0-9]|30)$/;
const TIER_ORDER = Object.freeze(["fraco", "medio", "forte"]);

export function isPhaseId(candidate) {
  return PHASE_ID_PATTERN.test(String(candidate));
}

function checkPassOwnership(problems) {
  const seenPasses = new Set();
  MGL_PASSES.forEach((passName) => {
    if (seenPasses.has(passName)) problems.push('pass "' + passName + '" appears twice in MGL_PASSES');
    seenPasses.add(passName);
    const owner = MGL_PASS_OWNER[passName];
    if (!owner) {
      problems.push('pass "' + passName + '" has no owning phase');
      return;
    }
    if (!isPhaseId(owner)) problems.push('pass "' + passName + '" is owned by "' + owner + '", which is not an ML-Fxx id');
  });
  Object.keys(MGL_PASS_OWNER).forEach((passName) => {
    if (MGL_PASSES.indexOf(passName) === -1) {
      problems.push('MGL_PASS_OWNER names "' + passName + '", which is not a pass of MGL_PASSES');
    }
  });
}

function checkPatchOrderSlots(problems) {
  const phaseBySlot = new Map();
  Object.keys(MGL_PATCH_ORDER).forEach((phaseId) => {
    if (!isPhaseId(phaseId)) problems.push('MGL_PATCH_ORDER has the key "' + phaseId + '", which is not an ML-Fxx id');
    const slot = MGL_PATCH_ORDER[phaseId];
    if (typeof slot !== "number") {
      problems.push("patch order of " + phaseId + " is not a number");
      return;
    }


    if (phaseBySlot.has(slot)) {
      problems.push("patch order " + slot + " is claimed by " + phaseBySlot.get(slot) + " and " + phaseId);
      return;
    }
    phaseBySlot.set(slot, phaseId);
  });
}

function checkFrozenLayoutChannels(bufferName, buffer, layout, problems) {
  const allowedChannels = CHANNELS_BY_FORMAT[buffer.format];
  if (layout.texels.length === 0) {
    problems.push('layout "' + bufferName + '" is frozen but declares no texel');
    return;
  }
  if (layout.texels.length !== layout.texelCount) {
    problems.push(
      'layout "' + bufferName + '" says ' + layout.texelCount + " texel(s) and declares " + layout.texels.length,
    );
  }
  layout.texels.forEach((texel, texelIndex) => {
    Object.keys(texel).forEach((channel) => {
      if (allowedChannels.indexOf(channel) === -1) {
        problems.push(
          'layout "' + bufferName + '" texel ' + texelIndex + ' uses channel "' + channel +
            '", which the format ' + buffer.format + " does not have",
        );
      }
      if (!texel[channel]) {
        problems.push('layout "' + bufferName + '" texel ' + texelIndex + ' leaves channel "' + channel + '" unnamed');
      }
    });
  });
}

function checkBufferLayouts(problems) {
  Object.keys(MGL_BUFFERS).forEach((bufferName) => {
    const buffer = MGL_BUFFERS[bufferName];
    const layout = MGL_BUFFER_LAYOUTS[bufferName];
    if (!layout) {
      problems.push('buffer "' + bufferName + '" has no layout in mlBufferLayouts.js');
      return;
    }
    if (layout.owner !== buffer.owner) {
      problems.push(
        'buffer "' + bufferName + '" is owned by ' + buffer.owner + " but its layout says " + layout.owner,
      );
    }
    if (!CHANNELS_BY_FORMAT[buffer.format]) {
      problems.push('buffer "' + bufferName + '" declares the unknown format "' + buffer.format + '"');
      return;
    }
    if (layout.status === MGL_LAYOUT_STATUS.frozen) {
      checkFrozenLayoutChannels(bufferName, buffer, layout, problems);
      return;
    }
    if (layout.status === MGL_LAYOUT_STATUS.reserved) {


      if (layout.texels.length > 0) {
        problems.push('layout "' + bufferName + '" is reserved but already declares channels: freeze it instead');
      }
      return;
    }
    if (layout.status === MGL_LAYOUT_STATUS.definedElsewhere) {
      if (layout.definedIn !== "MGL_LIGHT_BUFFER_LAYOUT") {
        problems.push('layout "' + bufferName + '" points to "' + layout.definedIn + '", which is not a known definition');
        return;
      }
      if (Object.keys(MGL_LIGHT_BUFFER_LAYOUT).length !== MGL_LIGHT_TEXELS_PER_LIGHT) {
        problems.push(
          "MGL_LIGHT_BUFFER_LAYOUT has " + Object.keys(MGL_LIGHT_BUFFER_LAYOUT).length +
            " texel(s) and MGL_LIGHT_TEXELS_PER_LIGHT says " + MGL_LIGHT_TEXELS_PER_LIGHT,
        );
      }
      return;
    }
    problems.push('layout "' + bufferName + '" has the unknown status "' + layout.status + '"');
  });

  Object.keys(MGL_BUFFER_LAYOUTS).forEach((bufferName) => {
    if (!MGL_BUFFERS[bufferName]) {
      problems.push('layout "' + bufferName + '" describes a buffer the contract does not declare');
    }
  });
}

function checkSamplerUniform(uniformName, definition, samplerByBuffer, problems) {
  if (!MGL_UNIFORM_SCOPE[definition.scope]) {
    problems.push('sampler "' + uniformName + '" has the unknown scope "' + definition.scope + '"');
  }
  const namesBuffer = !!definition.buffer;
  const namesExternalResource = !!definition.externalResource;
  if (namesBuffer === namesExternalResource) {
    problems.push('sampler "' + uniformName + '" must name exactly one of buffer or externalResource');
    return;
  }
  if (!namesBuffer) return;
  const buffer = MGL_BUFFERS[definition.buffer];
  if (!buffer) {
    problems.push('sampler "' + uniformName + '" reads the unknown buffer "' + definition.buffer + '"');
    return;
  }
  if (buffer.owner !== definition.phase) {
    problems.push(
      'sampler "' + uniformName + '" belongs to ' + definition.phase + ' but reads buffer "' + definition.buffer +
        '", owned by ' + buffer.owner,
    );
  }
  if (samplerByBuffer.has(definition.buffer)) {
    problems.push(
      'buffer "' + definition.buffer + '" is bound by two samplers: ' + samplerByBuffer.get(definition.buffer) +
        " and " + uniformName,
    );
    return;
  }
  samplerByBuffer.set(definition.buffer, uniformName);
}

function checkUniforms(problems) {
  const samplerByBuffer = new Map();
  uniformNames().forEach((uniformName) => {
    const definition = MGL_UNIFORMS[uniformName];
    if (uniformName.indexOf(MGL_UNIFORM_PREFIX) !== 0) {
      problems.push('uniform "' + uniformName + '" does not start with ' + MGL_UNIFORM_PREFIX);
    }
    if (!definition.description) problems.push('uniform "' + uniformName + '" has no description');
    if (definition.phase !== "base" && !isPhaseId(definition.phase)) {
      problems.push('uniform "' + uniformName + '" is owned by "' + definition.phase + '", which is not an ML-Fxx id');
    }
    if (!MGL_UNIFORM_TYPE[definition.type]) {
      problems.push('uniform "' + uniformName + '" has the unknown type "' + definition.type + '"');
      return;
    }
    if (definition.type !== MGL_UNIFORM_TYPE.sampler2D) {
      if (definition.scope || definition.buffer || definition.externalResource) {
        problems.push('uniform "' + uniformName + '" is not a sampler, so it must not declare a scope or a resource');
      }
      return;
    }
    checkSamplerUniform(uniformName, definition, samplerByBuffer, problems);
  });
}

function checkTextureUnitBudget(problems) {


  const reservedTotal = totalReservedTextureUnits();
  if (reservedTotal > MGL_TEXTURE_UNIT_CEILING) {
    problems.push(
      "reserved texture units add up to " + reservedTotal + ", above the ceiling of " + MGL_TEXTURE_UNIT_CEILING,
    );
  }
  Object.keys(MGL_TEXTURE_UNITS_RESERVED).forEach((reservationKey) => {
    const phaseId = reservationKey.split(":")[0];
    if (phaseId !== "engine" && !isPhaseId(phaseId)) {
      problems.push('texture unit reservation "' + reservationKey + '" does not start with an ML-Fxx id');
    }
  });
  const reservedByPhase = reservedTextureUnitsByPhase();
  const samplersByPhase = lightingSamplerCountByPhase();
  Object.keys(samplersByPhase).forEach((phaseId) => {
    const reserved = reservedByPhase[phaseId] || 0;
    if (samplersByPhase[phaseId] > reserved) {
      problems.push(
        phaseId + " binds " + samplersByPhase[phaseId] + " sampler(s) in the lighting shader but reserves only " +
          reserved + " texture unit(s)",
      );
    }
  });
}

function checkTierDefaults(problems) {


  if (MGL_TIER_DEFAULTS.fraco.enabled !== false) {
    problems.push("the weak tier must start with MegaLights disabled");
  }
  TIER_ORDER.forEach((tierName, tierIndex) => {
    const tier = MGL_TIER_DEFAULTS[tierName];
    if (!tier) {
      problems.push('tier "' + tierName + '" is missing from MGL_TIER_DEFAULTS');
      return;
    }
    if (!MGL_DOWNSAMPLE_MODES[tier.downsampleMode]) {
      problems.push('tier "' + tierName + '" uses the unknown downsample mode "' + tier.downsampleMode + '"');
    }
    if (tier.samplesPerPixel > MGL_MAX_SAMPLES_PER_PIXEL) {
      problems.push('tier "' + tierName + '" asks for more samples per pixel than MGL_MAX_SAMPLES_PER_PIXEL');
    }
    if (tierIndex === 0) return;
    const weakerTier = MGL_TIER_DEFAULTS[TIER_ORDER[tierIndex - 1]];
    if (weakerTier && weakerTier.samplesPerPixel > tier.samplesPerPixel) {
      problems.push('tier "' + tierName + '" samples less than "' + TIER_ORDER[tierIndex - 1] + '"');
    }
  });
}

function checkTraceStates(problems) {


  if (!MGL_TRACE_RESULT.unknown) problems.push("MGL_TRACE_RESULT needs an unknown state");
  if (!MGL_TRACE_RESULT.visible || !MGL_TRACE_RESULT.occluded) {
    problems.push("MGL_TRACE_RESULT needs a visible and an occluded state");
  }
}

function checkRefusals(problems) {
  const seenCodes = new Set();
  MGL_PASSES.forEach((passName) => {
    const refusals = MGL_PASS_REFUSALS[passName];
    if (!refusals || refusals.length === 0) {
      problems.push('pass "' + passName + '" declares no refusal: say what it must NOT do');
      return;
    }
    refusals.forEach((refusal) => {
      if (!refusal.refuses || !refusal.because) {
        problems.push('a refusal of pass "' + passName + '" is missing what it refuses or why');
      }
      if (String(refusal.code).indexOf(passName + ".") !== 0) {
        problems.push('refusal "' + refusal.code + '" does not start with its pass name');
      }
      if (seenCodes.has(refusal.code)) problems.push('refusal code "' + refusal.code + '" is used twice');
      seenCodes.add(refusal.code);
    });
  });
  Object.keys(MGL_PASS_REFUSALS).forEach((passName) => {
    if (MGL_PASSES.indexOf(passName) === -1) {
      problems.push('MGL_PASS_REFUSALS names "' + passName + '", which is not a pass of MGL_PASSES');
    }
  });
}


export function validateContract() {
  const problems = [];
  checkPassOwnership(problems);
  checkPatchOrderSlots(problems);
  checkBufferLayouts(problems);
  checkUniforms(problems);
  checkTextureUnitBudget(problems);
  checkTierDefaults(problems);
  checkTraceStates(problems);
  checkRefusals(problems);

  const layoutNames = Object.keys(MGL_BUFFER_LAYOUTS);
  return {
    ok: problems.length === 0,
    problems,
    counts: {
      passes: MGL_PASSES.length,
      buffers: Object.keys(MGL_BUFFERS).length,
      frozenLayouts: layoutNames.filter((name) => MGL_BUFFER_LAYOUTS[name].status === MGL_LAYOUT_STATUS.frozen).length,
      reservedLayouts: layoutNames.filter((name) => MGL_BUFFER_LAYOUTS[name].status === MGL_LAYOUT_STATUS.reserved).length,
      uniforms: uniformNames().length,
      refusals: Object.keys(MGL_PASS_REFUSALS).reduce(
        (total, passName) => total + MGL_PASS_REFUSALS[passName].length,
        0,
      ),
      reservedTextureUnits: totalReservedTextureUnits(),
      textureUnitCeiling: MGL_TEXTURE_UNIT_CEILING,
    },
  };
}

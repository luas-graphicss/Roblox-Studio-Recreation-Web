import { SSM_FAMILIES, SSM_THREE_REVISION } from '../../lighting/substrateSm/ssmContract.js';
import { assertSubstrateSmKey } from '../../lighting/substrateSm/ssmRecipeKeys.js';
import { createSubstrateSmDeformedProgramKey } from './ssmDeformedProgramKey.js';
import { createSubstrateSmDeformedIncrementalUsage, evaluateSubstrateSmDeformedHostBudget } from './ssmDeformedHostBudget.js';

export const SSM_DEFORMED_SURFACE_CONTRACT_VERSION = 1;
export const SSM_DEFORMED_SHADER_MARKER = '#define SSM_DEFORMED_HOST_V1';

export function requireSubstrateSmUniqueAnchor(source, anchor) {
  const position = source.indexOf(anchor);
  if (position < 0 || source.indexOf(anchor, position + anchor.length) >= 0) {
    throw new Error(`Missing or ambiguous deformed host anchor: ${anchor}`);
  }
  return position;
}

export function refuseSubstrateSmDeformedShader(error) {
  return Object.freeze({ ok: false, applied: false, code: 'SSM_DEFORMED_SHADER_REFUSED',
    reason: String(error?.message ?? error), fallback: 'keep-last-valid-binding-or-host' });
}

function validateSurface(surface, uniforms) {
  if (surface?.contractVersion !== SSM_DEFORMED_SURFACE_CONTRACT_VERSION
    || !SSM_FAMILIES.includes(surface.family)) throw new Error('An explicit shared surface provider is required');
  if (surface.family === 'anisotropic') throw new Error('SSM_DEFORMED_TANGENT_INTEGRATION_REQUIRED');
  assertSubstrateSmKey(surface.programKey, 'program');
  for (const field of ['declarations', 'resolveMaterial']) {
    const source = surface[field];
    if (typeof source !== 'string' || source.trim().length === 0
      || /\b(?:attribute|varying|[iu]?sampler\w*|texture\w*|texelFetch\w*|discard)\b|#include|void\s+main\s*\(/.test(source)) {
      throw new Error(`Unsupported surface provider ${field}`);
    }
    if (/^\s*(?:flat\s+)?(?:in|out)\s+\w+\s+\w+\s*(?:;|\[)|#\s*(?:define|undef)\s+USE_/m.test(source)) {
      throw new Error('Surface providers cannot add stage interfaces or change host feature defines');
    }
  }
  if (/\b(?:for|while|do|uniform)\b|\bdiffuseColor\s*\.\s*[argbwxy]+\s*[+*/-]?=|\bgl_Frag\w*/.test(surface.resolveMaterial)) {
    throw new Error('Surface resolution must preserve host coverage and execute once outside the light loop');
  }
  if (!surface.uniforms || typeof surface.uniforms !== 'object' || Array.isArray(surface.uniforms)) {
    throw new Error('Persistent surface uniform holders are required');
  }
  for (const [name, holder] of Object.entries(surface.uniforms)) {
    if (Object.hasOwn(uniforms, name) || !holder || !Object.hasOwn(holder, 'value')) {
      throw new Error(`Missing or conflicting surface uniform holder: ${name}`);
    }
  }
}

export function buildSubstrateSmDeformedShaderCandidate({ THREE, shader, host, surface,
  hostUsage, capabilities, contextGeneration, terrainLayout, textureSize = 0 } = {}) {
  if (String(THREE?.REVISION) !== SSM_THREE_REVISION) throw new Error('Only audited Three r161 chunks are supported');
  if (host?.allowed !== true) throw new Error(host?.code ?? 'A deformed host is required');
  if (typeof shader?.vertexShader !== 'string' || typeof shader?.fragmentShader !== 'string'
    || !shader.uniforms || typeof shader.uniforms !== 'object') throw new Error('A fresh host shader snapshot is required');
  const source = shader.fragmentShader;
  if (!/^#define STANDARD\s*$/m.test(source) || source.includes(SSM_DEFORMED_SHADER_MARKER)) {
    throw new Error('A fresh Standard host shader is required');
  }
  validateSurface(surface, shader.uniforms);
  const declarationsAnchor = '#include <lights_physical_pars_fragment>';
  const resolutionAnchor = '#include <lights_physical_fragment>';
  const orderedAnchors = ['#include <map_fragment>', '#include <color_fragment>',
    '#include <alphamap_fragment>', '#include <alphatest_fragment>',
    '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>',
    '#include <normal_fragment_begin>', '#include <normal_fragment_maps>',
    '#include <emissivemap_fragment>', resolutionAnchor, '#include <lights_fragment_begin>',
    '#include <lights_fragment_maps>', '#include <lights_fragment_end>', '#include <aomap_fragment>',
    '#include <opaque_fragment>'];
  let previous = requireSubstrateSmUniqueAnchor(source, declarationsAnchor);
  for (const anchor of orderedAnchors) {
    const position = requireSubstrateSmUniqueAnchor(source, anchor);
    if (position <= previous) throw new Error(`Unexpected host material evaluation order: ${anchor}`);
    previous = position;
  }
  const additionalUsage = createSubstrateSmDeformedIncrementalUsage(contextGeneration, surface.fragmentUniformVectors);
  const budget = evaluateSubstrateSmDeformedHostBudget({ host, hostUsage, capabilities,
    contextGeneration, additionalUsage, textureSize });
  if (!budget.ok) throw new Error(`${budget.code}:${budget.field ?? ''}`);
  const fragmentShader = source.replace(declarationsAnchor,
    `${declarationsAnchor}\n${SSM_DEFORMED_SHADER_MARKER}\n${surface.declarations}`)
    .replace(resolutionAnchor, `${resolutionAnchor}\n${surface.resolveMaterial}`);
  const programKey = createSubstrateSmDeformedProgramKey({ kind: host.kind, surface, terrainLayout });
  return Object.freeze({ ok: true, applied: false, kind: host.kind, materialPath: host.materialPath,
    vertexShader: shader.vertexShader, fragmentShader,
    uniforms: { ...shader.uniforms, ...surface.uniforms }, programKey, additionalUsage, budget,
    resolutionPhase: 'after-host-maps-and-material-before-light-loop',
    evidenceStatus: 'candidate-not-bound-or-linked', bindingOwner: 'shared-material-transaction',
    hostGeometryPreserved: true, uniformRecipePerDraw: true, tangentIntegrationReady: false });
}

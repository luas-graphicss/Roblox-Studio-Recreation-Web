import { SSM_THREE_REVISION } from '../../lighting/substrateSm/ssmContract.js';
import { validateSubstrateSmOwnership } from '../../lighting/substrateSm/ssmOwnershipCore.js';
import { classifySubstrateSmMsmCoexistence } from '../../lighting/substrateSm/ssmMsmCoexistenceCore.js';
import { buildSubstrateSmLightingSurfaceAssignment } from '../../lighting/substrateSm/ssmLightingSurfaceGlsl.js';
import { buildSubstrateSmDirectLightingGlsl, SSM_DIRECT_LIGHTING_REVISION } from '../../lighting/substrateSm/ssmDirectLightingGlsl.js';
import { isSubstrateSmShaderResponseOwned } from './ssmShaderOwnership.js';
import { rewriteSubstrateSmMsmInjection } from './ssmMsmShaderPatch.js';

const MATERIAL_CHUNKS = Object.freeze({
  standard: 'lights_physical_pars_fragment',
  phong: 'lights_phong_pars_fragment',
  poolPhong: 'lights_phong_pars_fragment',
});
const MAIN_ANCHOR = /\bvoid\s+main\s*\(\s*\)\s*\{/g;
const GEOMETRY_ANCHOR = /vec3\s+geometryPosition\s*=\s*-\s*vViewPosition\s*;/g;
const DIRECT_ALIAS = /^[\t ]*#define[\t ]+RE_Direct[\t ]+([^\r\n]*)$/gm;
const CONFLICTING_RESPONSE = /\b(?:SB_REAL_CLOSURES|uRswMFOn|llParityMix|SSM_DIRECT_LIGHTING_V1)\b/;

function refuse(fragmentShader, code, details = null) {
  return Object.freeze({ ok: false, applied: false, fragmentShader, code, details });
}

function insertSurfaceAssignment(source, assignment) {
  const include = '#include <lights_fragment_begin>';
  const includes = source.split(include).length - 1;
  const anchors = [...source.matchAll(GEOMETRY_ANCHOR)];
  if (includes === 1 && anchors.length === 0) return source.replace(include, assignment + '\n' + include);
  if (includes !== 0) return null;
  return anchors.length === 1 ? source.replace(GEOMETRY_ANCHOR, anchor => assignment + '\n' + anchor) : null;
}

export function prepareSubstrateSmLightingShader({
  THREE, shader, materialPath, family = 'base', surfaceBinding, activeResponses, msm,
} = {}) {
  const original = shader?.fragmentShader;
  if (String(THREE?.REVISION) !== SSM_THREE_REVISION) return refuse(original, 'SSM_LIGHTING_THREE_REVISION');
  if (typeof original !== 'string') return refuse(original, 'SSM_LIGHTING_SHADER_REQUIRED');
  if (!Object.hasOwn(MATERIAL_CHUNKS, materialPath)) return refuse(original, 'SSM_LIGHTING_HOST_UNSUPPORTED');
  if (family !== 'base') return refuse(original, 'SSM_LIGHTING_FAMILY_DELEGATED');
  if (!isSubstrateSmShaderResponseOwned(shader)) return refuse(original, 'SSM_LIGHTING_TRANSACTION_OWNERSHIP_REQUIRED');
  const ownership = validateSubstrateSmOwnership('substrateSm', activeResponses);
  if (!ownership.ok) return refuse(original, ownership.code, ownership.conflicts);
  const coexistence = classifySubstrateSmMsmCoexistence(msm);
  if (!coexistence.allowed) return refuse(original, coexistence.code, coexistence);
  if (CONFLICTING_RESPONSE.test(original)) return refuse(original, 'SSM_LIGHTING_RESPONSE_CONFLICT');
  let assignment;
  try {
    assignment = buildSubstrateSmLightingSurfaceAssignment(surfaceBinding);
  } catch (error) {
    return refuse(original, 'SSM_LIGHTING_RESOLVED_SURFACE_REQUIRED', error.message);
  }
  const chunkName = MATERIAL_CHUNKS[materialPath];
  const include = `#include <${chunkName}>`;
  const includes = original.split(include).length - 1;
  if (includes > 1) return refuse(original, 'SSM_LIGHTING_MATERIAL_ANCHOR_AMBIGUOUS');
  const chunk = THREE.ShaderChunk?.[chunkName];
  if (includes === 1 && typeof chunk !== 'string') return refuse(original, 'SSM_LIGHTING_MATERIAL_CHUNK_REQUIRED');
  let source = includes === 1 ? original.replace(include, chunk) : original;
  const aliases = [...source.matchAll(DIRECT_ALIAS)];
  const expectedAlias = materialPath === 'standard' ? 'RE_Direct_Physical' : 'RE_Direct_BlinnPhong';
  if (aliases.length !== 1 || aliases[0][1].trim() !== expectedAlias) return refuse(original, 'SSM_LIGHTING_DIRECT_ALIAS_MISMATCH');
  const mainAnchors = [...source.matchAll(MAIN_ANCHOR)];
  if (mainAnchors.length !== 1) return refuse(original, 'SSM_LIGHTING_MAIN_ANCHOR_MISMATCH');
  const hostAreaSpecular = source.includes('llAreaSpecularDirect');
  if (hostAreaSpecular && (materialPath !== 'standard' || !/llBeginAreaLight\(\s*uLlAreaLightShape\[/.test(source))) {
    return refuse(original, 'SSM_LIGHTING_AREA_STATE_INCOMPLETE');
  }
  const injected = rewriteSubstrateSmMsmInjection(source, msm.mode);
  if (!injected.ok) return refuse(original, injected.code);
  source = insertSurfaceAssignment(injected.source, assignment);
  if (source === null) return refuse(original, 'SSM_LIGHTING_LOOP_ANCHOR_MISMATCH');
  const declarations = buildSubstrateSmDirectLightingGlsl({ materialPath, hostAreaSpecular });
  source = source.replace(MAIN_ANCHOR, anchor => declarations + '\n' + anchor);
  return Object.freeze({
    ok: true,
    applied: false,
    candidateReady: true,
    requiresTransactionCommit: true,
    requiresLinkedProgramValidation: true,
    fragmentShader: source,
    code: null,
    signature: [SSM_DIRECT_LIGHTING_REVISION, materialPath, family, hostAreaSpecular ? 'host-area' : 'punctual', msm.mode, assignment].join('|'),
    coexistence,
    lighting: Object.freeze({
      visibility: 'host-before-RE_Direct',
      localAttenuation: 'unchanged',
      cookiesAndIes: 'unchanged',
      sourceShape: 'host-direction-unchanged',
      tubeSpecular: hostAreaSpecular ? 'host-LL-F6-base-approximation' : 'host-punctual-residual',
      rectArea: materialPath === 'standard' ? 'host-LTC-base-approximation-no-native-shadow' : 'host-unsupported',
      addedShadowEvaluations: 0,
      addedLightLoops: 0,
      addedSamplers: 0,
      addedUniformVectors: 0,
      addedPasses: 0,
      addedHistories: 0,
      productionHostIntegrated: false,
    }),
  });
}

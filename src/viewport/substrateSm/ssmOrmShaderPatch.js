import { SSM_THREE_REVISION } from '../../lighting/substrateSm/ssmContract.js';
import { SSM_ORM_PATCH_ID } from '../../lighting/substrateSm/ssmOrmPackingPlan.js';
import { isSubstrateSmMapPlan } from '../../lighting/substrateSm/ssmMapPlanCore.js';
import { normalizeSubstrateSmMapAsset } from '../../lighting/substrateSm/ssmMapValidation.js';
import { serializeSubstrateSmKeyDescriptor } from '../../lighting/substrateSm/ssmKeySerialization.js';
import { SSM_ORM_UNIFORM_NAME, SSM_ORM_DECLARATION, SSM_ORM_ROUGHNESS_READ,
  SSM_ORM_METALNESS_READ, SSM_ORM_AO_DECLARATION, SSM_ORM_EXPECTED_CHUNKS } from '../../lighting/substrateSm/ssmOrmShaderSource.js';
import { describeSubstrateSmHostTexture } from './ssmHostTextureDescriptor.js';

function replaceUnique(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error(`Missing or ambiguous ORM shader anchor: ${anchor}`);
  return source.replace(anchor, replacement);
}

function verifyHostTexture(THREE, texture, binding) {
  const actual = normalizeSubstrateSmMapAsset(describeSubstrateSmHostTexture({ THREE, texture,
    id: binding.id, revision: binding.revision, status: 'ready', dynamic: 'static' }), binding.role);
  for (const field of ['width', 'height', 'format', 'colorSpace', 'mipMode', 'mipLevels', 'uploadVersion']) {
    if (actual[field] !== binding[field]) throw new Error(`Host ORM ${field} changed after planning`);
  }
  if (serializeSubstrateSmKeyDescriptor(actual.sampling) !== serializeSubstrateSmKeyDescriptor(binding.sampling)) {
    throw new Error('Host ORM sampling changed after planning');
  }
}

export function createSubstrateSmOrmShaderCandidate({ THREE, shader, material, plan, texture }) {
  try {
    if (String(THREE?.REVISION) !== SSM_THREE_REVISION || !isSubstrateSmMapPlan(plan)
      || !plan.orm || plan.orm.requiredPatch !== SSM_ORM_PATCH_ID) throw new Error('An audited shared ORM plan is required');
    if (!material?.isMeshStandardMaterial || material.isMeshPhysicalMaterial) throw new Error('The F08 stock adapter only supports Standard; Phong requires its own host adapter');
    const orm = plan.orm;
    if (Boolean(material.aoMap) !== orm.occlusionEnabled) throw new Error('Host AO enablement differs from the plan');
    verifyHostTexture(THREE, material.roughnessMap, orm.roughness);
    verifyHostTexture(THREE, material.metalnessMap, orm.metalness);
    if (orm.occlusion) verifyHostTexture(THREE, material.aoMap, orm.occlusion);
    if (orm.mode === 'shared') {
      if (texture !== material.roughnessMap || texture !== material.metalnessMap
        || (orm.occlusion && texture !== material.aoMap)) throw new Error('One shared ORM read requires one actual texture resource');
    } else {
      const actual = normalizeSubstrateSmMapAsset(describeSubstrateSmHostTexture({ THREE, texture,
        id: 'derived-orm', revision: 1, status: 'ready', dynamic: 'static' }), 'roughness');
      if (actual.width !== orm.output.width || actual.height !== orm.output.height || actual.format !== orm.output.format
        || actual.colorSpace !== '' || actual.mipLevels !== orm.output.layout.levels.length
        || serializeSubstrateSmKeyDescriptor(actual.sampling) !== serializeSubstrateSmKeyDescriptor(orm.output.sampling)) {
        throw new Error('Derived ORM resource differs from the admitted output');
      }
    }
    if (typeof shader?.fragmentShader !== 'string' || !shader.uniforms || shader.uniforms[SSM_ORM_UNIFORM_NAME]) {
      throw new Error('A fresh stock shader snapshot is required');
    }
    for (const [name, expected] of Object.entries(SSM_ORM_EXPECTED_CHUNKS)) {
      if (THREE.ShaderChunk[name] !== expected) throw new Error(`Custom host chunk requires explicit ORM adaptation: ${name}`);
    }
    let fragmentShader = shader.fragmentShader;
    if (!/^#define STANDARD\s*$/m.test(fragmentShader) || /\bssmOrmSample\b/.test(fragmentShader)) throw new Error('Unsupported or already patched ORM shader');
    const occlusionChunk = replaceUnique(THREE.ShaderChunk.aomap_fragment,
      'texture2D( aoMap, vAoMapUv ).r', 'ssmOrmSample.r');
    const replacements = [
      ['aomap_pars_fragment', SSM_ORM_AO_DECLARATION],
      ['roughnessmap_pars_fragment', SSM_ORM_DECLARATION],
      ['metalnessmap_pars_fragment', ''],
      ['roughnessmap_fragment', SSM_ORM_ROUGHNESS_READ],
      ['metalnessmap_fragment', SSM_ORM_METALNESS_READ],
      ['aomap_fragment', occlusionChunk],
    ];
    for (const [chunk, replacement] of replacements) fragmentShader = replaceUnique(fragmentShader, `#include <${chunk}>`, replacement);
    if (/\b(?:roughnessMap|metalnessMap|aoMap)\b/.test(fragmentShader)) throw new Error('A custom ORM reader survives outside the supported anchors');
    const uniforms = { ...shader.uniforms, [SSM_ORM_UNIFORM_NAME]: { value: texture } };
    return Object.freeze({
      ok: true, fragmentShader, uniforms, patchId: SSM_ORM_PATCH_ID,
      bindingContract: Object.freeze({ sampler: SSM_ORM_UNIFORM_NAME, samplerSlots: 1, textureReads: 1,
        removedSamplerSlots: orm.sourceSamplerSlots - 1, uvSet: orm.output.sampling.uvSet,
        evidenceStatus: 'shaderTransformedNotYetLinked' }),
    });
  } catch (error) {
    return Object.freeze({ ok: false, code: 'SSM_ORM_SHADER_REFUSED', reason: String(error?.message ?? error),
      fallback: 'keep-last-valid-binding-or-host' });
  }
}

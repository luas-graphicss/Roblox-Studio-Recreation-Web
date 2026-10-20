import { buildSpecAaFilterGlsl } from '../../lighting/specularAaCore.js';
import { buildSpecOccApplyGlsl } from '../../lighting/specOccCore.js';
import {
  SSM_INDIRECT_LIGHTING_GLSL,
  SSM_INDIRECT_LIGHTING_MARKER,
} from '../../lighting/substrateSm/ssmIndirectLightingGlsl.js';
import { SSM_SPECULAR_FILTER_GLSL } from '../../lighting/substrateSm/ssmSpecularFilterGlsl.js';
import {
  inspectSubstrateSmIndirectHost,
  getSubstrateSmIndirectRecipeDeclaration,
} from './ssmIndirectHostGuards.js';
import {
  failSubstrateSmIndirectCandidate,
  replaceSubstrateSmIndirectAnchor,
  expandSubstrateSmIndirectChunk,
  requireSubstrateSmIndirectUniform,
  inspectSubstrateSmIndirectFields,
} from './ssmIndirectShaderSource.js';
import {
  getSubstrateSmIndirectDefaultFields,
  buildSubstrateSmIndirectSurfaceGlsl,
  buildSubstrateSmIndirectResponsePrelude,
  SSM_INDIRECT_DIFFUSE_ACCUMULATION,
  SSM_INDIRECT_SPECULAR_ACCUMULATION,
} from './ssmIndirectSurfaceGlsl.js';

const INDIRECT_DIFFUSE_CALL =
  'RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const INDIRECT_SPECULAR_CALL =
  'RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const GEOMETRY_POSITION = 'vec3 geometryPosition = - vViewPosition;';
const INDIRECT_BEGIN =
  '#if defined( RE_IndirectDiffuse )\n\tRE_IndirectDiffuse(';
const HOST_REFLECTION_CALL =
  'getIBLRadiance( geometryViewDir, geometryNormal, material.roughness )';
const HOST_MAP_OCCLUSION =
  'computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness )';
const HOST_ROUGHNESS_ALPHA = 'min( roughnessFactor, 0.995 )';

function unchanged(shader, code, detail = null, ok = false) {
  return Object.freeze({
    ok,
    changed: false,
    fragmentShader: shader?.fragmentShader,
    code,
    detail,
  });
}

function removeHostSpecularAa(source, uniforms) {
  const present = source.includes('rswSpecAaDx');
  if (!present) return { source, present };
  for (const [name, maximum] of [
    ['uRswSpecAaOn', 1],
    ['uRswSpecAaStr', 4],
    ['uRswSpecAaKernel', 1],
  ]) {
    requireSubstrateSmIndirectUniform(uniforms, name, maximum);
  }
  return {
    source: replaceSubstrateSmIndirectAnchor(
      source,
      buildSpecAaFilterGlsl(),
      '',
      'host-specular-aa',
    ),
    present,
  };
}

function removeHostSpecularOcclusion(source, uniforms) {
  const present = source.includes('rswSpecOccApply');
  if (!present) return { source, present };
  for (const name of [
    'uRswSpecOccOn',
    'uRswSpecOccPhongOn',
    'uRswSpecOccStr',
    'uRswSpecOccBentK',
  ]) {
    requireSubstrateSmIndirectUniform(uniforms, name, 1);
  }
  if (!uniforms?.tRswSpecOccMask || !uniforms?.uRswSpecOccInvRes) {
    failSubstrateSmIndirectCandidate('SSM_INDIRECT_HOST_MASK_HOLDERS_REQUIRED');
  }
  return {
    source: replaceSubstrateSmIndirectAnchor(
      source,
      buildSpecOccApplyGlsl(),
      '',
      'host-specular-occlusion',
    ),
    present,
  };
}

export function buildSubstrateSmIndirectShaderCandidate({
  shader,
  shaderChunks,
  threeRevision,
  materialPath,
  environmentKind,
  family = 'base',
  vectorCount = 8,
  surfaceExpressions,
  enabled = false,
} = {}) {
  if (!shader || typeof shader.fragmentShader !== 'string')
    return unchanged(shader, 'SSM_INDIRECT_SHADER_REQUIRED');
  if (enabled === false)
    return unchanged(shader, 'SSM_INDIRECT_DISABLED', null, true);
  if (enabled !== true)
    return unchanged(shader, 'SSM_INDIRECT_EXPLICIT_ENABLE_REQUIRED');
  try {
    const { standard, surface } = inspectSubstrateSmIndirectHost({
      shader,
      threeRevision,
      materialPath,
      environmentKind,
      family,
      vectorCount,
    });
    let source = shader.fragmentShader;
    if (source.includes(SSM_INDIRECT_LIGHTING_MARKER))
      failSubstrateSmIndirectCandidate('SSM_INDIRECT_ALREADY_PRESENT');
    const fields = inspectSubstrateSmIndirectFields(
      surfaceExpressions,
      getSubstrateSmIndirectDefaultFields(vectorCount),
    );
    const recipeDeclaration = getSubstrateSmIndirectRecipeDeclaration(
      source,
      vectorCount,
    );
    if (standard) {
      source = expandSubstrateSmIndirectChunk(
        source,
        'lights_physical_fragment',
        shaderChunks,
      );
      if (!source.includes('float geometryRoughness ='))
        failSubstrateSmIndirectCandidate(
          'SSM_INDIRECT_GEOMETRY_ROUGHNESS_REQUIRED',
        );
    }
    for (const name of [
      'lights_fragment_begin',
      'lights_fragment_maps',
      'lights_fragment_end',
      'aomap_fragment',
    ]) {
      source = expandSubstrateSmIndirectChunk(source, name, shaderChunks);
    }
    const antialiasing = removeHostSpecularAa(source, shader.uniforms);
    const occlusion = removeHostSpecularOcclusion(
      antialiasing.source,
      shader.uniforms,
    );
    source = occlusion.source;
    const surfacePrelude = buildSubstrateSmIndirectSurfaceGlsl({
      fields,
      standard,
      hostSpecularAa: antialiasing.present,
    });
    source = replaceSubstrateSmIndirectAnchor(
      source,
      GEOMETRY_POSITION,
      `${surfacePrelude}\n${GEOMETRY_POSITION}`,
      'geometry-position',
    );
    source = replaceSubstrateSmIndirectAnchor(
      source,
      INDIRECT_BEGIN,
      `${buildSubstrateSmIndirectResponsePrelude()}\n${INDIRECT_BEGIN}`,
      'indirect-begin',
    );
    source = replaceSubstrateSmIndirectAnchor(
      source,
      INDIRECT_DIFFUSE_CALL,
      SSM_INDIRECT_DIFFUSE_ACCUMULATION,
      'indirect-diffuse',
    );
    source = replaceSubstrateSmIndirectAnchor(
      source,
      INDIRECT_SPECULAR_CALL,
      SSM_INDIRECT_SPECULAR_ACCUMULATION,
      'indirect-specular',
    );
    if (standard) {
      source = replaceSubstrateSmIndirectAnchor(
        source,
        HOST_REFLECTION_CALL,
        'getIBLRadiance( geometryViewDir, geometryNormal, ssmIndirectReflectionRoughness )',
        'reflection-roughness',
      );
      source = replaceSubstrateSmIndirectAnchor(
        source,
        HOST_MAP_OCCLUSION,
        'computeSpecularOcclusion( dotNV, ambientOcclusion, ssmIndirectReflectionRoughness )',
        'material-ao-roughness',
      );
      if (occlusion.present) {
        source = replaceSubstrateSmIndirectAnchor(
          source,
          SSM_INDIRECT_SPECULAR_ACCUMULATION,
          `${SSM_INDIRECT_SPECULAR_ACCUMULATION}\nreflectedLight.indirectSpecular *= rswSpecOccApply(ssmIndirectReflectionRoughness, geometryNormal, geometryViewDir);`,
          'host-screen-occlusion',
        );
      }
    } else {
      source = expandSubstrateSmIndirectChunk(
        source,
        'envmap_fragment',
        shaderChunks,
      );
      source = replaceSubstrateSmIndirectAnchor(
        source,
        shaderChunks.envmap_fragment,
        '#ifdef USE_ENVMAP\n#error SSM_INDIRECT_PHONG_ENVIRONMENT_DELEGATED\n#endif',
        'phong-environment',
      );
    }
    const reflectionMetadata = source.includes('uRswAlphaRoughOn');
    if (reflectionMetadata) {
      source = replaceSubstrateSmIndirectAnchor(
        source,
        HOST_ROUGHNESS_ALPHA,
        'min( ssmIndirectReflectionRoughness, 0.995 )',
        'host-reflection-metadata',
      );
    }
    source = replaceSubstrateSmIndirectAnchor(
      source,
      'void main() {',
      `${recipeDeclaration}\n${SSM_SPECULAR_FILTER_GLSL}\n${SSM_INDIRECT_LIGHTING_GLSL}\nvoid main() {`,
      'fragment-main',
    );
    const missingReflection =
      environmentKind === 'none' &&
      surface.diffuseReflectance.every((value) => value === 0) &&
      surface.specularF0.some((value) => value > 0);
    return Object.freeze({
      ok: true,
      changed: true,
      code: null,
      fragmentShader: source,
      programKeySuffix: `|ssmIndirect1:${materialPath}:${environmentKind}:aa${Number(antialiasing.present)}:so${Number(occlusion.present)}:ra${Number(reflectionMetadata)}:u${vectorCount}:fields=${Object.values(fields).join(',')}`,
      requirements: Object.freeze({
        fragmentDerivatives: true,
        hostReleaseGate: true,
        hostResolvedFields: true,
      }),
      diagnostics: Object.freeze(
        missingReflection ? ['SSM_NO_HOST_REFLECTION_SOURCE'] : [],
      ),
      ownership: Object.freeze({
        specularAa: antialiasing.present
          ? 'ssm-host-controls'
          : 'geometry-only',
        specularOcclusion: occlusion.present
          ? 'host-mask-once'
          : 'host-ao-map-only',
        emission: 'host',
        exposure: 'host',
        reflectionSources: 'host',
      }),
    });
  } catch (error) {
    return unchanged(
      shader,
      error.code || 'SSM_INDIRECT_CANDIDATE_INVALID',
      error.message,
    );
  }
}

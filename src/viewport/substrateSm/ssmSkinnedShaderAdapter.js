import { PALETTE_GLSL_DECL, PALETTE_GLSL_MAT, PALETTE_GLSL_APPLY_NORMAL,
  PALETTE_GLSL_APPLY_POS } from '../skinnedPaletteCore.js';
import { inspectSubstrateSmSkinnedHost } from './ssmSkinnedHostPolicy.js';
import { buildSubstrateSmDeformedShaderCandidate, requireSubstrateSmUniqueAnchor,
  refuseSubstrateSmDeformedShader } from './ssmDeformedShaderCandidate.js';

export function createSubstrateSmSkinnedShaderCandidate(input = {}) {
  try {
    const { mesh, shader, paletteUniforms } = input;
    const host = inspectSubstrateSmSkinnedHost(mesh, { paletteUniforms });
    if (!host.allowed) throw new Error(host.code);
    if (host.kind === 'palette-skinned') {
      for (const source of [PALETTE_GLSL_DECL, PALETTE_GLSL_MAT, PALETTE_GLSL_APPLY_NORMAL, PALETTE_GLSL_APPLY_POS,
        `#include <beginnormal_vertex>\n${PALETTE_GLSL_MAT}\n${PALETTE_GLSL_APPLY_NORMAL}`,
        `#include <begin_vertex>\n${PALETTE_GLSL_APPLY_POS}`]) {
        requireSubstrateSmUniqueAnchor(shader.vertexShader, source);
      }
      if (shader.uniforms?.rswPaletteTex !== paletteUniforms.tex
        || shader.uniforms?.rswPaletteDim !== paletteUniforms.dim) {
        throw new Error('The existing palette pool uniform holders must remain shared');
      }
    } else {
      for (const chunk of ['skinning_pars_vertex', 'skinbase_vertex', 'skinnormal_vertex', 'skinning_vertex']) {
        requireSubstrateSmUniqueAnchor(shader.vertexShader, `#include <${chunk}>`);
      }
      if (shader.vertexShader.includes('rswPaletteBone')) throw new Error('Mixed native and palette skinning is unsupported');
    }
    return buildSubstrateSmDeformedShaderCandidate({ ...input, host });
  } catch (error) {
    return refuseSubstrateSmDeformedShader(error);
  }
}

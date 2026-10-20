import { buildTriplanarVertexPars, buildTriplanarVertexMain,
  buildTriplanarFragPars, buildTriplanarFragMain } from '../../terrain/triplanarShader.js';
import { atlasLayout } from '../../terrain/terrainTextures.js';
import { inspectSubstrateSmTerrainHost } from './ssmTerrainHostPolicy.js';
import { getSubstrateSmHostTextureSize } from './ssmDeformedHostValidation.js';
import { buildSubstrateSmDeformedShaderCandidate, requireSubstrateSmUniqueAnchor,
  refuseSubstrateSmDeformedShader } from './ssmDeformedShaderCandidate.js';

export function createSubstrateSmTerrainShaderCandidate(input = {}) {
  try {
    const { mesh, shader } = input;
    const terrainLayout = input.terrainLayout ?? atlasLayout();
    if (['cols', 'rows', 'tile'].some(field => !Number.isSafeInteger(terrainLayout[field]) || terrainLayout[field] < 1)) {
      throw new Error('An explicit integral terrain atlas layout is required');
    }
    const host = inspectSubstrateSmTerrainHost(mesh);
    if (!host.allowed) throw new Error(host.code);
    requireSubstrateSmUniqueAnchor(shader.vertexShader, buildTriplanarVertexPars());
    requireSubstrateSmUniqueAnchor(shader.vertexShader, buildTriplanarVertexMain());
    requireSubstrateSmUniqueAnchor(shader.fragmentShader, buildTriplanarFragPars(terrainLayout));
    const blend = buildTriplanarFragMain();
    const blendPosition = requireSubstrateSmUniqueAnchor(shader.fragmentShader, blend);
    const colorPosition = requireSubstrateSmUniqueAnchor(shader.fragmentShader, '#include <color_fragment>');
    const materialPosition = requireSubstrateSmUniqueAnchor(shader.fragmentShader, '#include <lights_physical_fragment>');
    if (blendPosition < colorPosition || blendPosition + blend.length >= materialPosition) {
      throw new Error('Terrain material must resolve after the complete host triplanar mixture');
    }
    const atlas = shader.uniforms?.uRswAtlas?.value;
    const textureSize = getSubstrateSmHostTextureSize(atlas);
    if (atlas?.image?.width !== terrainLayout.cols * terrainLayout.tile
      || atlas?.image?.height !== terrainLayout.rows * terrainLayout.tile) throw new Error('Terrain atlas layout and texture dimensions differ');
    if (textureSize === null || !Number.isFinite(shader.uniforms?.uRswTexScale?.value)
      || shader.uniforms.uRswTexScale.value <= 0) throw new Error('Host terrain atlas holders are required');
    return buildSubstrateSmDeformedShaderCandidate({ ...input, host, textureSize, terrainLayout });
  } catch (error) {
    return refuseSubstrateSmDeformedShader(error);
  }
}

import { assertSubstrateSmKey, createSubstrateSmProgramKey } from '../../lighting/substrateSm/ssmRecipeKeys.js';
import { TRIPLANAR_CACHE_KEY } from '../../terrain/triplanarShader.js';
import { atlasLayout } from '../../terrain/terrainTextures.js';

export function createSubstrateSmDeformedProgramKey({ kind, surface, terrainLayout = atlasLayout() } = {}) {
  assertSubstrateSmKey(surface?.programKey, 'program');
  let variant;
  if (kind === 'terrain') {
    if (['cols', 'rows', 'tile'].some(field => !Number.isSafeInteger(terrainLayout?.[field]) || terrainLayout[field] < 1)) {
      throw new Error('An explicit integral terrain atlas layout is required');
    }
    variant = `terrain/${TRIPLANAR_CACHE_KEY}/${terrainLayout.cols}x${terrainLayout.rows}x${terrainLayout.tile}`;
  } else if (kind === 'native-skinned') {
    variant = 'skinned/three161';
  } else if (kind === 'palette-skinned') {
    variant = 'palette/rswPalette186';
  } else {
    throw new Error('An explicit deformed host kind is required');
  }
  return createSubstrateSmProgramKey({ family: surface.family, hostBackend: 'standard',
    structuralVariant: `ssm-f20/v1/${variant}/${surface.programKey.signature}`, patchGeneration: 1 });
}

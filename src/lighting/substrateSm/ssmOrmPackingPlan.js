import { serializeSubstrateSmKeyDescriptor } from './ssmKeySerialization.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { describeSubstrateSmMipChain, describeSubstrateSmBakeMemory } from './ssmTextureFootprint.js';

export const SSM_MAP_PLAN_VERSION = 1;
export const SSM_ORM_PATCH_ID = 'ssm-orm-three161-v1';
export const SSM_ORM_MIP_POLICY = 'linear-channel-area-average-even-v1';

export function planSubstrateSmOrmPacking(bindings, mode) {
  if (!['host', 'shared', 'bake'].includes(mode)) throw new TypeError('Unknown ORM mode');
  const roughness = bindings.find(binding => binding.role === 'roughness');
  const metalness = bindings.find(binding => binding.role === 'metalness');
  const occlusion = bindings.find(binding => binding.role === 'occlusion');
  if (mode === 'host') return null;
  if (!roughness || !metalness) throw new Error('Shared ORM requires roughness and metalness maps');
  const sources = [roughness, metalness, ...(occlusion ? [occlusion] : [])];
  const referenceSampling = serializeSubstrateSmKeyDescriptor(roughness.sampling);
  for (const source of sources) {
    if (source.width !== roughness.width || source.height !== roughness.height
      || source.mipMode !== roughness.mipMode || source.mipLevels !== roughness.mipLevels
      || serializeSubstrateSmKeyDescriptor(source.sampling) !== referenceSampling) {
      throw new Error('ORM packing requires identical UV sets, transforms, wrapping, filtering, orientation, resolution and mips');
    }
    if (source.format !== 'rgba8') throw new Error('ORM packing only accepts linear RGBA8 data; HDR maps remain untouched');
  }
  const sameImage = sources.every(source => source.id === roughness.id && source.revision === roughness.revision);
  if (mode === 'shared' && !sameImage) throw new Error('Shared reads require the same versioned ORM image');
  if (mode === 'bake' && roughness.mipMode === 'provided') {
    throw new Error('Baking custom authored mip chains is delegated; existing levels must not be discarded');
  }
  const outputLayout = describeSubstrateSmMipChain(roughness.width, roughness.height, 4, roughness.mipMode !== 'none');
  return copySubstrateSmImmutableData({
    version: SSM_MAP_PLAN_VERSION, mode, requiredPatch: SSM_ORM_PATCH_ID,
    channels: { r: occlusion ? 'occlusion' : 'one', g: 'roughness', b: 'metalness', a: 'reserved-one' },
    alphaOwnership: 'reserved-one-no-authored-alpha-overwrite',
    occlusionEnabled: Boolean(occlusion), sourceSamplerSlots: sources.length,
    candidateSamplerSlots: 1, candidateTextureReads: 1,
    roughness, metalness, occlusion: occlusion ?? null,
    output: {
      width: roughness.width, height: roughness.height, format: 'rgba8', colorSpace: '',
      sampling: roughness.sampling, mipMode: roughness.mipMode,
      mipPolicy: mode === 'bake' ? SSM_ORM_MIP_POLICY : 'preserve-host-mips',
      layout: outputLayout,
    },
    memory: mode === 'bake' ? describeSubstrateSmBakeMemory(sources, outputLayout) : null,
  });
}

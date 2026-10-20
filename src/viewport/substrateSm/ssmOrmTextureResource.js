import { SSM_THREE_REVISION } from '../../lighting/substrateSm/ssmContract.js';
import { describeSubstrateSmMipChain } from '../../lighting/substrateSm/ssmTextureFootprint.js';
import { normalizeSubstrateSmMapSampling } from '../../lighting/substrateSm/ssmMapValidation.js';

export function createSubstrateSmOrmTextureResource({ THREE, baked, uploadTexture }) {
  if (String(THREE?.REVISION) !== SSM_THREE_REVISION || typeof uploadTexture !== 'function') {
    throw new TypeError('An audited renderer upload callback is required');
  }
  const output = baked?.output;
  if (!output || output.colorSpace !== '' || output.format !== 'rgba8') throw new TypeError('ORM uploads must remain linear RGBA8');
  const layout = describeSubstrateSmMipChain(output.width, output.height, 4, output.mipMode !== 'none');
  const sampling = normalizeSubstrateSmMapSampling(output.sampling);
  if (sampling.premultiplyAlpha || baked.byteLength !== layout.byteLength || baked.levels.length !== layout.levels.length) {
    throw new TypeError('The uploaded mip chain must match the admitted output');
  }
  for (let index = 0; index < layout.levels.length; index += 1) {
    const actual = baked.levels[index];
    const expected = layout.levels[index];
    if (actual.width !== expected.width || actual.height !== expected.height
      || !(actual.data instanceof Uint8Array) || actual.data.byteLength !== expected.byteLength
      || actual.data.byteOffset !== 0 || actual.data.buffer.byteLength !== expected.byteLength) throw new TypeError('Invalid owned mip level');
  }
  const wrapping = { repeat: THREE.RepeatWrapping, clamp: THREE.ClampToEdgeWrapping, mirror: THREE.MirroredRepeatWrapping };
  const filtering = {
    nearest: THREE.NearestFilter, linear: THREE.LinearFilter,
    nearestMipmapNearest: THREE.NearestMipmapNearestFilter, nearestMipmapLinear: THREE.NearestMipmapLinearFilter,
    linearMipmapNearest: THREE.LinearMipmapNearestFilter, linearMipmapLinear: THREE.LinearMipmapLinearFilter,
  };
  const texture = new THREE.DataTexture(baked.levels[0].data, output.width, output.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    texture.dispose();
    texture.mipmaps = [];
    texture.image = { data: null, width: output.width, height: output.height };
  }
  try {
    texture.name = 'Substrate SM derived ORM';
    texture.colorSpace = THREE.NoColorSpace;
    texture.channel = sampling.uvSet;
    texture.matrixAutoUpdate = false;
    texture.matrix.fromArray(sampling.matrix);
    texture.wrapS = wrapping[sampling.wrapS];
    texture.wrapT = wrapping[sampling.wrapT];
    texture.minFilter = filtering[sampling.minFilter];
    texture.magFilter = filtering[sampling.magFilter];
    texture.anisotropy = sampling.anisotropy;
    texture.flipY = sampling.flipY;
    texture.premultiplyAlpha = false;
    texture.generateMipmaps = false;
    texture.mipmaps = baked.levels.length > 1 ? baked.levels : [];
    texture.needsUpdate = true;
    if (uploadTexture(texture) !== true) throw new Error('Texture upload must complete before the reservation can shrink');
    return Object.freeze({ texture, cpuBytes: layout.byteLength, gpuBytes: layout.byteLength, uploadComplete: true, dispose });
  } catch (error) {
    dispose();
    throw error;
  }
}

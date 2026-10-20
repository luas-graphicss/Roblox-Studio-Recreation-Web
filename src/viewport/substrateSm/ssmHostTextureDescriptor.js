import { SSM_THREE_REVISION } from '../../lighting/substrateSm/ssmContract.js';

export function readSubstrateSmTextureSampling(THREE, texture) {
  const wrapping = new Map([[THREE.RepeatWrapping, 'repeat'], [THREE.ClampToEdgeWrapping, 'clamp'], [THREE.MirroredRepeatWrapping, 'mirror']]);
  const filtering = new Map([
    [THREE.NearestFilter, 'nearest'], [THREE.LinearFilter, 'linear'],
    [THREE.NearestMipmapNearestFilter, 'nearestMipmapNearest'], [THREE.NearestMipmapLinearFilter, 'nearestMipmapLinear'],
    [THREE.LinearMipmapNearestFilter, 'linearMipmapNearest'], [THREE.LinearMipmapLinearFilter, 'linearMipmapLinear'],
  ]);
  const matrix = texture.matrixAutoUpdate
    ? new THREE.Matrix3().setUvTransform(texture.offset.x, texture.offset.y, texture.repeat.x, texture.repeat.y,
      texture.rotation, texture.center.x, texture.center.y).elements.slice()
    : texture.matrix.elements.slice();
  return {
    uvSet: texture.channel, matrix, wrapS: wrapping.get(texture.wrapS), wrapT: wrapping.get(texture.wrapT),
    minFilter: filtering.get(texture.minFilter), magFilter: filtering.get(texture.magFilter),
    anisotropy: texture.anisotropy, flipY: texture.flipY, premultiplyAlpha: texture.premultiplyAlpha,
  };
}

export function describeSubstrateSmHostTexture({ THREE, texture, id, revision, status, dynamic, retainedBytes = 0 }) {
  if (String(THREE?.REVISION) !== SSM_THREE_REVISION) throw new Error('Texture descriptors require the audited Three revision');
  if (!texture?.isTexture || texture.isRenderTargetTexture || texture.isCompressedTexture
    || texture.isCubeTexture || texture.isData3DTexture || texture.isDataArrayTexture || texture.isVideoTexture) {
    throw new Error('Only static, uncompressed host texture2D resources can be described');
  }
  if (texture.format !== THREE.RGBAFormat) throw new Error('The host texture must use an explicit RGBA format');
  const format = texture.type === THREE.UnsignedByteType ? 'rgba8'
    : texture.type === THREE.HalfFloatType ? 'rgba16f' : texture.type === THREE.FloatType ? 'rgba32f' : null;
  if (!format || texture.internalFormat !== null) throw new Error('Custom or unsupported host storage is delegated');
  const image = texture.image;
  const width = image?.width;
  const height = image?.height;
  const sampling = readSubstrateSmTextureSampling(THREE, texture);
  const mipmaps = texture.mipmaps;
  const mipMode = mipmaps.length > 0 ? 'provided'
    : texture.generateMipmaps && /Mipmap/.test(sampling.minFilter) ? 'generated' : 'none';
  return {
    id, revision, uploadVersion: texture.version, status, dynamic, width, height, format,
    colorSpace: texture.colorSpace, mipMode, mipLevels: mipmaps.length,
    sampling, retainedBytes,
  };
}

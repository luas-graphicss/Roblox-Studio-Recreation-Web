import { serializeSubstrateSmKeyDescriptor } from './ssmKeySerialization.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { describeSubstrateSmMipChain, requireSubstrateSmByteCount } from './ssmTextureFootprint.js';

export function readSubstrateSmMapProperty(record, name, fallback) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(record))) {
    throw new TypeError('Map descriptors must be plain records');
  }
  const property = Object.getOwnPropertyDescriptor(record, name);
  if (property && !Object.hasOwn(property, 'value')) throw new TypeError(`Map property ${name} must not execute a getter`);
  return property?.value === undefined ? fallback : property.value;
}

export function requireSubstrateSmMapText(value, name, maximum = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new TypeError(`${name} must be bounded text`);
  return value;
}

export function requireSubstrateSmAssetRevision(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  return requireSubstrateSmMapText(value, 'revision', 256);
}

export function normalizeSubstrateSmMapSampling(input) {
  const text = serializeSubstrateSmKeyDescriptor(input);
  const sampling = JSON.parse(text);
  const allowed = ['uvSet', 'matrix', 'wrapS', 'wrapT', 'minFilter', 'magFilter', 'anisotropy', 'flipY', 'premultiplyAlpha'];
  if (Object.keys(sampling).some(key => !allowed.includes(key))) throw new TypeError('Unknown map sampling field');
  if (![0, 1, 2, 3].includes(sampling.uvSet)) throw new RangeError('Map UV set must be explicitly resolved');
  if (!Array.isArray(sampling.matrix) || sampling.matrix.length !== 9
    || sampling.matrix.some(value => typeof value !== 'number' || !Number.isFinite(value))
    || sampling.matrix[2] !== 0 || sampling.matrix[5] !== 0 || sampling.matrix[8] !== 1) {
    throw new TypeError('Map transform must be an affine column-major matrix');
  }
  if (!['repeat', 'clamp', 'mirror'].includes(sampling.wrapS)
    || !['repeat', 'clamp', 'mirror'].includes(sampling.wrapT)) throw new TypeError('Unknown map wrapping');
  if (!['nearest', 'linear', 'nearestMipmapNearest', 'nearestMipmapLinear', 'linearMipmapNearest', 'linearMipmapLinear'].includes(sampling.minFilter)
    || !['nearest', 'linear'].includes(sampling.magFilter)) throw new TypeError('Unknown map filtering');
  if (typeof sampling.anisotropy !== 'number' || !Number.isFinite(sampling.anisotropy) || sampling.anisotropy < 1) {
    throw new TypeError('Map anisotropy must be explicitly resolved');
  }
  if (typeof sampling.flipY !== 'boolean' || typeof sampling.premultiplyAlpha !== 'boolean') {
    throw new TypeError('Map upload orientation and alpha must be explicit');
  }
  return copySubstrateSmImmutableData(sampling);
}

export function normalizeSubstrateSmMapAsset(asset, role, samplingOverride) {
  const get = (name, fallback) => readSubstrateSmMapProperty(asset, name, fallback);
  const id = requireSubstrateSmMapText(get('id'), 'asset id');
  const revision = requireSubstrateSmAssetRevision(get('revision'));
  const uploadVersion = requireSubstrateSmByteCount(get('uploadVersion', 0), 'uploadVersion');
  if (get('status') !== 'ready') throw new Error(`Asset ${id} is unavailable: ${String(get('status', 'unknown'))}`);
  if (get('dynamic') !== 'static') throw new Error(`Asset ${id} is not an explicitly static texture`);
  const format = get('format');
  const bytesPerPixel = { rgba8: 4, rgba16f: 8, rgba32f: 16 }[format];
  if (!bytesPerPixel) throw new TypeError(`Asset ${id} uses an unsupported texture format`);
  const colorSpace = get('colorSpace');
  const allowedColorSpaces = role === 'emissive' ? ['srgb', 'srgb-linear']
    : ['color', 'detailColor'].includes(role) ? ['srgb'] : ['', 'srgb-linear'];
  if (!allowedColorSpaces.includes(colorSpace)) throw new TypeError(`Asset ${id} violates the ${role} color-space contract`);
  const width = get('width');
  const height = get('height');
  const mipMode = get('mipMode');
  if (!['none', 'generated', 'provided'].includes(mipMode)) throw new TypeError('Texture mip ownership must be explicit');
  const layout = describeSubstrateSmMipChain(width, height, bytesPerPixel, mipMode !== 'none');
  if (mipMode === 'provided' && get('mipLevels') !== layout.levels.length) throw new TypeError('Provided mip chains must be complete');
  const sampling = normalizeSubstrateSmMapSampling(samplingOverride === undefined ? get('sampling') : samplingOverride);
  if (mipMode === 'none' && /Mipmap/.test(sampling.minFilter)) throw new TypeError('Mip filtering requires a complete mip chain');
  if (!['color', 'detailColor', 'emissive'].includes(role) && sampling.premultiplyAlpha) {
    throw new TypeError('Data textures must not be premultiplied by alpha');
  }
  const residentBytes = get('residentBytes', layout.byteLength);
  requireSubstrateSmByteCount(residentBytes, 'residentBytes');
  if (residentBytes < layout.byteLength) throw new RangeError('Original texture residency is underreported');
  const retainedBytes = requireSubstrateSmByteCount(get('retainedBytes', 0), 'retainedBytes');
  return copySubstrateSmImmutableData({
    role, id, revision, uploadVersion, width, height, format, colorSpace, mipMode,
    mipLevels: layout.levels.length, sampling, residentBytes, retainedBytes, baseBytes: layout.baseBytes,
  });
}

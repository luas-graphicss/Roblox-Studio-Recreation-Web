import { getSubstrateSmProfile } from './ssmContract.js';
import { planSubstrateSmOrmPacking } from './ssmOrmPackingPlan.js';
import { serializeSubstrateSmKeyDescriptor } from './ssmKeySerialization.js';
import { buildSubstrateSmRgbaMipChain, throwIfSubstrateSmBakeAborted, yieldSubstrateSmBakeTask } from './ssmRgbaMipChain.js';

function inspectPixelLease(lease, source) {
  if (!lease || typeof lease.release !== 'function') throw new TypeError('Pixel providers must return releasable leases');
  if (lease.id !== source.id || lease.revision !== source.revision
    || lease.width !== source.width || lease.height !== source.height
    || lease.format !== source.format || lease.colorSpace !== source.colorSpace) {
    throw new Error('Loaded asset metadata does not match the admitted version');
  }
  if (!(lease.data instanceof Uint8Array) || lease.data.byteLength !== source.baseBytes
    || lease.data.byteOffset !== 0 || lease.data.buffer.byteLength !== source.baseBytes) {
    throw new RangeError('Decoded asset data exceeds or does not match its admitted staging allocation');
  }
}

export async function bakeSubstrateSmOrm({
  orm, profile, loadPixels, signal, yieldControl = yieldSubstrateSmBakeTask,
}) {
  if (!orm || orm.mode !== 'bake') throw new TypeError('An admitted static ORM bake plan is required');
  const settings = getSubstrateSmProfile(profile);
  const sources = [orm.roughness, orm.metalness, ...(orm.occlusion ? [orm.occlusion] : [])];
  const verified = planSubstrateSmOrmPacking(sources, 'bake');
  if (!settings || verified.memory.incrementalPeakBytes > settings.limits.derivedTexturePeakBytes
    || serializeSubstrateSmKeyDescriptor(verified) !== serializeSubstrateSmKeyDescriptor(orm)) {
    throw new RangeError('ORM bake descriptor or preallocation budget is invalid');
  }
  if (typeof loadPixels !== 'function' || typeof yieldControl !== 'function') throw new TypeError('Bake providers must be explicit');
  const acquired = [];
  const pixels = new Map();
  let failure = null;
  try {
    for (const source of sources) {
      throwIfSubstrateSmBakeAborted(signal);
      const identity = JSON.stringify([source.id, source.revision]);
      if (pixels.has(identity)) continue;
      const lease = await loadPixels(source, { signal, maxBytes: source.baseBytes });
      if (lease && typeof lease.release === 'function') acquired.push(lease);
      throwIfSubstrateSmBakeAborted(signal);
      inspectPixelLease(lease, source);
      pixels.set(identity, lease.data);
    }
    throwIfSubstrateSmBakeAborted(signal);
    const read = source => pixels.get(JSON.stringify([source.id, source.revision]));
    const roughness = read(orm.roughness);
    const metalness = read(orm.metalness);
    const occlusion = orm.occlusion ? read(orm.occlusion) : null;
    const baseData = new Uint8Array(orm.output.layout.baseBytes);
    for (let y = 0; y < orm.output.height; y += 1) {
      if (y % 8 === 0) {
        await yieldControl();
        throwIfSubstrateSmBakeAborted(signal);
      }
      for (let x = 0; x < orm.output.width; x += 1) {
        const offset = (y * orm.output.width + x) * 4;
        baseData[offset] = occlusion ? occlusion[offset] : 255;
        baseData[offset + 1] = roughness[offset + 1];
        baseData[offset + 2] = metalness[offset + 2];
        baseData[offset + 3] = 255;
      }
    }
    const levels = await buildSubstrateSmRgbaMipChain(baseData, orm.output.layout, { signal, yieldControl });
    throwIfSubstrateSmBakeAborted(signal);
    return { version: orm.version, output: orm.output, byteLength: orm.output.layout.byteLength, levels };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const errors = [];
    for (const lease of acquired) {
      try { await lease.release(); } catch (error) { errors.push(error); }
    }
    if (!failure && errors.length) throw new AggregateError(errors, 'Pixel lease cleanup failed');
  }
}

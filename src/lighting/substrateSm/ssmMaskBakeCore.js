import { isSubstrateSmMaskPlan } from './ssmMaskPlanCore.js';
import { buildSubstrateSmRgbaMipChain, throwIfSubstrateSmBakeAborted, yieldSubstrateSmBakeTask } from './ssmRgbaMipChain.js';

function requireMaskPixelLease(lease, source) {
  if (!lease || typeof lease.release !== 'function') throw new TypeError('Mask pixel providers must return releasable leases');
  for (const field of ['id', 'revision', 'width', 'height', 'format', 'colorSpace']) {
    if (lease[field] !== source[field]) throw new Error(`Mask bake source ${field} changed after admission`);
  }
  if (!(lease.data instanceof Uint8Array) || lease.data.byteLength !== source.baseBytes
    || lease.data.byteOffset !== 0 || lease.data.buffer.byteLength !== source.baseBytes) {
    throw new RangeError('Mask pixel leases must own exactly their admitted RGBA8 staging bytes');
  }
}

export async function bakeSubstrateSmOrmMask({ plan, loadPixels, signal, yieldControl = yieldSubstrateSmBakeTask }) {
  if (!isSubstrateSmMaskPlan(plan) || plan.mode !== 'bake' || !plan.bake) {
    throw new TypeError('An admitted static ORM-mask bake plan is required');
  }
  if (typeof loadPixels !== 'function' || typeof yieldControl !== 'function') throw new TypeError('Mask bake providers must be explicit');
  const leases = [];
  const pixels = new Map();
  let failure = null;
  try {
    for (const source of plan.bake.sources) {
      throwIfSubstrateSmBakeAborted(signal);
      const identity = JSON.stringify([source.id, source.revision]);
      if (pixels.has(identity)) continue;
      const lease = await loadPixels(source, { signal, maxBytes: source.baseBytes });
      if (lease && typeof lease.release === 'function') leases.push(lease);
      throwIfSubstrateSmBakeAborted(signal);
      requireMaskPixelLease(lease, source);
      pixels.set(identity, lease.data);
    }
    throwIfSubstrateSmBakeAborted(signal);
    const read = source => pixels.get(JSON.stringify([source.id, source.revision]));
    const orm = plan.mapPlan.orm;
    const roughness = read(orm.roughness);
    const metalness = read(orm.metalness);
    const occlusion = orm.occlusion ? read(orm.occlusion) : null;
    const mask = read(plan.source);
    const output = plan.bake.output;
    const baseData = new Uint8Array(output.layout.baseBytes);
    for (let row = 0; row < output.height; row += 1) {
      if (row % 8 === 0) {
        await yieldControl();
        throwIfSubstrateSmBakeAborted(signal);
      }
      for (let column = 0; column < output.width; column += 1) {
        const offset = (row * output.width + column) * 4;
        baseData[offset] = occlusion ? occlusion[offset] : 255;
        baseData[offset + 1] = roughness[offset + 1];
        baseData[offset + 2] = metalness[offset + 2];
        baseData[offset + 3] = mask[offset + plan.bake.channel];
      }
    }
    const levels = await buildSubstrateSmRgbaMipChain(baseData, output.layout, { signal, yieldControl });
    throwIfSubstrateSmBakeAborted(signal);
    return { version: 1, output, byteLength: output.layout.byteLength, levels };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const errors = [];
    for (const lease of leases) {
      try { await lease.release(); } catch (error) { errors.push(error); }
    }
    if (!failure && errors.length) throw new AggregateError(errors, 'Mask pixel lease cleanup failed');
  }
}

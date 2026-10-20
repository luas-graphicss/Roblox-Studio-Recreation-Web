import { makeTextureResource } from "../../contracts/frameContract.js";
import { HDR_TRANSPORT_FRAGMENT, HDR_VALIDATION_FRAGMENT } from "./hdrTransportShader.js";
import { validateColorSource } from "./validateColorSource.js";

export function createHdrTransportGpu({ rendererAdapter: adapter, pool, report = () => {} }) {
  if (!adapter || !pool?.acquire || !pool?.release) throw new TypeError("HDR transport requires the renderer adapter and resource pool");
  const keys = new Set();
  const targetLeases = new WeakMap();
  let material = null;
  let validationMaterial = null;
  let uniforms = null;
  let disposed = false;
  let conversions = 0;

  function acquire(key, descriptor) {
    const target = pool.acquire("CP-F04", key, descriptor);
    keys.add(key);
    if (!targetLeases.has(target)) {
      const lease = { alive: true, version: 0 };
      targetLeases.set(target, lease);
      target.addEventListener?.("dispose", () => { lease.alive = false; });
    }
    return target;
  }

  function initializeMaterials() {
    if (material) return;
    uniforms = { sourceTexture: { value: null }, colorMatrix: { value: new adapter.THREE.Matrix3() }, exposureRatio: { value: 1 }, maximumStorage: { value: 65504 }, decodeSrgb: { value: false }, clampNegative: { value: false }, sdrFallback: { value: false } };
    validationMaterial = adapter.createMaterial(HDR_VALIDATION_FRAGMENT, uniforms);
    material = adapter.createMaterial(HDR_TRANSPORT_FRAGMENT, uniforms);
  }

  function convert({ source, frame, plan, key = "CP-F04.color", history = false }) {
    if (disposed) throw new Error("HDR transport is disposed");
    if (typeof key !== "string" || !key.startsWith("CP-F04.")) throw new Error("HDR output keys must belong to CP-F04");
    validateColorSource(source, frame, plan, history);
    const samplerDecodes = source.texture.colorSpace === adapter.THREE.SRGBColorSpace;
    if (samplerDecodes !== plan.samplerDecoded) throw new Error("Texture sampler color-space decoding disagrees with the transport plan");
    const targetKey = `${key}.${encodeURIComponent(frame.viewId)}.${frame.frameId % 2}`;
    const validationKey = `${key}.${encodeURIComponent(frame.viewId)}.validation`;
    const descriptor = { width: source.width, height: source.height, format: plan.formatPolicy.format, filter: "nearest" };
    const target = acquire(targetKey, descriptor);
    const validationTarget = acquire(validationKey, { ...descriptor, format: "rgba8" });
    if (target.texture === source.texture || validationTarget.texture === source.texture) throw new Error("HDR read/write texture feedback is forbidden");
    initializeMaterials();
    uniforms.sourceTexture.value = source.texture;
    uniforms.colorMatrix.value.set(...plan.matrix);
    uniforms.exposureRatio.value = plan.exposureRatio;
    uniforms.maximumStorage.value = plan.formatPolicy.maximum;
    uniforms.decodeSrgb.value = plan.decodeSrgb;
    uniforms.clampNegative.value = plan.negativePolicy === "clamp-zero";
    uniforms.sdrFallback.value = !plan.formatPolicy.hdr;
    adapter.draw(validationMaterial, validationTarget);
    const validation = adapter.readTarget(validationTarget);
    for (let index = 0; index < validation.length; index += 4) {
      if (validation[index] || validation[index + 1] || validation[index + 2]) {
        const reason = validation[index] ? "non-finite radiance" : validation[index + 1] ? "HDR overflow" : "invalid alpha coverage";
        report({ phase: "CP-F04", type: "transport-rejected", reason, pixelIndex: index / 4, frameId: frame.frameId });
        throw new RangeError(`CP-F04 ${reason} at pixel ${index / 4}; no clipped HDR output published`);
      }
    }
    adapter.draw(material, target);
    const lease = targetLeases.get(target);
    const version = ++lease.version;
    conversions += 1;
    return Object.freeze({ ...makeTextureResource(target, frame, `scene-linear-${plan.destination.name}`), colorSpace: plan.destination, transfer: "linear", samplerDecoded: false, preExposure: plan.destinationPreExposure, sourceProvenance: source.provenance, temporalSourceFrameId: history ? source.frameId : null, formatPolicy: Object.freeze({ ...plan.formatPolicy, exactHdrEligible: plan.formatPolicy.exactHdrEligible && source.format !== "rgba8" && source.formatPolicy?.exactHdrEligible !== false }), rangeValidation: "gpu-mask-synchronous-readback", isAlive: () => !disposed && lease.alive && lease.version === version });
  }

  return Object.freeze({
    convert,
    stats: () => ({ conversions, materialCount: material ? 2 : 0, ownedTargets: keys.size, validation: "synchronous-diagnostic-readback", productionTimingCertified: false }),
    dispose() {
      if (disposed) return;
      disposed = true;
      material?.dispose();
      validationMaterial?.dispose();
      for (const key of keys) pool.release(key);
      keys.clear();
    }
  });
}

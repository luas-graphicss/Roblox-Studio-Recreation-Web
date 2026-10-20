import { createDiagnosticReporter } from "./createDiagnosticReporter.js";
import { createMaterialCompiler } from "./createMaterialCompiler.js";
import { createWarmupQueue } from "./createWarmupQueue.js";
import { shaderStructureKey } from "./shaderStructure.js";
import { assertTextureInputs } from "./textureFeedback.js";
import { withShaderFailureGuard } from "./shaderFailureGuard.js";

export function createManagedRendererAdapter(
  base,
  { pool, report = () => {}, maxPendingPrograms = 128, maxTrackedMaterials = 256, now } = {}
) {
  if (!["createMaterial", "draw", "readTarget"].every((name) => typeof base?.[name] === "function"))
    throw new TypeError("A renderer adapter is required");
  const emit = createDiagnosticReporter(report);
  const compiler = createMaterialCompiler(base);
  const queue = createWarmupQueue({ maxPending: maxPendingPrograms, now });
  const materials = new Map();
  const retiredMaterials = new WeakSet();
  let disposed = false;
  let serial = 0;
  let epoch = 0;
  let compilations = 0;
  let draws = 0;
  let shaderFailures = 0;
  function assertActive() {
    if (disposed) throw new Error("Managed renderer adapter is disposed");
  }
  function structure(material) {
    return shaderStructureKey(material, {
      colorSpace: base.renderer?.outputColorSpace,
      toneMapping: base.renderer?.toneMapping
    });
  }
  function compile(record) {
    assertActive();
    if (!materials.has(record.material)) throw new Error("Material has been released");
    const signature = structure(record.material);
    if (record.signature === signature && record.epoch === epoch) return false;
    if (record.failure && record.failureSignature === signature && record.failureEpoch === epoch)
      throw new Error(record.failure);
    try {
      if (record.signature !== null || record.epoch !== -1) record.material.needsUpdate = true;
      compiler.compile(record.material);
      record.signature = signature;
      record.epoch = epoch;
      record.failure = null;
      compilations += 1;
      return true;
    } catch (error) {
      record.failure = error.message;
      record.failureSignature = signature;
      record.failureEpoch = epoch;
      shaderFailures += 1;
      emit({ phase: "CP-F32", type: "shader-rejected", message: error.message });
      throw error;
    }
  }
  function enqueue(record, options) {
    return queue.enqueue(record.id, () => compile(record), options);
  }
  function track(material, owned) {
    if (retiredMaterials.has(material)) throw new Error("Released material cannot be reused");
    if (materials.has(material)) return materials.get(material);
    if (materials.size >= maxTrackedMaterials)
      throw new RangeError("Managed material capacity exceeded");
    const record = {
      material,
      owned,
      id: `CP-F32.program.${serial++}`,
      signature: null,
      epoch: -1,
      failure: null,
      onDispose: null
    };
    record.onDispose = () => {
      queue.cancel(record.id);
      materials.delete(material);
      retiredMaterials.add(material);
      material.removeEventListener?.("dispose", record.onDispose);
    };
    material.addEventListener?.("dispose", record.onDispose);
    materials.set(material, record);
    return record;
  }
  function assertTarget(target) {
    if (!target) throw new Error("Managed post-process draws require an explicit target");
    if (pool?.textureStatus?.(target.texture) === false)
      throw new Error("Managed draw uses a released target");
  }
  return Object.freeze({
    ...base,
    createMaterial(fragmentShader, uniforms = {}) {
      assertActive();
      const material = base.createMaterial(fragmentShader, uniforms);
      try {
        const record = track(material, true);
        enqueue(record);
        return material;
      } catch (error) {
        materials.get(material)?.onDispose();
        material.dispose();
        throw error;
      }
    },
    queueMaterial(material, options) {
      assertActive();
      return enqueue(track(material, false), options);
    },
    compileMaterial(material) {
      assertActive();
      const record = track(material, false);
      queue.cancel(record.id);
      return compile(record);
    },
    draw(material, target) {
      assertActive();
      assertTarget(target);
      assertTextureInputs(material, target, pool);
      const record = track(material, false);
      queue.cancel(record.id);
      compile(record);
      const result = withShaderFailureGuard(base, () => base.draw(material, target));
      draws += 1;
      return result;
    },
    readTarget(target) {
      assertActive();
      assertTarget(target);
      return base.readTarget(target);
    },
    warmup(options) {
      assertActive();
      return queue.drain(options);
    },
    cancelWarmup() {
      queue.cancelAll();
    },
    invalidatePrograms() {
      assertActive();
      epoch += 1;
      queue.cancelAll();
      for (const record of materials.values()) {
        record.material.needsUpdate = true;
        record.signature = null;
        record.epoch = -1;
      }
    },
    requeueMaterials() {
      assertActive();
      for (const record of materials.values()) {
        if (queue.stats().pending >= maxPendingPrograms) break;
        const signature = structure(record.material);
        const rejected =
          record.failure && record.failureSignature === signature && record.failureEpoch === epoch;
        if (!rejected && (record.epoch !== epoch || record.signature !== signature))
          enqueue(record);
      }
    },
    managedStats: () => ({
      liveMaterials: materials.size,
      compilations,
      draws,
      shaderFailures,
      programEpoch: epoch,
      warmup: queue.stats(),
      cacheBackend: "renderer-owned-structural-program-cache",
      disposed
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      queue.dispose();
      const failures = [];
      for (const record of [...materials.values()]) {
        record.onDispose();
        if (record.owned) {
          try {
            record.material.dispose();
          } catch (error) {
            failures.push(error);
          }
        }
      }
      compiler.dispose();
      if (failures.length) throw new AggregateError(failures, "Managed material cleanup failed");
    }
  });
}

import { estimateTargetBytes } from "../../core/resourcePool.js";
import { normalizeTargetDescriptor, targetDescriptorKey } from "./targetDescriptor.js";

export function createRobustResourcePool({
  createTarget,
  budgetBytes = 268435456,
  capabilities = {}
}) {
  if (typeof createTarget !== "function" || !Number.isSafeInteger(budgetBytes) || budgetBytes <= 0)
    throw new TypeError("Invalid resource pool configuration");
  const records = new Map();
  const targetRecords = new WeakMap();
  const textureRecords = new WeakMap();
  let currentBytes = 0;
  let peakBytes = 0;
  let peakLiveTargets = 0;
  let allocations = 0;
  let disposals = 0;
  let disposed = false;

  function assertActive() {
    if (disposed) throw new Error("Resource pool is disposed");
  }
  function retire(record, destroy) {
    if (!record.alive) return false;
    record.alive = false;
    record.target.removeEventListener?.("dispose", record.onDispose);
    if (records.get(record.key) === record) records.delete(record.key);
    currentBytes -= record.bytes;
    disposals += 1;
    if (destroy) record.target.dispose();
    return true;
  }
  function release(key) {
    const record = records.get(key);
    return record ? retire(record, true) : false;
  }
  function releaseMatching(predicate) {
    const failures = [];
    for (const record of [...records.values()]) {
      if (!predicate(record)) continue;
      try {
        retire(record, true);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "Resource cleanup failed");
  }
  function acquire(owner, key, input) {
    assertActive();
    if (
      typeof owner !== "string" ||
      !owner ||
      typeof key !== "string" ||
      !key.startsWith(`${owner}.`)
    )
      throw new Error("Invalid resource owner or key");
    const descriptor = normalizeTargetDescriptor(input, capabilities);
    const signature = targetDescriptorKey(descriptor);
    const existing = records.get(key);
    if (existing && existing.owner !== owner) throw new Error("Resource ownership collision");
    if (existing?.signature === signature && existing.alive) return existing.target;
    const bytes = estimateTargetBytes(descriptor);
    if (currentBytes + bytes > budgetBytes)
      throw new RangeError(
        `Transient allocation budget exceeded: ${currentBytes + bytes} > ${budgetBytes}`
      );
    const target = createTarget(descriptor);
    if (
      !target?.texture ||
      typeof target.texture !== "object" ||
      typeof target.dispose !== "function" ||
      typeof target.addEventListener !== "function" ||
      typeof target.removeEventListener !== "function"
    ) {
      try {
        target?.dispose?.();
      } finally {
        throw new TypeError("Target factory must expose a texture, disposal and lifetime events");
      }
    }
    if (targetRecords.has(target) || textureRecords.has(target.texture))
      throw new Error("Target factory reused a managed resource");
    if (target.width !== descriptor.width || target.height !== descriptor.height) {
      target.dispose();
      throw new Error("Target factory returned mismatched dimensions");
    }
    const record = { key, owner, signature, target, bytes, alive: true, onDispose: null };
    record.onDispose = () => retire(record, false);
    try {
      target.addEventListener?.("dispose", record.onDispose);
    } catch (error) {
      target.dispose();
      throw error;
    }
    const transientBytes = currentBytes + bytes;
    const transientTargets = records.size + 1;
    if (existing) {
      try {
        retire(existing, true);
      } catch (error) {
        target.removeEventListener?.("dispose", record.onDispose);
        target.dispose();
        throw error;
      }
    }
    records.set(key, record);
    targetRecords.set(target, record);
    textureRecords.set(target.texture, record);
    if (target.depthTexture) textureRecords.set(target.depthTexture, record);
    currentBytes += bytes;
    peakBytes = Math.max(peakBytes, transientBytes);
    peakLiveTargets = Math.max(peakLiveTargets, transientTargets);
    allocations += 1;
    return target;
  }
  function isAlive(target) {
    return targetRecords.get(target)?.alive === true;
  }
  return Object.freeze({
    acquire,
    release,
    releaseOwner(owner) {
      releaseMatching((record) => record.owner === owner);
    },
    clear() {
      assertActive();
      releaseMatching(() => true);
    },
    isAlive,
    textureStatus(texture) {
      const record = textureRecords.get(texture);
      return record ? record.alive : null;
    },
    assertAlive(target) {
      assertActive();
      if (!isAlive(target)) throw new Error("Released or unowned target");
      return target;
    },
    lease(owner, key, descriptor) {
      const target = acquire(owner, key, descriptor);
      let closed = false;
      const alive = () => !closed && !disposed && isAlive(target);
      return Object.freeze({
        get target() {
          if (!alive()) throw new Error("Expired target lease");
          return target;
        },
        isAlive: alive,
        close() {
          closed = true;
        }
      });
    },
    stats: () => ({
      currentBytes,
      peakBytes,
      budgetBytes,
      liveTargets: records.size,
      peakLiveTargets,
      allocations,
      disposals,
      accounting: "declared-target-bytes-including-transient-replacement",
      disposed
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseMatching(() => true);
    }
  });
}

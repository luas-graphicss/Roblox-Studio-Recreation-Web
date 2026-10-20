const formatBytes = Object.freeze({ rgba16f: 8, rgba8: 4, rg16f: 4, r16f: 2, r32f: 4, depth24: 4 });

export function estimateTargetBytes(descriptor) {
  const { width, height, format, depth = false } = descriptor;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !formatBytes[format]) throw new TypeError("Invalid target descriptor");
  return width * height * (formatBytes[format] + (depth ? 4 : 0));
}

export function createResourcePool({ createTarget, budgetBytes = 268435456 }) {
  if (typeof createTarget !== "function" || !Number.isFinite(budgetBytes) || budgetBytes <= 0) throw new TypeError("Invalid resource pool configuration");
  const records = new Map();
  let currentBytes = 0;
  let peakBytes = 0;
  let allocations = 0;
  let disposals = 0;

  function release(key) {
    const record = records.get(key);
    if (!record) return false;
    record.target.dispose();
    currentBytes -= record.bytes;
    records.delete(key);
    disposals += 1;
    return true;
  }

  function acquire(owner, key, descriptor) {
    if (!key.startsWith(`${owner}.`)) throw new Error(`Resource key ${key} does not belong to ${owner}`);
    const bytes = estimateTargetBytes(descriptor);
    const signature = JSON.stringify([descriptor.width, descriptor.height, descriptor.format, descriptor.depth === true, descriptor.filter ?? "nearest"]);
    const existing = records.get(key);
    if (existing?.signature === signature) return existing.target;
    if (currentBytes + bytes > budgetBytes) throw new Error(`Resource budget exceeded: ${currentBytes + bytes} > ${budgetBytes}`);
    const target = createTarget({ ...descriptor });
    if (!target || typeof target.dispose !== "function") throw new TypeError("Target factory returned an invalid target");
    release(key);
    records.set(key, { owner, bytes, signature, target });
    currentBytes += bytes;
    peakBytes = Math.max(peakBytes, currentBytes);
    allocations += 1;
    return target;
  }

  return Object.freeze({
    acquire,
    release,
    releaseOwner(owner) { for (const [key, record] of [...records]) if (record.owner === owner) release(key); },
    stats: () => ({ currentBytes, peakBytes, budgetBytes, liveTargets: records.size, allocations, disposals, accounting: "declared-target-bytes" }),
    dispose() { for (const key of [...records.keys()]) release(key); }
  });
}

import { integer, MAXIMUM_BUDGET_BYTES } from "./qualityContract.js";

export function createMemoryLedger({ budgetBytes }) {
  integer(budgetBytes, "budgetBytes", 1, MAXIMUM_BUDGET_BYTES);
  const allocations = new Map();
  const limits = new Map();
  let currentBytes = 0;
  let peakBytes = 0;
  let serial = 0;
  let rejected = 0;
  const ownerBytes = (owner) => [...allocations.values()].filter((entry) => entry.owner === owner).reduce((sum, entry) => sum + entry.bytes, 0);
  return Object.freeze({
    setOwnerLimit(owner, bytes) {
      integer(bytes, "owner budget", 1, budgetBytes);
      if (ownerBytes(owner) > bytes) throw new RangeError("Release live resources before reducing their budget");
      limits.set(owner, bytes);
    },
    releaseOwnerLimit(owner) {
      if (ownerBytes(owner)) throw new Error("Live allocations prevent owner retirement");
      return limits.delete(owner);
    },
    reserve(owner, bytes, category = "external") {
      integer(bytes, "reservation bytes");
      if (!limits.has(owner)) throw new Error("An owner budget must be registered before allocation");
      if (!["target", "external"].includes(category)) throw new TypeError("Unknown reservation category");
      if (currentBytes + bytes > budgetBytes || ownerBytes(owner) + bytes > limits.get(owner)) {
        rejected += 1;
        throw new RangeError("CP-F31 memory budget exceeded before allocation");
      }
      const id = serial++;
      allocations.set(id, { owner, bytes, category });
      currentBytes += bytes;
      peakBytes = Math.max(peakBytes, currentBytes);
      return () => {
        if (!allocations.delete(id)) return false;
        currentBytes -= bytes;
        return true;
      };
    },
    stats() {
      return Object.freeze({ budgetBytes, currentBytes, peakBytes, rejected,
        targetBytes: [...allocations.values()].filter((entry) => entry.category === "target").reduce((sum, entry) => sum + entry.bytes, 0),
        externalBytes: [...allocations.values()].filter((entry) => entry.category === "external").reduce((sum, entry) => sum + entry.bytes, 0),
        owners: [...limits].map(([owner, limit]) => Object.freeze({ owner, budgetBytes: limit, currentBytes: ownerBytes(owner) })),
        accounting: "declared-resident-bytes-including-transient-replacement", physicalGpuBytesMeasured: false });
    }
  });
}

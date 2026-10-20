const arenaNamespaces = new WeakMap();

import { normalizeTargetDescriptor, targetDescriptorKey } from "./targetDescriptor.js";

export function createTransientArena({ pool, owner, namespace = "transient", maxIdleTargets = 2 }) {
  if (
    !pool?.acquire ||
    !pool?.release ||
    typeof owner !== "string" ||
    !owner ||
    !Number.isInteger(maxIdleTargets) ||
    maxIdleTargets < 0
  )
    throw new TypeError("Invalid transient arena configuration");
  if (typeof namespace !== "string" || !namespace)
    throw new TypeError("A transient namespace is required");
  const prefixes = arenaNamespaces.get(pool) ?? new Set();
  const prefix = `${owner}.${namespace}`;
  if (prefixes.has(prefix)) throw new Error("Transient namespace is already in use");
  prefixes.add(prefix);
  arenaNamespaces.set(pool, prefixes);
  const slots = [];
  const names = new Set();
  let epoch = 0;
  let serial = 0;
  let frameKey = null;
  let disposed = false;
  let aliases = 0;
  function assertActive() {
    if (disposed) throw new Error("Transient arena is disposed");
  }
  function releaseSlot(slot) {
    pool.release(slot.key);
    const index = slots.indexOf(slot);
    if (index !== -1) slots.splice(index, 1);
  }
  function reset() {
    epoch += 1;
    names.clear();
    for (const slot of [...slots]) releaseSlot(slot);
    frameKey = null;
  }
  return Object.freeze({
    beginFrame(frame) {
      assertActive();
      if (slots.some((slot) => slot.busy))
        throw new Error("Transient leases remain live at the frame boundary");
      const key = JSON.stringify([
        frame.viewId,
        frame.generation,
        frame.renderSize.width,
        frame.renderSize.height
      ]);
      if (key !== frameKey) reset();
      frameKey = key;
      epoch += 1;
      names.clear();
    },
    acquire(name, input, sampledTextures = []) {
      assertActive();
      if (frameKey === null || typeof name !== "string" || !name || names.has(name))
        throw new Error("Invalid or duplicate transient resource name");
      const descriptor = normalizeTargetDescriptor(input);
      const signature = targetDescriptorKey(descriptor);
      for (const candidate of [...slots])
        if (!candidate.busy && pool.isAlive?.(candidate.target) === false) releaseSlot(candidate);
      let slot = slots.find(
        (candidate) =>
          !candidate.busy &&
          candidate.signature === signature &&
          !sampledTextures.includes(candidate.target.texture)
      );
      if (slot) aliases += 1;
      else {
        const key = `${owner}.${namespace}.${serial++}`;
        slot = {
          key,
          signature,
          target: pool.acquire(owner, key, descriptor),
          busy: false,
          version: 0
        };
        if (sampledTextures.includes(slot.target.texture)) {
          pool.release(key);
          throw new Error("Transient texture feedback");
        }
        slots.push(slot);
      }
      names.add(name);
      slot.busy = true;
      const version = ++slot.version;
      const leaseEpoch = epoch;
      let closed = false;
      const isAlive = () =>
        !disposed &&
        !closed &&
        leaseEpoch === epoch &&
        slot.version === version &&
        slot.busy &&
        (pool.isAlive ? pool.isAlive(slot.target) : true);
      return Object.freeze({
        name,
        get target() {
          if (!isAlive()) throw new Error("Expired transient lease");
          return slot.target;
        },
        isAlive,
        release() {
          if (closed) return;
          closed = true;
          if (leaseEpoch === epoch && slot.version === version) slot.busy = false;
        }
      });
    },
    endFrame() {
      assertActive();
      if (slots.some((slot) => slot.busy)) throw new Error("Transient frame has unreleased leases");
      while (slots.length > maxIdleTargets) releaseSlot(slots[0]);
    },
    reset() {
      assertActive();
      reset();
    },
    stats: () => ({
      liveLeases: slots.filter((slot) => slot.busy).length,
      retainedTargets: slots.length,
      aliases
    }),
    dispose() {
      if (disposed) return;
      try {
        reset();
      } finally {
        disposed = true;
        prefixes.delete(prefix);
      }
    }
  });
}

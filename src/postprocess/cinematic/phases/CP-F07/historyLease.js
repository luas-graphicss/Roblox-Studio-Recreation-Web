import { validateResource } from "../../contracts/frameContract.js";

export function createHistoryLease({ frame, descriptor, pair, readResource, writeSlot, assertCurrent, onCommit, reason }) {
  let closed = false;
  function assertOpen() {
    assertCurrent();
    pair.assertAlive();
    if (closed) throw new Error("History lease is already closed");
  }
  return Object.freeze({
    reason,
    get read() { assertOpen(); return readResource; },
    get writeTarget() { assertOpen(); return pair.get(writeSlot); },
    commit(resource) {
      assertOpen();
      validateResource(resource, frame, "history commit");
      const target = pair.get(writeSlot);
      if (resource.target !== target || resource.texture !== target.texture || resource.texture === readResource?.texture) throw new Error("History commit must use the distinct write target");
      if (resource.width !== descriptor.width || resource.height !== descriptor.height || resource.format !== descriptor.format || resource.encoding !== descriptor.encoding || resource.origin !== "bottom-left") throw new Error("History commit metadata does not match its descriptor");
      if (resource.preExposure !== undefined && resource.preExposure !== frame.preExposure) throw new Error("History commit pre-exposure does not match the frame");
      const committed = Object.freeze({ ...resource, preExposure: frame.preExposure });
      onCommit(committed, writeSlot);
      closed = true;
      return committed;
    },
    abort() { assertOpen(); closed = true; }
  });
}

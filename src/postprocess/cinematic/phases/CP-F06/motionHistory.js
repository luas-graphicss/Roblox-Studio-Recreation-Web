import { MOTION_LIMITS, MOTION_PHASE_ID } from "./motionContract.js";

function sameTopology(current, previous) {
  if (
    !previous ||
    current.topology !== previous.topology ||
    current.positions.length !== previous.positions.length ||
    current.indices?.length !== previous.indices?.length
  )
    return false;
  if (current.indices)
    for (let index = 0; index < current.indices.length; index += 1)
      if (current.indices[index] !== previous.indices[index]) return false;
  return true;
}

export function createMotionHistory(history) {
  let nextSurfaceId = MOTION_LIMITS.skySurfaceId + 1;
  const checkpoints = new Map();
  return Object.freeze({
    read(frame) {
      return history.read(MOTION_PHASE_ID, "surface-state", frame);
    },
    pair(snapshot, previousState) {
      const previous = previousState?.objects.get(snapshot.key);
      const valid = sameTopology(snapshot, previous) && snapshot.resetVelocity !== true;
      const surfaceId = valid ? previous.surfaceId : nextSurfaceId++;
      if (surfaceId > MOTION_LIMITS.maximumSurfaceId)
        throw new Error("CP-F06 surface identity space exhausted; recreate the phase");
      return {
        ...snapshot,
        surfaceId,
        previousPositions: valid ? previous.positions : snapshot.positions,
        historyValid: valid,
        previousPointSize: valid ? previous.pointSize : snapshot.pointSize,
        previousPointSizeAttenuation: valid ? previous.pointSizeAttenuation : snapshot.pointSizeAttenuation,
      };
    },
    commit(frame, camera, objects, targets, sky, sceneIdentity, enabled = true) {
      const snapshots = new Map(
        objects.map((object) => [
          object.key,
          {
            key: object.key,
            topology: object.topology,
            positions: object.positions,
            indices: object.indices,
            surfaceId: object.surfaceId,
            pointSize: object.pointSize,
            pointSizeAttenuation: object.pointSizeAttenuation,
            modelMatrix: object.modelMatrix,
            boneMatrices: object.boneMatrices,
            morphInfluences: object.morphInfluences,
          },
        ]),
      );
      const state = { camera, objects: snapshots, targets, sky, sceneIdentity, enabled };
      checkpoints.set(frame.viewId, { frame: { ...frame, renderSize: { ...frame.renderSize } }, state });
      history.write(MOTION_PHASE_ID, "surface-state", frame, state);
    },
    releaseView(viewId) {
      checkpoints.delete(viewId);
      const current = [...checkpoints.values()].filter(
        ({ frame, state }) =>
          history.read(MOTION_PHASE_ID, "surface-state", {
            ...frame,
            frameId: frame.frameId + 1,
            cameraCut: false,
          }) === state,
      );
      checkpoints.clear();
      history.clearOwner(MOTION_PHASE_ID);
      for (const checkpoint of current) {
        checkpoints.set(checkpoint.frame.viewId, checkpoint);
        history.write(MOTION_PHASE_ID, "surface-state", checkpoint.frame, checkpoint.state);
      }
    },
    clear() {
      history.clearOwner(MOTION_PHASE_ID);
      checkpoints.clear();
    },
  });
}

import { TEMPORAL_PHASE_ID, TEMPORAL_STATE_NAME } from "./temporalContract.js";
import { snapshotTemporalFrame, findTemporalInvalidators } from "./temporalInvalidation.js";
import { resolveHistoryDescriptor, historyDescriptorKey } from "./historyDescriptor.js";
import { createHistoryTargetPair } from "./historyTargetPair.js";
import { createHistoryLease } from "./historyLease.js";
import { getPreExposureScale } from "./preExposureScale.js";

export function createTemporalHistoryController({ pool, history, rescaleHistory, report = () => {} }) {
  if (!["read", "write", "clearOwner"].every((key) => typeof history?.[key] === "function")) throw new TypeError("Temporal history requires the B00 history service");
  const views = new Map();
  let disposed = false;

  function assertActive() {
    if (disposed) throw new Error("Temporal history controller is disposed");
  }
  function releaseEffects(state) {
    for (const effect of state.effects.values()) effect.pair.release();
    state.effects.clear();
    state.epoch += 1;
  }
  function checkpointIsCurrent(state) {
    return history.read(TEMPORAL_PHASE_ID, TEMPORAL_STATE_NAME, { ...state.frame, frameId: state.frame.frameId + 1, cameraCut: false }) === state;
  }
  function rebuildCheckpoints() {
    const currentStates = [...views.values()].filter(checkpointIsCurrent);
    history.clearOwner(TEMPORAL_PHASE_ID);
    for (const state of currentStates) history.write(TEMPORAL_PHASE_ID, TEMPORAL_STATE_NAME, state.frame, state);
  }
  function createScope(state) {
    const frame = state.frame;
    const epoch = state.epoch;
    function assertCurrent() {
      assertActive();
      if (views.get(frame.viewId) !== state || state.epoch !== epoch || !checkpointIsCurrent(state)) throw new Error("Stale temporal frame scope");
    }
    function releaseEffect(effectId) {
      assertCurrent();
      const effect = state.effects.get(effectId);
      if (!effect) return false;
      effect.pair.release();
      state.effects.delete(effectId);
      return true;
    }
    return Object.freeze({
      frameId: frame.frameId,
      viewId: frame.viewId,
      generation: frame.generation,
      resetReasons: state.resetReasons,
      releaseEffect,
      releaseView() {
        assertCurrent();
        releaseEffects(state);
        views.delete(frame.viewId);
        rebuildCheckpoints();
      },
      acquire(effectId, inputDescriptor) {
        assertCurrent();
        if (typeof effectId !== "string" || !effectId.trim()) throw new TypeError("A history effect ID is required");
        const descriptor = resolveHistoryDescriptor(inputDescriptor);
        const signature = historyDescriptorKey(descriptor);
        let effect = state.effects.get(effectId);
        let reason = state.resetReasons[0] ?? "first-use";
        if (effect && effect.lastLeaseEpoch === epoch) throw new Error("An effect may acquire only one history lease per frame");
        if (effect && (effect.signature !== signature || !effect.pair.isAlive())) {
          reason = effect.signature !== signature ? "descriptor-change" : "released-target";
          releaseEffect(effectId);
          effect = null;
        }
        if (!effect) {
          const identity = JSON.stringify([frame.viewId, effectId, frame.generation, signature]);
          effect = { signature, pair: createHistoryTargetPair(pool, identity, descriptor), committed: null, committedSlot: 0, lastLeaseEpoch: -1, lastUsedFrame: frame.frameId };
          state.effects.set(effectId, effect);
        }
        effect.lastLeaseEpoch = epoch;
        effect.lastUsedFrame = frame.frameId;
        let readResource = effect.committed;
        let readSlot = effect.committedSlot;
        if (readResource && (readResource.frameId !== frame.frameId - 1 || readResource.generation !== frame.generation || readResource.viewId !== frame.viewId)) {
          readResource = null;
          reason = "uncommitted-previous-frame";
        }
        if (frame.controls.paused) { readResource = null; reason = "pause"; }
        if (readResource) {
          reason = "valid";
          if (descriptor.exposureMode === "radiance") {
            const scale = getPreExposureScale(readResource.preExposure, frame.preExposure);
            if (scale !== 1) {
              if (typeof rescaleHistory !== "function") throw new Error("Radiance history requires a GPU pre-exposure converter");
              const scaledSlot = 1 - readSlot;
              const scaledTarget = effect.pair.get(scaledSlot);
              try {
                const result = rescaleHistory(readResource, scaledTarget, scale);
                if (result && typeof result.then === "function") throw new Error("History conversion must submit synchronously");
              } catch (error) {
                releaseEffect(effectId);
                throw error;
              }
              readResource = Object.freeze({ ...readResource, texture: scaledTarget.texture, target: scaledTarget, preExposure: frame.preExposure });
              readSlot = scaledSlot;
              reason = "pre-exposure-converted";
              report({ phase: TEMPORAL_PHASE_ID, type: "history-rescaled", viewId: frame.viewId, effectId, sourceFrameId: readResource.frameId, scale });
            }
          }
        }
        const writeSlot = readResource ? 1 - readSlot : 0;
        return createHistoryLease({
          frame,
          descriptor,
          pair: effect.pair,
          readResource,
          writeSlot,
          reason,
          assertCurrent() {
            assertCurrent();
            if (state.effects.get(effectId) !== effect) throw new Error("History effect was released");
          },
          onCommit(resource, slot) {
            effect.committed = resource;
            effect.committedSlot = slot;
          }
        });
      }
    });
  }

  return Object.freeze({
    beginFrame(inputFrame, controls) {
      assertActive();
      const frame = snapshotTemporalFrame(inputFrame, controls);
      let state = views.get(frame.viewId);
      if (state && state.frame.frameId === frame.frameId && state.frame.generation === frame.generation && checkpointIsCurrent(state)) throw new Error("Duplicate temporal preparation for the same view and frame");
      const checkpoint = state ? history.read(TEMPORAL_PHASE_ID, TEMPORAL_STATE_NAME, frame) === state : false;
      const resetReasons = findTemporalInvalidators(state?.frame, frame, checkpoint);
      if (!state) {
        state = { frame, effects: new Map(), epoch: 0, resetReasons };
        views.set(frame.viewId, state);
      } else if (resetReasons.length) {
        releaseEffects(state);
      }
      state.epoch += 1;
      state.frame = frame;
      state.resetReasons = resetReasons;
      for (const [effectId, effect] of state.effects) {
        if (effect.lastUsedFrame < frame.frameId - 1) { effect.pair.release(); state.effects.delete(effectId); }
      }
      history.write(TEMPORAL_PHASE_ID, TEMPORAL_STATE_NAME, frame, state);
      if (resetReasons.length) report({ phase: TEMPORAL_PHASE_ID, type: "history-reset", viewId: frame.viewId, frameId: frame.frameId, reasons: resetReasons });
      return createScope(state);
    },
    releaseView(viewId) {
      assertActive();
      const state = views.get(viewId);
      if (!state) return false;
      releaseEffects(state);
      views.delete(viewId);
      rebuildCheckpoints();
      return true;
    },
    reset() {
      assertActive();
      for (const state of views.values()) releaseEffects(state);
      views.clear();
      history.clearOwner(TEMPORAL_PHASE_ID);
    },
    stats() {
      return { views: views.size, effects: [...views.values()].reduce((total, state) => total + state.effects.size, 0) };
    },
    dispose() {
      if (disposed) return;
      for (const state of views.values()) releaseEffects(state);
      views.clear();
      history.clearOwner(TEMPORAL_PHASE_ID);
      disposed = true;
    }
  });
}

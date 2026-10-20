import { createTdrWatchdog, createWarmupStager } from "../warmupStageCore.js";
import { MSM_TRANSITION_FRAME_CEILING_MS, MSM_WARMUP_PHASE_ID, planMsmWarmup } from "./msmWarmupPlanCore.js";

export const MSM_WARMUP_STATE = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  DONE: "done",
  ABORTED: "aborted",
});

export const MSM_WARMUP_ABORT_REASON = Object.freeze({
  NONE: "none",
  SLICE_OVER_CEILING: "slice-over-ceiling",
  FRAME_OVER_CEILING: "frame-over-ceiling",
  SLICE_THREW: "slice-threw",
  CONTEXT_LOST: "context-lost",
  SUPERSEDED: "superseded",
  CANCELLED: "cancelled",
  PLAN_REFUSED: "plan-refused",
});

function roundMs(value) {
  return Math.round(Number(value) * 10) / 10;
}

function looksLikePlan(value) {
  return !!value && typeof value === "object" && Array.isArray(value.steps) && value.phase === MSM_WARMUP_PHASE_ID;
}

function readErrorText(error) {
  if (!error) return "unknown failure";
  if (typeof error === "string") return error;
  return typeof error.message === "string" && error.message ? error.message : String(error);
}


export function createMsmWarmupRunner(options) {
  const source = options && typeof options === "object" ? options : {};
  const ceilingMs =
    Number.isFinite(Number(source.ceilingMs)) && Number(source.ceilingMs) > 0
      ? Number(source.ceilingMs)
      : MSM_TRANSITION_FRAME_CEILING_MS;
  const watchdog = createTdrWatchdog({
    slowMs: ceilingMs / 2,
    slowRun: 2,
    panicMs: ceilingMs,
    idleGapMs: source.idleGapMs,
  });

  let plan = null;
  let stager = null;
  let state = MSM_WARMUP_STATE.IDLE;
  let stepIndex = 0;
  let abortReason = MSM_WARMUP_ABORT_REASON.NONE;
  let abortMessage = "";
  let abortedStepIndex = -1;
  let rollbackToOff = false;
  let worstSliceMs = 0;
  let worstFrameMs = 0;

  const counters = {
    armed: 0,
    completed: 0,
    aborted: 0,
    superseded: 0,
    refused: 0,
    slicesRun: 0,
    slicesFailed: 0,
    contextLosses: 0,
  };

  function stepAt(index) {
    return plan && plan.ok === true && plan.frameCount > index ? plan.steps[index] : null;
  }

  function nameOfStep(step) {
    return "slice " + (step.index + 1) + " of " + plan.frameCount + " (" + step.slice + ")";
  }

  function snapshot() {
    const step = state === MSM_WARMUP_STATE.RUNNING ? stepAt(stepIndex) : null;
    return {
      phase: MSM_WARMUP_PHASE_ID,
      state,
      transition: plan ? plan.transition : "",
      tier: plan ? plan.tier : "",
      compositeMode: plan ? plan.compositeMode : "",
      stepIndex,
      stepCount: plan ? plan.frameCount : 0,
      currentSlice: step ? step.slice : "",
      currentStepKey: step ? step.stepKey : "",
      ceilingMs,
      worstSliceMs: roundMs(worstSliceMs),
      worstFrameMs: roundMs(worstFrameMs),
      abortReason,
      abortMessage,
      abortedStepIndex,
      rollbackToOff,
      progress: stager ? stager.progress().pct : 0,
      counters: Object.assign({}, counters),
      watchdog: watchdog.debug(),
    };
  }

  function frameResult(fields) {
    return {
      ran: fields.ran === true,
      done: state === MSM_WARMUP_STATE.DONE,
      aborted: state === MSM_WARMUP_STATE.ABORTED,
      step: fields.step || null,
      spentMs: roundMs(fields.spentMs || 0),
      stepIndex,
      stepCount: plan ? plan.frameCount : 0,
      abortReason,
      abortMessage,
    };
  }

  function abortNow(reason, message, step, fields) {
    state = MSM_WARMUP_STATE.ABORTED;
    abortReason = reason;
    abortMessage = message;
    abortedStepIndex = step ? step.index : -1;
    rollbackToOff = true;
    counters.aborted += 1;
    if (stager) stager.cancel();
    return frameResult({
      ran: !!fields && fields.ran === true,
      spentMs: fields ? fields.spentMs : 0,
      step,
    });
  }

  return {
    limits: Object.freeze({ ceilingMs, phase: MSM_WARMUP_PHASE_ID }),


    arm(request) {
      const nextPlan = looksLikePlan(request) ? request : planMsmWarmup(request);

      if (!nextPlan || nextPlan.ok !== true) {
        plan = nextPlan || null;
        stager = null;
        stepIndex = 0;
        state = MSM_WARMUP_STATE.ABORTED;
        abortReason = MSM_WARMUP_ABORT_REASON.PLAN_REFUSED;
        abortMessage =
          "the transition was refused before any frame: " + (nextPlan && nextPlan.reason ? nextPlan.reason : "no plan");
        abortedStepIndex = -1;
        rollbackToOff = true;
        counters.refused += 1;
        return snapshot();
      }

      if (state === MSM_WARMUP_STATE.RUNNING) {
        counters.superseded += 1;
        abortReason = MSM_WARMUP_ABORT_REASON.SUPERSEDED;
        abortMessage =
          "the " + plan.transition + " in flight was superseded by a " + nextPlan.transition + " before frame " + (stepIndex + 1);
        if (stager) stager.cancel();
      } else {
        abortReason = MSM_WARMUP_ABORT_REASON.NONE;
        abortMessage = "";
      }

      plan = nextPlan;
      stepIndex = 0;
      abortedStepIndex = -1;
      rollbackToOff = false;
      counters.armed += 1;
      stager = createWarmupStager({ order: plan.steps.map((step) => step.stepKey) });
      stager.arm({ tech: plan.transition, nowMs: Number(source.nowMs) });
      state = plan.frameCount > 0 ? MSM_WARMUP_STATE.RUNNING : MSM_WARMUP_STATE.DONE;
      if (state === MSM_WARMUP_STATE.DONE) counters.completed += 1;
      return snapshot();
    },

    isActive() {
      return state === MSM_WARMUP_STATE.RUNNING;
    },


    tick(request) {
      const args = request && typeof request === "object" ? request : {};
      if (state !== MSM_WARMUP_STATE.RUNNING) return frameResult({ ran: false });

      const step = stepAt(stepIndex);
      if (!step) {
        state = MSM_WARMUP_STATE.DONE;
        counters.completed += 1;
        return frameResult({ ran: false });
      }

      const frameMs = Number(args.frameMs);
      if (Number.isFinite(frameMs) && frameMs > 0) {
        watchdog.sample(frameMs);
        if (frameMs > worstFrameMs) worstFrameMs = frameMs;
        if (frameMs > ceilingMs) {
          return abortNow(
            MSM_WARMUP_ABORT_REASON.FRAME_OVER_CEILING,
            "the frame before " +
              nameOfStep(step) +
              " took " +
              roundMs(frameMs) +
              " ms and the ceiling of a transition frame is " +
              ceilingMs +
              " ms",
            step,
            { ran: false, spentMs: 0 },
          );
        }
      }

      const clock = typeof args.now === "function" ? args.now : null;
      const runSlice = typeof args.runSlice === "function" ? args.runSlice : null;
      const startedAt = clock ? Number(clock()) : 0;
      let failure = null;
      if (runSlice) {
        try {
          runSlice(step);
        } catch (error) {
          failure = error;
        }
      }
      const spentMs = clock ? Math.max(0, Number(clock()) - startedAt) : 0;
      if (spentMs > worstSliceMs) worstSliceMs = spentMs;
      watchdog.sample(spentMs);

      if (failure) {
        counters.slicesFailed += 1;
        return abortNow(
          MSM_WARMUP_ABORT_REASON.SLICE_THREW,
          nameOfStep(step) + " failed and the ignition was aborted: " + readErrorText(failure),
          step,
          { ran: true, spentMs },
        );
      }

      if (spentMs > ceilingMs) {
        return abortNow(
          MSM_WARMUP_ABORT_REASON.SLICE_OVER_CEILING,
          nameOfStep(step) +
            " spent " +
            roundMs(spentMs) +
            " ms and the ceiling of a transition frame is " +
            ceilingMs +
            " ms",
          step,
          { ran: true, spentMs },
        );
      }

      stager.tick();
      stepIndex += 1;
      counters.slicesRun += 1;
      if (stepIndex >= plan.frameCount) {
        state = MSM_WARMUP_STATE.DONE;
        counters.completed += 1;
      }
      return frameResult({ ran: true, spentMs, step });
    },


    noteContextLost() {
      counters.contextLosses = watchdog.noteContextLost();
      if (state !== MSM_WARMUP_STATE.RUNNING) return snapshot();
      const step = stepAt(stepIndex);
      abortNow(
        MSM_WARMUP_ABORT_REASON.CONTEXT_LOST,
        "the WebGL context was lost during " + (step ? nameOfStep(step) : "the transition"),
        step,
        { ran: false, spentMs: 0 },
      );
      return snapshot();
    },


    cancel(reason) {
      if (state !== MSM_WARMUP_STATE.RUNNING) return snapshot();
      const step = stepAt(stepIndex);
      abortNow(
        MSM_WARMUP_ABORT_REASON.CANCELLED,
        "the transition was cancelled by the host" + (reason ? ": " + reason : ""),
        step,
        { ran: false, spentMs: 0 },
      );
      return snapshot();
    },


    holds(stepKey) {
      if (state === MSM_WARMUP_STATE.DONE) return false;
      if (state !== MSM_WARMUP_STATE.RUNNING) return true;
      return stager.holds(stepKey);
    },

    holdsSlice(slice) {
      if (state === MSM_WARMUP_STATE.DONE) return false;
      if (state !== MSM_WARMUP_STATE.RUNNING) return true;
      return plan.steps.some((step) => step.slice === slice && stager.holds(step.stepKey));
    },

    currentPlan() {
      return plan;
    },

    progress() {
      return stager ? stager.progress() : { idx: 0, total: 0, pct: 0, next: null };
    },

    snapshot,
  };
}

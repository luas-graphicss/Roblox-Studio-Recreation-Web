import { requireCallback, requireSynchronous } from "./adapterValidation.js";
import { callSynchronousMethod, requireSynchronousCallback } from "./synchronousCallbacks.js";

const runtimeMethods = ["configure", "resize", "prepare", "render", "reset", "dispose"];

export function createDeferredRuntime({ createRuntime, schedule, initialize, notify, report }) {
  requireCallback(createRuntime, "createRuntime");
  requireSynchronousCallback(schedule, "schedule");
  let status = "cold";
  let runtime = null;
  let revision = 0;
  let cancelScheduled = null;
  let controller = null;
  let failure = null;

  function release(instance) {
    try { instance && callSynchronousMethod(instance, "dispose"); }
    catch (error) { report({ type: "cleanup-failed", message: error.message }); }
  }

  function invalidate(nextStatus = "cold", reason = "reset") {
    revision += 1;
    controller?.abort(reason);
    controller = null;
    const cancel = cancelScheduled;
    cancelScheduled = null;
    if (cancel) {
      try { cancel(); } catch (error) { report({ type: "scheduler-cancel-failed", message: error.message }); }
    }
    const previous = runtime;
    runtime = null;
    status = nextStatus;
    if (previous) release(previous);
  }

  function fail(error) {
    failure = error.message;
    invalidate("failed", failure);
    report({ type: "runtime-failed", message: failure });
  }

  function ensure() {
    if (status !== "cold") return;
    status = "scheduled";
    const token = revision;
    controller = new AbortController();
    const signal = controller.signal;
    let scheduling = true;
    let synchronousInvocation = false;
    let invocationStarted = false;
    try {
      const cancel = schedule(async () => {
        if (scheduling) { synchronousInvocation = true; return; }
        if (token !== revision || signal.aborted || invocationStarted) return;
        invocationStarted = true;
        cancelScheduled = null;
        status = "loading";
        let candidate = null;
        try {
          candidate = await createRuntime({ signal });
          if (token !== revision || signal.aborted) { release(candidate); return; }
          for (const name of runtimeMethods) requireSynchronousCallback(candidate?.[name], `Runtime ${name}`);
          requireSynchronous(initialize(candidate), "Runtime initialization");
          if (token !== revision || signal.aborted) { release(candidate); return; }
          runtime = candidate;
          status = "ready";
          failure = null;
          notify();
        } catch (error) {
          if (candidate && candidate !== runtime) release(candidate);
          if (token === revision && !signal.aborted) fail(error);
        }
      });
      requireSynchronousCallback(cancel, "Scheduler cancellation");
      cancelScheduled = cancel;
      scheduling = false;
      if (synchronousInvocation) throw new Error("Boot scheduler must defer execution");
    } catch (error) {
      scheduling = false;
      fail(error);
    }
  }

  return Object.freeze({ ensure, invalidate, fail, get: () => runtime, snapshot: () => ({ status, revision, failure }) });
}

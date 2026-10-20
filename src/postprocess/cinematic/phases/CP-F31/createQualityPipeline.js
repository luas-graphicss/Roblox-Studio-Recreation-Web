import { validateFrame } from "../../contracts/frameContract.js";
import { createDiagnosticReporter } from "../CP-F32/createDiagnosticReporter.js";
import { createMemoryLedger } from "./createMemoryLedger.js";
import { createQualityView } from "./createQualityView.js";
import { createQualityGovernor } from "./createQualityGovernor.js";
import { createFrameTimingRegistry } from "./createFrameTimingRegistry.js";
import { createQualityPlan } from "./createQualityPlan.js";
import { readQualitySettings } from "./qualitySettings.js";
import { negotiateCapabilities } from "./negotiateCapabilities.js";
import { estimateResourceMemory } from "./resourceMemory.js";
import { verifyQualityReference } from "./verifyQualityReference.js";
import { captureQualityFrameIdentity, validateQualityFrame } from "./qualityFrame.js";
import { assertSynchronous, configurationKey, integer, MAXIMUM_BUDGET_BYTES, record } from "./qualityContract.js";

export function createQualityPipeline({ rendererAdapter, settings, phases = [], configureFrame, describeExternalResources,
  hostFeatures = {}, budgetBytes = 268435456, maximumViews = 4, pipelineRevision = "unversioned", verifyReference, report = () => {} }) {
  if (typeof configureFrame !== "function" || typeof describeExternalResources !== "function")
    throw new TypeError("Quality requires explicit host frame and external resource inventory bridges");
  if (!settings?.get || !settings?.revision || !rendererAdapter?.createTarget) throw new TypeError("Quality requires versioned settings and a renderer adapter");
  integer(budgetBytes, "global budget", 1, MAXIMUM_BUDGET_BYTES);
  integer(maximumViews, "maximumViews", 1, 16);
  if (!Array.isArray(phases) || new Set(phases.map((phase) => phase.id)).size !== phases.length) throw new TypeError("Provide unique explicit phase descriptors");
  if (typeof pipelineRevision !== "string" || !pipelineRevision.trim()) throw new TypeError("pipelineRevision must be nonempty");
  const capabilities = negotiateCapabilities(rendererAdapter.capabilities, hostFeatures, [...phases.map((phase) => phase.id), "CP-F31", "CP-F32"]);
  const ledger = createMemoryLedger({ budgetBytes });
  const emit = createDiagnosticReporter(report);
  const views = new Map();
  let busy = false;
  let disposed = false;
  let transitions = 0;
  const assertActive = () => { if (disposed) throw new Error("Quality pipeline is disposed"); };
  function retire(entry) {
    const view = entry.view;
    entry.view = null;
    entry.signature = null;
    entry.timing.clear();
    view?.dispose();
  }
  const snapshot = () => ({ disposed, busy, transitions, capabilities, memory: ledger.stats(), reporting: emit.stats(),
    views: [...views].map(([viewId, entry]) => ({ viewId, status: entry.status, profileId: entry.plan?.profileId ?? null,
      configurationKey: entry.plan?.configurationKey ?? null, frozen: entry.protected,
      governor: entry.governor?.snapshot() ?? null, robustness: entry.view?.snapshot() ?? null })) });
  return Object.freeze({
    snapshot,
    async renderFrame(frame, produceInputs, control = {}) {
      assertActive();
      if (busy) throw new Error("Quality frames cannot overlap or reenter the shared renderer");
      validateFrame(frame);
      if (frame.referenceMode !== undefined && typeof frame.referenceMode !== "boolean") throw new TypeError("referenceMode must be boolean");
      const identity = captureQualityFrameIdentity(frame);
      if (typeof produceInputs !== "function") throw new TypeError("A synchronous scene input producer is required");
      record(control, "quality frame control");
      for (const [name, value] of Object.entries(control))
        if (!["capture", "paused", "headless"].includes(name) || typeof value !== "boolean") throw new TypeError(`Invalid frame control: ${name}`);
      busy = true;
      let entry;
      try {
        entry = views.get(frame.viewId);
        if (!entry) {
          if (views.size >= maximumViews) throw new RangeError("Quality view capacity exceeded; release an inactive view explicitly");
          entry = { view: null, signature: null, protected: false, plan: null, status: "new", lastFrameId: -1, timing: createFrameTimingRegistry(), generation: frame.generation };
          views.set(frame.viewId, entry);
        }
        if (frame.generation < entry.generation || (frame.generation === entry.generation && frame.frameId <= entry.lastFrameId))
          throw new Error("Quality requires increasing frame ids within each host generation");
        const device = entry.view?.snapshot().device;
        if (device && device.state !== "ready") { entry.status = device.state; return { status: device.state, color: null, resources: {}, quality: snapshot() }; }
        const quality = readQualitySettings(settings, frame.viewId);
        const qualityKey = configurationKey(quality);
        if (qualityKey !== entry.qualityKey) {
          entry.governor = createQualityGovernor({ ...quality, adaptive: quality.adaptive && capabilities.timerQuery });
          entry.qualityKey = qualityKey;
        }
        const plan = createQualityPlan({ settings, quality, profileId: entry.governor.snapshot().profileId, capabilities,
          viewId: frame.viewId, outputSize: frame.outputSize, globalBudgetBytes: budgetBytes, pipelineRevision });
        const protectedFrame = control.capture === true || frame.referenceMode === true;
        const declared = assertSynchronous(describeExternalResources(Object.freeze({ frame, plan })), "external resource inventory");
        if (declared?.coverage !== "complete-declared" || !Array.isArray(declared.resources))
          throw new Error("Inventory must explicitly cover all unmanaged GPU, borrowed, CPU and swapchain storage");
        const inventory = estimateResourceMemory(declared.resources);
        const signature = configurationKey({ plan: plan.configurationKey, inventory: inventory.rows });
        if (entry.protected && protectedFrame && signature !== entry.signature)
          throw new Error("Capture/reference quality is frozen; end the protected sequence before changing configuration");
        const reference = verifyQualityReference({ plan, frame, verifier: verifyReference });
        if (inventory.residentBytes + plan.estimatedBloomBytes > plan.budgetBytes)
          throw new RangeError("CP-F31 preflight memory budget exceeded by declared inventory and bloom plan");
        const appliedFrame = assertSynchronous(configureFrame(frame, plan), "host configureFrame");
        validateQualityFrame(frame, appliedFrame, plan, identity);
        if (signature !== entry.signature) {
          const hadPlan = entry.plan !== null;
          retire(entry);
          const created = await createQualityView({ rendererAdapter, ledger, viewId: frame.viewId, plan, inventory, phases, report: emit });
          if (disposed) { created.dispose(); throw new Error("Quality pipeline was disposed during installation"); }
          entry.view = created;
          entry.signature = signature;
          if (hadPlan) transitions += 1;
          emit({ phase: "CP-F31", event: hadPlan ? "quality-boundary-rebuild" : "quality-installed", viewId: frame.viewId,
            profileId: plan.profileId, historyReset: hadPlan, budgetBytes: plan.budgetBytes });
        }
        entry.plan = plan;
        entry.protected = protectedFrame;
        entry.headless = control.headless === true;
        entry.paused = control.paused === true;
        entry.governor.bind({ configurationKey: plan.configurationKey, generation: frame.generation,
          freeze: protectedFrame || entry.headless || entry.paused });
        if (entry.generation !== frame.generation) entry.timing.clear();
        entry.lastFrameId = frame.frameId;
        entry.generation = frame.generation;
        const result = entry.view.render(appliedFrame, produceInputs, reference);
        entry.status = "rendered";
        entry.timing.remember(frame, plan.configurationKey, {
          eligible: !protectedFrame && !entry.headless && !entry.paused,
          deviceEpoch: entry.view.snapshot().device.epoch
        });
        return { ...result, quality: { profileId: plan.profileId, requestedProfileId: plan.requestedProfileId,
          configurationKey: plan.configurationKey, options: plan.options, memory: ledger.stats(),
          estimatedBloomBytes: plan.estimatedBloomBytes, estimatedBloomDraws: plan.estimatedBloomDraws,
          governor: entry.governor.snapshot(), reference } };
      } catch (error) {
        if (entry) { entry.status = "failed"; entry.timing.clear(); entry.view?.reset(); }
        emit({ phase: "CP-F31", event: "frame-rejected", viewId: frame.viewId, message: error.message });
        throw error;
      } finally { busy = false; }
    },
    observeTiming(sample) {
      assertActive();
      const entry = views.get(sample?.viewId);
      if (!entry?.plan) throw new Error("Timing must identify a previously rendered view and frame");
      return entry.governor.observe(entry.timing.qualify(sample, entry.view?.snapshot().device));
    },
    releaseView(viewId) {
      assertActive();
      if (busy) throw new Error("Release views only between frames");
      const entry = views.get(viewId);
      if (!entry) return false;
      retire(entry);
      views.delete(viewId);
      return true;
    },
    reset(viewId) {
      assertActive();
      if (busy) throw new Error("Reset only between frames");
      const selected = viewId === undefined ? [...views.values()] : [views.get(viewId)].filter(Boolean);
      for (const entry of selected) { entry.timing.clear(); entry.view?.reset(); }
    },
    suspend() {
      assertActive();
      if (busy) throw new Error("Suspend only between frames");
      for (const entry of views.values()) entry.view?.suspend();
    },
    resume() {
      assertActive();
      for (const entry of views.values()) entry.view?.resume();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const failures = [];
      for (const entry of views.values()) { try { retire(entry); } catch (error) { failures.push(error); } }
      views.clear();
      if (failures.length) throw new AggregateError(failures, "Quality pipeline cleanup failed");
    }
  });
}

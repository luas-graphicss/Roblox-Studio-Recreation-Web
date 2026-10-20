import { createFrameGraph } from "./frameGraph.js";
import { createHistoryStore } from "./historyStore.js";
import { CONTRACT_VERSION, getPhaseDefinition } from "../contracts/phaseManifest.js";

export function createPostProcessPipeline({ rendererAdapter, pool, settings, capabilities, report = () => {} }) {
  const graph = createFrameGraph();
  const history = createHistoryStore();
  const cleanups = [];
  const installedIds = new Set();
  const preparedViews = new Map();
  let disposed = false;
  const services = Object.freeze({ graph, history, pool, settings, capabilities, rendererAdapter, report });

  function assertActive() {
    if (disposed) throw new Error("Pipeline is disposed");
  }

  return Object.freeze({
    graph,
    history,
    async install(phase) {
      assertActive();
      if (phase.status !== "implemented") throw new Error(`${phase.id} is not implemented`);
      getPhaseDefinition(phase.id);
      if (phase.contractVersion !== CONTRACT_VERSION) throw new Error("Phase contract version mismatch");
      if (installedIds.has(phase.id)) throw new Error(`Duplicate phase installation: ${phase.id}`);
      const registrations = [];
      const scopedGraph = Object.freeze({ register(pass) {
        if (pass.owner !== phase.id) throw new Error("A phase cannot register another owner's pass");
        const unregister = graph.register(pass);
        registrations.push(unregister);
        return unregister;
      } });
      function releasePhaseResources() {
        for (const unregister of registrations.splice(0).reverse()) unregister();
        history.clearOwner(phase.id);
        pool?.releaseOwner(phase.id);
      }
      try {
        const cleanup = await phase.install(Object.freeze({ ...services, graph: scopedGraph }));
        if (typeof cleanup !== "function") throw new TypeError(`${phase.id} must return a cleanup function`);
        installedIds.add(phase.id);
        cleanups.push(() => { try { cleanup(); } finally { releasePhaseResources(); } });
      } catch (error) {
        releasePhaseResources();
        throw error;
      }
    },
    prepare(frame) {
      assertActive();
      const result = graph.execute({ frame, preparationOnly: true, rendererAdapter, settings });
      preparedViews.set(frame.viewId, { frameId: frame.frameId, generation: frame.generation, resources: result.resources });
      return result;
    },
    render(frame, inputs) {
      assertActive();
      const prepared = preparedViews.get(frame.viewId);
      preparedViews.delete(frame.viewId);
      if (prepared && (prepared.frameId !== frame.frameId || prepared.generation !== frame.generation)) throw new Error("Prepared resources belong to a different frame");
      const preparationInputs = prepared?.resources ?? {};
      for (const name of Object.keys(inputs)) if (name in preparationInputs) throw new Error(`Host input shadows prepared resource: ${name}`);
      return graph.execute({ frame, inputs: { ...preparationInputs, ...inputs }, color: inputs.sceneColor, rendererAdapter, settings });
    },
    reset() { assertActive(); history.clear(); preparedViews.clear(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups.reverse()) cleanup();
      cleanups.length = 0;
      installedIds.clear();
      preparedViews.clear();
      graph.dispose();
      history.clear();
    }
  });
}

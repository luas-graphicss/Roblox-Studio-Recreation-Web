import { getPhaseDefinition } from "../contracts/phaseManifest.js";
import { getStageIndex } from "../contracts/pipelineStages.js";
import { validateFrame, validateResource } from "../contracts/frameContract.js";

export function createFrameGraph() {
  const passes = new Map();
  const resourceWriters = new Map();
  let orderedPasses = [];
  let lastExecution = [];

  function register(pass) {
    const phase = getPhaseDefinition(pass.owner);
    if (!phase.stages.includes(pass.stage)) throw new Error(`${pass.owner} does not own stage ${pass.stage}`);
    if (!pass.id?.startsWith(`${pass.owner}.`) || passes.has(pass.id)) throw new Error(`Invalid or duplicate pass: ${pass.id}`);
    getStageIndex(pass.stage);
    if (!Number.isInteger(pass.order) || typeof pass.execute !== "function") throw new TypeError("Pass requires integer order and execute");
    if (!Array.isArray(pass.reads) || !Array.isArray(pass.writes)) throw new TypeError("Pass must declare reads and writes");
    if (new Set(pass.writes).size !== pass.writes.length) throw new Error("Duplicate writes within pass");
    for (const output of pass.writes) {
      if (!output.startsWith(`${pass.owner}.`) || resourceWriters.has(output)) throw new Error(`Invalid resource owner or duplicate writer: ${output}`);
      if (pass.reads.includes(output)) throw new Error(`Read/write feedback: ${output}`);
    }
    const installed = Object.freeze({ ...pass, reads: Object.freeze([...pass.reads]), writes: Object.freeze([...pass.writes]) });
    passes.set(pass.id, installed);
    for (const output of pass.writes) resourceWriters.set(output, pass.id);
    orderedPasses = [...passes.values()].sort((left, right) => getStageIndex(left.stage) - getStageIndex(right.stage) || left.order - right.order || left.id.localeCompare(right.id));
    return () => {
      if (!passes.delete(pass.id)) return;
      for (const output of pass.writes) resourceWriters.delete(output);
      orderedPasses = orderedPasses.filter((entry) => entry.id !== pass.id);
      installed.dispose?.();
    };
  }

  function execute({ frame, inputs = {}, color = null, rendererAdapter, settings, preparationOnly = false }) {
    validateFrame(frame);
    const resources = new Map(Object.entries(inputs));
    for (const [name, resource] of resources) validateResource(resource, frame, name);
    let currentColor = color;
    if (currentColor) validateResource(currentColor, frame, "input color");
    const execution = [];
    lastExecution = execution;
    for (const pass of orderedPasses) {
      if ((pass.stage === "prepare") !== preparationOnly) continue;
      const published = new Set();
      const sampledTextures = new Set();
      for (const inputName of pass.reads) {
        const input = inputName === "$color" ? currentColor : resources.get(inputName);
        validateResource(input, frame, `${pass.id}:${inputName}`);
        if (input.texture) sampledTextures.add(input.texture);
      }
      const context = Object.freeze({
        frame,
        color: currentColor,
        rendererAdapter,
        settings,
        read(name) {
          if (!pass.reads.includes(name)) throw new Error(`${pass.id} read undeclared resource ${name}`);
          return name === "$color" ? currentColor : resources.get(name);
        },
        publish(name, resource) {
          if (!pass.writes.includes(name)) throw new Error(`${pass.id} published undeclared resource ${name}`);
          if (published.has(name)) throw new Error(`${pass.id} published ${name} twice`);
          validateResource(resource, frame, name);
          if (resource.texture && sampledTextures.has(resource.texture)) throw new Error(`Texture feedback in ${pass.id}`);
          resources.set(name, resource);
          published.add(name);
        }
      });
      const started = performance.now();
      const colorIn = currentColor;
      try {
        const result = pass.execute(context);
        if (result && typeof result.then === "function") throw new Error("Pass execution must be synchronous GPU submission");
        for (const output of pass.writes) if (!published.has(output)) throw new Error(`${pass.id} did not publish ${output}`);
        if (pass.transformsColor) {
          validateResource(result?.color, frame, `${pass.id} output color`);
          if (!result.color.texture) throw new Error("Color output must be a texture");
          if (result.color.texture === currentColor?.texture) throw new Error(`In-place color transform in ${pass.id}`);
          if (![...published].some((name) => resources.get(name) === result.color)) throw new Error("Color output must be a declared published resource");
          currentColor = result.color;
        } else if (result?.color) {
          throw new Error(`${pass.id} returned undeclared color transform`);
        }
        execution.push({ id: pass.id, stage: pass.stage, status: "submitted", cpuSubmissionMs: performance.now() - started, transformsColor: pass.transformsColor === true, colorIn: pass.transformsColor ? colorIn : null, colorOut: pass.transformsColor ? currentColor : null });
      } catch (error) {
        execution.push({ id: pass.id, status: "failed", message: error.message });
        throw error;
      }
    }
    return { color: currentColor, resources: Object.fromEntries(resources), execution: [...execution] };
  }

  return Object.freeze({
    register,
    execute,
    describe: () => orderedPasses.map(({ id, owner, stage, order, reads, writes }) => ({ id, owner, stage, order, reads, writes })),
    lastExecution: () => [...lastExecution],
    dispose() {
      for (const pass of orderedPasses) pass.dispose?.();
      passes.clear();
      resourceWriters.clear();
      orderedPasses = [];
      lastExecution = [];
    }
  });
}

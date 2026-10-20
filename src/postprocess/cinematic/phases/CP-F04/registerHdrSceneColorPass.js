export function registerHdrSceneColorPass(services) {
  return services.graph.register({
    id: "CP-F04.ingestSceneColor", owner: "CP-F04", stage: "beforeDof", order: 400,
    reads: ["$color", "CP-F04.colorState", "CP-F04.transport"], writes: ["CP-F04.sceneColor"], transformsColor: true,
    execute(context) {
      const source = context.read("$color");
      const state = context.read("CP-F04.colorState").value;
      const transport = context.read("CP-F04.transport").value;
      const captured = source.preExposure === undefined && source.encoding === "scene-linear-rec709" ? Object.freeze({ ...source, preExposure: 1 }) : source;
      if (captured.preExposure !== state.plan.sourcePreExposure) throw new Error("CP-F04 source pre-exposure must be declared before capture; refusing double exposure");
      const color = transport.ingest(captured);
      context.publish("CP-F04.sceneColor", color);
      return { color };
    }
  });
}

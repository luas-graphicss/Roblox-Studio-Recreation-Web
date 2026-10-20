import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { createSceneGeometryProducer } from "./sceneGeometryProducer.js";
import { GEOMETRY_OWNER, GEOMETRY_RESOURCES } from "./geometryResources.js";

export { GEOMETRY_RESOURCES, requireGeometryResource } from "./geometryResources.js";
export { createSceneGeometryProducer } from "./sceneGeometryProducer.js";
export { createDepthConversionPass } from "./depthConversionPass.js";
export { createSampleResolvePass } from "./sampleResolvePass.js";
export { resolveGeometrySamples } from "./multisampleResolve.js";

export default Object.freeze({
  id: GEOMETRY_OWNER,
  contractVersion: CONTRACT_VERSION,
  status: "implemented",
  install(services) {
    const producer = createSceneGeometryProducer(services);
    let unregister;
    try {
      unregister = services.graph.register({
        id: "CP-F05.sceneGeometryInputs",
        owner: GEOMETRY_OWNER,
        stage: "beforeDof",
        order: -5000,
        reads: ["sceneColor"],
        writes: Object.values(GEOMETRY_RESOURCES),
        transformsColor: false,
        execute(context) {
          const resources = producer.render(context.frame, context.read("sceneColor"));
          for (const [name, resource] of Object.entries(resources)) context.publish(name, resource);
        }
      });
    } catch (error) { producer.dispose(); throw error; }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      unregister();
      producer.dispose();
    };
  }
});

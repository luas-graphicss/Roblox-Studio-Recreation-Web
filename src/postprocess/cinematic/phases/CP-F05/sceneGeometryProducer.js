import { validateCaptureAlignment } from "./frameAlignment.js";
import { createGeometryResource, GEOMETRY_OWNER, GEOMETRY_RESOURCES } from "./geometryResources.js";
import { createSceneGeometryCapture } from "./sceneGeometryCapture.js";
import { createCoverageExtractionPass } from "./coverageExtractionPass.js";
import { createDepthConversionPass } from "./depthConversionPass.js";

export function createSceneGeometryProducer({ rendererAdapter, pool, report = () => {} }) {
  if (!rendererAdapter?.host?.scene || !rendererAdapter?.host?.camera || !pool?.acquire) throw new Error("CP-F05 requires the injected host scene, camera and resource pool");
  const capture = createSceneGeometryCapture(rendererAdapter);
  const coveragePass = createCoverageExtractionPass(rendererAdapter);
  const depthPass = createDepthConversionPass(rendererAdapter);
  const views = new Set();
  let disposed = false;

  return Object.freeze({
    render(frame, sceneColor) {
      if (disposed) throw new Error("CP-F05 producer is disposed");
      const { scene, camera } = rendererAdapter.host;
      validateCaptureAlignment(frame, sceneColor, camera);
      if (!views.has(frame.viewId) && views.size >= 8) throw new Error("CP-F05 view capacity exceeded; release unused views");
      views.add(frame.viewId);
      const keyPrefix = `${GEOMETRY_OWNER}.${encodeURIComponent(frame.viewId)}`;
      const target = (name, format, depth = false) => pool.acquire(GEOMETRY_OWNER, `${keyPrefix}.${name}`, { ...frame.renderSize, format, depth, filter: "nearest" });
      const targets = {
        normal: target("normal", "rgba8", true),
        objectId: target("objectId", "rgba8", true),
        materialId: target("materialId", "rgba8", true),
        customStencil: target("customStencil", "rgba8", true),
        coverage: target("coverage", "rgba8"),
        linearDepth: target("linearDepth", "r32f")
      };
      const summary = capture.render(scene, camera, targets);
      coveragePass.draw(targets.normal, targets.coverage);
      const depth = createGeometryResource(targets.normal, frame, "hardware-depth-opengl", { depthTexture: true, component: "r" });
      const coverage = createGeometryResource(targets.coverage, frame, "coverage-unorm", { component: "r" });
      depthPass.convert({ depth, coverage, frame, target: targets.linearDepth, projection: camera.isOrthographicCamera ? "orthographic" : "perspective" });
      const resources = {
        [GEOMETRY_RESOURCES.depth]: depth,
        [GEOMETRY_RESOURCES.linearDepth]: createGeometryResource(targets.linearDepth, frame, "linear-depth-meters", { component: "r" }),
        [GEOMETRY_RESOURCES.normal]: createGeometryResource(targets.normal, frame, "view-normal-encoded", { validityComponent: "a" }),
        [GEOMETRY_RESOURCES.coverage]: coverage,
        [GEOMETRY_RESOURCES.objectId]: createGeometryResource(targets.objectId, frame, "uint24-little-endian-rgb", { validityComponent: "a", identityScope: "object-including-all-instances" }),
        [GEOMETRY_RESOURCES.materialId]: createGeometryResource(targets.materialId, frame, "uint24-little-endian-rgb", { validityComponent: "a" }),
        [GEOMETRY_RESOURCES.customDepth]: createGeometryResource(targets.customStencil, frame, "hardware-depth-opengl", { depthTexture: true, component: "r" }),
        [GEOMETRY_RESOURCES.customStencil]: createGeometryResource(targets.customStencil, frame, "uint8-normalized-red", { component: "r", validityComponent: "a" }),
        [GEOMETRY_RESOURCES.customCoverage]: createGeometryResource(targets.customStencil, frame, "coverage-alpha-unorm", { component: "a" }),
        [GEOMETRY_RESOURCES.metadata]: Object.freeze({ value: Object.freeze({ profile: "single-sample-three-r161", producer: GEOMETRY_OWNER, ...summary, projection: camera.isOrthographicCamera ? "orthographic" : "perspective", estimatedBytes: frame.renderSize.width * frame.renderSize.height * 40, colorUntouched: true, referenceVerified: false }), frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance: "gpu" })
      };
      report({ phase: GEOMETRY_OWNER, event: "geometry-inputs-produced", frameId: frame.frameId, viewId: frame.viewId, ...summary });
      return Object.freeze(resources);
    },
    releaseView(viewId) {
      for (const name of ["normal", "objectId", "materialId", "customStencil", "coverage", "linearDepth"]) pool.release(`${GEOMETRY_OWNER}.${encodeURIComponent(viewId)}.${name}`);
      views.delete(viewId);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      capture.dispose();
      coveragePass.dispose();
      depthPass.dispose();
      pool.releaseOwner(GEOMETRY_OWNER);
      views.clear();
    }
  });
}

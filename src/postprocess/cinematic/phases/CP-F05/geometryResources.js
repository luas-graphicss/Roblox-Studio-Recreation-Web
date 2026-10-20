export const GEOMETRY_OWNER = "CP-F05";
export const GEOMETRY_RESOURCES = Object.freeze({
  depth: "CP-F05.depth",
  linearDepth: "CP-F05.linearDepth",
  normal: "CP-F05.normal",
  coverage: "CP-F05.coverage",
  objectId: "CP-F05.objectId",
  materialId: "CP-F05.materialId",
  customDepth: "CP-F05.customDepth",
  customStencil: "CP-F05.customStencil",
  customCoverage: "CP-F05.customCoverage",
  metadata: "CP-F05.metadata"
});

export function createGeometryResource(target, frame, encoding, { depthTexture = false, component = "rgba", ...metadata } = {}) {
  const texture = depthTexture ? target.depthTexture : target.texture;
  if (!texture) throw new Error(`CP-F05 target has no ${depthTexture ? "depth" : "color"} texture`);
  return Object.freeze({
    texture,
    ...(depthTexture ? {} : { target }),
    width: target.width,
    height: target.height,
    format: depthTexture ? "depth24" : target.userData.format,
    encoding,
    component,
    origin: "bottom-left",
    frameId: frame.frameId,
    viewId: frame.viewId,
    generation: frame.generation,
    provenance: "gpu",
    jitterPixels: Object.freeze([...frame.jitterPixels]),
    nearMeters: frame.camera.nearMeters,
    farMeters: frame.camera.farMeters,
    samples: 1,
    ...metadata
  });
}

export function requireGeometryResource(resources, name, frame) {
  const resource = resources instanceof Map ? resources.get(name) : resources?.[name];
  if (!resource || resource.available === false) throw new Error(`CP-F05 required resource is unavailable: ${name}`);
  if (resource.frameId !== frame.frameId || resource.viewId !== frame.viewId || resource.generation !== frame.generation) throw new Error(`CP-F05 stale or cross-view resource: ${name}`);
  if (resource.texture && (resource.width !== frame.renderSize.width || resource.height !== frame.renderSize.height || resource.origin !== "bottom-left")) throw new Error(`CP-F05 incompatible texture extent or origin: ${name}`);
  if (resource.jitterPixels && resource.jitterPixels.some((value, index) => value !== frame.jitterPixels[index])) throw new Error(`CP-F05 mismatched jitter: ${name}`);
  return resource;
}

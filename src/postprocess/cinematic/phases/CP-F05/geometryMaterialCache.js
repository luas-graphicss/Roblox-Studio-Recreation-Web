import { encodeIdentifier } from "./identifierCodec.js";
import { patchGeometryShader } from "./geometryShaderPatch.js";

const COPIED_FIELDS = ["side", "map", "alphaMap", "alphaTest", "opacity", "displacementMap", "displacementScale", "displacementBias", "normalMap", "normalMapType", "bumpMap", "bumpScale", "flatShading", "vertexColors", "clippingPlanes", "clipIntersection", "clipShadows", "polygonOffset", "polygonOffsetFactor", "polygonOffsetUnits", "wireframe", "wireframeLinewidth", "size", "sizeAttenuation", "rotation", "depthFunc"];

export function createGeometryMaterialCache(THREE) {
  const entries = new Map();
  const used = new Set();

  function get(object, source, policy, output) {
    const kind = object.isPoints ? "points" : object.isSprite ? "sprite" : "mesh";
    if (source.isShaderMaterial || source.isRawShaderMaterial || source.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) throw new Error(`CP-F05 custom shader requires an explicit geometry input adapter: ${source.name || source.type}`);
    if (source.alphaHash || source.alphaToCoverage) throw new Error("CP-F05 stochastic alpha and alpha-to-coverage require explicit per-sample input");
    const key = `${object.uuid}:${source.uuid}`;
    used.add(key);
    const signature = JSON.stringify([source.version, kind, ...COPIED_FIELDS.map((field) => source[field]?.uuid ?? source[field]?.id ?? (typeof source[field] === "object" ? null : source[field]))]);
    let entry = entries.get(key);
    if (entry && entry.signature !== signature) { entry.material.dispose(); entries.delete(key); entry = null; }
    if (!entry) {
      const material = kind === "points" || kind === "sprite" ? source.clone() : new THREE.MeshNormalMaterial();
      for (const field of COPIED_FIELDS) if (source[field] !== undefined) material[field] = source[field];
      if (source.normalScale && material.normalScale) material.normalScale.copy(source.normalScale);
      material.transparent = false;
      material.blending = THREE.NoBlending;
      material.depthTest = true;
      material.depthWrite = true;
      material.colorWrite = true;
      material.toneMapped = false;
      material.fog = false;
      const uniforms = {
        cpGeometryOutput: { value: output },
        cpObjectIdBytes: { value: new THREE.Vector3() },
        cpMaterialIdBytes: { value: new THREE.Vector3() },
        cpCustomStencil: { value: policy.stencil / 255 }
      };
      if (kind === "mesh") {
        Object.assign(uniforms, {
          map: { value: source.map ?? null },
          alphaMap: { value: source.alphaMap ?? null },
          alphaTest: { value: source.alphaTest ?? 0 },
          mapTransform: { value: source.map?.matrix ?? new THREE.Matrix3() },
          alphaMapTransform: { value: source.alphaMap?.matrix ?? new THREE.Matrix3() }
        });
      }
      material.onBeforeCompile = (shader) => patchGeometryShader(shader, kind, uniforms);
      material.customProgramCacheKey = () => `CP-F05.geometry-v1.${kind}`;
      entry = { material, uniforms, signature };
      entries.set(key, entry);
    }
    for (const texture of [source.map, source.alphaMap]) if (texture?.matrixAutoUpdate) texture.updateMatrix();
    entry.uniforms.cpGeometryOutput.value = output;
    entry.uniforms.cpObjectIdBytes.value.fromArray(encodeIdentifier(policy.objectId).map((channel) => channel / 255));
    entry.uniforms.cpMaterialIdBytes.value.fromArray(encodeIdentifier(policy.materialId).map((channel) => channel / 255));
    entry.uniforms.cpCustomStencil.value = policy.stencil / 255;
    entry.material.opacity = source.opacity;
    if (source.normalScale && entry.material.normalScale) entry.material.normalScale.copy(source.normalScale);
    if (entry.uniforms.alphaTest) entry.uniforms.alphaTest.value = source.alphaTest;
    return entry.material;
  }

  return Object.freeze({
    get,
    beginFrame() { used.clear(); },
    endFrame() { for (const [key, entry] of entries) if (!used.has(key)) { entry.material.dispose(); entries.delete(key); } },
    size: () => entries.size,
    dispose() { for (const entry of entries.values()) entry.material.dispose(); entries.clear(); used.clear(); }
  });
}

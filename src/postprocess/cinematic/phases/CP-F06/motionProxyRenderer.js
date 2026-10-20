import { createMotionSky } from "./motionSky.js";
import { createMotionMaterials, motionPlanesFor } from "./motionProxyMaterial.js";
import { updateMotionUniforms } from "./motionUniforms.js";
import { withRendererState } from "../../render/rendererState.js";

export function createMotionProxyRenderer(adapter) {
  const { THREE, renderer } = adapter;
  const scene = new THREE.Scene();
  const records = new Map();
  const fallback = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1, THREE.RGBAFormat);
  fallback.needsUpdate = true;
  const sky = createMotionSky(adapter);
  const context = renderer.getContext();
  const particleRange = context.getParameter(context.ALIASED_POINT_SIZE_RANGE);
  let disposed = false;

  function disposeRecord(record) {
    scene.remove(record.proxy);
    record.proxy.geometry.dispose();
    for (const material of record.materials) material.dispose();
  }

  function signatureFor(snapshot) {
    return JSON.stringify([
      snapshot.topology,
      snapshot.positions.length,
      snapshot.indices ? Array.from(snapshot.indices) : null,
      snapshot.groups,
      snapshot.materials.map((policy) => [
        motionPlanesFor(renderer, policy).global.length,
        motionPlanesFor(renderer, policy).local.length,
      ]),
    ]);
  }

  function makeRecord(snapshot) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(snapshot.positions.length), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    geometry.setAttribute(
      "previousPosition",
      new THREE.BufferAttribute(new Float32Array(snapshot.positions.length), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    if (snapshot.indices) geometry.setIndex(new THREE.BufferAttribute(snapshot.indices.slice(), 1));
    for (const group of snapshot.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    snapshot.uvSets.forEach((uv, index) => {
      geometry.setAttribute(
        `motionMapUv${index}`,
        new THREE.BufferAttribute(uv.map.slice(), 2).setUsage(THREE.DynamicDrawUsage),
      );
      geometry.setAttribute(
        `motionAlphaUv${index}`,
        new THREE.BufferAttribute(uv.alpha.slice(), 2).setUsage(THREE.DynamicDrawUsage),
      );
    });
    const materials = createMotionMaterials(THREE, renderer, snapshot, fallback, particleRange);
    const proxy = snapshot.particle
      ? new THREE.Points(geometry, materials[0])
      : new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
    proxy.frustumCulled = false;
    scene.add(proxy);
    return { proxy, materials, signature: signatureFor(snapshot) };
  }

  function prepare(objects, cameraState, previous, camera, sceneDepth) {
    const alive = new Set(objects.map((object) => object.key));
    for (const [key, record] of records)
      if (!alive.has(key)) {
        disposeRecord(record);
        records.delete(key);
      }
    for (const snapshot of objects) {
      let record = records.get(snapshot.key);
      if (record && record.signature !== signatureFor(snapshot)) {
        disposeRecord(record);
        records.delete(snapshot.key);
        record = null;
      }
      if (!record) {
        record = makeRecord(snapshot);
        records.set(snapshot.key, record);
      }
      const geometry = record.proxy.geometry;
      for (const [attribute, values] of [
        ["position", snapshot.positions],
        ["previousPosition", snapshot.previousPositions],
      ]) {
        geometry.attributes[attribute].array.set(values);
        geometry.attributes[attribute].needsUpdate = true;
      }
      geometry.setDrawRange(snapshot.drawRange.start, snapshot.drawRange.count);
      snapshot.uvSets.forEach((uv, index) => {
        for (const [kind, values] of [
          ["Map", uv.map],
          ["Alpha", uv.alpha],
        ]) {
          geometry.attributes[`motion${kind}Uv${index}`].array.set(values);
          geometry.attributes[`motion${kind}Uv${index}`].needsUpdate = true;
        }
      });
      record.materials.forEach((material, index) =>
        updateMotionUniforms(
          THREE,
          renderer,
          material,
          snapshot.materials[index],
          snapshot,
          cameraState,
          previous,
          camera,
          fallback,
          sceneDepth,
        ),
      );
    }
  }

  function draw(target, mode, camera, cameraState, previous, skyPolicy, sceneDepth) {
    const previousErrorCount = adapter.errors().length;
    for (const record of records.values())
      for (const material of record.materials) material.uniforms.outputMode.value = mode;
    if (skyPolicy === "infinite") sky.draw(target, cameraState, previous, fallback, mode, sceneDepth);
    return withRendererState(THREE, renderer, () => {
      renderer.setRenderTarget(target);
      renderer.setViewport(0, 0, target.width, target.height);
      renderer.setScissorTest(false);
      if (skyPolicy !== "infinite") {
        renderer.setClearColor(0, 0);
        renderer.clear();
      }
      renderer.autoClear = false;
      renderer.render(scene, camera);
      if (adapter.errors().length > previousErrorCount)
        throw new Error(`CP-F06 shader failure: ${JSON.stringify(adapter.errors().at(-1))}`);
    });
  }

  return Object.freeze({
    render(objects, targets, camera, cameraState, previous, skyPolicy, sceneDepth) {
      if (disposed) throw new Error("CP-F06 renderer is disposed");
      const sampledTextures = new Set(
        [
          sceneDepth.texture,
          previous?.targets.identity.texture,
          previous?.targets.identity.depthTexture,
          ...objects.flatMap((object) => object.materials.flatMap((policy) => [policy.map, policy.alphaMap])),
        ].filter(Boolean),
      );
      for (const target of [targets.velocity, targets.identity, targets.validity])
        if (sampledTextures.has(target.texture) || sampledTextures.has(target.depthTexture))
          throw new Error("CP-F06 texture feedback before draw");
      prepare(objects, cameraState, previous, camera, sceneDepth);
      draw(targets.velocity, 0, camera, cameraState, previous, skyPolicy, sceneDepth);
      draw(targets.identity, 1, camera, cameraState, previous, skyPolicy, sceneDepth);
      draw(targets.validity, 2, camera, cameraState, previous, skyPolicy, sceneDepth);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const record of records.values()) disposeRecord(record);
      records.clear();
      fallback.dispose();
      sky.dispose();
    },
  });
}

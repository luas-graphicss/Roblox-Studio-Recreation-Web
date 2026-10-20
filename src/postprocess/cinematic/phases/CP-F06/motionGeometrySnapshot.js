import { describeMotionMaterial } from "./motionMaterialPolicy.js";
import { captureMotionSprite } from "./motionSpriteSnapshot.js";

function readUv(THREE, geometry, texture, count) {
  const values = new Float32Array(count * 2);
  if (!texture) return values;
  const channel = texture.channel ?? 0;
  const attribute = geometry.getAttribute(channel === 0 ? "uv" : `uv${channel}`);
  if (!attribute || attribute.count !== count)
    throw new Error(`CP-F06 missing uv${channel} for coverage texture`);
  if (texture.matrixAutoUpdate) texture.updateMatrix();
  const uv = new THREE.Vector2();
  for (let index = 0; index < count; index += 1) {
    uv.fromBufferAttribute(attribute, index).applyMatrix3(texture.matrix);
    values[index * 2] = uv.x;
    values[index * 2 + 1] = uv.y;
  }
  return values;
}

function stableToken(value, label) {
  if ((typeof value !== "string" && !Number.isSafeInteger(value)) || value === "")
    throw new TypeError(`${label} must be a nonempty string or safe integer`);
  return [typeof value, value];
}

export function captureMotionGeometry(THREE, scene, camera, frame) {
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const objects = [];
  const excluded = [];
  const keys = new Set();
  let vertexCount = 0;
  function append(snapshot) {
    if (keys.has(snapshot.key)) throw new Error("CP-F06 duplicate stable identity");
    if (!snapshot.positions.every(Number.isFinite))
      throw new Error("CP-F06 positions exceed finite float32 storage");
    keys.add(snapshot.key);
    objects.push(snapshot);
    vertexCount += snapshot.positions.length / 3;
  }
  scene.traverseVisible((object) => {
    if (!(object.isMesh || object.isPoints || object.isSprite)) {
      if (object.isLine) excluded.push({ object: object.uuid, reason: "line-domain-requires-an-adapter" });
      return;
    }
    if (!object.layers.test(camera.layers)) return;
    const configuration = object.userData.cinematicMotion ?? {};
    if (configuration.enabled === false) {
      excluded.push({ object: object.uuid, reason: "disabled" });
      return;
    }
    const materials = (Array.isArray(object.material) ? object.material : [object.material]).map((material) =>
      describeMotionMaterial(THREE, material, configuration),
    );
    if (!materials.some((material) => material.included)) {
      excluded.push({ object: object.uuid, reason: materials[0]?.reason ?? "no-material" });
      return;
    }
    if (
      object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender ||
      object.onAfterRender !== THREE.Object3D.prototype.onAfterRender
    )
      throw new Error("CP-F06 render callbacks require a frame-aligned host adapter");
    const objectGeneration = stableToken(configuration.generation ?? 0, "Object generation");
    if (object.isSprite) {
      if (configuration.samplePosition)
        throw new Error("CP-F06 custom sprite deformation requires a mesh adapter");
      append(
        captureMotionSprite(
          THREE,
          object,
          camera,
          materials,
          JSON.stringify([object.uuid, objectGeneration]),
          configuration,
        ),
      );
      return;
    }
    const geometry = object.geometry;
    const position = geometry?.getAttribute("position");
    if (!position || position.itemSize !== 3)
      throw new Error(`CP-F06 missing vec3 positions on ${object.name || object.uuid}`);
    if (object.isPoints && materials.length !== 1)
      throw new Error("CP-F06 point clouds require one material");
    if (object.morphTexture && typeof configuration.samplePosition !== "function")
      throw new Error("CP-F06 per-instance morph textures require an explicit position sampler");
    if (configuration.samplePosition !== undefined && typeof configuration.samplePosition !== "function")
      throw new TypeError("CP-F06 samplePosition must be a function");
    if (object.isSkinnedMesh) object.skeleton.update();
    const count = position.count;
    const indices = geometry.index ? Uint32Array.from(geometry.index.array) : null;
    const uvSets = materials.map((material) => ({
      map: readUv(THREE, geometry, object.isPoints ? null : material.map, count),
      alpha: readUv(THREE, geometry, object.isPoints ? null : material.alphaMap, count),
    }));
    const instanceCount = object.isInstancedMesh ? object.count : 1;
    const instanceMatrix = new THREE.Matrix4();
    const worldMatrix = new THREE.Matrix4();
    const local = new THREE.Vector3();
    for (let instance = 0; instance < instanceCount; instance += 1) {
      if (object.isInstancedMesh) {
        object.getMatrixAt(instance, instanceMatrix);
        worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
      } else worldMatrix.copy(object.matrixWorld);
      const positions = new Float32Array(count * 3);
      for (let index = 0; index < count; index += 1) {
        if (object.isMesh) object.getVertexPosition(index, local);
        else local.fromBufferAttribute(position, index);
        if (configuration.samplePosition) {
          const sampled = configuration.samplePosition(local, {
            object,
            vertexIndex: index,
            instanceIndex: instance,
            frame,
          });
          if (sampled?.then) throw new Error("CP-F06 position sampling must be synchronous");
          if (sampled && sampled !== local) local.copy(sampled);
        }
        local.applyMatrix4(worldMatrix);
        if (![local.x, local.y, local.z].every(Number.isFinite))
          throw new Error("CP-F06 sampled a non-finite world position");
        positions.set([local.x, local.y, local.z], index * 3);
      }
      const instanceId = configuration.instanceIds?.[instance] ?? instance;
      const instanceGeneration = configuration.instanceGenerations?.[instance] ?? 0;
      const rootKey = JSON.stringify([
        object.uuid,
        objectGeneration,
        stableToken(instanceId, "Instance id"),
        stableToken(instanceGeneration, "Instance generation"),
      ]);
      const common = {
        topology: `${geometry.uuid}:${count}:${object.isSkinnedMesh ? object.skeleton.bones.length : 0}`,
        positions,
        indices,
        materials,
        uvSets,
        groups: geometry.groups.map((group) => ({ ...group })),
        drawRange: { ...geometry.drawRange },
        modelMatrix: worldMatrix.toArray(),
        boneMatrices: object.isSkinnedMesh ? Float32Array.from(object.skeleton.boneMatrices) : null,
        morphInfluences: object.morphTargetInfluences ? Array.from(object.morphTargetInfluences) : null,
        resetVelocity: configuration.resetVelocity === true,
        domain: configuration.samplePosition
          ? "deformed"
          : object.isSkinnedMesh
            ? "skinned"
            : object.morphTargetInfluences?.length
              ? "morph"
              : object.isInstancedMesh
                ? "instanced"
                : object.isPoints
                  ? "particles"
                  : "rigid",
        pointSize: null,
        pointSizeAttenuation: false,
        particle: object.isPoints === true,
      };
      if (!object.isPoints) {
        append({ ...common, key: rootKey });
        continue;
      }
      const ids = configuration.particleIds ?? geometry.getAttribute("motionId")?.array;
      const generations =
        configuration.particleGenerations ?? geometry.getAttribute("motionGeneration")?.array;
      if (!ids || !generations || ids.length !== count || generations.length !== count)
        throw new Error("CP-F06 particles require stable particleIds and particleGenerations");
      if (!Number.isFinite(object.material.size) || object.material.size <= 0)
        throw new Error("CP-F06 requires a positive particle size");
      const first = geometry.drawRange.start;
      const end = Math.min(indices?.length ?? count, first + geometry.drawRange.count);
      for (let drawIndex = first; drawIndex < end; drawIndex += 1) {
        const index = indices?.[drawIndex] ?? drawIndex;
        const key = JSON.stringify([
          rootKey,
          stableToken(ids[index], "Particle id"),
          stableToken(generations[index], "Particle generation"),
        ]);
        append({
          ...common,
          key,
          topology: "point-sprite",
          positions: positions.slice(index * 3, index * 3 + 3),
          indices: null,
          groups: [],
          drawRange: { start: 0, count: 1 },
          uvSets: [{ map: new Float32Array(2), alpha: new Float32Array(2) }],
          pointSize: object.material.size,
          pointSizeAttenuation: object.material.sizeAttenuation !== false,
        });
      }
    }
  });
  return { objects, excluded, vertexCount };
}

const lightValues = light => [light.lightKey, light.type, light.range, light.intensity,
  light.position?.x, light.position?.y, light.position?.z,
  light.color?.r, light.color?.g, light.color?.b,
  light.direction?.x, light.direction?.y, light.direction?.z,
  light.outerAngleRadians, light.penumbra, light.atlasSlot, light.castsShadow];
function appendGeometryState(values, object) {
  const geometry = object.geometry;
  values.push(object.uuid, geometry?.uuid, geometry?.attributes?.position?.version || 0,
    geometry?.index?.version || 0, object.castShadow, object.visible, ...object.matrixWorld.elements);

  if (object.isInstancedMesh) values.push(object.count, object.instanceMatrix?.version || 0);
  if (object.morphTargetInfluences) values.push(...object.morphTargetInfluences);
  if (object.isSkinnedMesh && object.skeleton) {
    for (const bone of object.skeleton.bones) values.push(...bone.matrixWorld.elements);
  }
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) {
    if (!material) continue;
    values.push(material.uuid, material.visible, material.side, material.transparent,
      material.opacity, material.alphaTest, material.depthWrite, material.displacementScale,
      material.displacementBias, material.map?.uuid, material.map?.version,
      material.alphaMap?.uuid, material.alphaMap?.version, material.displacementMap?.uuid,
      material.displacementMap?.version);
  }
}
export function createMsmFrameInvalidation() {
  let previousLights = '', previousGeometry = '', previousCamera = '', previousSettings = '';
  let initialized = false;
  function inspect({ lights, scene, camera, settingsKey }) {
    const lightSignature = JSON.stringify((lights || []).map(lightValues));
    const geometry = [];
    scene?.traverseVisible(object => { if (object.isMesh) appendGeometryState(geometry, object); });
    const geometrySignature = JSON.stringify(geometry);
    const cameraSignature = [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements].join(',');
    const report = {
      reset: !initialized || previousSettings !== settingsKey,
      lightsChanged: !initialized || previousLights !== lightSignature,
      geometryChanged: !initialized || previousGeometry !== geometrySignature,
      cameraChanged: !initialized || previousCamera !== cameraSignature,
    };
    previousLights = lightSignature; previousGeometry = geometrySignature;
    previousCamera = cameraSignature; previousSettings = settingsKey; initialized = true;
    return report;
  }
  return { inspect, reset: () => { initialized = false; } };
}

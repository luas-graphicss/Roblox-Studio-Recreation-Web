export function captureMotionSprite(THREE, object, camera, materials, key, configuration) {
  const center = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
  const viewCenter = center.clone().applyMatrix4(camera.matrixWorldInverse);
  const scale = new THREE.Vector3().setFromMatrixScale(object.matrixWorld);
  if (!Number.isFinite(object.material.rotation)) throw new Error("CP-F06 sprite rotation must be finite");
  if (object.material.sizeAttenuation === false && camera.isPerspectiveCamera)
    scale.multiplyScalar(-viewCenter.z);
  const cosine = Math.cos(object.material.rotation);
  const sine = Math.sin(object.material.rotation);
  const positions = new Float32Array(12);
  const coordinates = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const viewPosition = new THREE.Vector3();
  for (let index = 0; index < coordinates.length; index += 1) {
    const horizontal = (coordinates[index][0] - object.center.x) * scale.x;
    const vertical = (coordinates[index][1] - object.center.y) * scale.y;
    viewPosition
      .set(
        viewCenter.x + cosine * horizontal - sine * vertical,
        viewCenter.y + sine * horizontal + cosine * vertical,
        viewCenter.z,
      )
      .applyMatrix4(camera.matrixWorld);
    positions.set(viewPosition.toArray(), index * 3);
  }
  const readUv = (texture) => {
    if (texture?.matrixAutoUpdate) texture.updateMatrix();
    const result = new Float32Array(8);
    const uv = new THREE.Vector2();
    coordinates.forEach((coordinate, index) => {
      uv.fromArray(coordinate);
      if (texture) uv.applyMatrix3(texture.matrix);
      result.set(uv.toArray(), index * 2);
    });
    return result;
  };
  return {
    key,
    topology: "camera-facing-sprite-quad",
    positions,
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    materials,
    uvSets: materials.map((material) => ({ map: readUv(material.map), alpha: readUv(material.alphaMap) })),
    groups: [],
    drawRange: { start: 0, count: 6 },
    modelMatrix: object.matrixWorld.toArray(),
    boneMatrices: null,
    morphInfluences: null,
    resetVelocity: configuration.resetVelocity === true,
    domain: "sprite",
    particle: false,
    pointSize: null,
    pointSizeAttenuation: false,
  };
}

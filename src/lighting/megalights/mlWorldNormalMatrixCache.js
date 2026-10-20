export function createWorldNormalMatrixCache(THREE) {
  const entryByMesh = new WeakMap();

  return {


    matrixFor(mesh) {
      let entry = entryByMesh.get(mesh);
      if (!entry) {
        entry = {
          worldMatrix: new THREE.Matrix4(),
          normalMatrix: new THREE.Matrix3(),
          isFilled: false,
        };
        entryByMesh.set(mesh, entry);
      }
      if (entry.isFilled && entry.worldMatrix.equals(mesh.matrixWorld)) return entry.normalMatrix;
      entry.worldMatrix.copy(mesh.matrixWorld);
      entry.normalMatrix.setFromMatrix4(mesh.matrixWorld).invert().transpose();
      entry.isFilled = true;
      return entry.normalMatrix;
    },
  };
}

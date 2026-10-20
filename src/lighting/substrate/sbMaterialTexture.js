export function createMaterialTexture(THREE) {
  let texture = null;
  let uploads = 0;
  return {
    upload(buffer) {
      const image = texture?.image;
      if (image?.width === buffer.width && image.height === buffer.height) {
        if (image.data.length === buffer.data.length && image.data.every((value, index) => value === buffer.data[index])) return texture;
        image.data.set(buffer.data);
      } else {
        texture?.dispose();
        texture = new THREE.DataTexture(buffer.data.slice(), buffer.width, buffer.height, THREE.RGBAFormat, THREE.UnsignedByteType);
        texture.name = 'Substrate material records';
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.colorSpace = THREE.NoColorSpace;
        texture.generateMipmaps = false;
        texture.flipY = false;
        texture.unpackAlignment = 1;
      }
      texture.needsUpdate = true;
      uploads += 1;
      return texture;
    },
    current: () => texture,
    uploads: () => uploads,
    dispose() { texture?.dispose(); texture = null; }
  };
}

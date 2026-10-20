function texelBuffersAreEqual(candidate, uploaded) {
  if (!candidate || !uploaded) return false;
  if (candidate.length !== uploaded.length) return false;
  for (let texelIndex = 0; texelIndex !== uploaded.length; texelIndex++) {
    if (candidate[texelIndex] !== uploaded[texelIndex]) return false;
  }
  return true;
}

export function createLightGridTextureUpload(THREE) {
  let texture = null;
  let textureWidth = 0;
  let textureHeight = 0;
  let uploadedTexels = null;

  return {


    uploadWhenChanged(packed) {
      if (!THREE || !packed || !packed.texture) return { texture, uploaded: false };
      const width = Math.max(0, Math.floor(Number(packed.textureWidth) || 0));
      const height = Math.max(0, Math.floor(Number(packed.textureHeight) || 0));
      if (width === 0 || height === 0) return { texture, uploaded: false };


      if (!texture || textureWidth !== width || textureHeight !== height) {
        if (texture) texture.dispose();
        uploadedTexels = new Float32Array(packed.texture.length);
        uploadedTexels.set(packed.texture);
        texture = new THREE.DataTexture(uploadedTexels, width, height, THREE.RGBAFormat, THREE.FloatType);
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        textureWidth = width;
        textureHeight = height;
        return { texture, uploaded: true };
      }

      if (texelBuffersAreEqual(packed.texture, uploadedTexels)) return { texture, uploaded: false };

      uploadedTexels.set(packed.texture);
      texture.needsUpdate = true;
      return { texture, uploaded: true };
    },

    describe() {
      return {
        allocated: !!texture,
        textureWidth,
        textureHeight,
        texelFloatCount: uploadedTexels ? uploadedTexels.length : 0,
      };
    },

    dispose() {
      if (texture) texture.dispose();
      texture = null;
      textureWidth = 0;
      textureHeight = 0;
      uploadedTexels = null;
    },
  };
}

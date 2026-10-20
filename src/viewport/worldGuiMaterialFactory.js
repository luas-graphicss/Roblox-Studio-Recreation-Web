import * as THREE from "three";


export function applyWorldGuiTextureColorSpace(texture) {
  if (THREE.SRGBColorSpace && "colorSpace" in texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  return texture;
}


export function createWorldGuiMaterial(texture) {
  applyWorldGuiTextureColorSpace(texture);
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,

    toneMapped: false,
  });
}

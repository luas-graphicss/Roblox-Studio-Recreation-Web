export function createSubstrateScreenTargets(THREE) {
  const targets = new Map();
  let allocations = 0;
  let generation = 0;
  function acquire(name, width, height, { attachments = 1, depth = false, precision = 'half', floatAttachments = [] } = {}) {
    const key = [width, height, attachments, depth, precision, floatAttachments.join(',')].join(':');
    const current = targets.get(name);
    if (current?.key === key) return current.target;
    current?.target.dispose();
    const options = { type: precision === 'float' ? THREE.FloatType : THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: depth, stencilBuffer: false,
      generateMipmaps: false, colorSpace: THREE.NoColorSpace };
    const target = attachments > 1 ? new THREE.WebGLMultipleRenderTargets(width, height, attachments, options) : new THREE.WebGLRenderTarget(width, height, options);
    for (const texture of [].concat(target.texture)) { texture.name = 'Substrate ' + name; texture.colorSpace = THREE.NoColorSpace; }
    for (const index of floatAttachments) target.texture[index].type = THREE.FloatType;
    if (depth) { target.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType); target.depthTexture.name = 'Substrate ' + name + ' depth'; }
    targets.set(name, { key, target });
    allocations++;
    return target;
  }
  function reset() { for (const { target } of targets.values()) target.dispose(); targets.clear(); generation++; }
  return { acquire, reset, dispose: reset, snapshot: () => ({ targets: targets.size, allocations, generation }) };
}

export function createSubstrateSmDrawObserver(onDraw) {
  if (typeof onDraw !== 'function') throw new TypeError('SSM_DRAW_OBSERVER_CALLBACK_REQUIRED');
  const installed = new Map();
  let draws = 0;

  function observe(mesh) {
    if (!mesh || typeof mesh !== 'object' || installed.has(mesh)) return false;
    const owned = Object.hasOwn(mesh, 'onAfterRender');
    const previous = mesh.onAfterRender;
    const hook = function ssmAfterRender(renderer, scene, camera, geometry, material, group) {
      if (typeof previous === 'function') previous.call(this, renderer, scene, camera, geometry, material, group);
      draws += 1;
      onDraw(mesh, material, renderer);
    };
    installed.set(mesh, { owned, previous, hook });
    mesh.onAfterRender = hook;
    return true;
  }

  function release(mesh) {
    const entry = installed.get(mesh);
    if (!entry) return false;
    installed.delete(mesh);
    if (mesh.onAfterRender === entry.hook) {
      if (entry.owned) mesh.onAfterRender = entry.previous;
      else delete mesh.onAfterRender;
    }
    return true;
  }

  function dispose() {
    for (const mesh of [...installed.keys()]) release(mesh);
  }

  return Object.freeze({
    observe, release, dispose,
    has: mesh => installed.has(mesh),
    getState: () => Object.freeze({ observed: installed.size, draws }),
  });
}

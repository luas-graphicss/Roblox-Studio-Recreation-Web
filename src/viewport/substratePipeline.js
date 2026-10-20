export function substrateWantsMaterials({ technology, tierName, enabledFlag, safeMode, webgl2 } = {}) {
  return technology === 'Future' && ['medio', 'forte'].includes(tierName) && (enabledFlag == null || enabledFlag === true) && safeMode !== true && webgl2 === true;
}
export function createSubstratePipeline(setup) {
  let driver = null;
  let pending = null;
  let configuration = {};
  let disposed = false;
  let failure = null;
  function configure(next) {
    configuration = next;
    if (driver) driver.configure(configuration);
    if (!pending && !disposed && substrateWantsMaterials(configuration)) {
      pending = import('./substrateEngineDriver.js').then(async module => {
        const created = module.createSubstrateEngineDriver({ ...setup, readConfiguration: () => configuration });
        if (disposed) { created.dispose(); return; }
        driver = created;
        await driver.initialize();
        if (disposed) return;
        driver.configure(configuration);
        setup.onReady?.();
      }).catch(error => { failure = error?.message || String(error); setup.onError?.(error); setup.onReady?.(); });
    }
    return wantsMaterials();
  }
  function wantsMaterials() { return !disposed && !failure && !!driver?.wantsMaterials() && substrateWantsMaterials(configuration); }
  function attachMaterial(material) {
    if (!wantsMaterials() || !material?.isMeshStandardMaterial) return false;
    return driver.attachMaterial(material);
  }
  function detachMaterial(material) { driver?.detachMaterial(material); }
  return {
    configure, wantsMaterials, attachMaterial, detachMaterial,
    owns: material => wantsMaterials() && driver?.owns(material) === true,
    runFrame(frame) { if (wantsMaterials()) driver.runFrame(frame); },
    afterRender(milliseconds) { if (wantsMaterials()) driver.afterRender(milliseconds); },
    signature: () => driver?.signature() || '',
    contextRestored() { driver?.contextRestored(); },
    snapshot: () => ({ wanted: substrateWantsMaterials(configuration), ready: !!driver?.ready(), active: wantsMaterials(), failure, ...(driver?.snapshot() || {}) }),
    isPreparingForDisplay: () => !disposed && !failure && substrateWantsMaterials(configuration) && !driver?.ready(),
    api: () => driver?.api() || null,
    screen: () => (wantsMaterials() ? driver.screen() : null),
    ready: () => pending || Promise.resolve(),
    dispose() { disposed = true; driver?.dispose(); },
  };
}

const UNNAMED_TIER = "";


export function createMegaLightsEngineHost(setup) {
  const config = setup || {};
  const readCamera = typeof config.readCamera === "function" ? config.readCamera : () => null;
  const readTierName =
    typeof config.readTierName === "function" ? config.readTierName : () => UNNAMED_TIER;

  const host = {
    THREE: config.THREE || null,
    renderer: config.renderer || null,
    scene: config.scene || null,
  };


  Object.defineProperty(host, "sceneRoot", {
    enumerable: true,
    get() {
      return host.scene;
    },
  });

  Object.defineProperty(host, "camera", {
    enumerable: true,
    get() {
      return readCamera() || null;
    },
  });

  Object.defineProperty(host, "tier", {
    enumerable: true,
    get() {
      return readTierName() || UNNAMED_TIER;
    },
  });

  return host;
}


export function describeMegaLightsEngineHost(host) {
  const inspected = host || {};
  return {
    hasThree: !!inspected.THREE,
    hasRenderer: !!inspected.renderer,
    hasScene: !!inspected.scene,
    hasCamera: !!inspected.camera,
    tier: String(inspected.tier || UNNAMED_TIER),
  };
}

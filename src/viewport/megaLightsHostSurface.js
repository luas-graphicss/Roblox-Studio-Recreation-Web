export const MEGALIGHTS_HOST_SURFACE_GLOBAL_NAME = "__mlLab";


export const MEGALIGHTS_HOST_NAME = "engine";

function copyMissingOwnProperties(target, source) {
  if (!source || typeof source !== "object") return [];
  const adoptedKeys = [];
  Object.keys(source).forEach((key) => {
    if (key in target) return;
    target[key] = source[key];
    adoptedKeys.push(key);
  });
  return adoptedKeys;
}


export function createMegaLightsHostSurface(setup) {
  const config = setup || {};
  const shaderLibrary = config.THREE || null;
  const renderer = config.renderer || null;
  const scene = config.scene || null;
  const resolveCamera = typeof config.resolveCamera === "function" ? config.resolveCamera : () => null;
  const resolveTierName = typeof config.resolveTierName === "function" ? config.resolveTierName : () => "";

  const hostSurface = {
    host: MEGALIGHTS_HOST_NAME,
    THREE: shaderLibrary,
    renderer,
    scene,
    gBuffer: config.gBuffer || null,
    hierarchicalZBuffer: config.hierarchicalZBuffer || null,


    get sceneRoot() {
      return scene;
    },


    get camera() {
      return resolveCamera();
    },


    get tier() {
      return resolveTierName();
    },


    publish() {
      return publishAsGlobal();
    },


    describe() {
      return {
        host: MEGALIGHTS_HOST_NAME,
        hasShaderLibrary: !!shaderLibrary,
        hasRenderer: !!renderer,
        hasScene: !!scene,
        hasCamera: !!resolveCamera(),
        tier: resolveTierName(),
        gBuffer: hostSurface.gBuffer ? hostSurface.gBuffer.describe() : null,
        hierarchicalZBuffer: hostSurface.hierarchicalZBuffer
          ? hostSurface.hierarchicalZBuffer.describe()
          : null,
        publishedAs: MEGALIGHTS_HOST_SURFACE_GLOBAL_NAME,
        publishedHandles: publishedHandleNames(),
      };
    },
  };


  const surfaceKeysOwnedByThisFile = Object.keys(hostSurface);

  function publishedHandleNames() {
    return Object.keys(hostSurface).filter((key) => surfaceKeysOwnedByThisFile.indexOf(key) === -1);
  }

  function publishAsGlobal() {
    if (typeof window === "undefined") {
      return { published: false, reason: "no window: this host is a terminal process", adoptedKeys: [] };
    }
    const alreadyPublished = window[MEGALIGHTS_HOST_SURFACE_GLOBAL_NAME];
    const adoptedKeys =
      alreadyPublished === hostSurface ? [] : copyMissingOwnProperties(hostSurface, alreadyPublished);
    window[MEGALIGHTS_HOST_SURFACE_GLOBAL_NAME] = hostSurface;
    return { published: true, reason: "", adoptedKeys };
  }

  return hostSurface;
}

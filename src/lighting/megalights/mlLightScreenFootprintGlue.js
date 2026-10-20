export const MINIMUM_SIGNIFICANT_IRRADIANCE = 0.02;


export const MAXIMUM_INFLUENCE_RADIUS = 200;

export function createLightScreenFootprintReader(dependencies) {
  const settings = dependencies || {};
  const THREE = settings.THREE || null;
  const hasVector3 = !!THREE && typeof THREE.Vector3 === "function";
  const projectedPosition = hasVector3 ? new THREE.Vector3() : null;

  function influenceRadiusOf(light) {
    const intensity = Math.max(0, Number(light.intensity) || 0);
    if (intensity <= 0) return 0;
    return Math.min(MAXIMUM_INFLUENCE_RADIUS, Math.sqrt(intensity / MINIMUM_SIGNIFICANT_IRRADIANCE));
  }

  function pixelsPerWorldUnit(camera, distanceToCamera, viewportHeight) {
    if (!(distanceToCamera > 0)) return 0;
    if (camera && camera.isPerspectiveCamera) {
      const halfFieldOfViewRadians = (Number(camera.fov) || 50) * 0.5 * (Math.PI / 180);
      const halfHeightAtDistance = Math.tan(halfFieldOfViewRadians) * distanceToCamera;
      if (!(halfHeightAtDistance > 0)) return 0;
      return viewportHeight * 0.5 / halfHeightAtDistance;
    }


    const frustumHeight = camera && camera.top !== undefined ? Math.abs(camera.top - camera.bottom) : viewportHeight;
    return frustumHeight > 0 ? viewportHeight / frustumHeight : 0;
  }


  function read(request) {
    const source = request || {};
    const camera = source.camera || null;
    const lights = Array.isArray(source.lights) ? source.lights : [];
    const width = Math.max(1, Math.floor(Number(source.width) || 1));
    const height = Math.max(1, Math.floor(Number(source.height) || 1));
    if (!camera || !projectedPosition) {
      return { screenLights: [], culledLightCount: lights.length, projected: false };
    }

    const screenLights = [];
    let culledLightCount = 0;

    lights.forEach((light, lightRowIndex) => {
      const position = light && Array.isArray(light.position) ? light.position : null;
      const influenceRadius = light ? influenceRadiusOf(light) : 0;
      if (!position || !(influenceRadius > 0)) {
        culledLightCount++;
        return;
      }

      projectedPosition.set(position[0], position[1], position[2]);
      const distanceToCamera = camera.position ? camera.position.distanceTo(projectedPosition) : 0;
      projectedPosition.project(camera);


      if (!(distanceToCamera > 0) || projectedPosition.z > 1) {
        culledLightCount++;
        return;
      }

      const screenScale = pixelsPerWorldUnit(camera, distanceToCamera, height);
      const screenRadius = influenceRadius * screenScale;
      if (!(screenRadius > 0)) {
        culledLightCount++;
        return;
      }

      screenLights.push({
        lightIndex: lightRowIndex,
        screenX: (projectedPosition.x * 0.5 + 0.5) * width,
        screenY: (1 - (projectedPosition.y * 0.5 + 0.5)) * height,
        screenRadius,
        energy: Math.max(0, Number(light.intensity) || 0),
        needsShadowTrace: !!light.castShadow,
        shapeIndex: 0,
      });
    });

    return { screenLights, culledLightCount, projected: true };
  }

  return { read };
}

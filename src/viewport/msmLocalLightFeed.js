import { MSM_GRID_MAX_LIGHT_COUNT } from "../lighting/megalightsSm/msmWorldGridLayout.js";

function createLightDescriptor() {
  return {
    lightKey: "", type: "point", range: 0, intensity: 0,
    position: { x: 0, y: 0, z: 0 },
    color: { r: 0, g: 0, b: 0 },
    direction: { x: 0, y: 0, z: 0 },
    outerAngleRadians: 0, penumbra: 0,
    castsShadow: true, atlasSlot: -1,
  };
}

export function createMsmLocalLightFeed() {
  const lights = [];
  const allLights = [];
  const pool = [];
  const state = { lights, candidateCount: 0, residentCount: 0, atlasResidentCount: 0, overflowCount: 0 };

  function reset() {
    lights.length = 0;
    allLights.length = 0;
    state.candidateCount = 0;
    state.residentCount = 0;
    state.atlasResidentCount = 0;
    state.overflowCount = 0;
    return state;
  }

  function update(entries, enabled) {
    reset();
    if (!enabled || !Array.isArray(entries)) return state;
    for (const entry of entries) {
      const light = entry && entry.light;
      if (!light || light.visible === false || !(light.intensity > 0) || !(light.distance > 0)) continue;

      if (entry.kind !== "PointLight" && entry.kind !== "SpotLight") continue;
      if (!light.isPointLight && !light.isSpotLight) continue;
      state.candidateCount += 1;


      if (light.castShadow === true) {
        state.residentCount += 1;
        continue;
      }
      if (lights.length >= MSM_GRID_MAX_LIGHT_COUNT) {
        state.overflowCount += 1;
        continue;
      }
      const lightKey = light.uuid || (entry.inst && entry.inst.id);
      if (!lightKey || !light.position || !light.color) continue;
      const descriptor = pool[lights.length] || (pool[lights.length] = createLightDescriptor());
      descriptor.lightKey = String(lightKey);
      descriptor.threeLight = light;
      descriptor.castsShadow = light.userData?.__rswShadowsRequested !== false;
      descriptor.atlasSlot = -1;
      descriptor.type = light.isSpotLight ? "spot" : "point";
      descriptor.range = light.distance;
      descriptor.intensity = light.intensity;
      descriptor.position.x = light.position.x;
      descriptor.position.y = light.position.y;
      descriptor.position.z = light.position.z;
      descriptor.color.r = light.color.r;
      descriptor.color.g = light.color.g;
      descriptor.color.b = light.color.b;
      descriptor.direction.x = 0;
      descriptor.direction.y = 0;
      descriptor.direction.z = 0;
      descriptor.outerAngleRadians = 0;
      descriptor.penumbra = 0;
      if (light.isSpotLight) {

        const target = light.target && light.target.position;
        if (!target) continue;
        descriptor.direction.x = target.x - light.position.x;
        descriptor.direction.y = target.y - light.position.y;
        descriptor.direction.z = target.z - light.position.z;
        descriptor.outerAngleRadians = light.angle;
        descriptor.penumbra = light.penumbra;
      }
      lights.push(descriptor);
      allLights.push(descriptor);
    }
    return state;
  }

  function excludeMappedLightKeys(lightKeys) {
    if (!lightKeys || lightKeys.size === 0) return state;
    let writeIndex = 0;
    for (const descriptor of lights) {
      if (lightKeys.has(descriptor.lightKey)) {
        state.residentCount += 1;
        state.atlasResidentCount += 1;
      } else {
        lights[writeIndex++] = descriptor;
      }
    }
    lights.length = writeIndex;
    return state;
  }

  return { lights, allLights, state, reset, update, excludeMappedLightKeys };
}

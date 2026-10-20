import {
  subscribeMaterialToMegaLights,
  unsubscribeMaterialFromMegaLights,
} from "../../../viewport/megaLightsMaterialSubscription.js";

export function createMegaLightsDebugFixture({ THREE, scene, requestRender }) {
  let group = null;
  let movingObject = null;
  let stepIndex = 0;
  let currentName = "none";
  let intensityScale = 1;
  let range = 12;
  const fixtureLights = [];
  const resources = new Set();
  const materials = new Set();

  function mesh(geometry, materialOptions) {
    resources.add(geometry);
    const material = new THREE.MeshStandardMaterial(materialOptions);
    resources.add(material);
    materials.add(material);
    subscribeMaterialToMegaLights(material);
    const object = new THREE.Mesh(geometry, material);
    group.add(object);
    return object;
  }

  function clear() {
    if (group) group.removeFromParent();
    for (const material of materials)
      unsubscribeMaterialFromMegaLights(material);
    for (const resource of resources) resource.dispose?.();
    fixtureLights.length = 0;
    resources.clear();
    materials.clear();
    group = movingObject = null;
    currentName = "none";
    stepIndex = 0;
  }

  function set(name, camera) {
    if (
      ![
        "none",
        "single",
        "spot",
        "materials",
        "occluder",
        "many",
        "transparency",
      ].includes(name)
    )
      throw new Error("Unknown fixture: " + name);
    clear();
    if (name === "none") {
      requestRender?.();
      return;
    }
    if (!camera?.isCamera)
      throw new Error("A live camera is required for the fixture");
    currentName = name;
    group = new THREE.Group();
    group.name = "MegaLights temporary debug fixture";
    group.userData.megaLightsDebugOwned = true;
    camera.getWorldPosition(group.position);
    camera.getWorldQuaternion(group.quaternion);
    scene.add(group);
    const wall = mesh(new THREE.PlaneGeometry(7, 4.5), {
      color: 0x838f9d,
      roughness: 0.65,
      metalness: 0,
    });
    wall.position.set(0, 0, -9);
    const count = name === "materials" ? 5 : 3;
    for (let index = 0; index < count; index += 1) {
      const object = mesh(new THREE.SphereGeometry(0.43, 20, 12), {
        color: [0xdb573d, 0x559dde, 0xd8be7f, 0x9be1c6, 0xc9d1dc][index],
        roughness: name === "materials" ? index / 4 : 0.5,
        metalness: name === "materials" ? index % 2 : 0,
      });
      object.position.set((index - (count - 1) / 2) * 1.05, -0.25, -7.5);
    }
    if (name === "occluder") {
      movingObject = mesh(new THREE.BoxGeometry(0.7, 2.2, 0.35), {
        color: 0x323941,
        roughness: 0.9,
      });
      movingObject.position.set(0, 0, -6.5);
    }
    if (name === "transparency") {
      const glass = mesh(new THREE.BoxGeometry(1.7, 2, 0.1), {
        color: 0x8ee6e7,
        transparent: true,
        opacity: 0.35,
        roughness: 0.1,
      });
      glass.position.set(0, 0, -6.7);
    }
    const lightCount = name === "many" ? 64 : 1;
    for (let index = 0; index < lightCount; index += 1) {
      const Light = name === "spot" ? THREE.SpotLight : THREE.PointLight;
      const light = new Light(
        new THREE.Color().setHSL(index / Math.max(1, lightCount), 0.45, 0.7),
        lightCount === 1 ? 28 : 0.65,
        12,
        2,
      );
      light.name = "MegaLights debug light " + index;
      light.position.set(
        lightCount === 1 ? -1.5 : ((index % 8) - 3.5) * 0.7,
        lightCount === 1 ? 1.4 : (Math.floor(index / 8) - 3.5) * 0.5,
        -5.5,
      );
      light.userData.debugBaseIntensity = light.intensity;
      light.intensity *= intensityScale;
      light.distance = range;
      if (name === "spot") {
        light.angle = Math.PI / 5;
        light.penumbra = 0.25;
        light.target.position.set(0, 0, -8);
        group.add(light.target);
      }
      group.add(light);
      fixtureLights.push(light);
      resources.add(light);
    }
    requestRender?.();
  }

  function step() {
    if (!group) return;
    stepIndex += 1;
    if (movingObject) movingObject.position.x = Math.sin(stepIndex / 15) * 1.8;
    else group.rotation.z = Math.sin(stepIndex / 50) * 0.05;
    requestRender?.();
  }

  return {
    set,
    step,
    clear,
    active: () => !!group,
    configure(options) {
      if (Number.isFinite(options.intensityScale))
        intensityScale = Math.max(0, Math.min(8, options.intensityScale));
      if (Number.isFinite(options.range))
        range = Math.max(0.1, Math.min(100, options.range));
      for (const light of fixtureLights) {
        light.intensity = light.userData.debugBaseIntensity * intensityScale;
        light.distance = range;
      }
      requestRender?.();
    },
    describe: () => ({
      name: currentName,
      ownedObjectCount: group?.children.length || 0,
      stepIndex,
      lightCount: fixtureLights.length,
      intensityScale,
      range,
      existingSceneUntouched: true,
    }),
    dispose: clear,
  };
}

import { store } from "../core/state.js";
import { getService } from "../datamodel/index.js";
import {
  climateTick,
  weatherParticleLayers,
  ambientSoundTarget,
  getCachedWind,
  readGrassLength,
  climateDebugState,
  getClimateState,
  WEATHER_RADIUS,
} from "../climate/climateRuntime.js";
import { collectWindShakeParts, sampleShake, allowWindShakeMark } from "../climate/windShake.js";
import { setClimateAmbient, stopClimateAmbient, disposeClimateAudio } from "../climate/climateAudio.js";
import { terrainStore } from "../terrain/terrainStore.js";
import { TERRAIN_MATERIALS, VOXEL_SIZE } from "../terrain/materials.js";

const MAX_PARTICLES = 1500;
const MAX_GRASS = 1200;
const GRASS_SCAN_RADIUS = 64;
const SHAKE_SCAN_MS = 500;
const GRASS_SCAN_MS = 1200;
const AUDIO_MS = 400;

const MAT_GRASS = TERRAIN_MATERIALS.findIndex((m) => m.name === "Grass");


const MAT_LEAFY = TERRAIN_MATERIALS.findIndex((m) => m.name === "LeafyGrass");
const MAT_SAND = TERRAIN_MATERIALS.findIndex((m) => m.name === "Sand");
const MAT_SNOW = TERRAIN_MATERIALS.findIndex((m) => m.name === "Snow");


let climateQualityScale = 1;
export function setClimateQualityScale(f) {
  const v = Number(f);
  climateQualityScale = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}
export function getClimateQualityScale() {
  return climateQualityScale;
}

export function initClimateRender({ THREE, scene, camera, requestRender, meshFor }) {
  if (!THREE || !scene || !camera) return null;

  const group = new THREE.Group();
  group.name = "rsw-climate";
  scene.add(group);


  const positions = new Float32Array(MAX_PARTICLES * 3);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  const vels = new Float32Array(MAX_PARTICLES * 3);
  const windFactors = new Float32Array(MAX_PARTICLES);
  const psizes = new Float32Array(MAX_PARTICLES);
  let alive = 0;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  pGeo.setAttribute("psize", new THREE.BufferAttribute(psizes, 1));
  pGeo.setDrawRange(0, 0);
  const pMat = new THREE.PointsMaterial({
    size: 0.35,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: true,
    depthWrite: false,
  });


  pMat.onBeforeCompile = (shader) => {
    if (shader.vertexShader.indexOf("gl_PointSize = size;") === -1) return;
    shader.vertexShader = "attribute float psize;\n" + shader.vertexShader.replace(
      "gl_PointSize = size;",
      "gl_PointSize = size * psize;",
    );
  };
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  points.raycast = () => {};
  group.add(points);
  const spawnCarry = new Map();

  function killParticle(i) {
    alive -= 1;
    if (i !== alive) {
      for (let k = 0; k < 3; k++) {
        positions[i * 3 + k] = positions[alive * 3 + k];
        colors[i * 3 + k] = colors[alive * 3 + k];
        vels[i * 3 + k] = vels[alive * 3 + k];
      }
      windFactors[i] = windFactors[alive];
      psizes[i] = psizes[alive];
    }
  }

  function spawnParticle(layer, camPos, wind) {
    if (alive >= MAX_PARTICLES) return;
    const i = alive;
    alive += 1;
    const ang = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (layer.radius || WEATHER_RADIUS);
    const isSand = layer.kind === "sand";
    positions[i * 3] = camPos.x + Math.cos(ang) * r;
    positions[i * 3 + 1] = camPos.y + (isSand ? Math.random() * 14 - 2 : 8 + Math.random() * 22);
    positions[i * 3 + 2] = camPos.z + Math.sin(ang) * r;
    colors[i * 3] = layer.color[0];
    colors[i * 3 + 1] = layer.color[1];
    colors[i * 3 + 2] = layer.color[2];
    const hWind = Math.sqrt(wind.x * wind.x + wind.z * wind.z);
    const hdx = hWind > 0.001 ? wind.x / hWind : 1;
    const hdz = hWind > 0.001 ? wind.z / hWind : 0;
    const hSpeed = layer.horizontal || 0;
    vels[i * 3] = (Math.random() - 0.5) * 2 + hdx * hSpeed;
    vels[i * 3 + 1] = -(layer.fall || 1) * (0.85 + Math.random() * 0.3);
    vels[i * 3 + 2] = (Math.random() - 0.5) * 2 + hdz * hSpeed;
    windFactors[i] = layer.kind === "rain" ? 0.55 : 1;
    psizes[i] = (layer.size || 0.35) / 0.35;
  }

  function updateParticles(dt, wind, layers, camPos) {
    const hadAlive = alive > 0;
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];


      const key = layer.kind + ":" + li;

      const want = (spawnCarry.get(key) || 0) + layer.rate * climateQualityScale * dt;
      let n = Math.floor(want);
      spawnCarry.set(key, want - n);
      while (n-- > 0) spawnParticle(layer, camPos, wind);
    }
    const maxDist = WEATHER_RADIUS + 10;
    let i = 0;
    while (i < alive) {
      const wf = windFactors[i];
      positions[i * 3] += (vels[i * 3] + wind.x * wf) * dt;
      positions[i * 3 + 1] += (vels[i * 3 + 1] + wind.y * wf * 0.3) * dt;
      positions[i * 3 + 2] += (vels[i * 3 + 2] + wind.z * wf) * dt;
      const dx = positions[i * 3] - camPos.x;
      const dy = positions[i * 3 + 1] - camPos.y;
      const dz = positions[i * 3 + 2] - camPos.z;
      if (dy < -14 || dx * dx + dz * dz > maxDist * maxDist || dy > 45) {
        killParticle(i);
        continue;
      }
      i += 1;
    }


    if (alive > 0 || hadAlive) {
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;
      pGeo.attributes.psize.needsUpdate = true;
    }
    pGeo.setDrawRange(0, alive);
  }


  function buildBladeGeometry() {
    const geo = new THREE.BufferGeometry();
    const w = 0.35;
    const verts = new Float32Array([
      -w, 0, 0, w, 0, 0, 0, 1, 0,
      0, 0, -w, 0, 0, w, 0, 1, 0,
    ]);
    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    return geo;
  }

  const grassMat = new THREE.MeshBasicMaterial({ color: 0x4f9440, side: THREE.DoubleSide });
  let grassShader = null;
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWindX = { value: 0 };
    shader.uniforms.uWindZ = { value: 0 };
    shader.vertexShader = "uniform float uTime;\nuniform float uWindX;\nuniform float uWindZ;\n" + shader.vertexShader.replace(
      "#include <begin_vertex>",
      [
        "#include <begin_vertex>",
        "float rswH = clamp(position.y, 0.0, 4.0);",
        "vec4 rswWp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);",
        "float rswWm = sqrt(uWindX * uWindX + uWindZ * uWindZ);",
        "float rswPh = rswWp.x * 0.35 + rswWp.z * 0.27;",
        "float rswSway = sin(uTime * (1.4 + rswWm * 0.08) + rswPh) * (0.06 + min(1.0, rswWm / 30.0) * 0.4) * rswH;",
        "// 'transformed' esta no espaco LOCAL da instancia: cada tufo tem um yaw",
        "// aleatorio, entao somar a direcao do vento em coordenadas de mundo aqui",
        "// fazia cada tufo balancar num eixo DIFERENTE (direcao do vento perdida).",
        "// Leva o vento do mundo para o espaco da instancia (colunas normalizadas",
        "// = rotacao; produto escalar com cada coluna = rotacao inversa).",
        "float rswWmS = max(rswWm, 0.001);",
        "vec3 rswW = rswWm > 0.001 ? vec3(uWindX / rswWmS, 0.0, uWindZ / rswWmS) : vec3(1.0, 0.0, 0.0);",
        "vec3 rswC0 = normalize(instanceMatrix[0].xyz);",
        "vec3 rswC1 = normalize(instanceMatrix[1].xyz);",
        "vec3 rswC2 = normalize(instanceMatrix[2].xyz);",
        "vec3 rswLocal = vec3(dot(rswC0, rswW), dot(rswC1, rswW), dot(rswC2, rswW));",
        "transformed += rswLocal * rswSway;",
      ].join("\n"),
    );
    grassShader = shader;
  };
  const grassMesh = new THREE.InstancedMesh(buildBladeGeometry(), grassMat, MAX_GRASS);
  grassMesh.count = 0;
  grassMesh.frustumCulled = false;
  grassMesh.raycast = () => {};
  group.add(grassMesh);
  const tmpMatrix = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion();
  const tmpPos = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const upAxis = new THREE.Vector3(0, 1, 0);
  let lastGrassScan = 0;
  let lastGrassKey = "";
  let ambientMats = { sand: false, snow: false };

  function topVoxelOfColumn(data, vx, vz, yMin, yMax) {
    for (let vy = yMax; vy >= yMin; vy--) {
      if (data.getOcc(vx, vy, vz) > 0.5) return vy;
    }
    return null;
  }

  function rebuildGrass(dm, camPos) {
    const terrain = terrainStore.getTerrainInstance();
    const data = terrainStore.getData();
    ambientMats = { sand: false, snow: false };
    const decoration = !!terrain && terrain.getProperty("Decoration") === true;
    const grassLen = readGrassLength(terrain);
    if (!data || data.isEmpty()) {
      grassMesh.count = 0;
      return;
    }
    const bounds = data.getBounds();
    if (!bounds) {
      grassMesh.count = 0;
      return;
    }


    const wantGrass = decoration && grassLen > 0.01;



    const [cvx, cvy, cvz] = data.worldToVoxel(camPos.x, camPos.y, camPos.z);
    const rad = Math.ceil(GRASS_SCAN_RADIUS / VOXEL_SIZE);
    const yMin = Math.max(bounds.min[1], cvy - 64);
    const yMax = Math.min(bounds.max[1], cvy + 64);
    let count = 0;
    if (yMax < yMin) {
      grassMesh.count = 0;
      return;
    }
    for (let vx = cvx - rad; vx <= cvx + rad && count < MAX_GRASS; vx++) {
      for (let vz = cvz - rad; vz <= cvz + rad && count < MAX_GRASS; vz++) {
        const top = topVoxelOfColumn(data, vx, vz, yMin, yMax);
        if (top == null || data.getOcc(vx, top + 1, vz) > 0.5) continue;
        const mat = data.getMat(vx, top, vz);
        if (mat === MAT_SAND) ambientMats.sand = true;
        if (mat === MAT_SNOW) ambientMats.snow = true;
        if (!wantGrass || (mat !== MAT_GRASS && mat !== MAT_LEAFY)) continue;
        const [wx, wy, wz] = data.voxelCenterWorld(vx, top, vz);
        const ddx = wx - camPos.x;
        const ddz = wz - camPos.z;
        const dist = Math.sqrt(ddx * ddx + ddz * ddz);
        if (dist > GRASS_SCAN_RADIUS) continue;


        let seed = (((vx * 73856093) ^ (vz * 19349663) ^ ((top + 32768) * 83492791)) >>> 0) || 1;
        const rnd = () => {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return seed / 4294967296;
        };
        const tufts = dist < 24 ? 3 : dist < 44 ? 2 : 1;
        for (let t = 0; t < tufts && count < MAX_GRASS; t++) {
          tmpPos.set(
            wx + (rnd() - 0.5) * VOXEL_SIZE * 0.9,
            wy + VOXEL_SIZE / 2,
            wz + (rnd() - 0.5) * VOXEL_SIZE * 0.9,
          );
          tmpQuat.setFromAxisAngle(upAxis, rnd() * Math.PI);
          const h = grassLen * (0.7 + rnd() * 0.6);
          tmpScale.set(0.8 + rnd() * 0.5, Math.max(0.05, h), 0.8 + rnd() * 0.5);
          tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
          grassMesh.setMatrixAt(count, tmpMatrix);
          count += 1;
        }
      }
    }
    grassMesh.count = count;
    grassMesh.instanceMatrix.needsUpdate = true;
  }


  let shakeEntries = [];
  const knownShakeIds = new Set();
  const shakeOffsets = new Map();
  let lastShakeScan = 0;
  let shakeTime = 0;
  const frustum = new THREE.Frustum();
  const frustumMatrix = new THREE.Matrix4();


  const SHAKE_EPS = 1e-3;

  function restoreShaken(id) {
    const off = shakeOffsets.get(id);
    if (!off) return;
    const obj = typeof meshFor === "function" ? meshFor(id) : null;
    if (obj) {


      if (
        Math.abs(obj.position.x - off.ex) <= SHAKE_EPS &&
        Math.abs(obj.position.y - off.ey) <= SHAKE_EPS &&
        Math.abs(obj.position.z - off.ez) <= SHAKE_EPS
      ) {
        obj.position.x -= off.ox;
        obj.position.y -= off.oy;
        obj.position.z -= off.oz;
      }
      if (Math.abs(obj.rotation.x - off.erx) <= SHAKE_EPS && Math.abs(obj.rotation.z - off.erz) <= SHAKE_EPS) {
        obj.rotation.x -= off.rx;
        obj.rotation.z -= off.rz;
      }
    }
    shakeOffsets.delete(id);
  }

  function rescanShake(dm, nowMs) {
    const ws = getService(dm, "Workspace");
    if (!ws) {
      shakeEntries = [];
      return;
    }
    const isPlaytest = store.get("centralView") !== "editor";
    const found = collectWindShakeParts(ws);
    const accepted = [];
    const liveIds = new Set();
    for (const entry of found) {
      const id = entry.part.id;
      if (!knownShakeIds.has(id)) {
        if (isPlaytest && !allowWindShakeMark(nowMs)) continue;
        knownShakeIds.add(id);
      }
      liveIds.add(id);
      accepted.push(entry);
    }
    for (const id of [...knownShakeIds]) {
      if (!liveIds.has(id)) {
        knownShakeIds.delete(id);
        restoreShaken(id);
      }
    }
    shakeEntries = accepted;
  }

  function updateShake(dt, wind) {
    shakeTime += dt;
    if (shakeEntries.length === 0) return false;
    frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(frustumMatrix);
    let moved = false;
    for (const entry of shakeEntries) {
      const part = entry.part;
      if (!part || (part.isDestroyed && part.isDestroyed())) continue;
      const obj = typeof meshFor === "function" ? meshFor(part.id) : null;
      if (!obj) continue;
      const pos = part.getProperty("Position") || { x: 0, y: 0, z: 0 };
      tmpPos.set(pos.x, pos.y, pos.z);
      if (!frustum.containsPoint(tmpPos)) continue;
      const prev = shakeOffsets.get(part.id) || null;
      const next = sampleShake(entry.seed, shakeTime, wind, entry.strength, entry.speed);


      let pox = 0, poy = 0, poz = 0, prx = 0, prz = 0;
      if (prev) {
        if (
          Math.abs(obj.position.x - prev.ex) <= SHAKE_EPS &&
          Math.abs(obj.position.y - prev.ey) <= SHAKE_EPS &&
          Math.abs(obj.position.z - prev.ez) <= SHAKE_EPS
        ) {
          pox = prev.ox; poy = prev.oy; poz = prev.oz;
        }
        if (Math.abs(obj.rotation.x - prev.erx) <= SHAKE_EPS && Math.abs(obj.rotation.z - prev.erz) <= SHAKE_EPS) {
          prx = prev.rx; prz = prev.rz;
        }
      }
      obj.position.x += next.ox - pox;
      obj.position.y += next.oy - poy;
      obj.position.z += next.oz - poz;
      obj.rotation.x += next.rx - prx;
      obj.rotation.z += next.rz - prz;
      shakeOffsets.set(part.id, {
        ox: next.ox, oy: next.oy, oz: next.oz, rx: next.rx, rz: next.rz,
        ex: obj.position.x, ey: obj.position.y, ez: obj.position.z,
        erx: obj.rotation.x, erz: obj.rotation.z,
      });
      if (next.ox !== pox || next.oz !== poz) moved = true;
    }
    return moved;
  }


  const gizmoGeo = new THREE.BufferGeometry();
  const gizmoMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false });
  const gizmos = new THREE.LineSegments(gizmoGeo, gizmoMat);
  gizmos.frustumCulled = false;
  gizmos.renderOrder = 999;
  gizmos.raycast = () => {};
  group.add(gizmos);
  const gizmoVerts = [];
  const gizmoColors = [];

  function pushLine(ax, ay, az, bx, by, bz, r, g, b) {
    gizmoVerts.push(ax, ay, az, bx, by, bz);
    gizmoColors.push(r, g, b, r, g, b);
  }

  function pushBox(pos, size, r, g, b) {
    const hx = (size.x || 1) / 2 + 0.15;
    const hy = (size.y || 1) / 2 + 0.15;
    const hz = (size.z || 1) / 2 + 0.15;
    const xs = [pos.x - hx, pos.x + hx];
    const ys = [pos.y - hy, pos.y + hy];
    const zs = [pos.z - hz, pos.z + hz];
    for (const y of ys) {
      pushLine(xs[0], y, zs[0], xs[1], y, zs[0], r, g, b);
      pushLine(xs[1], y, zs[0], xs[1], y, zs[1], r, g, b);
      pushLine(xs[1], y, zs[1], xs[0], y, zs[1], r, g, b);
      pushLine(xs[0], y, zs[1], xs[0], y, zs[0], r, g, b);
    }
    for (const x of xs) {
      for (const z of zs) pushLine(x, ys[0], z, x, ys[1], z, r, g, b);
    }
  }

  function rebuildGizmos(wind, camPos) {
    gizmoVerts.length = 0;
    gizmoColors.length = 0;
    if (climateDebugState.showWindVector) {
      const mag = Math.sqrt(wind.x * wind.x + wind.y * wind.y + wind.z * wind.z);
      const ox = 0, oy = 8, oz = 0;
      pushLine(ox - 1, oy, oz, ox + 1, oy, oz, 0.2, 0.9, 1);
      pushLine(ox, oy, oz - 1, ox, oy, oz + 1, 0.2, 0.9, 1);
      if (mag > 0.01) {
        const len = 4 + Math.min(mag, 120) * 0.2;
        const nx = wind.x / mag, ny = wind.y / mag, nz = wind.z / mag;
        const tx = ox + nx * len, ty = oy + ny * len, tz = oz + nz * len;
        pushLine(ox, oy, oz, tx, ty, tz, 0.2, 0.9, 1);
        const px = -nz, pz = nx;
        pushLine(tx, ty, tz, tx - nx * 1.6 + px * 0.9, ty - ny * 1.6, tz - nz * 1.6 + pz * 0.9, 0.2, 0.9, 1);
        pushLine(tx, ty, tz, tx - nx * 1.6 - px * 0.9, ty - ny * 1.6, tz - nz * 1.6 - pz * 0.9, 0.2, 0.9, 1);
      }
    }
    if (climateDebugState.showWindShakeObjects) {
      for (const entry of shakeEntries) {
        const part = entry.part;
        if (!part || (part.isDestroyed && part.isDestroyed())) continue;
        const pos = part.getProperty("Position") || { x: 0, y: 0, z: 0 };
        const size = part.getProperty("Size") || { x: 1, y: 1, z: 1 };
        pushBox(pos, size, 1, 0.85, 0.2);
      }
    }
    if (climateDebugState.showWeatherBounds) {
      const segs = 48;
      const y = camPos.y - 4;
      for (let s = 0; s < segs; s++) {
        const a1 = (s / segs) * Math.PI * 2;
        const a2 = ((s + 1) / segs) * Math.PI * 2;
        pushLine(
          camPos.x + Math.cos(a1) * WEATHER_RADIUS, y, camPos.z + Math.sin(a1) * WEATHER_RADIUS,
          camPos.x + Math.cos(a2) * WEATHER_RADIUS, y, camPos.z + Math.sin(a2) * WEATHER_RADIUS,
          0.4, 0.7, 1,
        );
      }
    }
    if (gizmoVerts.length > 0) {
      gizmoGeo.setAttribute("position", new THREE.Float32BufferAttribute(gizmoVerts, 3));
      gizmoGeo.setAttribute("color", new THREE.Float32BufferAttribute(gizmoColors, 3));
      gizmos.visible = true;
    } else {
      gizmos.visible = false;
    }
  }


  let lastMs = 0;
  let lastAudioMs = 0;
  let disposed = false;

  function update() {
    if (disposed) return;
    const nowMs = (typeof performance !== "undefined" ? performance : Date).now();
    const dt = lastMs === 0 ? 0.016 : Math.min(0.05, Math.max(0.001, (nowMs - lastMs) / 1000));
    lastMs = nowMs;
    const dm = store.getDataModel();
    if (!dm) return;
    climateTick(dm, dt);
    const wind = getCachedWind();
    const windMag = Math.sqrt(wind.x * wind.x + wind.y * wind.y + wind.z * wind.z);
    const camPos = camera.position;

    const layers = weatherParticleLayers().slice();
    if (windMag > 15) {
      if (ambientMats.sand) layers.push({ kind: "sand", rate: Math.min(50, windMag * 0.6), fall: 0.5, size: 0.3, horizontal: 0, color: [0.85, 0.74, 0.45], radius: WEATHER_RADIUS });
      if (ambientMats.snow) layers.push({ kind: "snow", rate: Math.min(40, windMag * 0.5), fall: 1.5, size: 0.3, horizontal: 0, color: [1, 1, 1], radius: WEATHER_RADIUS });
    }
    updateParticles(dt, wind, layers, camPos);

    if (nowMs - lastShakeScan > SHAKE_SCAN_MS) {
      lastShakeScan = nowMs;
      rescanShake(dm, nowMs);
    }
    const shakeMoved = updateShake(dt, wind);

    const terrain = terrainStore.getTerrainInstance();
    const grassKey = [
      terrain ? String(terrain.getProperty("Decoration") === true) : "f",
      terrain ? String(readGrassLength(terrain)) : "0",
      Math.round(camPos.x / 16),
      Math.round(camPos.y / 16),
      Math.round(camPos.z / 16),
    ].join("|");
    if (nowMs - lastGrassScan > GRASS_SCAN_MS || grassKey !== lastGrassKey) {
      lastGrassScan = nowMs;
      lastGrassKey = grassKey;
      try { rebuildGrass(dm, camPos); } catch (_) { grassMesh.count = 0; }
    }
    if (grassShader) {
      grassShader.uniforms.uTime.value = nowMs / 1000;
      grassShader.uniforms.uWindX.value = wind.x;
      grassShader.uniforms.uWindZ.value = wind.z;
    }

    const anyGizmo = climateDebugState.showWindVector || climateDebugState.showWindShakeObjects || climateDebugState.showWeatherBounds;
    rebuildGizmos(wind, camPos);

    if (nowMs - lastAudioMs > AUDIO_MS) {
      lastAudioMs = nowMs;
      try { setClimateAmbient(ambientSoundTarget()); } catch (_) {          }
    }

    const st = getClimateState();
    const active = alive > 0 || layers.length > 0 || shakeMoved || shakeEntries.length > 0 ||
      grassMesh.count > 0 || anyGizmo || st.progress < 1 || windMag > 0.05;
    if (active && typeof requestRender === "function") requestRender();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const id of [...shakeOffsets.keys()]) restoreShaken(id);
    try { stopClimateAmbient(); } catch (_) {          }
    try { disposeClimateAudio(); } catch (_) {          }
    scene.remove(group);
    pGeo.dispose();
    pMat.dispose();
    grassMesh.geometry.dispose();
    grassMat.dispose();
    gizmoGeo.dispose();
    gizmoMat.dispose();
  }

  return { update, dispose };
}

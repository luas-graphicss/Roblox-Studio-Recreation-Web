import { getService, createInstance } from "../datamodel/index.js";
import { makeVector3, makeColor } from "../datamodel/types.js";
import { terrainStore } from "../terrain/terrainStore.js";
import { TERRAIN_MATERIALS } from "../terrain/materials.js";
import { logger } from "../core/logger.js";
import { runCooperativeWork } from "../boot/cooperativeWork.js";

function terrainMat(name) {
  const idx = TERRAIN_MATERIALS.findIndex((m) => m.name === name);
  return idx === -1 ? 0 : idx;
}

function* buildPart(parent, opts) {
  const inst = createInstance(opts.className || "Part", { name: opts.name || "Part" });
  if (!inst) return null;
  const set = (prop, value) => {
    try {
      if (inst.hasProperty && inst.hasProperty(prop)) inst.setProperty(prop, value);
    } catch (_) {}
  };
  if (opts.shape) set("Shape", opts.shape);
  if (opts.size) set("Size", makeVector3(opts.size[0], opts.size[1], opts.size[2]));
  if (opts.pos) set("Position", makeVector3(opts.pos[0], opts.pos[1], opts.pos[2]));
  if (opts.rot) set("Rotation", makeVector3(opts.rot[0], opts.rot[1], opts.rot[2]));
  if (opts.color) set("Color", makeColor(opts.color[0], opts.color[1], opts.color[2]));
  if (opts.material) set("Material", opts.material);
  set("Anchored", opts.anchored !== false);


  if (opts.props) for (const k of Object.keys(opts.props)) set(k, opts.props[k]);


  if (opts.attrs && inst.setAttribute) {
    for (const k of Object.keys(opts.attrs)) {
      const v = opts.attrs[k];
      const t = typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";
      try { inst.setAttribute(k, t, v); } catch (_) {}
    }
  }

  inst.setParent(parent);
  yield;
  return inst;
}

function group(parent, name) {
  const model = createInstance("Model", { name, parent });
  return model || parent;
}


function weld(a, b) {
  if (!a || !b) return;
  try {
    const w = createInstance("WeldConstraint", { name: "Weld", parent: a });
    if (!w) return;
    w.setProperty("Part0", a);
    w.setProperty("Part1", b);
  } catch (_) {}
}

function findBaseplate(ws) {
  const kids = ws.getChildren ? ws.getChildren() : [];
  return kids.find((c) => c && c.name === "Baseplate" && c.className === "Part") || null;
}

function setBaseplate(ws, size, color, material) {
  const base = findBaseplate(ws);
  if (!base) return null;
  try {
    base.setProperty("Size", makeVector3(size[0], size[1], size[2]));
    base.setProperty("Position", makeVector3(0, -size[1] / 2, 0));
    base.setProperty("Color", makeColor(color[0], color[1], color[2]));
    if (material) base.setProperty("Material", material);
  } catch (_) {}
  return base;
}

function* addSpawn(ws, x, y, z) {
  return yield* buildPart(ws, {
    className: "SpawnLocation",
    name: "SpawnLocation",
    size: [12, 1, 12],
    pos: [x, y + 0.5, z],
    color: [0.63, 0.63, 0.65],
  });
}


function* buildTree(parent, x, z, scale) {
  const s = scale || 1;
  const tree = group(parent, "Tree");
  yield* buildPart(tree, { name: "Trunk", shape: "Cylinder", size: [6 * s, 1.6 * s, 1.6 * s], pos: [x, 3 * s, z], rot: [0, 0, 90], color: [0.42, 0.28, 0.17], material: "Wood" });
  yield* buildPart(tree, { name: "LeavesA", shape: "Ball", size: [7 * s, 6 * s, 7 * s], pos: [x, 7.4 * s, z], color: [0.28, 0.6, 0.31], material: "Grass" });
  yield* buildPart(tree, { name: "LeavesB", shape: "Ball", size: [4.6 * s, 4 * s, 4.6 * s], pos: [x + 2.2 * s, 6 * s, z + 1.4 * s], color: [0.32, 0.66, 0.34], material: "Grass" });
  yield* buildPart(tree, { name: "LeavesC", shape: "Ball", size: [4.2 * s, 3.6 * s, 4.2 * s], pos: [x - 2 * s, 6.4 * s, z - 1.6 * s], color: [0.26, 0.56, 0.29], material: "Grass" });
}

function* buildLampPost(parent, x, z) {
  const lamp = group(parent, "LampPost");
  yield* buildPart(lamp, { name: "Pole", shape: "Cylinder", size: [7, 0.5, 0.5], pos: [x, 3.5, z], rot: [0, 0, 90], color: [0.18, 0.18, 0.2], material: "Metal" });
  yield* buildPart(lamp, { name: "Lamp", size: [1.1, 1.1, 1.1], pos: [x, 7.3, z], color: [1, 0.85, 0.55], material: "Neon" });
}


function* buildRealisticShowcase(ctx) {
  const ws = ctx.ws;
  setBaseplate(ws, [512, 20, 512], [0.32, 0.33, 0.36], "Concrete");
  yield* addSpawn(ws, 0, 0, 26);


  const dm = ctx.dm || (ws && ws.parent) || null;
  try {
    const lighting = dm ? getService(dm, "Lighting") : null;
    if (lighting) {
      const setL = (prop, value) => {
        try {
          if (lighting.hasProperty && lighting.hasProperty(prop)) lighting.setProperty(prop, value);
        } catch (_) {}
      };
      setL("RenderStyle", "Realistic");
      setL("ToneMapper", "AgX");
      setL("ClockTime", 17.5);
      setL("SkyTurbidity", 2.4);
    }
  } catch (_) {}


  const stage = group(ws, "MaterialStage");
  const mats = [
    ["Marble", [0.92, 0.9, 0.86]],
    ["Metal", [0.75, 0.76, 0.8]],
    ["Fabric", [0.55, 0.2, 0.2]],
    ["Glass", [0.65, 0.82, 0.88]],
  ];
  for (let i = 0; i < mats.length; i += 1) {
    yield* buildPart(stage, { name: "Cube" + mats[i][0], size: [3, 3, 3], pos: [-12 + i * 8, 3, -6], color: mats[i][1], material: mats[i][0] });
  }


  yield* buildPart(ws, { name: "MirrorFloor", size: [24, 0.2, 16], pos: [0, 0.1, -6], color: [0.62, 0.66, 0.7], material: "Metal", props: { Mirror: true } });


  const street = group(ws, "PhotometryStreet");
  const post = function* (x, preset) {
    const arm = group(street, "Post" + preset);
    yield* buildPart(arm, { name: "Pole", shape: "Cylinder", size: [7, 0.5, 0.5], pos: [x, 3.5, 8], rot: [0, 0, 90], color: [0.18, 0.18, 0.2], material: "Metal" });
    const head = yield* buildPart(arm, { name: "Head", size: [1.1, 1.1, 1.1], pos: [x, 7.3, 8], color: [1, 0.9, 0.7], material: "Neon" });
    if (head) {
      const bulb = createInstance("PointLight", { name: "Bulb", parent: head });
      if (bulb) {
        try {
          bulb.setProperty("LightPreset", preset);
          bulb.setProperty("Range", 24);
        } catch (_) {}
      }
    }
  };
  yield* post(-14, "Sodium");
  yield* post(0, "LED");
  yield* post(14, "Candle");


  const softbox = group(ws, "Softbox");
  const panel = yield* buildPart(softbox, { name: "Panel", size: [8, 4, 0.4], pos: [0, 6, 2], color: [1, 1, 1], material: "Neon" });
  if (panel) {
    const rect = createInstance("RectLight", { name: "AreaLight", parent: panel });
    if (rect) {
      try {
        rect.setProperty("Width", 8);
        rect.setProperty("Height", 4);
        rect.setProperty("Range", 24);
        rect.setProperty("Brightness", 4);
      } catch (_) {}
    }
  }


  try {
    const kids = ws.getChildren ? ws.getChildren() : [];
    const terrain = kids.find((c) => c && c.className === "Terrain") || null;
    const clouds = createInstance("Clouds", { name: "Clouds", parent: terrain || ws });
    if (clouds) {
      clouds.setProperty("Cover", 0.42);
      clouds.setProperty("Density", 0.55);
    }
  } catch (_) {}
}


function* buildBaseplate({ ws }) {
  setBaseplate(ws, [2048, 16, 2048], [0.42, 0.42, 0.45], "Plastic");
  yield* addSpawn(ws, 0, 0, 0);
}

function* buildClassicBaseplate({ ws }) {
  setBaseplate(ws, [512, 20, 512], [0.39, 0.37, 0.39], "Concrete");
  yield* addSpawn(ws, 0, 0, 0);
}


function* buildFlatTerrain({ ws }) {
  const base = findBaseplate(ws);
  if (base) {
    try {
      base.destroy();
    } catch (_) {}
  }
  const data = terrainStore.getData();
  data.clear();
  const grass = terrainMat("Grass");
  const ground = terrainMat("Ground");
  const waterIdx = TERRAIN_MATERIALS.findIndex((m) => m.name === "Water");
  const sandIdx = TERRAIN_MATERIALS.findIndex((m) => m.name === "Sand");
  const half = 40;                                      
  for (let x = -half; x < half; x++) {
    for (let z = -half; z < half; z++) {
      data.set(x, -3, z, ground, 1);
      data.set(x, -2, z, ground, 1);
      data.set(x, -1, z, grass, 1);
    }
    yield 0.7 * (x + half + 1) / (half * 2);
  }


  const mounds = [
    { cx: -26, cz: -24, r: 9 },
    { cx: 28, cz: -20, r: 7 },
    { cx: -22, cz: 26, r: 6 },
    { cx: 24, cz: 28, r: 8 },
  ];
  for (const [moundIndex, m] of mounds.entries()) {
    for (let x = -m.r; x <= m.r; x++) {
      for (let z = -m.r; z <= m.r; z++) {
        const d = Math.sqrt(x * x + z * z) / m.r;
        if (d > 1) continue;
        const h = Math.round((1 - d) * 2.4);
        for (let y = 0; y < h; y++) data.set(m.cx + x, y, m.cz + z, grass, 1);
      }
      yield 0.7 + 0.2 * (moundIndex + (x + m.r + 1) / (2 * m.r + 1)) / mounds.length;
    }
  }

  if (waterIdx !== -1) {
    const cx = 14;
    const cz = -12;
    const r = 7;
    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        const d = Math.sqrt(x * x + z * z);
        if (d > r) continue;
        if (d > r - 1.2 && sandIdx !== -1) data.set(cx + x, -1, cz + z, sandIdx, 1);
        else data.set(cx + x, -1, cz + z, waterIdx, 1);
      }
      yield 0.9 + 0.09 * (x + r + 1) / (2 * r + 1);
    }
  }
  terrainStore.notifyChanged();
  yield* addSpawn(ws, 0, 0, 0);
}


function* buildHouse(parent, x, z, wallColor, facing, name) {
  const f = facing >= 0 ? 1 : -1;
  const house = group(parent, name || "House");
  yield* buildPart(house, { name: "Foundation", size: [15, 1, 13], pos: [x, 0.5, z], color: [0.45, 0.45, 0.47], material: "Concrete" });
  yield* buildPart(house, { name: "Walls", size: [14, 8, 12], pos: [x, 5, z], color: wallColor, material: "Brick" });
  const roofColor = [0.55, 0.26, 0.21];
  yield* buildPart(house, { name: "RoofSouth", shape: "Wedge", size: [15.6, 3.6, 6.9], pos: [x, 10.8, z + 3.28], color: roofColor, material: "Slate" });
  yield* buildPart(house, { name: "RoofNorth", shape: "Wedge", size: [15.6, 3.6, 6.9], pos: [x, 10.8, z - 3.28], rot: [0, 180, 0], color: roofColor, material: "Slate" });
  yield* buildPart(house, { name: "Chimney", size: [1.6, 4.5, 1.6], pos: [x - 4.5, 12, z - 2 * f], color: [0.5, 0.36, 0.3], material: "Brick" });
  yield* buildPart(house, { name: "Door", size: [3.6, 6.4, 0.5], pos: [x, 4.2, z + 6.05 * f], color: [0.36, 0.23, 0.13], material: "Wood" });
  yield* buildPart(house, { name: "DoorStep", size: [4.6, 1, 2.2], pos: [x, 0.5, z + 7.1 * f], color: [0.55, 0.55, 0.58], material: "Concrete" });
  const winColor = [0.62, 0.81, 0.93];
  yield* buildPart(house, { name: "WindowFrontA", size: [3, 3, 0.5], pos: [x - 4.2, 5.8, z + 6.05 * f], color: winColor, material: "Glass" });
  yield* buildPart(house, { name: "WindowFrontB", size: [3, 3, 0.5], pos: [x + 4.2, 5.8, z + 6.05 * f], color: winColor, material: "Glass" });
  yield* buildPart(house, { name: "WindowSideA", size: [0.5, 3, 3], pos: [x - 7.05, 5.8, z], color: winColor, material: "Glass" });
  yield* buildPart(house, { name: "WindowSideB", size: [0.5, 3, 3], pos: [x + 7.05, 5.8, z], color: winColor, material: "Glass" });
  yield* buildPart(house, { name: "SillFrontA", size: [3.6, 0.4, 0.7], pos: [x - 4.2, 4.1, z + 6.15 * f], color: [0.9, 0.9, 0.92], material: "SmoothPlastic" });
  yield* buildPart(house, { name: "SillFrontB", size: [3.6, 0.4, 0.7], pos: [x + 4.2, 4.1, z + 6.15 * f], color: [0.9, 0.9, 0.92], material: "SmoothPlastic" });
}

function* buildVillage({ ws }) {
  setBaseplate(ws, [512, 20, 512], [0.36, 0.53, 0.3], "Grass");


  const plaza = group(ws, "Plaza");
  yield* buildPart(plaza, { name: "PlazaFloor", size: [34, 0.6, 34], pos: [0, 0.3, 0], color: [0.62, 0.58, 0.5], material: "Cobblestone" });
  const fountain = group(plaza, "Fountain");
  const stone = [0.55, 0.55, 0.58];
  yield* buildPart(fountain, { name: "Basin", shape: "Cylinder", size: [1.4, 11, 11], pos: [0, 1.3, 0], rot: [0, 0, 90], color: stone, material: "Concrete" });
  yield* buildPart(fountain, { name: "Water", shape: "Cylinder", size: [0.5, 9.6, 9.6], pos: [0, 1.85, 0], rot: [0, 0, 90], color: [0.35, 0.62, 0.85], material: "Glass" });
  yield* buildPart(fountain, { name: "Pillar", shape: "Cylinder", size: [3.2, 1.6, 1.6], pos: [0, 3.6, 0], rot: [0, 0, 90], color: stone, material: "Concrete" });
  yield* buildPart(fountain, { name: "Bowl", shape: "Cylinder", size: [0.7, 4.6, 4.6], pos: [0, 5.55, 0], rot: [0, 0, 90], color: stone, material: "Concrete" });
  yield* buildPart(fountain, { name: "Spout", shape: "Ball", size: [1.6, 1.6, 1.6], pos: [0, 6.4, 0], color: [0.5, 0.75, 0.95], material: "Glass" });
  yield* buildLampPost(plaza, -14, -14);
  yield* buildLampPost(plaza, 14, -14);
  yield* buildLampPost(plaza, -14, 14);
  yield* buildLampPost(plaza, 14, 14);


  const roads = group(ws, "Roads");
  const roadColor = [0.6, 0.55, 0.45];
  yield* buildPart(roads, { name: "MainRoad", size: [10, 0.4, 120], pos: [0, 0.2, 0], color: roadColor, material: "Cobblestone" });
  yield* buildPart(roads, { name: "NorthRoad", size: [110, 0.4, 8], pos: [0, 0.2, -30], color: roadColor, material: "Cobblestone" });
  yield* buildPart(roads, { name: "SouthRoad", size: [110, 0.4, 8], pos: [0, 0.2, 30], color: roadColor, material: "Cobblestone" });
  yield* buildPart(roads, { name: "BranchNW", size: [4, 0.4, 6], pos: [-40, 0.2, -36], color: roadColor, material: "Cobblestone" });
  yield* buildPart(roads, { name: "BranchNE", size: [4, 0.4, 6], pos: [40, 0.2, -36], color: roadColor, material: "Cobblestone" });
  yield* buildPart(roads, { name: "BranchSW", size: [4, 0.4, 6], pos: [-40, 0.2, 36], color: roadColor, material: "Cobblestone" });
  yield* buildPart(roads, { name: "BranchSE", size: [4, 0.4, 6], pos: [40, 0.2, 36], color: roadColor, material: "Cobblestone" });


  yield* buildHouse(ws, -40, -44, [0.85, 0.79, 0.65], 1, "House 1");
  yield* buildHouse(ws, 40, -44, [0.75, 0.6, 0.45], 1, "House 2");
  yield* buildHouse(ws, -40, 44, [0.65, 0.7, 0.75], -1, "House 3");
  yield* buildHouse(ws, 40, 44, [0.8, 0.56, 0.5], -1, "House 4");


  const treesAt = [
    [-26, 14, 1.1],
    [26, 14, 0.9],
    [-28, -16, 1],
    [28, -14, 1.15],
    [-14, 52, 0.9],
    [16, -52, 1.05],
  ];
  const forest = group(ws, "Trees");
  for (const [tx, tz, ts] of treesAt) yield* buildTree(forest, tx, tz, ts);


  const sign = group(ws, "WelcomeSign");
  yield* buildPart(sign, { name: "PostA", size: [0.5, 3.6, 0.5], pos: [7.8, 1.8, 49], color: [0.42, 0.28, 0.17], material: "Wood" });
  yield* buildPart(sign, { name: "PostB", size: [0.5, 3.6, 0.5], pos: [10.2, 1.8, 49], color: [0.42, 0.28, 0.17], material: "Wood" });
  yield* buildPart(sign, { name: "Board", size: [4.4, 2.4, 0.4], pos: [9, 4.6, 49], color: [0.72, 0.55, 0.35], material: "WoodPlanks" });

  yield* addSpawn(ws, 0, 0.4, 54);
}


function* buildObby({ ws }) {
  setBaseplate(ws, [128, 16, 128], [0.55, 0.57, 0.62], "Plastic");
  const colors = [
    [0.9, 0.35, 0.3],
    [0.95, 0.65, 0.25],
    [0.95, 0.9, 0.35],
    [0.4, 0.8, 0.4],
    [0.35, 0.6, 0.9],
    [0.6, 0.45, 0.85],
  ];
  const obby = group(ws, "Obby");
  let ci = 0;
  const nextColor = () => colors[ci++ % colors.length];


  const gate = group(obby, "StartGate");
  yield* buildPart(gate, { name: "PillarA", size: [2, 10, 2], pos: [56, 5, -7], color: [0.92, 0.92, 0.95], material: "Concrete" });
  yield* buildPart(gate, { name: "PillarB", size: [2, 10, 2], pos: [56, 5, 7], color: [0.92, 0.92, 0.95], material: "Concrete" });
  yield* buildPart(gate, { name: "TopBar", size: [2, 2, 16], pos: [56, 11, 0], color: [0.92, 0.92, 0.95], material: "Concrete" });
  yield* buildPart(gate, { name: "Banner", size: [0.4, 1.4, 14], pos: [57.2, 11, 0], color: [0.3, 0.85, 0.4], material: "Neon" });


  yield* buildPart(obby, { name: "Lava", size: [217, 0.5, 44], pos: [171.5, -6, 0], color: [1, 0.35, 0.15], material: "Neon", attrs: { TouchDamage: 100 } });


  const stage1 = group(obby, "Stage1");
  for (let i = 0; i < 4; i++) {
    yield* buildPart(stage1, { name: "Platform" + (i + 1), size: [8, 1, 8], pos: [72 + i * 14, 2 + i * 2, 0], color: nextColor(), material: "SmoothPlastic" });
  }
  yield* buildPart(obby, { name: "CheckpointRing1", size: [10, 0.6, 10], pos: [128, 9.8, 0], color: [0.3, 0.6, 1], material: "Neon" });


  yield* buildPart(obby, { className: "SpawnLocation", name: "Checkpoint1", size: [8, 1, 8], pos: [128, 10.5, 0], color: [0.63, 0.63, 0.65], props: { Neutral: false }, attrs: { Checkpoint: true } });


  const stage2 = group(obby, "Stage2");
  const zig = [
    [140, 12, 4],
    [152, 14, -4],
    [164, 16, 4],
    [176, 18, -4],
  ];
  for (let i = 0; i < zig.length; i++) {
    const p = zig[i];
    if (i % 2 === 0) {
      yield* buildPart(stage2, { name: "Pad" + (i + 1), shape: "Cylinder", size: [1, 8, 8], pos: [p[0], p[1], p[2]], rot: [0, 0, 90], color: nextColor(), material: "SmoothPlastic" });
    } else {
      yield* buildPart(stage2, { name: "Pad" + (i + 1), size: [6, 1, 6], pos: [p[0], p[1], p[2]], color: nextColor(), material: "SmoothPlastic" });
    }
  }
  yield* buildPart(stage2, { name: "KillPanelA", size: [3, 0.4, 3], pos: [146, 13.4, 0], color: [1, 0.25, 0.25], material: "Neon", attrs: { TouchDamage: 100 } });
  yield* buildPart(stage2, { name: "KillPanelB", size: [3, 0.4, 3], pos: [170, 17.4, 0], color: [1, 0.25, 0.25], material: "Neon", attrs: { TouchDamage: 100 } });
  yield* buildPart(obby, { name: "CheckpointRing2", size: [10, 0.6, 10], pos: [190, 19.8, 0], color: [0.3, 0.6, 1], material: "Neon" });
  yield* buildPart(obby, { className: "SpawnLocation", name: "Checkpoint2", size: [8, 1, 8], pos: [190, 20.5, 0], color: [0.63, 0.63, 0.65], props: { Neutral: false }, attrs: { Checkpoint: true } });


  const stage3 = group(obby, "Stage3");
  yield* buildPart(stage3, { name: "Bridge", size: [24, 1, 3], pos: [208, 20.5, 0], color: nextColor(), material: "SmoothPlastic" });
  yield* buildPart(stage3, { name: "Step1", size: [5, 1, 5], pos: [228, 22, 3], color: nextColor(), material: "SmoothPlastic" });
  yield* buildPart(stage3, { name: "Step2", size: [5, 1, 5], pos: [238, 24, -3], color: nextColor(), material: "SmoothPlastic" });
  yield* buildPart(stage3, { name: "Step3", size: [5, 1, 5], pos: [248, 26, 0], color: nextColor(), material: "SmoothPlastic" });


  const finish = group(obby, "Finish");
  yield* buildPart(finish, { name: "Podium", size: [16, 2, 16], pos: [262, 27, 0], color: [1, 0.84, 0.3], material: "Neon" });
  yield* buildPart(finish, { name: "ArchPillarA", size: [1.5, 8, 1.5], pos: [262, 32, -7.5], color: [0.92, 0.92, 0.95], material: "Concrete" });
  yield* buildPart(finish, { name: "ArchPillarB", size: [1.5, 8, 1.5], pos: [262, 32, 7.5], color: [0.92, 0.92, 0.95], material: "Concrete" });
  yield* buildPart(finish, { name: "ArchBeam", size: [1.5, 1.5, 16.5], pos: [262, 36.75, 0], color: [0.92, 0.92, 0.95], material: "Concrete" });
  yield* buildPart(finish, { name: "ArchBanner", size: [0.4, 1.6, 15], pos: [261, 36.6, 0], color: [1, 0.84, 0.3], material: "Neon" });
  yield* buildPart(finish, { name: "TrophyBase", size: [2.4, 2.4, 2.4], pos: [266, 29.2, 0], color: [0.95, 0.95, 0.97], material: "Marble" });
  yield* buildPart(finish, { name: "Trophy", shape: "Ball", size: [1.8, 1.8, 1.8], pos: [266, 31.3, 0], color: [1, 0.84, 0.3], material: "Neon" });

  yield* addSpawn(ws, 44, 0, 0);
}


function* buildKart(parent, x, z, bodyColor, name, groundY) {
  const gy = groundY || 0;
  const kart = group(parent, name || "Kart");
  const chassis = yield* buildPart(kart, { name: "Chassis", size: [8, 1, 5], pos: [x, gy + 2, z], color: bodyColor, material: "SmoothPlastic", anchored: false });
  const nose = yield* buildPart(kart, { name: "Nose", shape: "Wedge", size: [5, 1, 2.5], pos: [x + 5.25, gy + 2, z], rot: [0, 90, 0], color: bodyColor, material: "SmoothPlastic", anchored: false });
  const seat = yield* buildPart(kart, { className: "VehicleSeat", name: "VehicleSeat", size: [3.4, 1, 3.4], pos: [x - 1, gy + 3, z], rot: [0, -90, 0], color: [0.15, 0.15, 0.15], anchored: false });
  const postA = yield* buildPart(kart, { name: "SpoilerPostA", size: [0.4, 1.2, 0.4], pos: [x - 3.4, gy + 3.1, z - 1.6], color: [0.15, 0.15, 0.15], material: "SmoothPlastic", anchored: false });
  const postB = yield* buildPart(kart, { name: "SpoilerPostB", size: [0.4, 1.2, 0.4], pos: [x - 3.4, gy + 3.1, z + 1.6], color: [0.15, 0.15, 0.15], material: "SmoothPlastic", anchored: false });
  const wing = yield* buildPart(kart, { name: "SpoilerWing", size: [1.4, 0.3, 5.4], pos: [x - 3.4, gy + 3.85, z], color: bodyColor, material: "SmoothPlastic", anchored: false });
  const wheels = [];
  const wheelAt = [
    [x - 2.6, z - 3.05],
    [x - 2.6, z + 3.05],
    [x + 2.6, z - 3.05],
    [x + 2.6, z + 3.05],
  ];
  for (let i = 0; i < wheelAt.length; i++) {
    wheels.push(yield* buildPart(kart, { name: "Wheel" + (i + 1), shape: "Cylinder", size: [1.2, 2.6, 2.6], pos: [wheelAt[i][0], gy + 1.3, wheelAt[i][1]], rot: [0, 90, 0], color: [0.12, 0.12, 0.13], material: "Rubber", anchored: false }));
  }
  for (const p of [nose, seat, postA, postB, wing, ...wheels]) weld(chassis, p);
  return kart;
}

function* buildRacing({ ws }) {
  setBaseplate(ws, [1024, 16, 1024], [0.34, 0.52, 0.32], "Grass");
  const asphalt = [0.16, 0.16, 0.18];
  const white = [0.95, 0.95, 0.95];


  const track = group(ws, "Track");
  yield* buildPart(track, { name: "StraightNorth", size: [240, 1, 28], pos: [0, 0.5, -90], color: asphalt, material: "Asphalt" });
  yield* buildPart(track, { name: "StraightSouth", size: [240, 1, 28], pos: [0, 0.5, 90], color: asphalt, material: "Asphalt" });
  yield* buildPart(track, { name: "SideWest", size: [28, 1, 208], pos: [-106, 0.5, 0], color: asphalt, material: "Asphalt" });
  yield* buildPart(track, { name: "SideEast", size: [28, 1, 208], pos: [106, 0.5, 0], color: asphalt, material: "Asphalt" });


  const lines = group(track, "Lines");
  yield* buildPart(lines, { name: "EdgeSouthOuter", size: [212, 0.18, 0.8], pos: [0, 1.08, 103.4], color: white, material: "SmoothPlastic" });
  yield* buildPart(lines, { name: "EdgeSouthInner", size: [212, 0.18, 0.8], pos: [0, 1.08, 76.6], color: white, material: "SmoothPlastic" });
  yield* buildPart(lines, { name: "EdgeNorthOuter", size: [212, 0.18, 0.8], pos: [0, 1.08, -103.4], color: white, material: "SmoothPlastic" });
  yield* buildPart(lines, { name: "EdgeNorthInner", size: [212, 0.18, 0.8], pos: [0, 1.08, -76.6], color: white, material: "SmoothPlastic" });
  yield* buildPart(lines, { name: "EdgeWestOuter", size: [0.8, 0.18, 132], pos: [-119.4, 1.08, 0], color: white, material: "SmoothPlastic" });
  yield* buildPart(lines, { name: "EdgeWestInner", size: [0.8, 0.18, 132], pos: [-92.6, 1.08, 0], color: white, material: "SmoothPlastic" });
  yield* buildPart(lines, { name: "EdgeEastOuter", size: [0.8, 0.18, 132], pos: [119.4, 1.08, 0], color: white, material: "SmoothPlastic" });
  yield* buildPart(lines, { name: "EdgeEastInner", size: [0.8, 0.18, 132], pos: [92.6, 1.08, 0], color: white, material: "SmoothPlastic" });
  const dashColor = [0.85, 0.85, 0.88];
  const dashX = [-75, -45, -15, 15, 45, 75];
  for (let i = 0; i < dashX.length; i++) {
    yield* buildPart(lines, { name: "DashS" + (i + 1), size: [6, 0.15, 0.9], pos: [dashX[i], 1.08, 90], color: dashColor, material: "SmoothPlastic" });
    yield* buildPart(lines, { name: "DashN" + (i + 1), size: [6, 0.15, 0.9], pos: [dashX[i], 1.08, -90], color: dashColor, material: "SmoothPlastic" });
  }
  const dashZ = [-60, -30, 0, 30, 60];
  for (let i = 0; i < dashZ.length; i++) {
    yield* buildPart(lines, { name: "DashW" + (i + 1), size: [0.9, 0.15, 6], pos: [-106, 1.08, dashZ[i]], color: dashColor, material: "SmoothPlastic" });
    yield* buildPart(lines, { name: "DashE" + (i + 1), size: [0.9, 0.15, 6], pos: [106, 1.08, dashZ[i]], color: dashColor, material: "SmoothPlastic" });
  }


  const curbs = group(track, "Curbs");
  const curbRed = [0.85, 0.16, 0.14];
  const corners = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (let c = 0; c < corners.length; c++) {
    const sx = corners[c][0];
    const sz = corners[c][1];
    const xRun = [95.4, 99, 102.6];
    for (let k = 0; k < xRun.length; k++) {
      yield* buildPart(curbs, { name: "CurbX" + c + "_" + k, size: [3.4, 0.25, 1.6], pos: [sx * xRun[k], 1.13, sz * 77.2], color: k % 2 ? white : curbRed, material: "SmoothPlastic" });
    }
    const zRun = [79.4, 83, 86.6];
    for (let k = 0; k < zRun.length; k++) {
      yield* buildPart(curbs, { name: "CurbZ" + c + "_" + k, size: [1.6, 0.25, 3.4], pos: [sx * 93.2, 1.13, sz * zRun[k]], color: k % 2 ? curbRed : white, material: "SmoothPlastic" });
    }
  }


  const start = group(ws, "StartLine");
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 8; k++) {
      const dark = (row + k) % 2 === 0;
      yield* buildPart(start, { name: "Check" + row + "_" + k, size: [2, 0.15, 3.5], pos: [row === 0 ? -1 : 1, 1.08, 77.75 + k * 3.5], color: dark ? [0.08, 0.08, 0.09] : [0.97, 0.97, 0.97], material: "SmoothPlastic" });
    }
  }
  yield* buildPart(start, { name: "GantryPillarA", size: [2.4, 13, 2.4], pos: [0, 6.5, 74.6], color: [0.25, 0.25, 0.28], material: "Metal" });
  yield* buildPart(start, { name: "GantryPillarB", size: [2.4, 13, 2.4], pos: [0, 6.5, 105.4], color: [0.25, 0.25, 0.28], material: "Metal" });


  yield* buildPart(start, { name: "GantryBeam", size: [2.4, 2.4, 33.2], pos: [0, 14.2, 90], color: [0.25, 0.25, 0.28], material: "Metal" });
  yield* buildPart(start, { name: "GantryBanner", size: [1, 1.8, 28], pos: [0, 12.1, 90], color: [0.35, 0.9, 0.45], material: "Neon" });


  const props = group(ws, "TrackProps");
  const tire = [0.12, 0.12, 0.13];
  for (let c = 0; c < corners.length; c++) {
    const sx = corners[c][0];
    const sz = corners[c][1];
    yield* buildPart(props, { name: "TireA1_" + c, shape: "Cylinder", size: [1.2, 3.6, 3.6], pos: [sx * 114, 1.6, sz * 98], rot: [0, 0, 90], color: tire, material: "Rubber" });
    yield* buildPart(props, { name: "TireA2_" + c, shape: "Cylinder", size: [1.2, 3.6, 3.6], pos: [sx * 114, 2.8, sz * 98], rot: [0, 0, 90], color: tire, material: "Rubber" });
    yield* buildPart(props, { name: "TireB1_" + c, shape: "Cylinder", size: [1.2, 3.6, 3.6], pos: [sx * 109, 1.6, sz * 101], rot: [0, 0, 90], color: tire, material: "Rubber" });
    yield* buildPart(props, { name: "TireB2_" + c, shape: "Cylinder", size: [1.2, 3.6, 3.6], pos: [sx * 109, 2.8, sz * 101], rot: [0, 0, 90], color: tire, material: "Rubber" });


    yield* buildPart(props, { name: "BarrierZ" + c, size: [1, 2.4, 26], pos: [sx * 120.6, 1.2, sz * 94], color: [0.92, 0.92, 0.95], material: "SmoothPlastic" });
    yield* buildPart(props, { name: "BarrierX" + c, size: [26, 2.4, 1], pos: [sx * 107, 1.2, sz * 104.6], color: [0.92, 0.92, 0.95], material: "SmoothPlastic" });
  }


  const pit = group(ws, "PitStop");
  yield* buildPart(pit, { name: "PitFloor", size: [26, 0.5, 14], pos: [-40, 0.25, 58], color: [0.35, 0.35, 0.38], material: "Concrete" });
  yield* buildPart(pit, { name: "PitBackWall", size: [26, 6, 1], pos: [-40, 3, 51.5], color: [0.75, 0.75, 0.78], material: "Concrete" });
  yield* buildPart(pit, { name: "PitSideA", size: [1, 6, 13], pos: [-52.5, 3, 58], color: [0.75, 0.75, 0.78], material: "Concrete" });
  yield* buildPart(pit, { name: "PitSideB", size: [1, 6, 13], pos: [-27.5, 3, 58], color: [0.75, 0.75, 0.78], material: "Concrete" });
  yield* buildPart(pit, { name: "PitRoof", size: [28, 0.8, 16], pos: [-40, 6.4, 58], color: [0.5, 0.24, 0.2], material: "Slate" });


  yield* buildKart(ws, -10, 84, [0.85, 0.2, 0.2], "Kart 1", 1);
  yield* buildKart(ws, -20, 96, [0.25, 0.45, 0.85], "Kart 2", 1);
  yield* buildKart(ws, -40, 58, [0.9, 0.75, 0.2], "Kart 3", 0.5);


  const forest = group(ws, "Trees");
  yield* buildTree(forest, 150, 140, 1.2);
  yield* buildTree(forest, -150, 140, 1.2);
  yield* buildTree(forest, 150, -140, 1.2);
  yield* buildTree(forest, -150, -140, 1.2);

  yield* addSpawn(ws, 0, 0, 56);
}

const ART = {
  baseplate: [
    ["rect", { x: "0", y: "0", width: "160", height: "96", fill: "#7ba6cf" }],
    ["circle", { cx: "128", cy: "22", r: "10", fill: "#f4e9b0" }],
    ["rect", { x: "0", y: "56", width: "160", height: "40", fill: "#9a9aa2" }],
    ["rect", { x: "64", y: "50", width: "32", height: "8", rx: "2", fill: "#c9c9cf" }],
  ],
  classic: [
    ["rect", { x: "0", y: "0", width: "160", height: "96", fill: "#87b2d8" }],
    ["rect", { x: "0", y: "52", width: "160", height: "44", fill: "#6f6d72" }],
    ["circle", { cx: "24", cy: "62", r: "3", fill: "#8b898f" }],
    ["circle", { cx: "56", cy: "62", r: "3", fill: "#8b898f" }],
    ["circle", { cx: "88", cy: "62", r: "3", fill: "#8b898f" }],
    ["circle", { cx: "120", cy: "62", r: "3", fill: "#8b898f" }],
    ["circle", { cx: "40", cy: "78", r: "3", fill: "#8b898f" }],
    ["circle", { cx: "72", cy: "78", r: "3", fill: "#8b898f" }],
    ["circle", { cx: "104", cy: "78", r: "3", fill: "#8b898f" }],
    ["circle", { cx: "136", cy: "78", r: "3", fill: "#8b898f" }],
  ],
  flat: [
    ["rect", { x: "0", y: "0", width: "160", height: "96", fill: "#8fc1e8" }],
    ["circle", { cx: "34", cy: "24", r: "9", fill: "#f4e9b0" }],
    ["rect", { x: "0", y: "58", width: "160", height: "38", fill: "#5fa544" }],
    ["rect", { x: "0", y: "58", width: "160", height: "5", fill: "#74b858" }],
  ],
  village: [
    ["rect", { x: "0", y: "0", width: "160", height: "96", fill: "#9cc3e5" }],
    ["rect", { x: "0", y: "62", width: "160", height: "34", fill: "#6aa14f" }],
    ["rect", { x: "22", y: "42", width: "32", height: "26", fill: "#d9c9a3" }],
    ["polygon", { points: "18,42 38,26 58,42", fill: "#8c4a38" }],
    ["rect", { x: "96", y: "46", width: "36", height: "24", fill: "#c2986e" }],
    ["polygon", { points: "92,46 114,30 136,46", fill: "#7d4030" }],
    ["rect", { x: "34", y: "54", width: "8", height: "14", fill: "#5b3a20" }],
    ["rect", { x: "108", y: "56", width: "8", height: "14", fill: "#5b3a20" }],
  ],
  obby: [
    ["rect", { x: "0", y: "0", width: "160", height: "96", fill: "#7f9fd4" }],
    ["rect", { x: "10", y: "72", width: "26", height: "10", rx: "2", fill: "#e2564d" }],
    ["rect", { x: "48", y: "58", width: "26", height: "10", rx: "2", fill: "#f0a03c" }],
    ["rect", { x: "86", y: "44", width: "26", height: "10", rx: "2", fill: "#f4d44a" }],
    ["rect", { x: "124", y: "30", width: "26", height: "10", rx: "2", fill: "#57bf63" }],
  ],
  racing: [
    ["rect", { x: "0", y: "0", width: "160", height: "96", fill: "#79ab63" }],
    ["rect", { x: "0", y: "34", width: "160", height: "34", fill: "#2e2e33" }],
    ["rect", { x: "6", y: "49", width: "14", height: "4", fill: "#e8e8ea" }],
    ["rect", { x: "34", y: "49", width: "14", height: "4", fill: "#e8e8ea" }],
    ["rect", { x: "62", y: "49", width: "14", height: "4", fill: "#e8e8ea" }],
    ["rect", { x: "90", y: "49", width: "14", height: "4", fill: "#e8e8ea" }],
    ["rect", { x: "118", y: "49", width: "14", height: "4", fill: "#e8e8ea" }],
    ["rect", { x: "104", y: "40", width: "26", height: "12", rx: "3", fill: "#d8433a" }],
  ],
  showcase: [
    ["rect", { x: "0", y: "0", width: "140", height: "56", fill: "#f2a65a" }],
    ["circle", { cx: "112", cy: "22", r: "9", fill: "#ffd9a0" }],
    ["rect", { x: "0", y: "56", width: "140", height: "34", fill: "#3d4148" }],
    ["rect", { x: "34", y: "58", width: "72", height: "22", rx: "2", fill: "#6d7681" }],
    ["rect", { x: "52", y: "20", width: "24", height: "12", rx: "2", fill: "#ffffff" }],
    ["rect", { x: "16", y: "30", width: "3", height: "28", fill: "#23262b" }],
    ["circle", { cx: "17.5", cy: "28", r: "4", fill: "#ffb066" }],
    ["rect", { x: "120", y: "30", width: "3", height: "28", fill: "#23262b" }],
    ["circle", { cx: "121.5", cy: "28", r: "4", fill: "#e8f4ff" }],
    ["rect", { x: "40", y: "62", width: "12", height: "12", fill: "#c9cdd4" }],
    ["rect", { x: "58", y: "62", width: "12", height: "12", fill: "#8a2f2f" }],
    ["rect", { x: "76", y: "62", width: "12", height: "12", fill: "#9fc6cf" }],
  ],
};


function synchronousBuilder(createSteps) {
  return (context) => {
    for (const progress of createSteps(context)) {                                 }
  };
}

export async function applyTemplateCooperatively(dataModel, id, options = {}) {
  const template = getTemplate(id);
  const workspace = dataModel && getService(dataModel, "Workspace");
  if (!template || !workspace) throw new Error("The requested template is unavailable.");

  const buildSteps = template.steps({ dm: dataModel, ws: workspace });
  await runCooperativeWork((function* () {
    let completedWorkUnits = 0;
    for (const checkpoint of buildSteps) {
      completedWorkUnits += 1;
      yield Math.min(0.99, completedWorkUnits / template.workUnits);
    }
  })(), options);
  options.reportProgress?.(1);
  return true;
}

export const TEMPLATES = Object.freeze([
  Object.freeze({ id: "baseplate", title: "Baseplate", desc: "Comece do zero com uma base plana gigante.", art: ART.baseplate, build: synchronousBuilder(buildBaseplate), steps: buildBaseplate, workUnits: 1 }),
  Object.freeze({ id: "classic-baseplate", title: "Classic Baseplate", desc: "O visual cl\u00e1ssico do Studio, com studs.", art: ART.classic, build: synchronousBuilder(buildClassicBaseplate), steps: buildClassicBaseplate, workUnits: 1 }),
  Object.freeze({ id: "flat-terrain", title: "Flat Terrain", desc: "Campo de Terrain real com colinas suaves e um lago.", art: ART.flat, build: synchronousBuilder(buildFlatTerrain), steps: buildFlatTerrain, workUnits: 160 }),
  Object.freeze({ id: "village", title: "Village", desc: "Vila com pra\u00e7a, chafariz, casas e \u00e1rvores prontas para editar.", art: ART.village, build: synchronousBuilder(buildVillage), steps: buildVillage, workUnits: 101 }),
  Object.freeze({ id: "obby", title: "Obby", desc: "Obby com 3 etapas, checkpoints, lava e p\u00f3dio de chegada.", art: ART.obby, build: synchronousBuilder(buildObby), steps: buildObby, workUnits: 31 }),
  Object.freeze({ id: "racing", title: "Racing", desc: "Circuito fechado com largada, zebras, boxes e karts dirig\u00edveis.", art: ART.racing, build: synchronousBuilder(buildRacing), steps: buildRacing, workUnits: 154 }),
  Object.freeze({ id: "realistic-showcase", title: "Realistic Showcase", desc: "Vitrine do plano de ilumina\u00e7\u00e3o: Realistic + AgX, rua fotom\u00e9trica s\u00f3dio/LED/vela, softbox RectLight, piso espelho e nuvens.", art: ART.showcase, build: synchronousBuilder(buildRealisticShowcase), steps: buildRealisticShowcase, workUnits: 13 }),
]);

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

export function applyTemplate(dataModel, id) {
  const template = getTemplate(id);
  if (!template || !dataModel) return false;
  const ws = getService(dataModel, "Workspace");
  if (!ws) return false;
  try {
    template.build({ dm: dataModel, ws });
    return true;
  } catch (e) {
    logger.error("Templates: falha ao gerar template \"" + id + "\": " + ((e && e.message) || e), { source: "Studio" });
    return false;
  }
}

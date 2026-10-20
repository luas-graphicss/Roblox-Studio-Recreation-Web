export const PART_MASS_VERSION = "basepart-members-1";


export const PART_MASS_MEMBERS = ["Reflectance", "GetMass", "Resize"];


export const MIN_PART_SIZE = 0.05;


export function clampReflectance(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}


export const MATERIAL_DENSITY = {
  Plastic: 0.7,
  SmoothPlastic: 0.7,
  Neon: 0.7,
  Wood: 0.35,
  WoodPlanks: 0.35,
  Marble: 2.563,
  Slate: 2.691,
  Concrete: 2.403,
  Granite: 2.691,
  Brick: 1.922,
  Pebble: 2.403,
  Cobblestone: 2.691,
  Rock: 2.691,
  Sandstone: 2.691,
  Basalt: 2.691,
  CrackedLava: 2.691,
  Limestone: 2.691,
  Pavement: 2.691,
  CorrodedMetal: 7.85,
  DiamondPlate: 7.85,
  Foil: 2.7,
  Metal: 7.85,
  Grass: 0.9,
  LeafyGrass: 0.9,
  Sand: 1.602,
  Fabric: 0.7,
  Snow: 0.9,
  Mud: 0.9,
  Ground: 0.9,
  Asphalt: 2.36,
  Salt: 2.165,
  Ice: 0.919,
  Glacier: 0.919,
  Glass: 2.403,
  ForceField: 2.403,
  Cardboard: 0.7,
  Carpet: 1.1,
  CeramicTiles: 2.4,
  ClayRoofTiles: 2,
  Leather: 0.86,
  Plaster: 2.2,
  Rubber: 1.3,
  RoofShingles: 2.36,
  Air: 0.01,
  Water: 1,
};


function toFiniteNumber(value, fallback = 0) {
  const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readVec3(value) {
  if (Array.isArray(value)) {
    return {
      x: toFiniteNumber(value[0]),
      y: toFiniteNumber(value[1]),
      z: toFiniteNumber(value[2]),
    };
  }
  if (value && typeof value === "object") {
    return {
      x: toFiniteNumber(value.x !== undefined ? value.x : value.X),
      y: toFiniteNumber(value.y !== undefined ? value.y : value.Y),
      z: toFiniteNumber(value.z !== undefined ? value.z : value.Z),
    };
  }
  return { x: 0, y: 0, z: 0 };
}


export function densityFor(material) {
  if (typeof material === "string") {
    const key = material.trim();
    if (typeof MATERIAL_DENSITY[key] === "number") return MATERIAL_DENSITY[key];
    if (key.indexOf("Enum.Material.") === 0) {
      const short = key.slice("Enum.Material.".length);
      if (typeof MATERIAL_DENSITY[short] === "number") return MATERIAL_DENSITY[short];
    }
  } else if (material && typeof material === "object") {
    const name = material.Name !== undefined ? material.Name : material.name;
    if (typeof name === "string" && typeof MATERIAL_DENSITY[name] === "number") {
      return MATERIAL_DENSITY[name];
    }
  }
  return MATERIAL_DENSITY.Plastic;       
}


const SHAPE_BY_CLASS = {
  WedgePart: "Wedge",
  CornerWedgePart: "CornerWedge",
  TrussPart: "Truss",
};

export function partVolume(input) {
  const opts = input || {};
  const s = readVec3(opts.size);
  const box = Math.abs(s.x * s.y * s.z);
  const cls = typeof opts.className === "string" ? opts.className : "";


  if (
    cls === "MeshPart" ||
    cls === "UnionOperation" ||
    cls === "NegateOperation" ||
    cls === "IntersectOperation"
  ) {
    const real = solidVolume({ size: opts.size, solid: opts.solid });
    return real !== null ? real : box;
  }

  let shape = typeof opts.shape === "string" && opts.shape ? opts.shape : SHAPE_BY_CLASS[cls] || "Block";
  if (shape.indexOf("Enum.PartType.") === 0) shape = shape.slice("Enum.PartType.".length);

  switch (shape) {
    case "Ball":
      return (Math.PI / 6) * box;
    case "Cylinder":

      return (Math.PI / 4) * box;
    case "Wedge":
      return 0.5 * box;
    case "CornerWedge":


      return box / 3;
    case "Block":
    case "Truss":
    default:
      return box;
  }
}


export const VOLUME_SLACK = 0.05;

function positiveOrNull(n) {
  return Number.isFinite(n) && n > 0 ? n : null;
}


export function meshSoupVolume(positions) {
  if (!positions || typeof positions.length !== "number") return null;
  const len = Math.floor(positions.length);
  if (len < 36 || len % 9 !== 0) return null;
  let six = 0;
  for (let i = 0; i < len; i += 9) {
    const ax = Number(positions[i]), ay = Number(positions[i + 1]), az = Number(positions[i + 2]);
    const bx = Number(positions[i + 3]), by = Number(positions[i + 4]), bz = Number(positions[i + 5]);
    const cx = Number(positions[i + 6]), cy = Number(positions[i + 7]), cz = Number(positions[i + 8]);
    if (
      !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) ||
      !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz) ||
      !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)
    ) {
      return null;
    }
    six += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return positiveOrNull(Math.abs(six) / 6);
}


export function hullVolume(hull) {
  if (!hull || !Array.isArray(hull.vertices) || !Array.isArray(hull.faces)) return null;
  const verts = hull.vertices;
  if (verts.length < 4 || hull.faces.length < 4) return null;
  for (const v of verts) {
    if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return null;
  }
  let six = 0;
  for (const face of hull.faces) {
    if (!Array.isArray(face) || face.length < 3) return null;
    const a = verts[face[0]];
    if (!a) return null;
    for (let k = 1; k + 1 < face.length; k += 1) {
      const b = verts[face[k]];
      const c = verts[face[k + 1]];
      if (!b || !c) return null;
      six += a.x * (b.y * c.z - b.z * c.y) + a.y * (b.z * c.x - b.x * c.z) + a.z * (b.x * c.y - b.y * c.x);
    }
  }
  return positiveOrNull(Math.abs(six) / 6);
}


function normalizedBoxesVolume(boxes) {
  if (!Array.isArray(boxes) || boxes.length === 0) return null;
  let sum = 0;
  for (const b of boxes) {
    const h = b && b.h;
    if (!h || !Number.isFinite(h.x) || !Number.isFinite(h.y) || !Number.isFinite(h.z)) return null;
    if (h.x <= 0 || h.y <= 0 || h.z <= 0) return null;
    sum += 8 * h.x * h.y * h.z;
  }
  return positiveOrNull(sum);
}


function baseVolumeScale(size, baseSize) {
  if (baseSize == null) return 1;
  const s = readVec3(size);
  const b = readVec3(baseSize);
  if (!(b.x > 0) || !(b.y > 0) || !(b.z > 0)) return null;
  return (Math.abs(s.x) / b.x) * (Math.abs(s.y) / b.y) * (Math.abs(s.z) / b.z);
}


export function solidVolume(input) {
  const opts = input || {};
  const solid = opts.solid;
  if (!solid || typeof solid !== "object") return null;
  const s = readVec3(opts.size);
  const boxVol = Math.abs(s.x * s.y * s.z);
  if (!(boxVol > 0)) return null;

  const accept = (raw) => {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    if (raw > boxVol * (1 + VOLUME_SLACK)) return null;
    return Math.min(raw, boxVol);
  };

  const scale = baseVolumeScale(opts.size, solid.baseSize);

  if (scale !== null && Number.isFinite(solid.volume) && solid.volume > 0) {
    const v = accept(solid.volume * scale);
    if (v !== null) return v;
  }

  if (scale !== null && solid.positions != null) {
    const raw = meshSoupVolume(solid.positions);
    if (raw !== null) {
      const v = accept(raw * scale);
      if (v !== null) return v;
    }
  }


  if (Number.isFinite(solid.normalizedVolume) && solid.normalizedVolume > 0) {
    const v = accept(solid.normalizedVolume * boxVol);
    if (v !== null) return v;
  }

  const fromBoxes = normalizedBoxesVolume(solid.normalizedBoxes);
  if (fromBoxes !== null) {
    const v = accept(fromBoxes * boxVol);
    if (v !== null) return v;
  }

  const fromHull = hullVolume(solid.normalizedHull);
  if (fromHull !== null) {
    const v = accept(fromHull * boxVol);
    if (v !== null) return v;
  }
  return null;
}


export function partMass(input) {
  const opts = input || {};
  return (
    partVolume({ shape: opts.shape, className: opts.className, size: opts.size, solid: opts.solid }) *
    densityFor(opts.material)
  );
}


const NORMAL_AXES = ["x", "y", "z", "x", "y", "z"];
const NORMAL_SIGNS = [1, 1, 1, -1, -1, -1];
const NORMAL_ID_BY_NAME = { Right: 0, Top: 1, Back: 2, Left: 3, Bottom: 4, Front: 5 };

export function resizePart(input) {
  const opts = input || {};
  const s = readVec3(opts.size);
  const pos = readVec3(opts.position);
  const unchanged = (reason) => ({
    ok: false,
    size: { x: s.x, y: s.y, z: s.z },
    position: { x: pos.x, y: pos.y, z: pos.z },
    reason,
  });

  let n = opts.normalId;
  if (typeof n === "string") {
    const name = n.indexOf("Enum.NormalId.") === 0 ? n.slice("Enum.NormalId.".length) : n;
    n = NORMAL_ID_BY_NAME[name] !== undefined ? NORMAL_ID_BY_NAME[name] : Number(name);
  }
  n = Number(n);
  if (!Number.isInteger(n) || n < 0 || n > 5) {
    return unchanged("normalId inválido (esperado inteiro 0..5 ou nome de Enum.NormalId)");
  }

  const d = Number(opts.delta);
  if (!Number.isFinite(d)) {
    return unchanged("delta inválido (precisa ser número finito)");
  }

  const axis = NORMAL_AXES[n];
  const sign = NORMAL_SIGNS[n];
  const nextLen = s[axis] + d;
  if (!Number.isFinite(nextLen) || nextLen < MIN_PART_SIZE) {
    return unchanged(
      "resize violaria MIN_PART_SIZE=" + MIN_PART_SIZE + " no eixo " + axis + " (resultado " + nextLen + ")"
    );
  }

  const nextSize = { x: s.x, y: s.y, z: s.z };
  nextSize[axis] = nextLen;
  const nextPos = { x: pos.x, y: pos.y, z: pos.z };
  nextPos[axis] = pos[axis] + sign * (d / 2);


  return { ok: true, size: nextSize, position: nextPos };
}

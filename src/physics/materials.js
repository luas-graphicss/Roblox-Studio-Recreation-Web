import { sanitizeNum } from "./mathUtils.js";


import { solidVolume } from "../runtime/partMass.js";


import { meshRegistry } from "../assets/meshRegistry.js";


const TABLE = Object.freeze({
  Plastic: { density: 0.7, friction: 0.3, elasticity: 0.5 },
  SmoothPlastic: { density: 0.7, friction: 0.2, elasticity: 0.5 },
  Wood: { density: 0.35, friction: 0.48, elasticity: 0.2 },
  WoodPlanks: { density: 0.35, friction: 0.48, elasticity: 0.2 },
  Slate: { density: 2.69, friction: 0.4, elasticity: 0.2 },
  Concrete: { density: 2.4, friction: 0.7, elasticity: 0.2 },
  Brick: { density: 1.92, friction: 0.8, elasticity: 0.15 },
  Cobblestone: { density: 2.69, friction: 0.5, elasticity: 0.17 },
  Metal: { density: 7.85, friction: 0.4, elasticity: 0.25 },
  CorrodedMetal: { density: 7.85, friction: 0.7, elasticity: 0.2 },
  DiamondPlate: { density: 7.85, friction: 0.35, elasticity: 0.25 },
  Foil: { density: 2.7, friction: 0.4, elasticity: 0.25 },
  Grass: { density: 0.9, friction: 0.4, elasticity: 0.1 },
  Sand: { density: 1.6, friction: 0.5, elasticity: 0.05 },
  Fabric: { density: 0.7, friction: 0.35, elasticity: 0.05 },
  Granite: { density: 2.69, friction: 0.4, elasticity: 0.2 },
  Marble: { density: 2.56, friction: 0.2, elasticity: 0.17 },
  Pebble: { density: 2.4, friction: 0.4, elasticity: 0.17 },
  Ice: { density: 0.92, friction: 0.02, elasticity: 0.15 },
  Glass: { density: 2.4, friction: 0.25, elasticity: 0.2 },
  Neon: { density: 0.7, friction: 0.3, elasticity: 0.2 },
  Glacier: { density: 0.92, friction: 0.05, elasticity: 0.15 },

  Rock: { density: 2.69, friction: 0.5, elasticity: 0.17 },
  Sandstone: { density: 2.69, friction: 0.5, elasticity: 0.15 },
  Basalt: { density: 2.69, friction: 0.7, elasticity: 0.15 },
  CrackedLava: { density: 2.69, friction: 0.65, elasticity: 0.15 },
  Limestone: { density: 2.69, friction: 0.5, elasticity: 0.15 },
  Pavement: { density: 2.69, friction: 0.5, elasticity: 0.17 },
  Mud: { density: 0.9, friction: 0.9, elasticity: 0.07 },
  Ground: { density: 0.9, friction: 0.45, elasticity: 0.1 },
  Asphalt: { density: 2.36, friction: 0.8, elasticity: 0.2 },
  Snow: { density: 0.9, friction: 0.3, elasticity: 0.03 },
  Salt: { density: 2.16, friction: 0.5, elasticity: 0.05 },
  Cardboard: { density: 0.7, friction: 0.5, elasticity: 0.05 },
  Carpet: { density: 1.1, friction: 0.4, elasticity: 0.25 },
  Plaster: { density: 0.75, friction: 0.6, elasticity: 0.2 },
  Rubber: { density: 1.3, friction: 1.5, elasticity: 0.95 },
  Leather: { density: 0.86, friction: 0.35, elasticity: 0.25 },
});

const DEFAULT = TABLE.Plastic;


const DENSITY_MIN = 0.01;
const DENSITY_MAX = 100;
const FRICTION_MIN = 0;
const FRICTION_MAX = 2;
const ELASTICITY_MIN = 0;
const ELASTICITY_MAX = 1;

function clamp(v, lo, hi, fb) {
  const n = sanitizeNum(v, fb);
  return Math.min(hi, Math.max(lo, n));
}

export function getMaterialProperties(materialName) {
  return TABLE[materialName] || DEFAULT;
}


export function getPhysicalProperties(part) {
  const mat = part.hasProperty("Material") ? part.getProperty("Material") : "Plastic";
  const base = getMaterialProperties(mat);
  const custom = part.hasProperty("CustomPhysicalProperties") &&
    part.getProperty("CustomPhysicalProperties") === true;
  if (!custom) {
    return {
      density: base.density,
      friction: base.friction,
      elasticity: base.elasticity,
      frictionWeight: 1,
      elasticityWeight: 1,
    };
  }
  return {
    density: clamp(part.getProperty("CustomDensity"), DENSITY_MIN, DENSITY_MAX, base.density),
    friction: clamp(part.getProperty("CustomFriction"), FRICTION_MIN, FRICTION_MAX, base.friction),
    elasticity: clamp(part.getProperty("CustomElasticity"), ELASTICITY_MIN, ELASTICITY_MAX, base.elasticity),
    frictionWeight: clamp(part.getProperty("CustomFrictionWeight"), 0, 100, 1),
    elasticityWeight: clamp(part.getProperty("CustomElasticityWeight"), 0, 100, 1),
  };
}


const CSG_CLASSES = Object.freeze({
  UnionOperation: true,
  NegateOperation: true,
  IntersectOperation: true,
});

export function getSolidEvidence(part) {
  const cls = part ? part.className : "";
  if (CSG_CLASSES[cls] === true) {
    const csg = part._csgMesh && typeof part._csgMesh === "object" ? part._csgMesh : null;
    const hasRecipe = Array.isArray(part._sourceParts) && part._sourceParts.length > 0;
    const imp =
      !hasRecipe &&
      part._importedSolid &&
      typeof part._importedSolid === "object" &&
      part._importedSolid.boxOnly !== true
        ? part._importedSolid
        : null;
    if (!csg && !imp) return null;
    return {
      volume: imp ? imp.volume : null,
      positions: csg ? csg.positions : null,
      baseSize: (csg && csg.baseSize) || (imp && imp.baseSize) || null,
    };
  }
  if (cls === "MeshPart") {
    const fidelity = part.hasProperty("CollisionFidelity")
      ? part.getProperty("CollisionFidelity")
      : "Default";
    if (fidelity === "Box") return null;
    const meshId = part.hasProperty("MeshId") ? part.getProperty("MeshId") : "";
    const info = meshId ? meshRegistry.get(meshId) : null;
    const col = info && info.collision ? info.collision : null;
    if (!col) return null;
    const wantDecomp = fidelity === "Default" || fidelity === "PreciseConvexDecomposition";
    return {


      normalizedVolume:
        wantDecomp && Number.isFinite(col.volume) && col.volume > 0 ? col.volume : null,
      normalizedBoxes: wantDecomp && Array.isArray(col.boxes) && col.boxes.length ? col.boxes : null,
      normalizedHull: col.hull || null,
    };
  }
  return null;
}


export function getPartVolume(part) {
  const s = part.getProperty("Size") || { x: 1, y: 1, z: 1 };
  const x = Math.max(0.05, sanitizeNum(s.x, 1));
  const y = Math.max(0.05, sanitizeNum(s.y, 1));
  const z = Math.max(0.05, sanitizeNum(s.z, 1));
  const cls = part ? part.className : "";
  if (cls === "MeshPart" || CSG_CLASSES[cls] === true) {
    const real = solidVolume({ size: { x, y, z }, solid: getSolidEvidence(part) });
    if (real !== null) return real;                                               
    return x * y * z;                                      
  }
  const shape = part.hasProperty("Shape") ? part.getProperty("Shape") : "Block";
  switch (shape) {
    case "Ball": {
      const r = Math.min(x, y, z) / 2;
      return (4 / 3) * Math.PI * r * r * r;
    }
    case "Cylinder": {

      const r = Math.min(y, z) / 2;
      return Math.PI * r * r * x;
    }
    case "Wedge":
      return (x * y * z) / 2;
    case "CornerWedge":
      return (x * y * z) / 3;
    default:
      return x * y * z;
  }
}


export function getPartMass(part) {
  if (part.hasProperty("Massless") && part.getProperty("Massless") === true) return 0;
  const props = getPhysicalProperties(part);
  return getPartVolume(part) * props.density;
}

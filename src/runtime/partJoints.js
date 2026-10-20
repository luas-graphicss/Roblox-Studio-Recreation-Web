export const PART_JOINTS_VERSION = "basepart-members-1";


export const PART_JOINTS_MEMBERS = [
  "BreakJoints",
  "MakeJoints",
  "GetNetworkOwner",
  "SetNetworkOwner",
];


export const JOINT_CLASSES = ["Weld", "WeldConstraint", "Motor6D", "Snap", "Rotate", "Glue"];


export const JOINABLE_SURFACES = new Set(["Weld", "Glue", "Studs", "Inlet", "Universal"]);


export function createNetworkOwnershipStore() {
  const owners = new Map();
  return {
    get(part) {
      const owner = owners.get(part);
      return owner === undefined ? null : owner;
    },
    set(part, playerOrNull) {
      if (playerOrNull === null || playerOrNull === undefined) owners.delete(part);
      else owners.set(part, playerOrNull);
    },
    clear(part) {
      owners.delete(part);
    },
  };
}


function classNameOf(inst, api) {
  if (!inst) return "";
  if (api && typeof api.getProperty === "function") {
    const viaApi = api.getProperty(inst, "ClassName");
    if (typeof viaApi === "string" && viaApi) return viaApi;
  }
  if (typeof inst.ClassName === "string") return inst.ClassName;
  if (typeof inst.className === "string") return inst.className;
  return "";
}

function allInstances(api) {
  if (!api || typeof api.getDescendants !== "function") return [];
  const all = api.getDescendants();
  return Array.isArray(all) ? all : [];
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function readVec3(value) {
  if (Array.isArray(value)) {
    return { x: toFiniteNumber(value[0]), y: toFiniteNumber(value[1]), z: toFiniteNumber(value[2]) };
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

function surfaceName(value) {
  if (typeof value === "string") {
    return value.indexOf("Enum.SurfaceType.") === 0 ? value.slice("Enum.SurfaceType.".length) : value;
  }
  if (value && typeof value === "object") {
    const name = value.Name !== undefined ? value.Name : value.name;
    if (typeof name === "string") return name;
  }
  return value === undefined || value === null ? "" : String(value);
}


const FACES_BY_AXIS = {
  x: { positive: "RightSurface", negative: "LeftSurface" },
  y: { positive: "TopSurface", negative: "BottomSurface" },
  z: { positive: "BackSurface", negative: "FrontSurface" },
};


function contactFaces(a, b, api) {
  const pa = readVec3(api.getProperty(a, "Position"));
  const pb = readVec3(api.getProperty(b, "Position"));
  const sa = readVec3(api.getProperty(a, "Size"));
  const sb = readVec3(api.getProperty(b, "Size"));
  let best = null;
  const axes = ["x", "y", "z"];
  for (let i = 0; i < axes.length; i++) {
    const axis = axes[i];
    const d = pb[axis] - pa[axis];
    const flushGap = Math.abs(Math.abs(d) - (sa[axis] + sb[axis]) / 2);                     
    if (!best || flushGap < best.flushGap) {
      best = { axis, flushGap, dir: d >= 0 ? 1 : -1 };
    }
  }
  if (!best) return null;
  const faces = FACES_BY_AXIS[best.axis];
  return best.dir > 0
    ? { faceA: faces.positive, faceB: faces.negative }
    : { faceA: faces.negative, faceB: faces.positive };
}

function jointExistsBetween(joints, a, b, api) {
  for (let i = 0; i < joints.length; i++) {
    const j = joints[i];
    const p0 = api.getProperty(j, "Part0");
    const p1 = api.getProperty(j, "Part1");
    if ((p0 === a && p1 === b) || (p0 === b && p1 === a)) return true;
  }
  return false;
}


export function jointsOf(part, api) {
  if (!part || !api || typeof api.getProperty !== "function") return [];
  const out = [];
  const all = allInstances(api);
  for (let i = 0; i < all.length; i++) {
    const inst = all[i];
    if (!inst || inst === part) continue;
    if (JOINT_CLASSES.indexOf(classNameOf(inst, api)) === -1) continue;
    const p0 = api.getProperty(inst, "Part0");
    const p1 = api.getProperty(inst, "Part1");
    if (p0 === part || p1 === part) out.push(inst);
  }
  return out;
}


export function breakJoints(part, api) {
  let removed = 0;
  if (!part || !api || typeof api.destroy !== "function") return { removed };
  const joints = jointsOf(part, api);
  for (let i = 0; i < joints.length; i++) {
    api.destroy(joints[i]);
    removed += 1;
  }
  return { removed };
}


export function makeJoints(part, api) {
  const pairs = [];
  if (
    !part ||
    !api ||
    typeof api.touchingParts !== "function" ||
    typeof api.createInstance !== "function" ||
    typeof api.getProperty !== "function"
  ) {
    return { created: 0, pairs };
  }

  const touching = api.touchingParts(part);
  if (!Array.isArray(touching) || touching.length === 0) return { created: 0, pairs };

  const knownJoints = jointsOf(part, api);
  const processed = new Set();

  for (let i = 0; i < touching.length; i++) {
    const other = touching[i];
    if (!other || other === part || processed.has(other)) continue;
    processed.add(other);

    if (jointExistsBetween(knownJoints, part, other, api)) continue;                 

    const contact = contactFaces(part, other, api);
    if (!contact) continue;

    const surfA = surfaceName(api.getProperty(part, contact.faceA));
    const surfB = surfaceName(api.getProperty(other, contact.faceB));
    if (!JOINABLE_SURFACES.has(surfA) || !JOINABLE_SURFACES.has(surfB)) continue;

    const weld = api.createInstance("Weld", { Part0: part, Part1: other });
    if (weld) knownJoints.push(weld);
    pairs.push([part, other]);
  }

  return { created: pairs.length, pairs };
}

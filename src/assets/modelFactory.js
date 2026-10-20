const SHAPES = new Set(["Block", "Ball", "Cylinder", "Wedge", "CornerWedge"]);

function part(name, shape, size, pos, color, rot) {
  const out = {
    name: String(name),
    shape: SHAPES.has(shape) ? shape : "Block",
    size: [num(size[0], 1), num(size[1], 1), num(size[2], 1)],
    pos: [num(pos[0], 0), num(pos[1], 0), num(pos[2], 0)],
    color: [clamp01(color[0]), clamp01(color[1]), clamp01(color[2])],
  };


  if (Array.isArray(rot)) out.rot = [num(rot[0], 0), num(rot[1], 0), num(rot[2], 0)];
  return out;
}

function num(v, d) {
  return Number.isFinite(v) ? v : d;
}
function clamp01(v) {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}


function tree(name) {
  return {
    name,
    parts: [
      part("Trunk", "Cylinder", [8, 2, 2], [0, 4, 0], [0.45, 0.3, 0.16], [0, 0, 90]),
      part("Leaves", "Ball", [9, 9, 9], [0, 10.5, 0], [0.2, 0.62, 0.22]),
    ],
  };
}

function car(name) {
  const body = [0.85, 0.13, 0.13];
  const dark = [0.1, 0.1, 0.12];
  return {
    name,
    parts: [
      part("Body", "Block", [10, 2, 5], [0, 2.5, 0], body),
      part("Cabin", "Block", [5, 2, 4.4], [-0.5, 4.5, 0], [0.9, 0.4, 0.4]),


      part("WheelFL", "Cylinder", [1.2, 1.6, 1.6], [3, 0.8, 2.4], dark, [0, 90, 0]),
      part("WheelFR", "Cylinder", [1.2, 1.6, 1.6], [3, 0.8, -2.4], dark, [0, 90, 0]),
      part("WheelRL", "Cylinder", [1.2, 1.6, 1.6], [-3, 0.8, 2.4], dark, [0, 90, 0]),
      part("WheelRR", "Cylinder", [1.2, 1.6, 1.6], [-3, 0.8, -2.4], dark, [0, 90, 0]),
    ],
  };
}

function house(name) {
  return {
    name,
    parts: [
      part("Walls", "Block", [10, 7, 9], [0, 3.5, 0], [0.86, 0.8, 0.66]),
      part("Roof", "Wedge", [11, 4, 10], [0, 9, 0], [0.55, 0.2, 0.16]),
      part("Door", "Block", [0.4, 3.5, 2], [5, 1.75, 0], [0.36, 0.24, 0.14]),
    ],
  };
}

function tower(name) {
  return {
    name,
    parts: [
      part("Base", "Cylinder", [4, 6, 6], [0, 2, 0], [0.6, 0.6, 0.64], [0, 0, 90]),
      part("Shaft", "Cylinder", [10, 4, 4], [0, 9, 0], [0.72, 0.72, 0.76], [0, 0, 90]),
      part("Top", "Ball", [5, 5, 5], [0, 16, 0], [0.95, 0.85, 0.3]),
    ],
  };
}

function bridge(name) {
  return {
    name,
    parts: [
      part("Deck", "Block", [18, 1, 5], [0, 4, 0], [0.5, 0.34, 0.2]),
      part("PillarL", "Block", [1.5, 4, 5], [-7, 2, 0], [0.4, 0.28, 0.16]),
      part("PillarR", "Block", [1.5, 4, 5], [7, 2, 0], [0.4, 0.28, 0.16]),


      part("RailL", "Block", [18, 1.4, 0.4], [0, 5.2, 2.3], [0.46, 0.32, 0.18]),
      part("RailR", "Block", [18, 1.4, 0.4], [0, 5.2, -2.3], [0.46, 0.32, 0.18]),
    ],
  };
}

function crate(name) {
  return {
    name,
    parts: [
      part("Box", "Block", [4, 4, 4], [0, 2, 0], [0.6, 0.42, 0.22]),
      part("Lid", "Block", [4.3, 0.6, 4.3], [0, 4.3, 0], [0.5, 0.34, 0.18]),
    ],
  };
}

function rock(name) {
  return {
    name,
    parts: [

      part("Rock", "Ball", [6, 4.5, 5.5], [0, 2.25, 0], [0.45, 0.46, 0.48]),
      part("Chip", "Ball", [2.5, 2, 2.5], [2.5, 1, 1.5], [0.5, 0.51, 0.53]),
    ],
  };
}

function character(name) {
  const skin = [0.95, 0.78, 0.2];
  return {
    name,
    parts: [

      part("LegL", "Block", [1.4, 4, 1.4], [1, 2, 0], [0.18, 0.18, 0.2]),
      part("LegR", "Block", [1.4, 4, 1.4], [-1, 2, 0], [0.18, 0.18, 0.2]),
      part("Torso", "Block", [4, 4, 2], [0, 6, 0], [0.2, 0.42, 0.75]),
      part("Head", "Ball", [2.4, 2.4, 2.4], [0, 9.2, 0], skin),
      part("ArmL", "Block", [1, 4, 1], [2.5, 6, 0], skin),
      part("ArmR", "Block", [1, 4, 1], [-2.5, 6, 0], skin),
    ],
  };
}

function generic(name) {
  return {
    name,
    parts: [
      part("Base", "Block", [5, 1, 5], [0, 0.5, 0], [0.55, 0.55, 0.6]),
      part("Body", "Block", [3, 3, 3], [0, 2.5, 0], [0.3, 0.55, 0.85]),
      part("Top", "Ball", [2, 2, 2], [0, 5, 0], [0.95, 0.55, 0.2]),
    ],
  };
}

const BUILDERS = {
  tree,
  car,
  house,
  tower,
  bridge,
  crate,
  rock,
  character,
  default: generic,
};


export function deriveModelKind(name) {
  const n = String(name || "").toLowerCase();
  if (/tree|oak|pine|forest/.test(n)) return "tree";
  if (/car|kart|vehicle|truck|racer|racing/.test(n)) return "car";
  if (/house|castle|cabin|cottage|hut|home/.test(n)) return "house";
  if (/tower|lighthouse|spire|rocket/.test(n)) return "tower";
  if (/bridge/.test(n)) return "bridge";
  if (/crate|chest|box|barrel/.test(n)) return "crate";
  if (/rock|stone|mountain|volcano|boulder/.test(n)) return "rock";
  if (/robot|dragon|snowman|scarecrow|guard|character|knight|zombie/.test(n))
    return "character";
  return "default";
}

export function modelSpecFor(asset) {
  const name = (asset && asset.name) || "Model";
  const kind = (asset && asset.modelKind) || deriveModelKind(name);
  const build = BUILDERS[kind] || BUILDERS.default;
  const spec = build(name);

  if (spec.parts.length > 32) spec.parts = spec.parts.slice(0, 32);
  return spec;
}

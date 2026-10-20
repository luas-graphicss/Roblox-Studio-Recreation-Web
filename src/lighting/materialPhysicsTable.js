export const RENDER_STYLES = Object.freeze(["Classic", "Realistic"]);


export function resolveRenderStyle(raw) {
  return raw === "Realistic" ? "Realistic" : "Classic";
}

const F = Object.freeze;


export const MATERIAL_PHYSICS = F({
  Plastic:       F({ rough: 0.72, metal: 0, f0: 0.040, ns: 1, ao: 1 }),
  SmoothPlastic: F({ rough: 0.32, metal: 0, f0: 0.045, ns: 1, ao: 1 }),
  Neon:          F({ rough: 0.25, metal: 0, f0: 0.040, ns: 1, ao: 1 }),
  Wood:          F({ rough: 0.68, metal: 0, f0: 0.035, ns: 1, ao: 1 }),
  WoodPlanks:    F({ rough: 0.74, metal: 0, f0: 0.035, ns: 1, ao: 1 }),
  Marble:        F({ rough: 0.22, metal: 0, f0: 0.055, ns: 1, ao: 1 }),
  Slate:         F({ rough: 0.82, metal: 0, f0: 0.040, ns: 1, ao: 1 }),
  Concrete:      F({ rough: 0.90, metal: 0, f0: 0.037, ns: 1, ao: 1 }),
  Granite:       F({ rough: 0.55, metal: 0, f0: 0.050, ns: 1, ao: 1 }),
  Brick:         F({ rough: 0.94, metal: 0, f0: 0.035, ns: 1, ao: 1 }),
  Pebble:        F({ rough: 0.88, metal: 0, f0: 0.040, ns: 1, ao: 1 }),
  Cobblestone:   F({ rough: 0.90, metal: 0, f0: 0.038, ns: 1, ao: 1 }),
  Rock:          F({ rough: 0.92, metal: 0, f0: 0.040, ns: 1, ao: 1 }),
  Sandstone:     F({ rough: 0.93, metal: 0, f0: 0.035, ns: 1, ao: 1 }),
  Basalt:        F({ rough: 0.86, metal: 0, f0: 0.045, ns: 1, ao: 1 }),
  CrackedLava:   F({ rough: 0.78, metal: 0, f0: 0.050, ns: 1, ao: 1 }),
  Limestone:     F({ rough: 0.91, metal: 0, f0: 0.036, ns: 1, ao: 1 }),
  Pavement:      F({ rough: 0.89, metal: 0, f0: 0.038, ns: 1, ao: 1 }),

  CorrodedMetal: F({ rough: 0.85, metal: 1, f0: 0.040, ns: 1, ao: 1 }),
  DiamondPlate:  F({ rough: 0.32, metal: 1, f0: 0.040, ns: 1, ao: 1 }),
  Foil:          F({ rough: 0.18, metal: 1, f0: 0.040, ns: 1, ao: 1 }),
  Metal:         F({ rough: 0.45, metal: 1, f0: 0.040, ns: 1, ao: 1, flags: F({ aniso: true }) }),
  Grass:         F({ rough: 0.95, metal: 0, f0: 0.030, ns: 1, ao: 1, flags: F({ sheen: true }) }),
  Sand:          F({ rough: 0.96, metal: 0, f0: 0.030, ns: 1, ao: 1 }),
  Fabric:        F({ rough: 0.97, metal: 0, f0: 0.028, ns: 1, ao: 1, flags: F({ sheen: true }) }),
  Glass:         F({ rough: 0.06, metal: 0, f0: 0.050, ns: 1, ao: 1, flags: F({ transmission: true }) }),
  Ice:           F({ rough: 0.14, metal: 0, f0: 0.045, ns: 1, ao: 1, flags: F({ transmission: true }) }),
  Mud:           F({ rough: 0.82, metal: 0, f0: 0.045, ns: 1, ao: 1 }),
  Ground:        F({ rough: 0.94, metal: 0, f0: 0.032, ns: 1, ao: 1 }),
  Asphalt:       F({ rough: 0.90, metal: 0, f0: 0.040, ns: 1, ao: 1 }),
  Snow:          F({ rough: 0.85, metal: 0, f0: 0.040, ns: 1, ao: 1 }),
  Glacier:       F({ rough: 0.28, metal: 0, f0: 0.045, ns: 1, ao: 1, flags: F({ transmission: true }) }),
  Salt:          F({ rough: 0.90, metal: 0, f0: 0.035, ns: 1, ao: 1 }),
  Cardboard:     F({ rough: 0.95, metal: 0, f0: 0.030, ns: 1, ao: 1 }),
  Carpet:        F({ rough: 0.98, metal: 0, f0: 0.025, ns: 1, ao: 1, flags: F({ sheen: true }) }),
  Plaster:       F({ rough: 0.93, metal: 0, f0: 0.034, ns: 1, ao: 1 }),
  Rubber:        F({ rough: 0.87, metal: 0, f0: 0.045, ns: 1, ao: 1 }),
  Leather:       F({ rough: 0.62, metal: 0, f0: 0.040, ns: 1, ao: 1, flags: F({ coat: true }) }),
});


export function physicsFor(name) {
  return MATERIAL_PHYSICS[name] || MATERIAL_PHYSICS.Plastic;
}


export function hasMaterialPhysics(name) {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(MATERIAL_PHYSICS, name);
}


export function standardPhysicsFor(name, style) {
  if (resolveRenderStyle(style) !== "Realistic") return null;
  const p = physicsFor(name);
  return { roughness: p.rough, metalness: p.metal };
}


export function phongApproxFor(name, style, specScale) {
  if (resolveRenderStyle(style) !== "Realistic") return null;
  const p = physicsFor(name);
  const s = Number.isFinite(specScale) ? Math.min(1, Math.max(0, specScale)) : 1;
  const inv = 1 - p.rough;
  const shininess = Math.min(512, Math.max(4, 4 + 508 * inv * inv));
  const specular = p.metal >= 0.5
    ? Math.min(1, (0.3 + 0.45 * inv) * (0.4 + 0.6 * s))
    : Math.min(1, p.f0 * (2.2 + 2.8 * s));
  return { shininess, specular };
}


export function validateMaterialPhysicsTable() {
  const errors = [];
  if (!Object.isFrozen(MATERIAL_PHYSICS)) errors.push("tabela não congelada");
  for (const name of Object.keys(MATERIAL_PHYSICS)) {
    const p = MATERIAL_PHYSICS[name];
    if (!Object.isFrozen(p)) errors.push(name + ": entrada não congelada");
    if (!(p.rough >= 0.04 && p.rough <= 1)) errors.push(name + ": rough fora de [0.04,1]");
    if (!(p.metal === 0 || p.metal === 1)) errors.push(name + ": metal deve ser 0 ou 1");
    if (!(p.f0 >= 0.02 && p.f0 <= 0.08)) errors.push(name + ": f0 fora de [0.02,0.08]");
    if (!(p.ns >= 0 && p.ns <= 2)) errors.push(name + ": ns fora de [0,2]");
    if (!(p.ao >= 0 && p.ao <= 1)) errors.push(name + ": ao fora de [0,1]");
  }
  return errors;
}


let activeStyle = "Classic";
const tracked = new Set();                          

const makeRef =
  typeof WeakRef === "function"
    ? (m) => new WeakRef(m)
    : (m) => ({ deref: () => m });                                  

export function setActiveRenderStyle(raw) {
  const style = resolveRenderStyle(raw);
  const changed = style !== activeStyle;
  activeStyle = style;
  return { style, changed };
}

export function activeRenderStyle() {
  return activeStyle;
}

function track(mat, ud) {


  if (ud.__rswPhysTracked === mat) return;
  ud.__rswPhysTracked = mat;
  tracked.add(makeRef(mat));
}


export function applyStandardPhysics(mat, name, opts = {}) {
  if (!mat) return false;
  const ud = mat.userData || (mat.userData = {});
  if (opts.rebase) delete ud.__rswPhysBase;
  const refl = ud.__rswReflBase && typeof ud.__rswReflBase === "object" ? ud.__rswReflBase : null;
  if (!ud.__rswPhysBase) {
    const src = refl || mat;
    ud.__rswPhysBase = { kind: "standard", roughness: src.roughness, metalness: src.metalness };
  }
  ud.__rswPhys = { name: String(name || "Plastic"), kind: "standard" };
  track(mat, ud);
  const dst = refl || mat;                                                    
  const patch = standardPhysicsFor(ud.__rswPhys.name, activeStyle);
  if (patch) {
    dst.roughness = patch.roughness;
    dst.metalness = patch.metalness;
    return true;
  }
  dst.roughness = ud.__rswPhysBase.roughness;
  dst.metalness = ud.__rswPhysBase.metalness;
  return false;
}


export function applyPhongPhysics(mat, name, opts = {}) {
  if (!mat || !mat.specular || typeof mat.specular.setScalar !== "function") return false;
  const ud = mat.userData || (mat.userData = {});
  if (opts.rebase) delete ud.__rswPhysBase;
  if (!ud.__rswPhysBase) {
    ud.__rswPhysBase = { kind: "phong", shininess: mat.shininess, specular: mat.specular.r };
  }
  const rawS = Number.isFinite(opts.specScale)
    ? opts.specScale
    : ud.__rswPhys && Number.isFinite(ud.__rswPhys.specScale)
      ? ud.__rswPhys.specScale
      : 1;
  ud.__rswPhys = { name: String(name || "Plastic"), kind: "phong", specScale: rawS };
  track(mat, ud);
  const patch = phongApproxFor(ud.__rswPhys.name, activeStyle, rawS);
  if (patch) {
    mat.shininess = patch.shininess;
    mat.specular.setScalar(patch.specular);
    return true;
  }
  mat.shininess = ud.__rswPhysBase.shininess;
  mat.specular.setScalar(ud.__rswPhysBase.specular);
  return false;
}


export function sweepMaterialPhysics() {
  let alive = 0;
  let applied = 0;
  let pruned = 0;
  for (const ref of [...tracked]) {
    const mat = ref.deref();
    const info = mat && mat.userData && mat.userData.__rswPhys;
    if (!info) {
      tracked.delete(ref);
      pruned++;
      continue;
    }
    alive++;
    const on =
      info.kind === "phong"
        ? applyPhongPhysics(mat, info.name, { specScale: info.specScale })
        : applyStandardPhysics(mat, info.name);
    if (on) applied++;
  }
  return { tracked: alive, applied, pruned };
}


export function physicsQaSnapshot() {
  let alive = 0;
  let phong = 0;
  let standard = 0;
  for (const ref of tracked) {
    const mat = ref.deref();
    const info = mat && mat.userData && mat.userData.__rswPhys;
    if (!info) continue;
    alive++;
    if (info.kind === "phong") phong++;
    else standard++;
  }
  return {
    style: activeStyle,
    tableSize: Object.keys(MATERIAL_PHYSICS).length,
    tracked: alive,
    standard,
    phong,
  };
}

if (typeof window !== "undefined") {


  window.__rswMaterialPhysicsQa = {
    get: physicsQaSnapshot,
    sweep: sweepMaterialPhysics,
    applyStandardPhysics,
    applyPhongPhysics,
    phongApproxFor,
    standardPhysicsFor,
    resolveRenderStyle,
    setActiveRenderStyle,
    activeRenderStyle,
    validate: validateMaterialPhysicsTable,
    MATERIAL_PHYSICS,
  };
}


export const MATERIAL_FEATURES = Object.freeze({

	SmoothPlastic: Object.freeze({ coat: 1.0, coatRough: 0.1 }),
	Plastic: Object.freeze({ coat: 0.35, coatRough: 0.22 }),
	Marble: Object.freeze({ coat: 0.3, coatRough: 0.16 }),

	Metal: Object.freeze({ aniso: 0.8, anisoRough: 0.34 }),
	DiamondPlate: Object.freeze({ aniso: 0.45, anisoRough: 0.42 }),
	CorrodedMetal: Object.freeze({ aniso: 0.3, anisoRough: 0.55 }),
	Foil: Object.freeze({ aniso: 0.6, anisoRough: 0.28 }),

	Fabric: Object.freeze({ sheen: 0.9, sheenRough: 0.35 }),
	Carpet: Object.freeze({ sheen: 0.8, sheenRough: 0.55 }),
	Cardboard: Object.freeze({ sheen: 0.25, sheenRough: 0.6 }),

	Grass: Object.freeze({ sss: 0.5, sssBack: 0.35, sssTint: Object.freeze([0.62, 0.9, 0.42]) }),
	Leather: Object.freeze({ sss: 0.35, sssBack: 0.15, sssTint: Object.freeze([0.92, 0.58, 0.42]) }),
	Snow: Object.freeze({ sss: 0.4, sssBack: 0.1, sssTint: Object.freeze([0.8, 0.88, 1.0]) }),
	Ice: Object.freeze({ sss: 0.45, sssBack: 0.5, sssTint: Object.freeze([0.62, 0.82, 1.0]) }),
});


export const MATFEAT_DEFAULTS = Object.freeze({
	coat: 0,
	coatRough: 0.15,
	aniso: 0,
	anisoRough: 0.4,
	sheen: 0,
	sheenRough: 0.4,
	sss: 0,
	sssBack: 0,
	sssTint: Object.freeze([1, 1, 1]),
});


export function featuresForMaterial(name) {
	const row = typeof name === "string" ? MATERIAL_FEATURES[name] : null;
	if (!row) return MATFEAT_DEFAULTS;
	return {
		coat: typeof row.coat === "number" ? row.coat : MATFEAT_DEFAULTS.coat,
		coatRough: typeof row.coatRough === "number" ? row.coatRough : MATFEAT_DEFAULTS.coatRough,
		aniso: typeof row.aniso === "number" ? row.aniso : MATFEAT_DEFAULTS.aniso,
		anisoRough: typeof row.anisoRough === "number" ? row.anisoRough : MATFEAT_DEFAULTS.anisoRough,
		sheen: typeof row.sheen === "number" ? row.sheen : MATFEAT_DEFAULTS.sheen,
		sheenRough: typeof row.sheenRough === "number" ? row.sheenRough : MATFEAT_DEFAULTS.sheenRough,
		sss: typeof row.sss === "number" ? row.sss : MATFEAT_DEFAULTS.sss,
		sssBack: typeof row.sssBack === "number" ? row.sssBack : MATFEAT_DEFAULTS.sssBack,
		sssTint: Array.isArray(row.sssTint) && row.sssTint.length === 3 ? row.sssTint : MATFEAT_DEFAULTS.sssTint,
	};
}


export function hasAnyFeature(f) {
	if (!f) return false;
	return (f.coat || 0) > 0 || (f.aniso || 0) > 0 || (f.sheen || 0) > 0 || (f.sss || 0) > 0;
}

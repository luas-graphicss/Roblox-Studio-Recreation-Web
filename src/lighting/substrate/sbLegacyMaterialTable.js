export const SB_LEGACY_MATERIAL_FALLBACK_NAME = "Plastic"

function createLegacyMaterial(roughness, metalness, dielectricF0, brightness, options = {}) {
	return Object.freeze({
		roughness,
		metalness,
		dielectricF0,
		brightness,
		opacity: options.opacity === undefined ? 1 : options.opacity,
		isEmissive: options.isEmissive === true,
		features: Object.freeze({
			anisotropic: options.anisotropic === true,
			sheen: options.sheen === true,
			coat: options.coat === true,
			transmission: options.transmission === true,
		}),
	})
}

const LEGACY_MATERIALS = Object.freeze({
	Plastic: createLegacyMaterial(0.72, 0, 0.04, 0.92),
	SmoothPlastic: createLegacyMaterial(0.32, 0, 0.045, 0.96),
	Neon: createLegacyMaterial(0.25, 0, 0.04, 1, { isEmissive: true }),
	Wood: createLegacyMaterial(0.68, 0, 0.035, 0.82),
	WoodPlanks: createLegacyMaterial(0.74, 0, 0.035, 0.8),
	Marble: createLegacyMaterial(0.22, 0, 0.055, 0.93),
	Slate: createLegacyMaterial(0.82, 0, 0.04, 0.72),
	Concrete: createLegacyMaterial(0.9, 0, 0.037, 0.85),
	Granite: createLegacyMaterial(0.55, 0, 0.05, 0.78),
	Brick: createLegacyMaterial(0.94, 0, 0.035, 0.8),
	Pebble: createLegacyMaterial(0.88, 0, 0.04, 0.82),
	Cobblestone: createLegacyMaterial(0.9, 0, 0.038, 0.78),
	Rock: createLegacyMaterial(0.92, 0, 0.04, 0.72),
	Sandstone: createLegacyMaterial(0.93, 0, 0.035, 0.86),
	Basalt: createLegacyMaterial(0.86, 0, 0.045, 0.5),
	CrackedLava: createLegacyMaterial(0.78, 0, 0.05, 0.45),
	Limestone: createLegacyMaterial(0.91, 0, 0.036, 0.9),
	Pavement: createLegacyMaterial(0.89, 0, 0.038, 0.8),
	CorrodedMetal: createLegacyMaterial(0.85, 1, 0.04, 0.65),
	DiamondPlate: createLegacyMaterial(0.32, 1, 0.04, 0.85),
	Foil: createLegacyMaterial(0.18, 1, 0.04, 0.95),
	Metal: createLegacyMaterial(0.45, 1, 0.04, 0.88, { anisotropic: true }),
	Grass: createLegacyMaterial(0.95, 0, 0.03, 0.78, { sheen: true }),
	Sand: createLegacyMaterial(0.96, 0, 0.03, 0.9),
	Fabric: createLegacyMaterial(0.97, 0, 0.028, 0.84, { sheen: true }),
	Glass: createLegacyMaterial(0.06, 0, 0.05, 0.97, { opacity: 0.45, transmission: true }),
	Ice: createLegacyMaterial(0.14, 0, 0.045, 0.95, { opacity: 0.85, transmission: true }),
	Mud: createLegacyMaterial(0.82, 0, 0.045, 0.55),
	Ground: createLegacyMaterial(0.94, 0, 0.032, 0.72),
	Asphalt: createLegacyMaterial(0.9, 0, 0.04, 0.55),
	Snow: createLegacyMaterial(0.85, 0, 0.04, 0.98),
	Glacier: createLegacyMaterial(0.28, 0, 0.045, 0.93, { opacity: 0.95, transmission: true }),
	Salt: createLegacyMaterial(0.9, 0, 0.035, 0.96),
	Cardboard: createLegacyMaterial(0.95, 0, 0.03, 0.82),
	Carpet: createLegacyMaterial(0.98, 0, 0.025, 0.8, { sheen: true }),
	Plaster: createLegacyMaterial(0.93, 0, 0.034, 0.92),
	Rubber: createLegacyMaterial(0.87, 0, 0.045, 0.62),
	Leather: createLegacyMaterial(0.62, 0, 0.04, 0.75, { coat: true }),
})

const LEGACY_MATERIAL_NAMES = Object.freeze(Object.keys(LEGACY_MATERIALS))

export function legacyMaterialNames() {
	return LEGACY_MATERIAL_NAMES.slice()
}

export function legacyMaterialCount() {
	return LEGACY_MATERIAL_NAMES.length
}

export function hasLegacyMaterial(name) {
	return LEGACY_MATERIALS[name] !== undefined
}


export function legacyMaterialFor(name) {
	const entry = LEGACY_MATERIALS[name]
	return entry === undefined ? LEGACY_MATERIALS[SB_LEGACY_MATERIAL_FALLBACK_NAME] : entry
}

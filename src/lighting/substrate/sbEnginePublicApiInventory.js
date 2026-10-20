export const IL_PUBLIC_API_REGISTRATION_TOTAL = 73


export const IL_PLAN_PROPERTY_TOTAL = 65


const IL_PLAN_PHASE_PATTERN = /^IL-F([2-9]|[12][0-9]|3[0-2])$/

function engineProperty(propertyName, phaseId) {
	return Object.freeze({ propertyName, phaseId })
}


export const IL_PUBLIC_API_INVENTORY = Object.freeze({
	Lighting: Object.freeze([
		engineProperty("RenderStyle", "IL-F2"),
		engineProperty("ToneMapper", "IL-F3"),
		engineProperty("AutoExposure", "IL-F5"),
		engineProperty("LocalExposure", "IL-F6"),
		engineProperty("LocalExposureStrength", "IL-F6"),
		engineProperty("MaterialFeatures", "IL-F11"),
		engineProperty("GlassRefraction", "IL-F12"),
		engineProperty("IndexOfRefraction", "IL-F12"),
		engineProperty("SkyTurbidity", "IL-F14"),
		engineProperty("SkyGroundAlbedo", "IL-F14"),
		engineProperty("VolumetricFog", "IL-F18"),
		engineProperty("SSR", "IL-F21"),
		engineProperty("ReflectionProbes", "IL-F22"),
		engineProperty("PlanarReflections", "IL-F23"),
		engineProperty("LightPhotometry", "IL-F27"),
		engineProperty("ShadowAtlas", "F14"),
		engineProperty("LightCluster", "IL-F28"),
		engineProperty("AreaLightParts", "IL-F37"),
		engineProperty("LensFlare", "IL-F30"),
		engineProperty("LensFlareIntensity", "IL-F30"),
		engineProperty("CinematicPostProcess", "CP-F34"),
		engineProperty("ColorGradingPreset", "IL-F31"),
		engineProperty("WhiteBalanceTemperature", "IL-F31"),
		engineProperty("WhiteBalanceTint", "IL-F31"),
		engineProperty("ColorGradingLutAmount", "IL-F31"),
		engineProperty("TemporalAA", "IL-F32"),
		engineProperty("MotionBlur", "IL-F32"),
		engineProperty("ObjectMotionVectors", "IL-F40"),
		engineProperty("TemporalUpscale", "IL-F40"),
		engineProperty("ChromaticAberration", "IL-F32"),
		engineProperty("FilmGrain", "IL-F32"),
	]),
	Light: Object.freeze([
		engineProperty("Temperature", "IL-F27"),
		engineProperty("LightPreset", "IL-F27"),
	]),
	PointLight: Object.freeze([
		engineProperty("SourceRadius", "IL-F25"),
		engineProperty("IesProfile", "IL-F26"),
	]),
	SpotLight: Object.freeze([
		engineProperty("SourceRadius", "IL-F25"),
		engineProperty("IesProfile", "IL-F26"),
		engineProperty("LightFunction", "IL-F26"),
		engineProperty("LightFunctionRotation", "IL-F26"),
	]),
	SurfaceLight: Object.freeze([
		engineProperty("IesProfile", "IL-F26"),
		engineProperty("LightFunction", "IL-F26"),
		engineProperty("LightFunctionRotation", "IL-F26"),
	]),
	RectLight: Object.freeze([
		engineProperty("Face", "IL-F25"),
		engineProperty("Width", "IL-F25"),
		engineProperty("Height", "IL-F25"),
		engineProperty("Range", "IL-F25"),
	]),
	TubeLight: Object.freeze([
		engineProperty("Face", "IL-F37"),
		engineProperty("Length", "IL-F37"),
		engineProperty("Range", "IL-F37"),
		engineProperty("TubeRadius", "IL-F37"),
	]),
	ReflectionProbe: Object.freeze([
		engineProperty("Enabled", "IL-F22"),
		engineProperty("Shape", "IL-F22"),
		engineProperty("Position", "IL-F22"),
		engineProperty("Size", "IL-F22"),
		engineProperty("Priority", "IL-F22"),
		engineProperty("Resolution", "IL-F22"),
		engineProperty("BlendDistance", "IL-F22"),
	]),
	Clouds: Object.freeze([
		engineProperty("Enabled", "IL-F19"),
		engineProperty("Cover", "IL-F19"),
		engineProperty("Density", "IL-F19"),
		engineProperty("Color", "IL-F19"),
	]),
	Sky: Object.freeze([
		engineProperty("SkyboxHdri", "IL-F16"),
		engineProperty("HdriIntensity", "IL-F16"),
		engineProperty("MoonPhase", "IL-F15"),
	]),
	BloomEffect: Object.freeze([
		engineProperty("Mode", "IL-F29"),
		engineProperty("Anamorphic", "IL-F29"),
		engineProperty("Dirt", "IL-F29"),
	]),
	BasePart: Object.freeze([engineProperty("Mirror", "IL-F23")]),
	SurfaceAppearance: Object.freeze([
		engineProperty("NormalMapConvention", "IL-F10"),
		engineProperty("HeightMap", "IL-F10"),
		engineProperty("HeightScale", "IL-F10"),
		engineProperty("DetailColorMap", "IL-F10"),
		engineProperty("DetailNormalMap", "IL-F10"),
		engineProperty("DetailTiling", "IL-F10"),
	]),
})

export function engineApiClassNames() {
	return Object.keys(IL_PUBLIC_API_INVENTORY)
}


export function engineApiRegistrations() {
	return engineApiClassNames().flatMap((className) =>
		IL_PUBLIC_API_INVENTORY[className].map((entry) => ({
			className,
			propertyName: entry.propertyName,
			phaseId: entry.phaseId,
		})),
	)
}

export function engineApiRegistrationCount() {
	return engineApiRegistrations().length
}


export function enginePlanRegistrations() {
	return engineApiRegistrations().filter((registration) => IL_PLAN_PHASE_PATTERN.test(registration.phaseId))
}

export function enginePlanPropertyCount() {
	return enginePlanRegistrations().length
}

function uniqueSortedNames(propertyNames) {
	return Array.from(new Set(propertyNames)).sort()
}


export function engineApiPropertyNames() {
	return uniqueSortedNames(engineApiRegistrations().map((registration) => registration.propertyName))
}

export function enginePlanPropertyNames() {
	return uniqueSortedNames(enginePlanRegistrations().map((registration) => registration.propertyName))
}

export function isEngineApiPropertyName(propertyName) {
	return engineApiPropertyNames().includes(propertyName)
}


export function engineApiClassesOfProperty(propertyName) {
	return engineApiRegistrations()
		.filter((registration) => registration.propertyName === propertyName)
		.map((registration) => registration.className)
}


export function findEngineInventoryProblems() {
	const problems = []

	if (engineApiRegistrationCount() !== IL_PUBLIC_API_REGISTRATION_TOTAL) {
		problems.push(
			"o retrato tem " +
				engineApiRegistrationCount() +
				" registros e a engine declara " +
				IL_PUBLIC_API_REGISTRATION_TOTAL,
		)
	}

	if (enginePlanPropertyCount() !== IL_PLAN_PROPERTY_TOTAL) {
		problems.push(
			"o plano de iluminacao soma " +
				enginePlanPropertyCount() +
				" campos no retrato e o portao fala em " +
				IL_PLAN_PROPERTY_TOTAL,
		)
	}

	for (const className of engineApiClassNames()) {
		const propertyNames = IL_PUBLIC_API_INVENTORY[className].map((entry) => entry.propertyName)
		if (propertyNames.length === 0) problems.push("classe sem propriedade no retrato: " + className)
		if (new Set(propertyNames).size !== propertyNames.length) {
			problems.push("propriedade repetida na classe " + className)
		}
	}

	for (const registration of engineApiRegistrations()) {
		if (typeof registration.phaseId !== "string" || registration.phaseId.length === 0) {
			problems.push("registro sem fase de origem: " + registration.className + "." + registration.propertyName)
		}
	}

	return problems
}

export function describeEngineApiInventory() {
	return {
		classCount: engineApiClassNames().length,
		registrationCount: engineApiRegistrationCount(),
		declaredRegistrationTotal: IL_PUBLIC_API_REGISTRATION_TOTAL,
		planPropertyCount: enginePlanPropertyCount(),
		declaredPlanPropertyTotal: IL_PLAN_PROPERTY_TOTAL,
		distinctPropertyCount: engineApiPropertyNames().length,
		problems: findEngineInventoryProblems(),
	}
}

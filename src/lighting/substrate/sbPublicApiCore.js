import { SB_MAX_CLOSURES_PER_PIXEL, SB_TIER_NAMES, tierDefaults } from "./sbMaterialContract.js"
import {
	engineApiClassNames,
	engineApiClassesOfProperty,
	engineApiRegistrationCount,
	enginePlanPropertyCount,
	isEngineApiPropertyName,
} from "./sbEnginePublicApiInventory.js"

export const SB_PUBLIC_API_OWNER_PHASE = "SB-F30"


export const SB_PUBLIC_API_PROPERTY_PREFIX = "Substrate"


import { SB_AUTO_VALUE, isAutoValue } from "./authoring/sbAutoValue.js"
export { SB_AUTO_VALUE, isAutoValue } from "./authoring/sbAutoValue.js"


export const SB_OWN_API_CLASS_NAMES = Object.freeze(["SubstrateMaterial"])

export const SB_PUBLIC_API_VALUE_TYPES = Object.freeze({
	boolean: "boolean",
	integer: "integer",
	enumeration: "enumeration",
	materialTreeText: "materialTreeText",
	presetName: "presetName",
})

const VALUE_TYPES = SB_PUBLIC_API_VALUE_TYPES


export const SB_PUBLIC_SIMPLIFICATION_OPTIONS = Object.freeze(["conservative", "balanced", "aggressive"])

function createPublicApiProperty(definition) {
	return Object.freeze({
		className: definition.className,
		propertyName: definition.propertyName,
		valueType: definition.valueType,
		options: Object.freeze([...(definition.options ?? [])]),
		integerRange: definition.integerRange ? Object.freeze({ ...definition.integerRange }) : null,
		writable: definition.writable !== false,
		autoMeaning: definition.autoMeaning ?? null,
		resolveAuto: definition.resolveAuto ?? null,
		description: definition.description,
	})
}


export const SB_PUBLIC_API_PROPERTIES = Object.freeze([
	createPublicApiProperty({
		className: "Lighting",
		propertyName: "SubstrateMaterials",
		valueType: VALUE_TYPES.boolean,
		autoMeaning: "o tier decide, pelo substrateEnabled do contrato",
		resolveAuto: (defaults) => defaults.substrateEnabled === true,
		description: "liga o caminho Substrate; desligada, a cena renderiza o material legado",
	}),
	createPublicApiProperty({
		className: "Lighting",
		propertyName: "SubstrateClosuresPerPixel",
		valueType: VALUE_TYPES.integer,
		integerRange: { minimum: 1, maximum: SB_MAX_CLOSURES_PER_PIXEL },
		autoMeaning: "o tier decide quantas closures cabem no pixel",
		resolveAuto: (defaults) => defaults.closuresPerPixel,
		description: "teto de closures avaliadas por pixel, dentro do teto do contrato",
	}),
	createPublicApiProperty({
		className: "Lighting",
		propertyName: "SubstrateSimplification",
		valueType: VALUE_TYPES.enumeration,
		options: SB_PUBLIC_SIMPLIFICATION_OPTIONS,
		autoMeaning: "o tier decide a politica de simplificacao da SB-F7",
		resolveAuto: (defaults) => defaults.simplification,
		description: "o que fazer quando a topologia autorada nao cabe no teto do tier",
	}),
	createPublicApiProperty({
		className: "SurfaceAppearance",
		propertyName: "SubstrateMaterialTree",
		valueType: VALUE_TYPES.materialTreeText,
		autoMeaning: "sem arvore autorada: vale o material legado convertido pela SB-F4",
		resolveAuto: () => null,
		description: "texto canonico da arvore de material, do jeito que a SB-F3 grava",
	}),
	createPublicApiProperty({
		className: "SurfaceAppearance",
		propertyName: "SubstrateMaterialPreset",
		valueType: VALUE_TYPES.presetName,
		autoMeaning: "sem preset: a arvore autorada manda",
		resolveAuto: () => null,
		description: "preset de autoria carregado nesta superficie",
	}),
	createPublicApiProperty({
		className: "SubstrateMaterial",
		propertyName: "Tree",
		valueType: VALUE_TYPES.materialTreeText,
		autoMeaning: "sem arvore: um slab com todos os parametros no default da SB-F4",
		resolveAuto: () => null,
		description: "arvore de material do bloco proprio, em texto canonico",
	}),
	createPublicApiProperty({
		className: "SubstrateMaterial",
		propertyName: "Preset",
		valueType: VALUE_TYPES.presetName,
		autoMeaning: "sem preset",
		resolveAuto: () => null,
		description: "preset de autoria que originou a arvore",
	}),
	createPublicApiProperty({
		className: "SubstrateMaterial",
		propertyName: "ClosureCount",
		valueType: VALUE_TYPES.integer,
		integerRange: { minimum: 0, maximum: SB_MAX_CLOSURES_PER_PIXEL },
		writable: false,
		description: "quantas closures a arvore entrega ao pixel; derivado, nunca autorado",
	}),
])

export function publicApiClassNames() {
	return Array.from(new Set(SB_PUBLIC_API_PROPERTIES.map((property) => property.className))).sort()
}

export function publicApiPropertyNames() {
	return Array.from(new Set(SB_PUBLIC_API_PROPERTIES.map((property) => property.propertyName))).sort()
}

export function publicApiPropertyCount() {
	return SB_PUBLIC_API_PROPERTIES.length
}

export function findPublicApiProperty(className, propertyName) {
	return (
		SB_PUBLIC_API_PROPERTIES.find(
			(property) => property.className === className && property.propertyName === propertyName,
		) ?? null
	)
}

export function isOwnApiClassName(className) {
	return SB_OWN_API_CLASS_NAMES.includes(className)
}


export function findPublicApiCollisions() {
	const engineClasses = engineApiClassNames()
	const collisions = []
	for (const property of SB_PUBLIC_API_PROPERTIES) {
		if (isOwnApiClassName(property.className)) {
			if (engineClasses.includes(property.className)) {
				collisions.push({
					className: property.className,
					propertyName: property.propertyName,
					reason: "a classe propria do Substrate tem o nome de uma classe da engine",
				})
			}
			continue
		}
		if (isEngineApiPropertyName(property.propertyName)) {
			collisions.push({
				className: property.className,
				propertyName: property.propertyName,
				reason: "a engine ja publica esta propriedade em " + engineApiClassesOfProperty(property.propertyName).join(", "),
			})
		}
	}
	return collisions
}

function findShapeProblems(property) {
	const problems = []
	const fullName = property.className + "." + property.propertyName
	if (property.writable) {
		if (typeof property.autoMeaning !== "string" || property.autoMeaning.length === 0) {
			problems.push("propriedade gravavel sem o significado de AUTO escrito: " + fullName)
		}
		if (typeof property.resolveAuto !== "function") {
			problems.push("propriedade gravavel sem resolucao de AUTO: " + fullName)
		}
	} else {
		if (property.autoMeaning !== null || property.resolveAuto !== null) {
			problems.push("propriedade somente leitura nao pode oferecer AUTO: " + fullName)
		}
	}
	const isEnumeration = property.valueType === VALUE_TYPES.enumeration
	if (isEnumeration && property.options.length === 0) {
		problems.push("propriedade de enumeracao sem opcoes declaradas: " + fullName)
	}
	if (!isEnumeration && property.options.length > 0) {
		problems.push("propriedade com opcoes declaradas sem ser enumeracao: " + fullName)
	}
	if (!Object.values(VALUE_TYPES).includes(property.valueType)) {
		problems.push("tipo de valor desconhecido em " + fullName + ": " + String(property.valueType))
	}
	return problems
}

function findPlacementProblems(property) {
	const problems = []
	const fullName = property.className + "." + property.propertyName
	if (isOwnApiClassName(property.className)) {
		if (!property.className.startsWith(SB_PUBLIC_API_PROPERTY_PREFIX)) {
			problems.push("classe propria sem o prefixo do Substrate: " + property.className)
		}
		return problems
	}
	if (!engineApiClassNames().includes(property.className)) {
		problems.push("classe nem da engine nem do Substrate: " + property.className)
	}
	if (!property.propertyName.startsWith(SB_PUBLIC_API_PROPERTY_PREFIX)) {
		problems.push("propriedade em classe da engine sem o prefixo do Substrate: " + fullName)
	}
	return problems
}

function findAutoResolutionProblems(property) {
	if (!property.writable) return []
	const problems = []
	for (const tierName of SB_TIER_NAMES) {
		let resolved = undefined
		try {
			resolved = property.resolveAuto(tierDefaults(tierName))
		} catch (error) {
			problems.push(
				"a resolucao de AUTO lancou em " +
					property.className +
					"." +
					property.propertyName +
					" no tier " +
					tierName +
					": " +
					(error?.message ?? String(error)),
			)
			continue
		}
		if (resolved === undefined) {
			problems.push(
				"AUTO devolveu undefined em " + property.className + "." + property.propertyName + " no tier " + tierName,
			)
		}
	}
	return problems
}


export function findPublicApiProblems() {
	const problems = []
	const seenFullNames = new Set()
	for (const property of SB_PUBLIC_API_PROPERTIES) {
		const fullName = property.className + "." + property.propertyName
		if (seenFullNames.has(fullName)) problems.push("propriedade declarada duas vezes: " + fullName)
		seenFullNames.add(fullName)
		problems.push(...findShapeProblems(property))
		problems.push(...findPlacementProblems(property))
		problems.push(...findAutoResolutionProblems(property))
	}
	for (const collision of findPublicApiCollisions()) {
		problems.push("colisao com a API da engine em " + collision.className + "." + collision.propertyName + ": " + collision.reason)
	}
	return problems
}


export function validatePropertyValue(request = {}) {
	const { className, propertyName, value } = request
	const property = findPublicApiProperty(className, propertyName)
	if (!property) {
		return { ok: false, reason: "propriedade fora do bloco publico: " + String(className) + "." + String(propertyName) }
	}
	if (!property.writable) {
		return { ok: false, reason: "propriedade somente leitura: " + property.className + "." + property.propertyName }
	}
	if (isAutoValue(value)) return { ok: true, reason: null }
	if (property.valueType === VALUE_TYPES.boolean) {
		return typeof value === "boolean" ? { ok: true, reason: null } : { ok: false, reason: "esperado true, false ou AUTO" }
	}
	if (property.valueType === VALUE_TYPES.integer) {
		if (!Number.isInteger(value)) return { ok: false, reason: "esperado um inteiro ou AUTO" }
		const range = property.integerRange
		if (range && (range.minimum > value || value > range.maximum)) {
			return { ok: false, reason: "fora da faixa " + range.minimum + ".." + range.maximum }
		}
		return { ok: true, reason: null }
	}
	if (property.valueType === VALUE_TYPES.enumeration) {
		return property.options.includes(value)
			? { ok: true, reason: null }
			: { ok: false, reason: "valor fora das opcoes: " + property.options.join(", ") }
	}
	if (typeof value !== "string" || value.length === 0) {
		return { ok: false, reason: "esperado texto nao vazio ou AUTO" }
	}
	return { ok: true, reason: null }
}


export function resolvePropertyValue(request = {}) {
	const { className, propertyName, authoredValue = SB_AUTO_VALUE, tierName } = request
	const property = findPublicApiProperty(className, propertyName)
	if (!property) {
		return {
			ok: false,
			value: null,
			source: null,
			reason: "propriedade fora do bloco publico: " + String(className) + "." + String(propertyName),
		}
	}
	if (!property.writable) {
		return {
			ok: false,
			value: null,
			source: null,
			reason: "propriedade somente leitura: " + property.className + "." + property.propertyName,
		}
	}
	if (!isAutoValue(authoredValue)) {
		const validation = validatePropertyValue({ className, propertyName, value: authoredValue })
		if (!validation.ok) return { ok: false, value: null, source: "authored", reason: validation.reason }
		return { ok: true, value: authoredValue, source: "authored", reason: null }
	}
	if (!SB_TIER_NAMES.includes(tierName)) {
		return {
			ok: false,
			value: null,
			source: "auto",
			reason: "AUTO precisa de um tier conhecido: " + SB_TIER_NAMES.join(", "),
		}
	}
	return { ok: true, value: property.resolveAuto(tierDefaults(tierName)), source: "auto", reason: null }
}


export function describeAutoValues(tierName) {
	return SB_PUBLIC_API_PROPERTIES.filter((property) => property.writable).map((property) => ({
		className: property.className,
		propertyName: property.propertyName,
		autoMeaning: property.autoMeaning,
		autoValue: SB_TIER_NAMES.includes(tierName) ? property.resolveAuto(tierDefaults(tierName)) : null,
	}))
}

export function describePublicApiBlock() {
	return {
		ownerPhase: SB_PUBLIC_API_OWNER_PHASE,
		propertyPrefix: SB_PUBLIC_API_PROPERTY_PREFIX,
		ownClassNames: [...SB_OWN_API_CLASS_NAMES],
		classNames: publicApiClassNames(),
		propertyCount: publicApiPropertyCount(),
		properties: SB_PUBLIC_API_PROPERTIES.map((property) => ({
			className: property.className,
			propertyName: property.propertyName,
			valueType: property.valueType,
			options: [...property.options],
			writable: property.writable,
			autoMeaning: property.autoMeaning,
			description: property.description,
		})),
		engineRegistrationTotal: engineApiRegistrationCount(),
		enginePlanPropertyTotal: enginePlanPropertyCount(),
		collisions: findPublicApiCollisions(),
		problems: findPublicApiProblems(),
	}
}

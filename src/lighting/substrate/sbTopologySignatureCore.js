import { canonicalJson } from "./sbTreeSerializationCore.js"


export const SB_TOPOLOGY_SIGNATURE_VERSION = 1


export const SB_MATERIAL_FAMILIES = Object.freeze(["standard", "poolPhong", "physical", "terreno", "skinned"])

export const SB_DEFAULT_MATERIAL_FAMILY = "standard"


const SIGNATURE_HASH_OFFSET_BASIS = 0x811c9dc5
const SIGNATURE_HASH_PRIME = 0x01000193
const SIGNATURE_HASH_HEX_LENGTH = 8

function fnv1aHex(text) {
	let hash = SIGNATURE_HASH_OFFSET_BASIS
	for (const character of text) {
		hash ^= character.codePointAt(0)
		hash = Math.imul(hash, SIGNATURE_HASH_PRIME)
	}
	return (hash >>> 0).toString(16).padStart(SIGNATURE_HASH_HEX_LENGTH, "0")
}

function sortedFeatures(features) {
	if (!Array.isArray(features)) return []
	return [...features].sort()
}


export function createTopologyDescriptor(compiledTopology) {
	const closures = compiledTopology?.closures ?? []
	const operators = compiledTopology?.operators ?? []
	return {
		version: SB_TOPOLOGY_SIGNATURE_VERSION,
		shadingClass: compiledTopology?.shadingClass ?? null,
		closureCount: closures.reduce((total, closure) => total + (closure.closureCost ?? 0), 0),
		closures: closures.map((closure) => ({
			bsdf: closure.bsdf ?? null,
			layerIndex: closure.layerIndex ?? 0,
			closureCost: closure.closureCost ?? 0,
			covered: Boolean(closure.coveredBy),
			features: sortedFeatures(closure.features),
		})),
		operators: operators.map((entry) => ({
			operator: entry.operator ?? null,
			closureMath: entry.closureMath ?? null,
			depth: entry.depth ?? 0,
		})),
	}
}


export function topologySignature(descriptor) {
	return canonicalJson(descriptor)
}


export function topologySignatureHash(signature) {
	if (typeof signature !== "string" || signature.length === 0) return null
	return fnv1aHex(signature)
}


export function createProgramKey(materialFamily, signatureHash) {
	return String(materialFamily) + ":" + String(signatureHash)
}

export function isKnownMaterialFamily(materialFamily) {
	return SB_MATERIAL_FAMILIES.includes(materialFamily)
}


export function createProgramKeyRegistry() {
	const signatureHashesByFamily = new Map()

	function hashesFor(materialFamily) {
		const existing = signatureHashesByFamily.get(materialFamily)
		if (existing) return existing
		const created = new Set()
		signatureHashesByFamily.set(materialFamily, created)
		return created
	}

	function families() {
		return Array.from(signatureHashesByFamily.keys()).sort()
	}

	function programCount(materialFamily) {
		return signatureHashesByFamily.get(materialFamily)?.size ?? 0
	}

	function register(materialFamily, signatureHash) {
		const hashes = hashesFor(materialFamily)
		const alreadyKnown = hashes.has(signatureHash)
		hashes.add(signatureHash)
		return {
			programKey: createProgramKey(materialFamily, signatureHash),
			alreadyKnown,
			programCount: hashes.size,
		}
	}

	function countsByFamily() {
		const counts = {}
		for (const materialFamily of families()) counts[materialFamily] = programCount(materialFamily)
		return counts
	}

	function report(maximumProgramsPerFamily) {
		const overBudgetFamilies = families()
			.filter((materialFamily) => programCount(materialFamily) > maximumProgramsPerFamily)
			.map((materialFamily) => ({
				materialFamily,
				programCount: programCount(materialFamily),
				ceiling: maximumProgramsPerFamily,
			}))
		return {
			ok: overBudgetFamilies.length === 0,
			ceiling: maximumProgramsPerFamily,
			familyCount: families().length,
			countsByFamily: countsByFamily(),
			overBudgetFamilies,
		}
	}

	function clear() {
		signatureHashesByFamily.clear()
	}

	return { register, programCount, families, countsByFamily, report, clear }
}

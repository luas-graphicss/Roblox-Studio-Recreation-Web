import {
	SB_MATERIAL_TREE_FORMAT,
	SB_MATERIAL_TREE_FORMAT_VERSION,
	normalizeMaterialTree,
} from "./sbMaterialTreeCore.js"

const FINGERPRINT_OFFSET_BASIS = 0x811c9dc5
const FINGERPRINT_PRIME = 0x01000193
const FINGERPRINT_HEX_LENGTH = 8


export function canonicalJson(value) {
	if (value === undefined || value === null) return "null"
	if (typeof value !== "object") return JSON.stringify(value)
	if (Array.isArray(value)) return "[" + value.map((item) => canonicalJson(item)).join(",") + "]"
	const pairs = Object.keys(value)
		.sort()
		.map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key]))
	return "{" + pairs.join(",") + "}"
}


export function createMaterialTreeEnvelope(rawRootNode) {
	const normalization = normalizeMaterialTree(rawRootNode)
	if (!normalization.root) {
		return {
			ok: false,
			envelope: null,
			anomalies: normalization.anomalies,
			reason: "a arvore nao tem raiz aproveitavel",
		}
	}
	return {
		ok: true,
		envelope: {
			format: SB_MATERIAL_TREE_FORMAT,
			version: SB_MATERIAL_TREE_FORMAT_VERSION,
			root: normalization.root,
		},
		anomalies: normalization.anomalies,
		reason: null,
	}
}

export function serializeMaterialTree(rawRootNode) {
	const { ok, envelope, anomalies, reason } = createMaterialTreeEnvelope(rawRootNode)
	if (!ok) return { ok: false, text: null, envelope: null, anomalies, reason }
	return { ok: true, text: canonicalJson(envelope), envelope, anomalies, reason: null }
}


export function deserializeMaterialTree(text) {
	if (typeof text !== "string" || text.trim() === "") {
		return { ok: false, root: null, reason: "texto vazio" }
	}
	let parsedEnvelope = null
	try {
		parsedEnvelope = JSON.parse(text)
	} catch (error) {
		return { ok: false, root: null, reason: "JSON invalido: " + (error?.message ?? String(error)) }
	}
	if (!parsedEnvelope || typeof parsedEnvelope !== "object" || Array.isArray(parsedEnvelope)) {
		return { ok: false, root: null, reason: "o envelope nao e um objeto" }
	}
	if (parsedEnvelope.format !== SB_MATERIAL_TREE_FORMAT) {
		return { ok: false, root: null, reason: "formato desconhecido: " + String(parsedEnvelope.format) }
	}
	if (parsedEnvelope.version !== SB_MATERIAL_TREE_FORMAT_VERSION) {
		return { ok: false, root: null, reason: "versao de formato incompativel: " + String(parsedEnvelope.version) }
	}
	const normalization = normalizeMaterialTree(parsedEnvelope.root)
	if (!normalization.root) {
		return { ok: false, root: null, reason: "o envelope nao traz uma raiz valida" }
	}
	return { ok: true, root: normalization.root, reason: null, anomalies: normalization.anomalies }
}

function fnv1aHex(text) {
	let hash = FINGERPRINT_OFFSET_BASIS
	for (const character of text) {
		hash ^= character.codePointAt(0)
		hash = Math.imul(hash, FINGERPRINT_PRIME)
	}
	return (hash >>> 0).toString(16).padStart(FINGERPRINT_HEX_LENGTH, "0")
}






export function materialTreeFingerprint(rawRootNode) {
	const serialized = serializeMaterialTree(rawRootNode)
	if (!serialized.ok) return null
	return fnv1aHex(serialized.text)
}


export function materialTreeRoundTrip(rawRootNode) {
	const serialized = serializeMaterialTree(rawRootNode)
	if (!serialized.ok) {
		return { ok: false, identical: false, text: null, restoredText: null, fingerprint: null, byteLength: 0, reason: serialized.reason }
	}
	const restored = deserializeMaterialTree(serialized.text)
	if (!restored.ok) {
		return { ok: false, identical: false, text: serialized.text, restoredText: null, fingerprint: null, byteLength: serialized.text.length, reason: restored.reason }
	}
	const reserialized = serializeMaterialTree(restored.root)
	const identical = reserialized.ok && reserialized.text === serialized.text
	return {
		ok: identical,
		identical,
		text: serialized.text,
		restoredText: reserialized.text ?? null,
		fingerprint: fnv1aHex(serialized.text),
		byteLength: serialized.text.length,
		reason: identical ? null : "o texto da volta divergiu do texto de ida",
	}
}

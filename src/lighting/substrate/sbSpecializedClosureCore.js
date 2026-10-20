import { SB_CLOSURE_HEADER_BYTES, SB_CLOSURE_LAYOUTS, closureLayoutKinds } from "./sbClosureLayouts.js"
import { packChannel, unpackChannel } from "./sbClosurePackingCore.js"

export const SB_SPECIALIZED_CLOSURE_KINDS = Object.freeze(["hair", "eye", "singleLayerWater", "volume", "unlit"])

const SPECIALIZED_FIELD_RANGES = Object.freeze({
	hair: {
		baseColor: { channelCount: 3, minimum: 0, maximum: 1, defaultValue: [0.35, 0.2, 0.1] },
		melanin: { channelCount: 1, minimum: 0, maximum: 1, defaultValue: 0.5 },
		roughness: { channelCount: 1, minimum: 0, maximum: 1, defaultValue: 0.3 },
		radialRoughness: { channelCount: 1, minimum: 0, maximum: 1, defaultValue: 0.3 },
		cuticleAngle: { channelCount: 1, minimum: 0, maximum: 0.35, defaultValue: 0.05 },
		ior: { channelCount: 1, minimum: 1, maximum: 2.5, defaultValue: 1.55 },
		tangent: { channelCount: 2, minimum: -1, maximum: 1, defaultValue: [0, 0] },
		scatter: { channelCount: 1, minimum: 0, maximum: 1, defaultValue: 0.2 },
	},
	eye: {
		irisColor: { channelCount: 3, minimum: 0, maximum: 1, defaultValue: [0.25, 0.4, 0.5] },
		irisDepth: { channelCount: 1, minimum: 0, maximum: 1, defaultValue: 0.25 },
		pupilRadius: { channelCount: 1, minimum: 0, maximum: 1, defaultValue: 0.25 },
		corneaRoughness: { channelCount: 1, minimum: 0, maximum: 1, defaultValue: 0.05 },
		corneaIor: { channelCount: 1, minimum: 1, maximum: 2, defaultValue: 1.376 },
		limbusDarkening: { channelCount: 1, minimum: 0, maximum: 1, defaultValue: 0.6 },
		normal: { channelCount: 2, minimum: -1, maximum: 1, defaultValue: [0, 0] },
	},
	singleLayerWater: {
		absorption: { channelCount: 3, minimum: 0, maximum: 4, defaultValue: [0.45, 0.09, 0.03] },
		scattering: { channelCount: 3, minimum: 0, maximum: 1, defaultValue: [0.02, 0.06, 0.08] },
		phaseG: { channelCount: 1, minimum: -1, maximum: 1, defaultValue: 0.6 },
		roughness: { channelCount: 1, minimum: 0, maximum: 1, defaultValue: 0.05 },
		ior: { channelCount: 1, minimum: 1, maximum: 2, defaultValue: 1.333 },
		normal: { channelCount: 2, minimum: -1, maximum: 1, defaultValue: [0, 0] },
	},
	volume: {
		extinction: { channelCount: 3, minimum: 0, maximum: 4, defaultValue: [0.5, 0.5, 0.5] },
		albedo: { channelCount: 3, minimum: 0, maximum: 1, defaultValue: [0.8, 0.8, 0.8] },
		phaseG: { channelCount: 1, minimum: -1, maximum: 1, defaultValue: 0 },
		emissive: { channelCount: 3, minimum: 0, maximum: 4, defaultValue: [0, 0, 0] },
	},
	unlit: {
		emissive: { channelCount: 3, minimum: 0, maximum: 4, defaultValue: [1, 1, 1] },
		opacity: { channelCount: 1, minimum: 0, maximum: 1, defaultValue: 1 },
	},
})

function glslTypeFor(channelCount) {
	if (channelCount === 2) return "vec2"
	if (channelCount === 3) return "vec3"
	return "float"
}

function buildEncodings(kind) {
	const layout = SB_CLOSURE_LAYOUTS[kind]
	const ranges = SPECIALIZED_FIELD_RANGES[kind]
	if (!layout || !ranges) return Object.freeze([])
	let byteOffset = SB_CLOSURE_HEADER_BYTES
	return Object.freeze(
		layout.payload.map((field) => {
			const range = ranges[field.name] ?? { channelCount: 1, minimum: 0, maximum: 1, defaultValue: 0 }
			const bytesPerChannel = Math.max(1, Math.floor(field.bytes / range.channelCount))
			const encoding = Object.freeze({
				name: field.name,
				byteOffset,
				byteCount: field.bytes,
				channelCount: range.channelCount,
				bytesPerChannel,
				minimum: range.minimum,
				maximum: range.maximum,
				defaultValue: range.defaultValue,
				glslType: glslTypeFor(range.channelCount),
			})
			byteOffset += field.bytes
			return encoding
		}),
	)
}

const ENCODINGS_BY_KIND = Object.freeze(
	Object.fromEntries(SB_SPECIALIZED_CLOSURE_KINDS.map((kind) => [kind, buildEncodings(kind)])),
)

export function isSpecializedClosureKind(kind) {
	return SB_SPECIALIZED_CLOSURE_KINDS.includes(kind)
}

export function specializedFieldEncodings(kind) {
	return ENCODINGS_BY_KIND[kind] ?? []
}

export function specializedKindCode(kind) {
	return Math.max(0, closureLayoutKinds().indexOf(kind))
}

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function channelValues(encoding, rawValue) {
	const values = []
	for (let channelIndex = 0; channelIndex < encoding.channelCount; channelIndex += 1) {
		const fallback = Array.isArray(encoding.defaultValue) ? encoding.defaultValue[channelIndex] : encoding.defaultValue
		if (isFiniteNumber(rawValue)) values.push(rawValue)
		else if (Array.isArray(rawValue) && isFiniteNumber(rawValue[channelIndex])) values.push(rawValue[channelIndex])
		else values.push(isFiniteNumber(fallback) ? fallback : encoding.minimum)
	}
	return values
}

export function sanitizeSpecializedParameters(kind, parameters) {
	const source = parameters && typeof parameters === "object" ? parameters : {}
	const sanitized = {}
	for (const encoding of specializedFieldEncodings(kind)) {
		const values = channelValues(encoding, source[encoding.name]).map((value) =>
			Math.min(encoding.maximum, Math.max(encoding.minimum, value)),
		)
		sanitized[encoding.name] = encoding.channelCount === 1 ? values[0] : values
	}
	return sanitized
}

export function writeSpecializedPayload(kind, bytes, byteOffset, parameters) {
	const sanitized = sanitizeSpecializedParameters(kind, parameters)
	for (const encoding of specializedFieldEncodings(kind)) {
		const range = { minimum: encoding.minimum, maximum: encoding.maximum, byteCount: encoding.bytesPerChannel }
		const values = encoding.channelCount === 1 ? [sanitized[encoding.name]] : sanitized[encoding.name]
		values.forEach((value, channelIndex) => {
			packChannel(bytes, byteOffset + encoding.byteOffset + channelIndex * encoding.bytesPerChannel, value, range)
		})
	}
	return bytes
}

export function readSpecializedPayload(kind, bytes, byteOffset) {
	const parameters = {}
	for (const encoding of specializedFieldEncodings(kind)) {
		const range = { minimum: encoding.minimum, maximum: encoding.maximum, byteCount: encoding.bytesPerChannel }
		const values = []
		for (let channelIndex = 0; channelIndex < encoding.channelCount; channelIndex += 1) {
			const value = unpackChannel(bytes, byteOffset + encoding.byteOffset + channelIndex * encoding.bytesPerChannel, range)
			values.push(value === null ? encoding.minimum : value)
		}
		parameters[encoding.name] = encoding.channelCount === 1 ? values[0] : values
	}
	return parameters
}

export function describeSpecializedClosures() {
	return SB_SPECIALIZED_CLOSURE_KINDS.map((kind) => ({
		kind,
		code: specializedKindCode(kind),
		fields: specializedFieldEncodings(kind).map((encoding) => ({
			name: encoding.name,
			byteOffset: encoding.byteOffset,
			byteCount: encoding.byteCount,
			channelCount: encoding.channelCount,
			minimum: encoding.minimum,
			maximum: encoding.maximum,
		})),
	}))
}

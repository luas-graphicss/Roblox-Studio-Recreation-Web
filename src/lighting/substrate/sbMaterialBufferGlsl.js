import {
	SB_CLOSURE_FLAG_BITS,
	SB_MATERIAL_BUFFER_BYTES_PER_TEXEL,
	SB_MATERIAL_BUFFER_UNIFORMS,
	closureHeaderFieldOffsets,
	closureRecordTexels,
	slabFieldEncodings,
} from "./sbMaterialBufferCore.js"
import { quantizationLevels } from "./sbClosurePackingCore.js"


export const SB_MATERIAL_BUFFER_PATCH_ANCHOR = "bsdfs"

const HEADER_STRUCT_NAME = "SbClosureHeader"
const CLOSURE_STRUCT_NAME = "SbSlabClosure"
const CLOSURE_READER_NAME = "sbReadSlabClosure"
const HEADER_READER_NAME = "sbReadClosureHeader"

const BYTE_MAXIMUM = 255
const BYTE_STATES = 256
const TWO_BYTE_CHANNEL = 2
const SINGLE_CHANNEL = 1


const HIGH_BYTE_SCALE = BYTE_MAXIMUM * BYTE_STATES
const TWO_BYTE_LEVELS = quantizationLevels(TWO_BYTE_CHANNEL)


function toGlslFloat(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return "0.0"
	if (Number.isInteger(value)) return value.toFixed(1)
	const rounded = Number(value.toFixed(8))
	const text = String(rounded)
	return text.includes(".") || text.includes("e") ? text : rounded.toFixed(1)
}

function toScreamingSnakeCase(name) {
	return name.replace(/([A-Z])/g, "_$1").toUpperCase()
}

function uniformDeclarationLines() {
	return [
		"uniform sampler2D " + SB_MATERIAL_BUFFER_UNIFORMS.buffer + ";",
		"uniform vec2 " + SB_MATERIAL_BUFFER_UNIFORMS.size + ";",
	]
}


function byteFetchLines() {
	const bytesPerTexel = String(SB_MATERIAL_BUFFER_BYTES_PER_TEXEL)
	return [
		"float sbMaterialBufferByte(float closureRow, int byteIndex) {",
		"\tint texelIndex = byteIndex / " + bytesPerTexel + ";",
		"\tint channelIndex = byteIndex - texelIndex * " + bytesPerTexel + ";",
		"\tvec2 bufferUv = vec2(",
		"\t\t(float(texelIndex) + 0.5) / " + SB_MATERIAL_BUFFER_UNIFORMS.size + ".x,",
		"\t\t(closureRow + 0.5) / " + SB_MATERIAL_BUFFER_UNIFORMS.size + ".y",
		"\t);",
		"\tvec4 texel = texture2D(" + SB_MATERIAL_BUFFER_UNIFORMS.buffer + ", bufferUv);",
		"\tif (channelIndex == 0) return texel.r;",
		"\tif (channelIndex == 1) return texel.g;",
		"\tif (channelIndex == 2) return texel.b;",
		"\treturn texel.a;",
		"}",
	]
}

function decoderLines() {
	return [
		"// A amostra de RGBA8 ja chega normalizada: byte / 255.",
		"float sbMaterialBufferUnorm1(float closureRow, int byteIndex) {",
		"\treturn sbMaterialBufferByte(closureRow, byteIndex);",
		"}",
		"",
		"// Big-endian: byte mais significativo primeiro, igual ao escritor de CPU.",
		"float sbMaterialBufferUnorm2(float closureRow, int byteIndex) {",
		"\tfloat highByte = sbMaterialBufferByte(closureRow, byteIndex);",
		"\tfloat lowByte = sbMaterialBufferByte(closureRow, byteIndex + 1);",
		"\treturn (highByte * " +
			toGlslFloat(HIGH_BYTE_SCALE) +
			" + lowByte * " +
			toGlslFloat(BYTE_MAXIMUM) +
			") / " +
			toGlslFloat(TWO_BYTE_LEVELS) +
			";",
		"}",
		"",
		"// Codigo inteiro de um byte de header, de volta ao valor 0..255.",
		"float sbMaterialBufferCode(float closureRow, int byteIndex) {",
		"\treturn floor(sbMaterialBufferByte(closureRow, byteIndex) * " + toGlslFloat(BYTE_MAXIMUM) + " + 0.5);",
		"}",
		"",
		"float sbMaterialBufferRange(float normalized, float minimum, float maximum) {",
		"\treturn minimum + normalized * (maximum - minimum);",
		"}",
		"",
		"float sbMaterialBufferRow(float closureIndex) {",
		"\treturn clamp(closureIndex, 0.0, " + SB_MATERIAL_BUFFER_UNIFORMS.size + ".y - 1.0);",
		"}",
		"",
		"bool sbClosureHasFlag(float flags, float flagBit) {",
		"\treturn mod(floor(flags / flagBit), 2.0) >= 0.5;",
		"}",
	]
}

function flagConstantLines() {
	return Object.keys(SB_CLOSURE_FLAG_BITS).map(
		(flagName) =>
			"const float SB_FLAG" +
			toScreamingSnakeCase(flagName).replace("_HAS", "") +
			" = " +
			toGlslFloat(SB_CLOSURE_FLAG_BITS[flagName]) +
			";",
	)
}

function headerStructLines() {
	const offsets = closureHeaderFieldOffsets()
	const lines = ["struct " + HEADER_STRUCT_NAME + " {"]
	Object.keys(offsets).forEach((fieldName) => lines.push("\tfloat " + fieldName + ";"))
	lines.push("};")
	return lines
}

function headerReaderLines() {
	const offsets = closureHeaderFieldOffsets()
	const lines = [
		HEADER_STRUCT_NAME + " " + HEADER_READER_NAME + "(float closureRow) {",
		"\t" + HEADER_STRUCT_NAME + " header;",
	]
	Object.keys(offsets).forEach((fieldName) => {
		lines.push("\theader." + fieldName + " = sbMaterialBufferCode(closureRow, " + offsets[fieldName].byteOffset + ");")
	})
	lines.push("\treturn header;", "}")
	return lines
}

function closureStructLines() {
	const lines = ["struct " + CLOSURE_STRUCT_NAME + " {"]
	slabFieldEncodings().forEach((encoding) => lines.push("\t" + encoding.glslType + " " + encoding.name + ";"))
	lines.push("};")
	return lines
}

function channelExpression(encoding, channelIndex) {
	const byteIndex = encoding.byteOffset + channelIndex * encoding.bytesPerChannel
	const decoder = encoding.bytesPerChannel === TWO_BYTE_CHANNEL ? "sbMaterialBufferUnorm2" : "sbMaterialBufferUnorm1"
	return (
		"sbMaterialBufferRange(" +
		decoder +
		"(closureRow, " +
		byteIndex +
		"), " +
		toGlslFloat(encoding.minimum) +
		", " +
		toGlslFloat(encoding.maximum) +
		")"
	)
}

function fieldAssignmentLines(encoding) {
	const expressions = []
	for (let channelIndex = 0; encoding.channelCount > channelIndex; channelIndex += 1) {
		expressions.push(channelExpression(encoding, channelIndex))
	}
	if (encoding.channelCount === SINGLE_CHANNEL) {
		return ["\tclosure." + encoding.name + " = " + expressions[0] + ";"]
	}
	const lines = ["\tclosure." + encoding.name + " = " + encoding.glslType + "("]
	expressions.forEach((expression, index) => {
		const isLast = index === expressions.length - 1
		lines.push("\t\t" + expression + (isLast ? "" : ","))
	})
	lines.push("\t);")
	return lines
}

function closureReaderLines() {
	const lines = [
		CLOSURE_STRUCT_NAME + " " + CLOSURE_READER_NAME + "(float closureRow) {",
		"\t" + CLOSURE_STRUCT_NAME + " closure;",
	]
	slabFieldEncodings().forEach((encoding) => {
		fieldAssignmentLines(encoding).forEach((line) => lines.push(line))
	})
	lines.push("\treturn closure;", "}")
	return lines
}


export function sbMaterialBufferDeclarations() {
	return [
		"// SB-F8 -- buffer de material quantizado. Texto GERADO por sbMaterialBufferGlsl.js.",
		"// " + closureRecordTexels() + " texels RGBA8 por closure, um registro por linha da textura.",
		...uniformDeclarationLines(),
		"",
		...byteFetchLines(),
		"",
		...decoderLines(),
		"",
		...flagConstantLines(),
		"",
		...headerStructLines(),
		"",
		...headerReaderLines(),
		"",
		...closureStructLines(),
		"",
		...closureReaderLines(),
		"",
	].join("\n")
}






export function sbMaterialBufferPatchCode() {
	return "\t// SB-F8: leitores do buffer de material disponiveis; o consumo comeca na SB-F9."
}


export function describeMaterialBufferGlsl() {
	const declarations = sbMaterialBufferDeclarations()
	return {
		anchor: SB_MATERIAL_BUFFER_PATCH_ANCHOR,
		uniforms: Object.values(SB_MATERIAL_BUFFER_UNIFORMS),
		structNames: [HEADER_STRUCT_NAME, CLOSURE_STRUCT_NAME],
		readerNames: [HEADER_READER_NAME, CLOSURE_READER_NAME],
		declarationLineCount: declarations.split("\n").length,
		declarationCharacterCount: declarations.length,
	}
}

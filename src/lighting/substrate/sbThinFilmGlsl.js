import {
	SB_NANOMETERS_PER_METER,
	SB_SENSITIVITY_FLAT_RESPONSE,
	SB_SENSITIVITY_NORMALIZATION,
	SB_SPECTRAL_SENSITIVITY_LOBES,
	SB_XYZ_TO_LINEAR_SRGB_ROWS,
} from "./sbThinFilmSpectralSensitivityCore.js"
import {
	SB_THIN_FILM_HARMONIC_COUNT,
	SB_THIN_FILM_MINIMUM_BASE_FRESNEL,
	SB_THIN_FILM_MINIMUM_VIEW_COSINE,
	SB_THIN_FILM_OUTSIDE_IOR,
} from "./sbThinFilmCore.js"

export const SB_THIN_FILM_UNIFORM_NAME = "uSbThinFilm"


export const SB_THIN_FILM_ANCHORS = Object.freeze({
	declarations: "bsdfs",
	application: "lightsFragmentEnd",
})


export const SB_THIN_FILM_READ_ONLY_SYMBOLS = Object.freeze([
	"material.specularColor",
	"geometryNormal",
	"geometryViewDir",
])

const INCLUDE_GUARD_NAME = "SB_THIN_FILM"
const MAXIMUM_BASE_F0 = 0.9999
const MAXIMUM_COMPOUND_REFLECTANCE = 0.9999

function toGlslFloat(value) {
	const numeric = Number(value)
	const text = Number.isFinite(numeric) ? String(numeric) : "0"
	return text.includes(".") || text.includes("e") ? text : text + ".0"
}


function sensitivityLobeLines() {
	return SB_SPECTRAL_SENSITIVITY_LOBES.map((lobe) => {
		const channel = "[" + lobe.channelIndex + "]"
		return (
			"\txyz" +
			channel +
			" += " +
			toGlslFloat(lobe.amplitude) +
			" * sqrt(2.0 * PI * " +
			toGlslFloat(lobe.variance) +
			") * cos(" +
			toGlslFloat(lobe.angularFrequency) +
			" * phase + phaseShiftPerChannel" +
			channel +
			") * exp(-" +
			toGlslFloat(lobe.variance) +
			" * phase * phase);"
		)
	})
}


function xyzToLinearSrgbLines() {
	const lastRowIndex = SB_XYZ_TO_LINEAR_SRGB_ROWS.length - 1
	return SB_XYZ_TO_LINEAR_SRGB_ROWS.map((row, rowIndex) => {
		const separator = rowIndex === lastRowIndex ? "" : ","
		return "\t\tdot(vec3(" + row.map((coefficient) => toGlslFloat(coefficient)).join(", ") + "), xyz)" + separator
	})
}


function harmonicLines() {
	const lines = []
	for (let harmonicIndex = 1; SB_THIN_FILM_HARMONIC_COUNT >= harmonicIndex; harmonicIndex += 1) {
		const harmonic = toGlslFloat(harmonicIndex)
		lines.push("\t// harmonico " + harmonicIndex + " de " + SB_THIN_FILM_HARMONIC_COUNT)
		lines.push("\tharmonicAmplitude *= compoundAmplitude;")
		lines.push(
			"\treflectance += 2.0 * harmonicAmplitude * sbThinFilmSpectralSensitivity(" +
				harmonic +
				" * opticalPathDifference, " +
				harmonic +
				" * phaseShift);",
		)
	}
	return lines
}


export function buildThinFilmGlsl() {
	const uniforms = "uniform vec2 " + SB_THIN_FILM_UNIFORM_NAME + ";"

	const sensitivityFunctions = [
		"// Sensibilidade espectral do olho no dominio de Fourier (Belcour e Barla).",
		"// Os numeros vem de sbThinFilmSpectralSensitivityCore.js, gerados: nao ha",
		"// constante copiada a mao entre o JS e o shader.",
		"vec3 sbThinFilmXyzToLinearSrgb(const in vec3 xyz) {",
		"\treturn vec3(",
		...xyzToLinearSrgbLines(),
		"\t);",
		"}",
		"",
		"vec3 sbThinFilmSpectralSensitivity(const in float opticalPathDifferenceNanometers, const in vec3 phaseShiftPerChannel) {",
		"\tfloat phase = 2.0 * PI * opticalPathDifferenceNanometers / " + toGlslFloat(SB_NANOMETERS_PER_METER) + ";",
		"\tvec3 xyz = vec3(0.0);",
		...sensitivityLobeLines(),
		"\tvec3 rgb = sbThinFilmXyzToLinearSrgb(xyz / " + toGlslFloat(SB_SENSITIVITY_NORMALIZATION) + ");",
		"\t// Espectro plano vale (1,1,1) tambem em RGB: a mesma regua de branco do JS.",
		"\treturn rgb * vec3(" +
			SB_SENSITIVITY_FLAT_RESPONSE.map((channelArea) => toGlslFloat(1 / channelArea)).join(", ") +
			");",
		"}",
	].join("\n")

	const fresnelHelpers = [
		"// Interface entre dois indices: refletancia na incidencia normal e a volta,",
		"// de F0 para o indice equivalente da base. Sempre por canal, porque o filme",
		"// e um so mas a base tem cor.",
		"vec3 sbThinFilmIorToNormalReflectancePerChannel(const in vec3 transmittedIor, const in float incidentIor) {",
		"\tvec3 amplitude = (transmittedIor - vec3(incidentIor)) / (transmittedIor + vec3(incidentIor));",
		"\treturn amplitude * amplitude;",
		"}",
		"",
		"vec3 sbThinFilmNormalReflectanceToIor(const in vec3 normalReflectance) {",
		"\tvec3 amplitude = sqrt(clamp(normalReflectance, vec3(0.0), vec3(" + toGlslFloat(MAXIMUM_BASE_F0) + ")));",
		"\treturn (vec3(1.0) + amplitude) / (vec3(1.0) - amplitude);",
		"}",
		"",
		"vec3 sbThinFilmSchlickPerChannel(const in vec3 normalReflectance, const in float cosTheta) {",
		"\tfloat grazingWeight = pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);",
		"\treturn normalReflectance + (vec3(1.0) - normalReflectance) * grazingWeight;",
		"}",
		"",
		"// Fresnel exato, nao polarizado, da primeira interface. Com os dois indices",
		"// iguais isto devolve ZERO em qualquer angulo: filme com o indice do ar fica",
		"// invisivel, em vez de acender franja na silhueta como Schlick faria.",
		"float sbThinFilmDielectricFresnel(const in float incidentIor, const in float transmittedIor, const in float cosThetaIncident, const in float cosThetaTransmitted) {",
		"\tfloat perpendicularAmplitude = (incidentIor * cosThetaIncident - transmittedIor * cosThetaTransmitted) / (incidentIor * cosThetaIncident + transmittedIor * cosThetaTransmitted);",
		"\tfloat parallelAmplitude = (transmittedIor * cosThetaIncident - incidentIor * cosThetaTransmitted) / (transmittedIor * cosThetaIncident + incidentIor * cosThetaTransmitted);",
		"\treturn 0.5 * (perpendicularAmplitude * perpendicularAmplitude + parallelAmplitude * parallelAmplitude);",
		"}",
	].join("\n")

	const interferenceFunctions = [
		"// Interferencia de Airy do filme: Snell para dentro, Fresnel nas duas",
		"// interfaces, caminho optico de ida e volta e a serie de cossenos pesada",
		"// pela sensibilidade do olho. Espelho de sbThinFilmCore.js, linha por linha.",
		"vec3 sbThinFilmReflectance(const in vec3 baseNormalReflectance, const in float cosThetaView, const in float thicknessNanometers, const in float filmIor) {",
		"\tvec3 baseFresnel = sbThinFilmSchlickPerChannel(baseNormalReflectance, cosThetaView);",
		"\tif (0.0 >= thicknessNanometers) return baseFresnel;",
		"\tfloat outsideIor = " + toGlslFloat(SB_THIN_FILM_OUTSIDE_IOR) + ";",
		"\tfloat sineFilmSquared = pow(outsideIor / filmIor, 2.0) * (1.0 - cosThetaView * cosThetaView);",
		"\tfloat cosineFilmSquared = 1.0 - sineFilmSquared;",
		"\tif (0.0 >= cosineFilmSquared) return vec3(1.0);",
		"\tfloat cosThetaFilm = sqrt(cosineFilmSquared);",
		"\tfloat firstInterface = sbThinFilmDielectricFresnel(outsideIor, filmIor, cosThetaView, cosThetaFilm);",
		"\tfloat roundTripTransmittance = 1.0 - firstInterface;",
		"\tfloat firstInterfacePhaseShift = (outsideIor > filmIor) ? 0.0 : PI;",
		"\tvec3 baseIor = sbThinFilmNormalReflectanceToIor(baseNormalReflectance);",
		"\tvec3 secondInterface = sbThinFilmSchlickPerChannel(sbThinFilmIorToNormalReflectancePerChannel(baseIor, filmIor), cosThetaFilm);",
		"\tvec3 phaseShift = vec3(firstInterfacePhaseShift) + vec3(",
		"\t\t(filmIor > baseIor.r) ? PI : 0.0,",
		"\t\t(filmIor > baseIor.g) ? PI : 0.0,",
		"\t\t(filmIor > baseIor.b) ? PI : 0.0",
		"\t);",
		"\tvec3 compoundReflectance = min(vec3(firstInterface) * secondInterface, vec3(" +
			toGlslFloat(MAXIMUM_COMPOUND_REFLECTANCE) +
			"));",
		"\tvec3 compoundAmplitude = sqrt(compoundReflectance);",
		"\tvec3 multipleBounce = (roundTripTransmittance * roundTripTransmittance) * secondInterface / (vec3(1.0) - compoundReflectance);",
		"\tvec3 reflectance = vec3(firstInterface) + multipleBounce;",
		"\tvec3 harmonicAmplitude = multipleBounce - vec3(roundTripTransmittance);",
		"\tfloat opticalPathDifference = 2.0 * filmIor * thicknessNanometers * cosThetaFilm;",
		...harmonicLines(),
		"\t// A serie truncada passa de 1 em metal rasante, e refletancia acima de 1",
		"\t// criaria energia: o corte fica aqui, do mesmo jeito que no nucleo JS.",
		"\treturn clamp(reflectance, vec3(0.0), vec3(1.0));",
		"}",
		"",
		"// O que o especular multiplica. Espessura zero devolve 1.0 EXATO, entao a",
		"// flag ligada com espessura zero e byte a byte igual a imagem base.",
		"vec3 sbThinFilmSpecularTint(const in vec3 baseNormalReflectance, const in float cosThetaView, const in float thicknessNanometers, const in float filmIor) {",
		"\tif (0.0 >= thicknessNanometers) return vec3(1.0);",
		"\tvec3 baseFresnel = max(sbThinFilmSchlickPerChannel(baseNormalReflectance, cosThetaView), vec3(" +
			toGlslFloat(SB_THIN_FILM_MINIMUM_BASE_FRESNEL) +
			"));",
		"\treturn sbThinFilmReflectance(baseNormalReflectance, cosThetaView, thicknessNanometers, filmIor) / baseFresnel;",
		"}",
	].join("\n")

	const callSite = [
		"// SB-F14: iridescencia por interferencia. O uniform traz espessura em",
		"// nanometros (x) e IOR do filme (y). Espessura zero nao entra no calculo.",
		"if (" + SB_THIN_FILM_UNIFORM_NAME + ".x > 0.0) {",
		"\tfloat sbThinFilmViewCosine = clamp(dot(geometryNormal, geometryViewDir), " +
			toGlslFloat(SB_THIN_FILM_MINIMUM_VIEW_COSINE) +
			", 1.0);",
		"\tvec3 sbThinFilmTint = sbThinFilmSpecularTint(material.specularColor, sbThinFilmViewCosine, " +
			SB_THIN_FILM_UNIFORM_NAME +
			".x, " +
			SB_THIN_FILM_UNIFORM_NAME +
			".y);",
		"\treflectedLight.directSpecular *= sbThinFilmTint;",
		"\treflectedLight.indirectSpecular *= sbThinFilmTint;",
		"}",
	].join("\n")

	const declarationsCode = [
		"#ifndef " + INCLUDE_GUARD_NAME,
		"#define " + INCLUDE_GUARD_NAME,
		uniforms,
		sensitivityFunctions,
		fresnelHelpers,
		interferenceFunctions,
		"#endif",
	].join("\n\n")

	return {
		declarationsCode,
		applicationCode: callSite,
		sources: { uniforms, sensitivityFunctions, fresnelHelpers, interferenceFunctions, callSite },
	}
}

import { SB_MAX_CLOSURES_PER_PIXEL } from "./sbMaterialContract.js"

export const SB_CLOSURE_DISPATCH_READY_DEFINE = "SB_CLOSURE_DISPATCH_READY"
export const SB_CLOSURE_LIMIT_DEFINE = "SB_CLOSURE_LIMIT"
export const SB_CLOSURE_COUNT_UNIFORM_NAME = "uSbClosureCount"


export function resolveClosureCeiling(rawCeiling) {
	if (!Number.isInteger(rawCeiling) || 1 > rawCeiling) return 1
	return Math.min(rawCeiling, SB_MAX_CLOSURES_PER_PIXEL)
}

export function closureLimitDefineLine(closureCeiling) {
	return "#define " + SB_CLOSURE_LIMIT_DEFINE + " " + resolveClosureCeiling(closureCeiling)
}


export function buildClosureDispatchDeclarations(input) {
	const closureCeiling = resolveClosureCeiling(input?.closureCeiling)
	return [
		"// SB-F9: despacho de avaliacao de closures.",
		"#define " + SB_CLOSURE_DISPATCH_READY_DEFINE + " 1",
		closureLimitDefineLine(closureCeiling),
		"",
		"uniform int " + SB_CLOSURE_COUNT_UNIFORM_NAME + ";",
		"",
		"struct SbClosureRadiance {",
		"\tvec3 diffuse;",
		"\tvec3 specular;",
		"};",
		"",
		"// Quantas closures este material avalia, sempre dentro do teto compilado.",
		"int sbActiveClosureCount() {",
		"\treturn clamp(" + SB_CLOSURE_COUNT_UNIFORM_NAME + ", 1, " + SB_CLOSURE_LIMIT_DEFINE + ");",
		"}",
		"",
		"// STUB da SB-F8: sem buffer de material o peso reparte o lobo legado em",
		"// partes iguais. Com uma closure o peso e exatamente 1.0, e 1.0 nao muda um bit.",
		"float sbClosureWeight(const in int slot, const in int activeClosureCount) {",
		"\treturn 1.0 / float(activeClosureCount);",
		"}",
		"",
		"// STUB da SB-F10: sem BSDF por closure, cada slot devolve o lobo legado.",
		"SbClosureRadiance sbEvaluateClosure(const in int slot, const in SbClosureRadiance legacyRadiance) {",
		"\treturn legacyRadiance;",
		"}",
		"",
		"// O laco da fase: teto compilado, contagem por material em uniform e soma",
		"// sem normalizacao, para o caso de uma closure sair identico ao legado.",
		"SbClosureRadiance sbDispatchClosures(const in SbClosureRadiance legacyRadiance) {",
		"\tint activeClosureCount = sbActiveClosureCount();",
		"\tSbClosureRadiance dispatchedRadiance = SbClosureRadiance(vec3(0.0), vec3(0.0));",
		"\tfor (int slot = 0; " + SB_CLOSURE_LIMIT_DEFINE + " > slot; slot += 1) {",
		"\t\tif (slot >= activeClosureCount) break;",
		"\t\tfloat closureWeight = sbClosureWeight(slot, activeClosureCount);",
		"\t\tSbClosureRadiance closureRadiance = sbEvaluateClosure(slot, legacyRadiance);",
		"\t\tdispatchedRadiance.diffuse += closureRadiance.diffuse * closureWeight;",
		"\t\tdispatchedRadiance.specular += closureRadiance.specular * closureWeight;",
		"\t}",
		"\treturn dispatchedRadiance;",
		"}",
	].join("\n")
}







export function buildClosureDispatchCode() {
	return [
		"#ifdef " + SB_CLOSURE_DISPATCH_READY_DEFINE,
		"{",
		"\tSbClosureRadiance sbLegacyRadiance = SbClosureRadiance(",
		"\t\treflectedLight.directDiffuse + reflectedLight.indirectDiffuse,",
		"\t\treflectedLight.directSpecular + reflectedLight.indirectSpecular",
		"\t);",
		"\tSbClosureRadiance sbDispatchedRadiance = sbDispatchClosures(sbLegacyRadiance);",
		"\treflectedLight.indirectDiffuse += sbDispatchedRadiance.diffuse - sbLegacyRadiance.diffuse;",
		"\treflectedLight.indirectSpecular += sbDispatchedRadiance.specular - sbLegacyRadiance.specular;",
		"}",
		"#endif",
	].join("\n")
}


export function buildClosureDispatchGlsl(input) {
	const closureCeiling = resolveClosureCeiling(input?.closureCeiling)
	return {
		closureCeiling,
		declarations: buildClosureDispatchDeclarations({ closureCeiling }),
		code: buildClosureDispatchCode(),
	}
}


export function closureDispatchGlslProblems(glsl) {
	const problems = []
	const declarations = typeof glsl?.declarations === "string" ? glsl.declarations : ""
	const code = typeof glsl?.code === "string" ? glsl.code : ""

	if (!declarations.includes(closureLimitDefineLine(glsl?.closureCeiling))) {
		problems.push("o teto de closures nao saiu compilado nas declaracoes")
	}
	if (!declarations.includes("uniform int " + SB_CLOSURE_COUNT_UNIFORM_NAME + ";")) {
		problems.push("o uniform " + SB_CLOSURE_COUNT_UNIFORM_NAME + " nao foi declarado")
	}
	if (!declarations.includes(SB_CLOSURE_LIMIT_DEFINE + " > slot")) {
		problems.push("o laco nao usa o teto compilado como limite")
	}
	if (!code.includes("#ifdef " + SB_CLOSURE_DISPATCH_READY_DEFINE)) {
		problems.push("o bloco do main nao esta protegido pelo ifdef de prontidao")
	}
	return problems
}

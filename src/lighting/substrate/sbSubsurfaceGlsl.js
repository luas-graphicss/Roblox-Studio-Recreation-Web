import { SB_SUBSURFACE_LUT_WIDTH, maximumMeanFreePathMillimeters } from "./sbSubsurfaceMfpCore.js"

const MAXIMUM_MEAN_FREE_PATH = maximumMeanFreePathMillimeters()
const SAFE_MAXIMUM_MEAN_FREE_PATH = MAXIMUM_MEAN_FREE_PATH > 0 ? MAXIMUM_MEAN_FREE_PATH : 1
const HALF_TEXEL = 0.5 / SB_SUBSURFACE_LUT_WIDTH

function glslFloat(value) {
	return Number(value).toFixed(6)
}

export const SB_SUBSURFACE_UNIFORM_NAMES = Object.freeze({
	meanFreePath: "uSbSubsurfaceMfp",
	diffusionTexture: "uSbSubsurfaceTexture",
})

const MEAN_FREE_PATH = SB_SUBSURFACE_UNIFORM_NAMES.meanFreePath
const DIFFUSION_TEXTURE = SB_SUBSURFACE_UNIFORM_NAMES.diffusionTexture


export const SB_SUBSURFACE_DECLARATIONS_GLSL = [
	"uniform vec3 " + MEAN_FREE_PATH + ";",
	"uniform sampler2D " + DIFFUSION_TEXTURE + ";",
	"",
	"// Milimetro de caminho livre medio para o centro do texel da tabela.",
	"float sbSubsurfaceLutCoordinate(float meanFreePathMillimeters) {",
	"\tfloat normalized = clamp(meanFreePathMillimeters / " + glslFloat(SAFE_MAXIMUM_MEAN_FREE_PATH) + ", 0.0, 1.0);",
	"\treturn mix(" + glslFloat(HALF_TEXEL) + ", 1.0 - " + glslFloat(HALF_TEXEL) + ", normalized);",
	"}",
	"",
	"// r = fracao difundida, g = largura do wrap, b = transmitancia, a = tabela assada.",
	"vec4 sbSubsurfaceProfileRow(float meanFreePathMillimeters) {",
	"\treturn texture2D(" + DIFFUSION_TEXTURE + ", vec2(sbSubsurfaceLutCoordinate(meanFreePathMillimeters), 0.5));",
	"}",
	"",
	"// Um toque por canal: cada canal tem o seu proprio caminho livre medio.",
	"// Sem tabela assada o sampler devolve alfa 0 e a fase inteira vira identidade.",
	"vec3 sbSubsurfaceBleedFraction(vec3 meanFreePathMillimeters) {",
	"\tvec4 redRow = sbSubsurfaceProfileRow(meanFreePathMillimeters.r);",
	"\tvec4 greenRow = sbSubsurfaceProfileRow(meanFreePathMillimeters.g);",
	"\tvec4 blueRow = sbSubsurfaceProfileRow(meanFreePathMillimeters.b);",
	"\tfloat tableIsBaked = min(min(redRow.a, greenRow.a), blueRow.a);",
	"\treturn clamp(vec3(redRow.r, greenRow.r, blueRow.r) * tableIsBaked, 0.0, 1.0);",
	"}",
].join("\n")








export const SB_SUBSURFACE_APPLY_GLSL = [
	"{",
	"\tvec3 sbSubsurfaceBleed = sbSubsurfaceBleedFraction(" + MEAN_FREE_PATH + ");",
	"\tvec3 sbSubsurfaceMovedEnergy = reflectedLight.directDiffuse * sbSubsurfaceBleed;",
	"\treflectedLight.directDiffuse -= sbSubsurfaceMovedEnergy;",
	"\treflectedLight.indirectDiffuse += sbSubsurfaceMovedEnergy;",
	"}",
].join("\n")

export const SB_SUBSURFACE_GLSL = Object.freeze({
	declarations: SB_SUBSURFACE_DECLARATIONS_GLSL,
	apply: SB_SUBSURFACE_APPLY_GLSL,
	lutWidth: SB_SUBSURFACE_LUT_WIDTH,
	maximumMeanFreePathMillimeters: MAXIMUM_MEAN_FREE_PATH,
	halfTexel: HALF_TEXEL,
})

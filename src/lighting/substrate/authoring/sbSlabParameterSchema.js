import { SB_CLOSURE_LAYOUTS } from '../sbClosureLayouts.js';

export const SB_SLAB_PARAMETER_KINDS = Object.freeze({
  color3: 'color3', vector3: 'vector3', scalar: 'scalar', angleRadians: 'angleRadians',
});

const parameterDefinitions = [
  {"name": "albedo", "kind": "color3", "unit": "refletancia linear", "minimum": 0, "maximum": 1, "defaultValue": [0.82, 0.82, 0.82], "closureField": "albedo", "rationale": "difusa em espaco linear; metal nasce em zero porque a cor dele vira F0"},
  {"name": "f0", "kind": "color3", "unit": "refletancia linear", "minimum": 0, "maximum": 1, "defaultValue": [0.04, 0.04, 0.04], "closureField": "f0", "rationale": "especular na incidencia normal; 0,04 e o dieletrico padrao"},
  {"name": "f90", "kind": "scalar", "unit": "refletancia linear", "minimum": 0, "maximum": 1, "defaultValue": 1, "closureField": "f90", "rationale": "especular rasante; escalar porque o layout reserva 1 byte"},
  {"name": "roughness", "kind": "scalar", "unit": "rugosidade GGX", "minimum": 0.02, "maximum": 1, "defaultValue": 0.4, "closureField": "roughness", "rationale": "piso 0,02 e o menor lobo que 8 bits resolvem sem serrilhar o especular"},
  {"name": "anisotropy", "kind": "scalar", "unit": "fracao", "minimum": 0, "maximum": 1, "defaultValue": 0, "closureField": "anisotropy", "rationale": "forca do estiramento; o sentido mora em anisotropyRotation, o que mantem 8 bits dentro do portao"},
  {"name": "anisotropyRotation", "kind": "angleRadians", "unit": "radianos", "minimum": 0, "maximum": Math.PI, "defaultValue": 0, "closureField": "anisotropyRotation", "rationale": "giro do quadro tangente; periodo pi porque o estiramento e simetrico a meia volta"},
  {"name": "secondRoughness", "kind": "scalar", "unit": "rugosidade GGX", "minimum": 0, "maximum": 1, "defaultValue": 0, "closureField": "secondRoughness", "rationale": "segundo lobo especular; zero e desligado e so vale quando o peso passa de zero"},
  {"name": "secondRoughnessWeight", "kind": "scalar", "unit": "fracao", "minimum": 0, "maximum": 1, "defaultValue": 0, "closureField": "secondRoughnessWeight", "rationale": "mistura do segundo lobo; zero desliga sem custo"},
  {"name": "fuzzAmount", "kind": "scalar", "unit": "fracao", "minimum": 0, "maximum": 1, "defaultValue": 0, "closureField": "fuzzAmount", "rationale": "quantidade de fibra na superficie (sheen de tecido)"},
  {"name": "fuzzRoughness", "kind": "scalar", "unit": "rugosidade GGX", "minimum": 0.05, "maximum": 1, "defaultValue": 0.5, "closureField": "fuzzRoughness", "rationale": "abertura do lobo de fibra; abaixo de 0,05 o sheen virou espelho"},
  {"name": "fuzzColor", "kind": "color3", "unit": "refletancia linear", "minimum": 0, "maximum": 1, "defaultValue": [1, 1, 1], "closureField": "fuzzColor", "rationale": "cor da fibra, mais clara que o albedo"},
  {"name": "subsurfaceMeanFreePath", "kind": "vector3", "unit": "milimetros", "minimum": 0, "maximum": 16, "defaultValue": [0, 0, 0], "closureField": "subsurfaceMeanFreePath", "rationale": "caminho livre medio por canal; 16 mm cobre pele, leite e marmore"},
  {"name": "subsurfacePhase", "kind": "scalar", "unit": "g de Henyey-Greenstein", "minimum": -1, "maximum": 1, "defaultValue": 0, "closureField": "subsurfacePhase", "rationale": "o sinal e fisico: negativo espalha para tras, positivo para frente"},
  {"name": "thinFilmThicknessNanometers", "kind": "scalar", "unit": "nanometros", "minimum": 0, "maximum": 2000, "defaultValue": 0, "closureField": "thinFilmThicknessNanometers", "rationale": "2000 nm passa da terceira ordem de interferencia visivel; acima a cor repete"},
  {"name": "thinFilmIor", "kind": "scalar", "unit": "indice de refracao", "minimum": 1, "maximum": 3, "defaultValue": 1.35, "closureField": "thinFilmIor", "rationale": "1 e vacuo; 3 cobre os filmes densos de verniz e bolha"},
  {"name": "glintDensity", "kind": "scalar", "unit": "flocos por metro quadrado", "minimum": 0, "maximum": 20000, "defaultValue": 0, "closureField": "glintDensity", "rationale": "teto onde o cintilar ainda e resolvivel em tela; acima vira ruido branco"},
  {"name": "glintRoughness", "kind": "scalar", "unit": "rugosidade GGX", "minimum": 0.005, "maximum": 1, "defaultValue": 0.05, "closureField": "glintRoughness", "rationale": "rugosidade do floco; e ela que governa o LOD do cintilar"},
  {"name": "emissive", "kind": "color3", "unit": "refletancia linear equivalente", "minimum": 0, "maximum": 16, "defaultValue": [0, 0, 0], "closureField": "emissive", "rationale": "emissao propria; 16 cobre o neon legado sem pedir mais que 8 bits por canal"},
  {"name": "specularProfileIndex", "kind": "scalar", "integer": true, "unit": "profile index", "minimum": 0, "maximum": 255, "defaultValue": 0, "closureField": "specularProfileIndex", "rationale": "Persistent per-closure profile selector in the existing byte; zero is neutral."},
  {"name": "opacity", "kind": "scalar", "unit": "fracao", "minimum": 0, "maximum": 1, "defaultValue": 1, "closureField": null, "rationale": "cobertura do pixel; fora do registro de closure (alpha do framebuffer e OIT da SB-F23)"}
];
const parameterNames = Object.freeze(parameterDefinitions.map(definition => definition.name));
const slabPayloadFields = SB_CLOSURE_LAYOUTS.slab.payload;

export const SB_SLAB_PARAMETERS_OUTSIDE_CLOSURE = Object.freeze(
  parameterDefinitions.filter(definition => definition.closureField === null).map(definition => definition.name),
);

function describeEncoding(definition) {
  const channelCount = definition.kind === 'color3' || definition.kind === 'vector3' ? 3 : 1;
  const field = slabPayloadFields.find(entry => entry.name === definition.closureField);
  const closureBytes = definition.closureField === null || field === undefined ? 0 : field.bytes;
  const bytesPerChannel = closureBytes === 0 ? 0 : closureBytes / channelCount;
  const quantizationLevels = closureBytes === 0 ? 0 : Math.pow(2, bytesPerChannel * 8) - 1;
  const rangeWidth = definition.maximum - definition.minimum;
  return {
    channelCount, closureBytes, bytesPerChannel, quantizationLevels,
    quantizationStep: quantizationLevels === 0 ? 0 : rangeWidth / quantizationLevels,
    rangeWidth, isNormalizedRange: 1 >= rangeWidth,
  };
}

const parameterSchema = Object.freeze(parameterDefinitions.reduce((schema, definition) => {
  const defaultValue = Array.isArray(definition.defaultValue) ? Object.freeze(definition.defaultValue.slice()) : definition.defaultValue;
  schema[definition.name] = Object.freeze({ ...definition, defaultValue, encoding: Object.freeze(describeEncoding(definition)) });
  return schema;
}, {}));

export function slabParameterNames() {
  return parameterNames.slice();
}

export function slabParameterCount() {
  return parameterNames.length;
}

export function slabParameterSchema(name) {
  const schema = parameterSchema[name];
  return schema === undefined ? null : schema;
}

export function describeSlabParameters() {
  return parameterNames.map(name => parameterSchema[name]);
}

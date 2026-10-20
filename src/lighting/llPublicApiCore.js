import { hashImageText as hashCanonicalText } from "./llImageFingerprintCore.js";
import { PUBLIC_API_BLOCK_NAME } from "./llPublicApiContract.js";


export const LL_PUBLIC_API_VERSION = "LL-F22/2026-09-01";

export const PUBLIC_API_PROPERTY_TYPES = Object.freeze({
  NUMBER: "number",
  BOOLEAN: "boolean",
  TRI_STATE: "triState",
  ENUM: "enum",
  TEXT: "text",
});


export const LOCAL_LIGHT_KINDS = Object.freeze(["PointLight", "SpotLight", "SurfaceLight", "RectLight", "TubeLight"]);

const SPHERE_AND_CONE_KINDS = Object.freeze(["PointLight", "SpotLight", "TubeLight"]);
const CONE_KINDS = Object.freeze(["SpotLight", "SurfaceLight"]);
const RECT_KINDS = Object.freeze(["SurfaceLight", "RectLight"]);


export const PUBLIC_API_UNITS = Object.freeze({
  PHOTOMETRIC: "lm|cd|EV",
  STUD: "stud",
  DEGREE: "deg",
  SCALE: "x",
});

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function definePublicApiProperty(descriptor) {
  return Object.freeze({
    name: descriptor.name,
    type: descriptor.type,
    defaultValue: descriptor.defaultValue === undefined ? null : descriptor.defaultValue,
    min: finiteOrNull(descriptor.min),
    max: finiteOrNull(descriptor.max),
    options: Object.freeze(Array.isArray(descriptor.options) ? descriptor.options.slice() : []),
    phase: descriptor.phase,
    unit: descriptor.unit || null,
    appliesTo: Object.freeze(Array.isArray(descriptor.appliesTo) ? descriptor.appliesTo.slice() : LOCAL_LIGHT_KINDS.slice()),


    unrealAlias: descriptor.unrealAlias || null,


    robloxNative: descriptor.robloxNative === true,
    doc: descriptor.doc || "",
  });
}





export const LL_PUBLIC_API = Object.freeze([
  definePublicApiProperty({
    name: "UEFalloff",
    type: PUBLIC_API_PROPERTY_TYPES.TRI_STATE,
    defaultValue: null,
    phase: "LL-F2",
    unrealAlias: "bUseInverseSquaredFalloff",
    doc: "Tri-state: queda de luz no contrato UE (janela saturate(1-(d/R)^4)^2 sobre d^2+1). Ausente = decide pelo tier; ligado = UE; desligado = a curva do three de hoje.",
  }),
  definePublicApiProperty({
    name: "IntensityUnits",
    type: PUBLIC_API_PROPERTY_TYPES.ENUM,
    defaultValue: "unitless",
    options: ["unitless", "lumens", "candela", "ev"],
    phase: "LL-F3",
    unit: PUBLIC_API_UNITS.PHOTOMETRIC,
    unrealAlias: "IntensityUnits",
    doc: "Unidade em que Intensity e lida: unitless mantem a rampa legada de Brightness, lumens/candela/ev sao absolutos e convertidos pela abertura real da luz.",
  }),
  definePublicApiProperty({
    name: "UseIESBrightness",
    type: PUBLIC_API_PROPERTY_TYPES.BOOLEAN,
    defaultValue: false,
    phase: "LL-F3",
    unrealAlias: "bUseIESBrightness",
    doc: "Quando ligado, a candela absoluta vem do perfil IES (LM-63) e Intensity deixa de mandar.",
  }),
  definePublicApiProperty({
    name: "Intensity",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 0,
    min: -20,
    max: 1000000,
    phase: "LL-F3",
    unit: PUBLIC_API_UNITS.PHOTOMETRIC,
    unrealAlias: "Intensity",
    doc: "Valor absoluto da intensidade na unidade de IntensityUnits. O minimo negativo existe porque EV100 aceita valores negativos; em lumens e candela o valor e sempre positivo.",
  }),
  definePublicApiProperty({
    name: "IESBrightnessScale",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 1,
    min: 0,
    max: 100,
    phase: "LL-F3",
    unit: PUBLIC_API_UNITS.SCALE,
    unrealAlias: "IESIntensityScale",
    doc: "Multiplica a candela do perfil IES quando UseIESBrightness esta ligado.",
  }),
  definePublicApiProperty({
    name: "SourceLength",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 0,
    min: 0,
    max: 20,
    phase: "LL-F4",
    unit: PUBLIC_API_UNITS.STUD,
    appliesTo: SPHERE_AND_CONE_KINDS,
    unrealAlias: "SourceLength",
    doc: "Comprimento da fonte em studs: transforma a esfera em capsula (tubo/letreiro), no difuso e no especular.",
  }),
  definePublicApiProperty({
    name: "SoftSourceRadius",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 0,
    min: 0,
    max: 8,
    phase: "LL-F4",
    unit: PUBLIC_API_UNITS.STUD,
    appliesTo: SPHERE_AND_CONE_KINDS,
    unrealAlias: "SoftSourceRadius",
    doc: "Soma ao SourceRadius APENAS no difuso: amacia o terminador sem inchar o brilho especular.",
  }),
  definePublicApiProperty({
    name: "InnerConeAngle",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 0,
    min: 0,
    max: 179,
    phase: "LL-F5",
    unit: PUBLIC_API_UNITS.DEGREE,
    appliesTo: CONE_KINDS,
    unrealAlias: "InnerConeAngle",
    doc: "Abertura total do miolo do cone. 0 mantem a largura legada (penumbra 0,4 reescrita como angulo).",
  }),
  definePublicApiProperty({
    name: "OuterConeAngle",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 90,
    min: 1,
    max: 179,
    phase: "LL-F5",
    unit: PUBLIC_API_UNITS.DEGREE,
    appliesTo: CONE_KINDS,
    unrealAlias: "OuterConeAngle",
    doc: "Abertura total da borda do cone. So pode ESTREITAR o Angle do Roblox: alargar vazaria luz fora do cone legado.",
  }),
  definePublicApiProperty({
    name: "SpecularScale",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 1,
    min: 0,
    max: 4,
    phase: "LL-F6",
    unit: PUBLIC_API_UNITS.SCALE,
    unrealAlias: "SpecularScale",
    doc: "Escala so o termo especular da luz (1 = fisico). Serve para matar highlight de fonte de preenchimento.",
  }),
  definePublicApiProperty({
    name: "BarnDoorAngle",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 90,
    min: 0,
    max: 90,
    phase: "LL-F7",
    unit: PUBLIC_API_UNITS.DEGREE,
    appliesTo: RECT_KINDS,
    unrealAlias: "BarnDoorAngle",
    doc: "Abertura das portas da rect: 90 = totalmente aberta (sem corte), 0 = feixe fechado em tunel.",
  }),
  definePublicApiProperty({
    name: "BarnDoorLength",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 0,
    min: 0,
    max: 20,
    phase: "LL-F7",
    unit: PUBLIC_API_UNITS.STUD,
    appliesTo: RECT_KINDS,
    unrealAlias: "BarnDoorLength",
    doc: "Comprimento das portas da rect em studs: porta mais longa recorta o feixe mais longe da fonte.",
  }),
  definePublicApiProperty({
    name: "SourceTexture",
    type: PUBLIC_API_PROPERTY_TYPES.TEXT,
    defaultValue: "",
    phase: "LL-F7",
    appliesTo: RECT_KINDS,
    unrealAlias: "SourceTexture",
    doc: "Textura da fonte da rect (TV, vitral, painel). A cor media modula o LTC e aparece no reflexo alongado.",
  }),
  definePublicApiProperty({
    name: "TwoSided",
    type: PUBLIC_API_PROPERTY_TYPES.BOOLEAN,
    defaultValue: false,
    phase: "LL-F7",
    appliesTo: RECT_KINDS,
    unrealAlias: null,
    doc: "Rect emitindo pelos DOIS lados da face. A UE 5.8 nao tem propriedade equivalente: e paridade com o SurfaceLight do Roblox.",
  }),
  definePublicApiProperty({
    name: "FilterSharpen",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 0,
    min: 0,
    max: 1,
    phase: "LL-F14",
    unit: PUBLIC_API_UNITS.SCALE,
    unrealAlias: "ShadowSharpen",
    doc: "Endurece o filtro da sombra desta luz (0 = penumbra cheia da fonte, 1 = borda mais seca).",
  }),
  definePublicApiProperty({
    name: "ShadowSlopeBias",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 0,
    min: 0,
    max: 8,
    phase: "LL-F14",
    unit: PUBLIC_API_UNITS.SCALE,
    unrealAlias: "ShadowSlopeBias",
    doc: "Bias por inclinacao da sombra desta luz. Sobe para matar acne em superficie rasante; alto demais causa peter-panning.",
  }),
  definePublicApiProperty({
    name: "ContactShadowLength",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 0,
    min: 0,
    max: 8,
    phase: "LL-F15",
    unit: PUBLIC_API_UNITS.STUD,
    unrealAlias: "ContactShadowLength",
    doc: "Comprimento em studs da marcha de contato desta luz. 0 desliga o contato para ela.",
  }),
  definePublicApiProperty({
    name: "RayTracedShadow",
    type: PUBLIC_API_PROPERTY_TYPES.BOOLEAN,
    defaultValue: false,
    phase: "LL-F16",
    unrealAlias: "CastRaytracedShadow",
    doc: "Opt-in de sombra por raio para esta luz (somente tier forte). Default desligado: o atlas continua dono da sombra.",
  }),
  definePublicApiProperty({
    name: "VolumetricScatteringIntensity",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 1,
    min: 0,
    max: 8,
    phase: "LL-F17",
    unit: PUBLIC_API_UNITS.SCALE,
    unrealAlias: "VolumetricScatteringIntensity",
    doc: "Quanto esta luz injeta no fog volumetrico (shaft de spot). 0 tira a luz do ar sem apagar o direto.",
  }),
  definePublicApiProperty({
    name: "IndirectLightingIntensity",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 1,
    min: 0,
    max: 8,
    phase: "LL-F18",
    unit: PUBLIC_API_UNITS.SCALE,
    unrealAlias: "IndirectLightingIntensity",
    doc: "Escala do bounce (GI) desta luz. 0 mata SO o indireto e mantem o direto intacto.",
  }),
  definePublicApiProperty({
    name: "MaxDrawDistance",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 0,
    min: 0,
    max: 1000,
    phase: "LL-F21",
    unit: PUBLIC_API_UNITS.STUD,
    unrealAlias: "MaxDrawDistance",
    doc: "Distancia em que a luz para de ser desenhada. 0 = sem corte.",
  }),
  definePublicApiProperty({
    name: "FadeRange",
    type: PUBLIC_API_PROPERTY_TYPES.NUMBER,
    defaultValue: 0,
    min: 0,
    max: 200,
    phase: "LL-F21",
    unit: PUBLIC_API_UNITS.STUD,
    unrealAlias: "MaxDistanceFadeRange",
    doc: "Faixa de fade antes do MaxDrawDistance: intensidade E sombra caem juntas para nao dar pop.",
  }),
]);

const PROPERTY_BY_NAME = new Map(LL_PUBLIC_API.map((property) => [property.name, property]));

export function publicApiPropertyNames() {
  return LL_PUBLIC_API.map((property) => property.name);
}

export function findPublicApiProperty(name) {
  return PROPERTY_BY_NAME.get(name) || null;
}

export function isPublicApiProperty(name) {
  return PROPERTY_BY_NAME.has(name);
}

export function propertiesForLightKind(kind) {
  return LL_PUBLIC_API.filter((property) => property.appliesTo.indexOf(kind) >= 0);
}

export function publicApiPropertiesByPhase() {
  const byPhase = {};
  LL_PUBLIC_API.forEach((property) => {
    if (!byPhase[property.phase]) byPhase[property.phase] = [];
    byPhase[property.phase].push(property.name);
  });
  return byPhase;
}

function clampNumberValue(property, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return property.defaultValue;
  const floor = property.min === null ? -Infinity : property.min;
  const ceiling = property.max === null ? Infinity : property.max;
  return Math.min(Math.max(parsed, floor), ceiling);
}

function clampByType(property, value) {
  if (property.type === PUBLIC_API_PROPERTY_TYPES.NUMBER) return clampNumberValue(property, value);

  if (property.type === PUBLIC_API_PROPERTY_TYPES.BOOLEAN) return !!value;
  if (property.type === PUBLIC_API_PROPERTY_TYPES.TRI_STATE) return value === true ? true : value === false ? false : null;
  if (property.type === PUBLIC_API_PROPERTY_TYPES.ENUM) return property.options.indexOf(value) >= 0 ? value : property.defaultValue;


  return typeof value === "string" ? value : property.defaultValue;
}


export function clampPublicApiValue(name, value) {
  const property = findPublicApiProperty(name);
  return property ? clampByType(property, value) : value;
}

export function defaultPublicApiProps() {
  const props = {};
  LL_PUBLIC_API.forEach((property) => {
    props[property.name] = property.defaultValue;
  });
  return props;
}


export function sanitizePublicApiProps(props) {
  const source = props && typeof props === "object" ? props : {};
  const sanitized = {};
  LL_PUBLIC_API.forEach((property) => {
    const authored = Object.prototype.hasOwnProperty.call(source, property.name) ? source[property.name] : property.defaultValue;
    sanitized[property.name] = clampByType(property, authored);
  });
  return sanitized;
}


export function changedPublicApiProps(props) {
  const sanitized = sanitizePublicApiProps(props);
  return LL_PUBLIC_API.filter((property) => sanitized[property.name] !== property.defaultValue).map((property) => property.name);
}


export function publicApiDocRows() {
  return LL_PUBLIC_API.map((property) => ({
    name: property.name,
    type: property.type,
    default: property.defaultValue,
    range: property.type === PUBLIC_API_PROPERTY_TYPES.NUMBER ? [property.min, property.max] : null,
    options: property.options.length ? property.options.slice() : null,
    phase: property.phase,
    unit: property.unit,
    unrealAlias: property.unrealAlias,
    appliesTo: property.appliesTo.slice(),
    doc: property.doc,
  }));
}


export function findNativeNameCollisions(nativeNames) {
  const names = Array.isArray(nativeNames) ? nativeNames : [];
  return LL_PUBLIC_API.filter((property) => names.indexOf(property.name) >= 0).map((property) => property.name);
}

const BENCH_TYPE_BY_API_TYPE = Object.freeze({
  number: "num",
  boolean: "bool",
  triState: "tri",
  enum: "enum",
  text: "texto",
});

function sameOptionList(apiOptions, benchOptions) {
  const bench = Array.isArray(benchOptions) ? benchOptions : [];
  if (apiOptions.length !== bench.length) return false;
  return apiOptions.every((option, index) => option === bench[index]);
}


export function comparePublicApiWithPropContract(propContract) {
  const contract = Array.isArray(propContract) ? propContract : [];
  const byName = new Map(contract.map((entry) => [entry.nome, entry]));
  const rows = LL_PUBLIC_API.map((property) => {
    const benchProperty = byName.get(property.name) || null;
    const expectedBenchType = BENCH_TYPE_BY_API_TYPE[property.type];
    return {
      name: property.name,
      inContract: !!benchProperty,
      typeMatches: !!benchProperty && benchProperty.tipo === expectedBenchType,
      defaultMatches: !!benchProperty && benchProperty.dft === property.defaultValue,
      minMatches: !!benchProperty && (property.min === null ? benchProperty.min === undefined : benchProperty.min === property.min),
      maxMatches: !!benchProperty && (property.max === null ? benchProperty.max === undefined : benchProperty.max === property.max),
      phaseMatches: !!benchProperty && benchProperty.fase === property.phase,
      optionsMatch: !!benchProperty && sameOptionList(property.options, benchProperty.opcoes),
    };
  });
  const problems = rows.filter(
    (row) =>
      !row.inContract || !row.typeMatches || !row.defaultMatches || !row.minMatches || !row.maxMatches || !row.phaseMatches || !row.optionsMatch,
  );
  return {
    ok: problems.length === 0,
    checked: rows.length,
    problems: problems.map((row) => row.name),
    rows,
  };
}

function canonicalLineFor(property) {
  return [
    property.name,
    property.type,
    String(property.defaultValue),
    property.min === null ? "-" : String(property.min),
    property.max === null ? "-" : String(property.max),
    property.options.length ? property.options.join("|") : "-",
    property.phase,
  ].join(";");
}


export function publicApiCanonicalText() {
  return LL_PUBLIC_API.map(canonicalLineFor).join("\n");
}


export function publicApiChecksum() {
  return hashCanonicalText(PUBLIC_API_BLOCK_NAME + "@" + LL_PUBLIC_API_VERSION + "\n" + publicApiCanonicalText());
}

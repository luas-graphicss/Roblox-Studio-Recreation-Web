import {
  ATLAS_TINT_FUNCTION,
  SUBSURFACE_FUNCTION,
  SUBSURFACE_MATERIAL_UNIFORM,
  TRANSMISSION_MIX_UNIFORM,
  TRANSMISSION_TINT_FUNCTION,
} from "./llTransmissionContract.js";
import {
  SUBSURFACE_AMBIENT_MIX,
  SUBSURFACE_EXTINCTION_PER_STUD,
  SUBSURFACE_FORWARD_MIX,
} from "./llLocalSubsurfaceCore.js";


export const RE_DIRECT_CALL = "RE_Direct( directLight";

export const LOCAL_LIGHT_KINDS = Object.freeze([
  Object.freeze({ kind: "point", infoFunction: "getPointLightInfo" }),
  Object.freeze({ kind: "spot", infoFunction: "getSpotLightInfo" }),
]);

export const INJECTION_REFUSALS = Object.freeze({
  alreadyInjected: "already-injected",
  noLocalLightLoop: "no-local-light-loop",
  noReDirect: "no-re-direct",
});

function glslFloat(value) {
  const text = String(Number(value));
  return text.indexOf(".") >= 0 || text.indexOf("e") >= 0 ? text : text + ".0";
}

export function hasAtlasTintFunction(source) {
  return typeof source === "string" && source.indexOf(ATLAS_TINT_FUNCTION) >= 0;
}

export function buildTransmissionDeclarations() {
  return [
    "// LL-F16: transmissao das luzes LOCAIS (tinte do vitral + SSS/foliage).",
    "// Entra DEPOIS das declaracoes do atlas (LL-F10) porque chama " + ATLAS_TINT_FUNCTION + ".",
    "uniform vec4 " + TRANSMISSION_MIX_UNIFORM + ";       // x = tinte, y = SSS (A/B sem recompilar)",
    "uniform vec4 " + SUBSURFACE_MATERIAL_UNIFORM + ";  // POR MATERIAL: x=espessura(studs) y=wrap z=forca w=nitidez",
    "const float LL_SSS_EXTINCTION_PER_STUD = " + glslFloat(SUBSURFACE_EXTINCTION_PER_STUD) + ";",
    "const float LL_SSS_AMBIENT_MIX = " + glslFloat(SUBSURFACE_AMBIENT_MIX) + ";",
    "const float LL_SSS_FORWARD_MIX = " + glslFloat(SUBSURFACE_FORWARD_MIX) + ";",
    "",
    "vec3 " + TRANSMISSION_TINT_FUNCTION + "( const in vec3 surfaceViewPosition, const in vec3 lightViewPosition ) {",
    "\tif ( " + TRANSMISSION_MIX_UNIFORM + ".x <= 0.0 || uTransCount <= 0 ) return vec3( 1.0 );",
    "\treturn mix( vec3( 1.0 ), " + ATLAS_TINT_FUNCTION + "( surfaceViewPosition, lightViewPosition ), " + TRANSMISSION_MIX_UNIFORM + ".x );",
    "}",
    "",
    "vec3 " + SUBSURFACE_FUNCTION + "( const in vec3 lightColor, const in vec3 lightDirection, const in vec3 surfaceNormal, const in vec3 viewDirection, const in vec3 albedo ) {",
    "\tfloat strength = " + SUBSURFACE_MATERIAL_UNIFORM + ".z * " + TRANSMISSION_MIX_UNIFORM + ".y;",
    "\tif ( strength <= 0.0 ) return vec3( 0.0 );",
    "\tfloat backLit = max( -dot( surfaceNormal, lightDirection ), 0.0 );",
    "\tfloat wrapAmount = max( " + SUBSURFACE_MATERIAL_UNIFORM + ".y, 0.0 );",
    "\tfloat wrapped = clamp( ( backLit + wrapAmount ) / ( 1.0 + wrapAmount ), 0.0, 1.0 );",
    "\twrapped *= wrapped;",
    "\tfloat transmitted = exp( -max( " + SUBSURFACE_MATERIAL_UNIFORM + ".x, 0.0 ) * LL_SSS_EXTINCTION_PER_STUD );",
    "\tfloat forward = pow( clamp( dot( viewDirection, -lightDirection ), 0.0, 1.0 ), max( " + SUBSURFACE_MATERIAL_UNIFORM + ".w, 1.0 ) );",
    "\treturn lightColor * albedo * ( strength * wrapped * transmitted * ( LL_SSS_AMBIENT_MIX + LL_SSS_FORWARD_MIX * forward ) );",
    "}",
    "",
  ].join("\n");
}



function findLightInfoCall(source, infoFunction) {
  const pattern = new RegExp(infoFunction + "\\(\\s*(\\w+)\\s*,\\s*\\w+\\s*,\\s*directLight\\s*\\)\\s*;", "m");
  const match = pattern.exec(source);
  if (!match) return null;
  return {
    structName: match[1],
    startIndex: match.index,
    endIndex: match.index + match[0].length,
  };
}

function subsurfaceLine() {
  return "\n\t\treflectedLight.directDiffuse += " + SUBSURFACE_FUNCTION
    + "( directLight.color, directLight.direction, geometryNormal, geometryViewDir, material.diffuseColor );";
}

function tintLine(structName) {
  return "directLight.color *= " + TRANSMISSION_TINT_FUNCTION
    + "( geometryPosition, " + structName + ".position );\n\t\t";
}







export function injectTransmissionIntoLocalLightLoops(source) {
  if (typeof source !== "string" || source.length === 0) {
    return { replaced: false, reason: INJECTION_REFUSALS.noLocalLightLoop, source, patchedKinds: [] };
  }
  if (source.indexOf(TRANSMISSION_TINT_FUNCTION + "( geometryPosition") >= 0) {
    return { replaced: false, reason: INJECTION_REFUSALS.alreadyInjected, source, patchedKinds: [] };
  }

  let output = source;
  const patchedKinds = [];
  for (let index = 0; index < LOCAL_LIGHT_KINDS.length; index++) {
    const kind = LOCAL_LIGHT_KINDS[index];
    const info = findLightInfoCall(output, kind.infoFunction);
    if (!info) continue;                                               
    const reDirectIndex = output.indexOf(RE_DIRECT_CALL, info.endIndex);
    if (reDirectIndex < 0) {
      return {
        replaced: false,
        reason: INJECTION_REFUSALS.noReDirect + "-" + kind.kind,
        source,
        patchedKinds: [],
      };
    }
    output = output.slice(0, info.endIndex)
      + subsurfaceLine()
      + output.slice(info.endIndex, reDirectIndex)
      + tintLine(info.structName)
      + output.slice(reDirectIndex);
    patchedKinds.push(kind.kind);
  }

  if (patchedKinds.length === 0) {
    return { replaced: false, reason: INJECTION_REFUSALS.noLocalLightLoop, source, patchedKinds: [] };
  }
  return { replaced: true, reason: "", source: output, patchedKinds };
}

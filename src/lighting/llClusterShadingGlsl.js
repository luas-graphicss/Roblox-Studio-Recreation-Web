import { CLUSTER_GRID, CLUSTER_SHADING_UNIFORMS } from "./llClusterShadingContract.js";
import { CLUSTER_LIGHT_TEXEL_COUNT, CLUSTER_LIGHT_TEXTURE_WIDTH } from "./llClusterShadingCore.js";

export const CLUSTER_SHADING_MARKER = "// LL-F20 cluster shading";


export const CLUSTER_SHADING_LOOP_MARKER = CLUSTER_SHADING_MARKER + " loop";
export const RE_DIRECT_CALL_PATTERN = /RE_Direct\s*\(([^;]*)\)\s*;/;
export const CLUSTER_LIGHT_VARIABLE = "llF20DirectLight";


export const CLUSTER_SHADING_TAIL_MARKERS = Object.freeze([
  "#include <lights_fragment_maps>",
  "#include <lights_fragment_end>",
]);

let cachedLoopSource = null;
let cachedDirectCall = null;


export function buildClusterShadingDeclarations() {
  const uniforms = CLUSTER_SHADING_UNIFORMS;
  return [
    CLUSTER_SHADING_MARKER + " - uniforms and cell lookup.",
    "uniform float " + uniforms.enabled + ";",
    "uniform float " + uniforms.lightCount + ";",
    "uniform float " + uniforms.near + ";",
    "uniform float " + uniforms.far + ";",
    "uniform float " + uniforms.projectionScaleX + ";",
    "uniform float " + uniforms.projectionScaleY + ";",
    "uniform sampler2D " + uniforms.lightTexture + ";",
    "uniform sampler2D " + uniforms.cellTexture + ";",
    "uniform sampler2D " + uniforms.lightIndexTexture + ";",
    "const float LL_F20_TILES_X = " + glslFloat(CLUSTER_GRID.tilesX) + ";",
    "const float LL_F20_TILES_Y = " + glslFloat(CLUSTER_GRID.tilesY) + ";",
    "const float LL_F20_DEPTH_SLICES = " + glslFloat(CLUSTER_GRID.depthSlices) + ";",
    "const float LL_F20_CELL_COUNT = " + glslFloat(CLUSTER_GRID.cells) + ";",
    "const float LL_F20_INDEX_TEX_WIDTH = " + glslFloat(CLUSTER_GRID.indexTextureWidth) + ";",
    "const float LL_F20_INDEX_TEX_HEIGHT = " + glslFloat(CLUSTER_GRID.indexTextureHeight) + ";",
    "const float LL_F20_MAX_INDEX_ENTRIES = " + glslFloat(CLUSTER_GRID.maxIndexEntries) + ";",
    "const float LL_F20_LIGHT_TEX_WIDTH = " + glslFloat(CLUSTER_LIGHT_TEXTURE_WIDTH) + ";",
    "const float LL_F20_TEXELS_PER_LIGHT = " + glslFloat(CLUSTER_LIGHT_TEXEL_COUNT) + ";",
    "const int LL_F20_MAX_LIGHTS_PER_CELL = " + Math.floor(CLUSTER_GRID.maxLightsPerCell) + ";",
    "",
    "// Same math as clZSlice/clXYSlice/clCellIndex of the engine core.",
    "vec2 llF20CellAt( const in vec3 viewPosition ) {",
    "\tfloat viewDepth = max( - viewPosition.z, " + uniforms.near + " );",
    "\tfloat logNear = log( " + uniforms.near + " );",
    "\tfloat logFar = log( max( " + uniforms.far + ", " + uniforms.near + " + 0.001 ) );",
    "\tfloat depthSlice = clamp( floor( LL_F20_DEPTH_SLICES * ( log( viewDepth ) - logNear ) / ( logFar - logNear ) ), 0.0, LL_F20_DEPTH_SLICES - 1.0 );",
    "\tfloat inverseDepth = 1.0 / max( - viewPosition.z, 0.001 );",
    "\tfloat ndcX = viewPosition.x * " + uniforms.projectionScaleX + " * inverseDepth;",
    "\tfloat ndcY = viewPosition.y * " + uniforms.projectionScaleY + " * inverseDepth;",
    "\tfloat tileX = clamp( floor( ( ndcX + 1.0 ) * 0.5 * LL_F20_TILES_X ), 0.0, LL_F20_TILES_X - 1.0 );",
    "\tfloat tileY = clamp( floor( ( 1.0 - ndcY ) * 0.5 * LL_F20_TILES_Y ), 0.0, LL_F20_TILES_Y - 1.0 );",
    "\tfloat cellIndex = depthSlice * ( LL_F20_TILES_X * LL_F20_TILES_Y ) + tileY * LL_F20_TILES_X + tileX;",
    "\tvec4 cell = texture2D( " + uniforms.cellTexture + ", vec2( ( cellIndex + 0.5 ) / LL_F20_CELL_COUNT, 0.5 ) );",
    "\treturn vec2( cell.r, cell.g );",
    "}",
    "",
    "float llF20LightIndexAt( const in float indexSlot ) {",
    "\tfloat column = mod( indexSlot, LL_F20_INDEX_TEX_WIDTH );",
    "\tfloat row = floor( indexSlot / LL_F20_INDEX_TEX_WIDTH );",
    "\treturn texture2D( " + uniforms.lightIndexTexture + ", vec2( ( column + 0.5 ) / LL_F20_INDEX_TEX_WIDTH, ( row + 0.5 ) / LL_F20_INDEX_TEX_HEIGHT ) ).r;",
    "}",
    "",
    "vec4 llF20LightTexel( const in float lightIndex, const in float texelIndex ) {",
    "\tfloat column = lightIndex * LL_F20_TEXELS_PER_LIGHT + texelIndex;",
    "\treturn texture2D( " + uniforms.lightTexture + ", vec2( ( column + 0.5 ) / LL_F20_LIGHT_TEX_WIDTH, 0.5 ) );",
    "}",
  ].join("\n");
}


export function buildDirectCallFromSource(source, lightVariableName) {
  const match = String(source || "").match(RE_DIRECT_CALL_PATTERN);
  if (!match) return null;
  const argumentList = match[1].split(",").map((argument) => argument.trim()).filter((argument) => argument.length !== 0);
  if (argumentList.length === 0) return null;
  argumentList[0] = lightVariableName;
  return "RE_Direct( " + argumentList.join(", ") + " );";
}


export function buildClusterShadingLoop(directCallStatement) {
  const uniforms = CLUSTER_SHADING_UNIFORMS;
  const light = CLUSTER_LIGHT_VARIABLE;
  return [
    "",
    "\t" + CLUSTER_SHADING_LOOP_MARKER + " - the lights of THIS cell, above the forward budget.",
    "\t#if defined( RE_Direct )",
    "\tif ( " + uniforms.enabled + " > 0.5 && " + uniforms.lightCount + " > 0.5 ) {",
    "\t\tvec2 llF20Cell = llF20CellAt( geometryPosition );",
    "\t\tint llF20CellLightCount = int( llF20Cell.y );",
    "\t\tIncidentLight " + light + ";",
    "\t\tfor ( int llF20Slot = 0; llF20Slot < LL_F20_MAX_LIGHTS_PER_CELL; llF20Slot ++ ) {",
    "\t\t\tif ( llF20Slot >= llF20CellLightCount ) break;",
    "\t\t\tfloat llF20IndexSlot = llF20Cell.x + float( llF20Slot );",
    "\t\t\tif ( llF20IndexSlot >= LL_F20_MAX_INDEX_ENTRIES ) break;",
    "\t\t\tfloat llF20LightIndex = llF20LightIndexAt( llF20IndexSlot );",
    "\t\t\tif ( llF20LightIndex < 0.0 || llF20LightIndex >= " + uniforms.lightCount + " ) continue;",
    "\t\t\tvec4 llF20PositionRange = llF20LightTexel( llF20LightIndex, 0.0 );",
    "\t\t\tvec4 llF20ColorKind = llF20LightTexel( llF20LightIndex, 1.0 );",
    "\t\t\tvec4 llF20ConeExtras = llF20LightTexel( llF20LightIndex, 3.0 );",
    "\t\t\tvec3 llF20LightVector = llF20PositionRange.xyz - geometryPosition;",
    "\t\t\t" + light + ".direction = normalize( llF20LightVector );",
    "\t\t\t" + light + ".color = llF20ColorKind.rgb;",
    "\t\t\tif ( llF20ColorKind.w > 0.5 ) {",
    "\t\t\t\tvec4 llF20DirectionCone = llF20LightTexel( llF20LightIndex, 2.0 );",
    "\t\t\t\tfloat llF20AngleCosine = dot( " + light + ".direction, llF20DirectionCone.xyz );",
    "\t\t\t\tfloat llF20SpotAttenuation = getSpotAttenuation( llF20DirectionCone.w, llF20ConeExtras.x, llF20AngleCosine );",
    "\t\t\t\tif ( llF20SpotAttenuation <= 0.0 ) continue;",
    "\t\t\t\t" + light + ".color *= llF20SpotAttenuation;",
    "\t\t\t}",
    "\t\t\t" + light + ".color *= getDistanceAttenuation( length( llF20LightVector ), llF20PositionRange.w, llF20ConeExtras.y );",
    "\t\t\t" + light + ".visible = ( " + light + ".color != vec3( 0.0 ) );",
    "\t\t\tif ( ! " + light + ".visible ) continue;",
    "\t\t\t" + directCallStatement,
    "\t\t}",
    "\t}",
    "\t#endif",
    "",
  ].join("\n");
}


export function injectClusterShadingLoop(chunkSource) {
  const source = String(chunkSource || "");
  if (source.indexOf(CLUSTER_SHADING_LOOP_MARKER) >= 0) {


    return { source, injected: false, alreadyInjected: true, reason: "already injected" };
  }
  const directCall = buildDirectCallFromSource(source, CLUSTER_LIGHT_VARIABLE);
  if (!directCall) {
    return { source, injected: false, reason: "RE_Direct call not found in the chunk" };
  }
  const loopSource = loopSourceFor(directCall);
  const tailMarker = CLUSTER_SHADING_TAIL_MARKERS.find((marker) => source.indexOf(marker) >= 0);
  if (!tailMarker) {

    return { source: source + "\n" + loopSource, injected: true, reason: "appended to the chunk" };
  }

  return {
    source: source.replace(tailMarker, loopSource + "\n" + tailMarker),
    injected: true,
    reason: "inserted before " + tailMarker,
  };
}

function loopSourceFor(directCall) {
  if (cachedDirectCall !== directCall || cachedLoopSource === null) {
    cachedDirectCall = directCall;
    cachedLoopSource = buildClusterShadingLoop(directCall);
  }
  return cachedLoopSource;
}

function glslFloat(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number.toFixed(1) : String(number);
}

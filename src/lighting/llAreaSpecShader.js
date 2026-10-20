export const AREA_LIGHT_SHAPE_UNIFORM = "uLlAreaLightShape";
export const AREA_LIGHT_AXIS_UNIFORM = "uLlAreaLightAxis";
export const AREA_SPECULAR_FUNCTION = "llAreaSpecularDirect";
export const AREA_LIGHT_BEGIN_FUNCTION = "llBeginAreaLight";

const PHYSICAL_MATERIAL_BRDF_DECLARATION = "void RE_Direct_Physical(";
const POINT_LIGHT_INFO_CALL = "getPointLightInfo(";
const SPOT_LIGHT_INFO_CALL = "getSpotLightInfo(";
const DIRECT_LIGHT_CALL = "RE_Direct(";


const DIRECT_SPECULAR_LINE =
  /reflectedLight\.directSpecular\s*\+=\s*irradiance\s*\*\s*BRDF_GGX\(\s*directLight\.direction,\s*geometryViewDir,\s*geometryNormal,\s*material\s*\);/;

const DIRECT_SPECULAR_REPLACEMENT =
  "reflectedLight.directSpecular += " +
  AREA_SPECULAR_FUNCTION +
  "( directLight, irradiance, geometryPosition, geometryNormal, geometryViewDir, material );";

export function buildAreaSpecularGlsl() {
  return [
    "// ---- LL-F6 especular de area (MRP de Karis) ----",
    "#define LL_AREA_LIGHT_COUNT ( NUM_POINT_LIGHTS + NUM_SPOT_LIGHTS )",
    "#if LL_AREA_LIGHT_COUNT > 0",
    "\tuniform vec4 " + AREA_LIGHT_SHAPE_UNIFORM + "[ LL_AREA_LIGHT_COUNT ];",
    "\tuniform vec4 " + AREA_LIGHT_AXIS_UNIFORM + "[ LL_AREA_LIGHT_COUNT ];",
    "#endif",
    "float llAreaLightEnabled = 0.0;",
    "float llAreaLightSourceRadius = 0.0;",
    "float llAreaLightHalfSourceLength = 0.0;",
    "float llAreaLightSpecularScale = 1.0;",
    "vec3 llAreaLightAxis = vec3( 0.0, 1.0, 0.0 );",
    "vec3 llAreaLightViewPosition = vec3( 0.0 );",
    "void " + AREA_LIGHT_BEGIN_FUNCTION + "( const in vec4 shape, const in vec4 axis, const in vec3 viewPosition ) {",
    "\tllAreaLightSourceRadius = shape.x;",
    "\tllAreaLightHalfSourceLength = shape.y;",
    "\tllAreaLightSpecularScale = shape.z;",
    "\tllAreaLightEnabled = shape.w;",
    "\tllAreaLightAxis = axis.xyz;",
    "\tllAreaLightViewPosition = viewPosition;",
    "}",
    "void llEndAreaLight() {",
    "\tllAreaLightEnabled = 0.0;",
    "}",
    "vec3 " + AREA_SPECULAR_FUNCTION + "( const in IncidentLight directLight, const in vec3 punctualIrradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in PhysicalMaterial material ) {",
    "\tif ( llAreaLightEnabled > 0.5 ) {",
    "\t\tvec3 lightVector = llAreaLightViewPosition - geometryPosition;",
    "\t\tfloat distanceToLightCenter = max( length( lightVector ), 1e-4 );",
    "\t\tvec3 reflectionDirection = reflect( - geometryViewDir, geometryNormal );",
    "\t\tvec3 halfSegment = llAreaLightAxis * llAreaLightHalfSourceLength;",
    "\t\tvec3 segmentStart = lightVector - halfSegment;",
    "\t\tvec3 segmentDelta = halfSegment * 2.0;",
    "\t\tfloat rayDotDelta = dot( reflectionDirection, segmentDelta );",
    "\t\tfloat segmentDenominator = dot( segmentDelta, segmentDelta ) - rayDotDelta * rayDotDelta;",
    "\t\tvec3 closestOnSegment = segmentStart;",
    "\t\tif ( segmentDenominator > 1e-6 ) {",
    "\t\t\tfloat travel = clamp( ( dot( reflectionDirection, segmentStart ) * rayDotDelta - dot( segmentStart, segmentDelta ) ) / segmentDenominator, 0.0, 1.0 );",
    "\t\t\tclosestOnSegment = segmentStart + segmentDelta * travel;",
    "\t\t}",
    "\t\tvec3 centerToRay = dot( closestOnSegment, reflectionDirection ) * reflectionDirection - closestOnSegment;",
    "\t\tfloat centerToRayLength = max( length( centerToRay ), 1e-4 );",
    "\t\tvec3 closestPoint = closestOnSegment + centerToRay * clamp( llAreaLightSourceRadius / centerToRayLength, 0.0, 1.0 );",
    "\t\tfloat distanceToClosestPoint = max( length( closestPoint ), 1e-4 );",
    "\t\tvec3 representativeDirection = closestPoint / distanceToClosestPoint;",
    "\t\tfloat distanceToSegment = distanceToLightCenter;",
    "\t\tfloat segmentLengthSquared = dot( segmentDelta, segmentDelta );",
    "\t\tif ( segmentLengthSquared > 1e-6 ) {",
    "\t\t\tfloat nearestTravel = clamp( - dot( segmentStart, segmentDelta ) / segmentLengthSquared, 0.0, 1.0 );",
    "\t\t\tdistanceToSegment = max( length( segmentStart + segmentDelta * nearestTravel ), 1e-4 );",
    "\t\t}",
    "\t\tfloat alpha = max( pow2( material.roughness ), 1e-4 );",
    "\t\tfloat alphaWidenedByRadius = clamp( alpha + llAreaLightSourceRadius / ( 2.0 * distanceToLightCenter ), alpha, 1.0 );",
    "\t\tfloat alphaWidenedByHalfLength = clamp( alpha + llAreaLightHalfSourceLength / ( 2.0 * distanceToSegment ), alpha, 1.0 );",
    "\t\tfloat sphereNormalization = pow2( min( 1.0, alpha / max( alphaWidenedByRadius, 1e-4 ) ) );",
    "\t\tfloat tubeNormalization = min( 1.0, alpha / max( alphaWidenedByHalfLength, 1e-4 ) );",
    "\t\tfloat segmentFalloffCompensation = pow2( distanceToLightCenter / distanceToSegment );",
    "\t\tfloat energyScale = sphereNormalization * tubeNormalization * segmentFalloffCompensation;",
    "\t\tfloat sinAngularRadius = clamp( ( llAreaLightSourceRadius + llAreaLightHalfSourceLength ) / distanceToLightCenter, 0.0, 1.0 );",
    "\t\tfloat normalDotLightCenter = dot( geometryNormal, lightVector / distanceToLightCenter );",
    "\t\tfloat horizonFade = clamp( ( normalDotLightCenter + sinAngularRadius ) / max( 2.0 * sinAngularRadius, 1e-6 ), 0.0, 1.0 );",
    "\t\tvec3 areaIrradiance = saturate( dot( geometryNormal, representativeDirection ) ) * directLight.color;",
    "\t\treturn areaIrradiance * BRDF_GGX( representativeDirection, geometryViewDir, geometryNormal, material ) * ( energyScale * horizonFade * llAreaLightSpecularScale );",
    "\t}",
    "\treturn punctualIrradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );",
    "}",
    "",
  ].join("\n");
}


export function injectAreaSpecularIntoPhysicalChunk(source) {
  if (typeof source !== "string") return null;
  if (source.indexOf(AREA_SPECULAR_FUNCTION) >= 0) return null;
  const declarationIndex = source.indexOf(PHYSICAL_MATERIAL_BRDF_DECLARATION);
  if (declarationIndex === -1) return null;
  if (!DIRECT_SPECULAR_LINE.test(source)) return null;
  const withPhase =
    source.slice(0, declarationIndex) + buildAreaSpecularGlsl() + source.slice(declarationIndex);
  return withPhase.replace(DIRECT_SPECULAR_LINE, DIRECT_SPECULAR_REPLACEMENT);
}



export function injectAreaLightStateIntoLightLoops(source) {
  if (typeof source !== "string") return null;
  if (source.indexOf(AREA_LIGHT_BEGIN_FUNCTION) >= 0) return null;
  const withPoint = wrapDirectCallAfter(
    source,
    POINT_LIGHT_INFO_CALL,
    AREA_LIGHT_BEGIN_FUNCTION +
      "( " + AREA_LIGHT_SHAPE_UNIFORM + "[ UNROLLED_LOOP_INDEX ], " +
      AREA_LIGHT_AXIS_UNIFORM + "[ UNROLLED_LOOP_INDEX ], pointLight.position );"
  );
  if (withPoint === null) return null;
  return wrapDirectCallAfter(
    withPoint,
    SPOT_LIGHT_INFO_CALL,
    AREA_LIGHT_BEGIN_FUNCTION +
      "( " + AREA_LIGHT_SHAPE_UNIFORM + "[ NUM_POINT_LIGHTS + UNROLLED_LOOP_INDEX ], " +
      AREA_LIGHT_AXIS_UNIFORM + "[ NUM_POINT_LIGHTS + UNROLLED_LOOP_INDEX ], spotLight.position );"
  );
}



function wrapDirectCallAfter(source, markerCall, beginStatement) {
  const markerIndex = source.indexOf(markerCall);
  if (markerIndex === -1) return null;
  const callIndex = source.indexOf(DIRECT_LIGHT_CALL, markerIndex);
  if (callIndex === -1) return null;
  const statementEnd = source.indexOf(";", callIndex);
  if (statementEnd === -1) return null;
  return (
    source.slice(0, callIndex) +
    beginStatement +
    "\n\t\t" +
    source.slice(callIndex, statementEnd + 1) +
    "\n\t\tllEndAreaLight();" +
    source.slice(statementEnd + 1)
  );
}

import { toGlslFloatLiteral } from "./msmNormalFromDepthGlsl.js";
import {
  MSM_ATLAS_LAST_ROW,
  MSM_ATLAS_META_TEXEL,
  MSM_ATLAS_META_TEXELS_PER_ROW,
  MSM_ATLAS_META_TEXTURE_WIDTH,
  MSM_ATLAS_VISIBILITY_BLOCKED,
  MSM_ATLAS_VISIBILITY_LIT,
  MSM_ATLAS_VISIBILITY_NO_INFORMATION,
} from "./msmAtlasVisibilityCore.js";


export const MSM_ATLAS_VISIBILITY_UNIFORMS = Object.freeze([
  Object.freeze({ name: "uMsmAtlasOn", glslType: "float", carries: "the gate: 0 means the atlas is asleep" }),
  Object.freeze({ name: "uMsmAtlasTex", glslType: "sampler2D", carries: "the atlas pages, RGBA-packed depth" }),
  Object.freeze({ name: "uMsmAtlasMeta", glslType: "sampler2D", carries: "six meta texels per atlas row" }),
  Object.freeze({ name: "uMsmAtlasBias", glslType: "float", carries: "depth bias subtracted from the reference" }),
  Object.freeze({ name: "uMsmViewToWorld", glslType: "mat4", carries: "view to world; meta matrices are in WORLD" }),
]);


export const MSM_ATLAS_VISIBILITY_TEXTURE_UNITS = Object.freeze(["uMsmAtlasTex", "uMsmAtlasMeta"]);


export const MSM_ATLAS_VISIBILITY_FUNCTIONS = Object.freeze([
  "msmAtlasMetaTexel",
  "msmUnpackAtlasDepth",
  "msmAtlasVisibility",
]);


export const MSM_ATLAS_VISIBILITY_REQUIRED_INCLUDES = Object.freeze([]);


export function buildAtlasVisibilityGlsl() {
  const metaTexelsPerRow = toGlslFloatLiteral(MSM_ATLAS_META_TEXELS_PER_ROW);
  const metaTextureWidth = toGlslFloatLiteral(MSM_ATLAS_META_TEXTURE_WIDTH);
  const lastRow = toGlslFloatLiteral(MSM_ATLAS_LAST_ROW);
  const lit = toGlslFloatLiteral(MSM_ATLAS_VISIBILITY_LIT);
  const blocked = toGlslFloatLiteral(MSM_ATLAS_VISIBILITY_BLOCKED);
  const noInformation = toGlslFloatLiteral(MSM_ATLAS_VISIBILITY_NO_INFORMATION);
  const slotTransformTexel = toGlslFloatLiteral(MSM_ATLAS_META_TEXEL.SLOT_TRANSFORM);
  const slotBoundsTexel = toGlslFloatLiteral(MSM_ATLAS_META_TEXEL.SLOT_BOUNDS);
  const column0 = toGlslFloatLiteral(MSM_ATLAS_META_TEXEL.VIEW_PROJECTION_COLUMN_0);
  const column1 = toGlslFloatLiteral(MSM_ATLAS_META_TEXEL.VIEW_PROJECTION_COLUMN_1);
  const column2 = toGlslFloatLiteral(MSM_ATLAS_META_TEXEL.VIEW_PROJECTION_COLUMN_2);
  const column3 = toGlslFloatLiteral(MSM_ATLAS_META_TEXEL.VIEW_PROJECTION_COLUMN_3);

  return `
                                                                              
const float MSM_ATLAS_META_TEXELS_PER_ROW = ${metaTexelsPerRow};
const float MSM_ATLAS_META_TEXTURE_WIDTH = ${metaTextureWidth};
const float MSM_ATLAS_LAST_ROW = ${lastRow};
const float MSM_ATLAS_VISIBILITY_LIT = ${lit};
const float MSM_ATLAS_VISIBILITY_BLOCKED = ${blocked};
const float MSM_ATLAS_VISIBILITY_NO_INFORMATION = ${noInformation};

                                                                              
                                                                             
                                                                          
const vec4 MSM_ATLAS_UNPACK_FACTORS = ( 255.0 / 256.0 ) / vec4( 256.0 * 256.0 * 256.0, 256.0 * 256.0, 256.0, 1.0 );

vec4 msmAtlasMetaTexel(const in float atlasRow, const in float texelIndex) {
  float column = atlasRow * MSM_ATLAS_META_TEXELS_PER_ROW + texelIndex + 0.5;
  return texture2D(uMsmAtlasMeta, vec2(column / MSM_ATLAS_META_TEXTURE_WIDTH, 0.5));
}

float msmUnpackAtlasDepth(const in vec4 packedDepth) {
  return dot(packedDepth, MSM_ATLAS_UNPACK_FACTORS);
}

                                                                      
                                                                               
                                                                           
                                                         
float msmAtlasVisibility(const in float atlasRow, const in vec3 viewPosition) {
  if (uMsmAtlasOn <= 0.0) return MSM_ATLAS_VISIBILITY_NO_INFORMATION;
  if (atlasRow < 0.0) return MSM_ATLAS_VISIBILITY_NO_INFORMATION;
  if (atlasRow > MSM_ATLAS_LAST_ROW) return MSM_ATLAS_VISIBILITY_NO_INFORMATION;

  vec4 slotTransform = msmAtlasMetaTexel(atlasRow, ${slotTransformTexel});
  if (slotTransform.x <= 0.0) return MSM_ATLAS_VISIBILITY_NO_INFORMATION;

  vec4 worldPosition = uMsmViewToWorld * vec4(viewPosition, 1.0);
  mat4 lightViewProjection = mat4(
    msmAtlasMetaTexel(atlasRow, ${column0}),
    msmAtlasMetaTexel(atlasRow, ${column1}),
    msmAtlasMetaTexel(atlasRow, ${column2}),
    msmAtlasMetaTexel(atlasRow, ${column3})
  );
  vec4 clipPosition = lightViewProjection * vec4(worldPosition.xyz, 1.0);
  if (clipPosition.w <= 0.0) return MSM_ATLAS_VISIBILITY_LIT;

  vec3 deviceCoordinates = clipPosition.xyz / clipPosition.w;
  if (abs(deviceCoordinates.x) >= 1.0) return MSM_ATLAS_VISIBILITY_LIT;
  if (abs(deviceCoordinates.y) >= 1.0) return MSM_ATLAS_VISIBILITY_LIT;
  if (deviceCoordinates.z >= 1.0) return MSM_ATLAS_VISIBILITY_LIT;
  if (deviceCoordinates.z <= -1.0) return MSM_ATLAS_VISIBILITY_LIT;

  vec4 slotBounds = msmAtlasMetaTexel(atlasRow, ${slotBoundsTexel});
  vec2 pageUv = (deviceCoordinates.xy * 0.5 + 0.5) * slotTransform.xy + slotTransform.zw;
  vec2 clampedUv = clamp(pageUv, slotBounds.xy, slotBounds.zw);
  float reference = deviceCoordinates.z * 0.5 + 0.5 - uMsmAtlasBias;

  return step(reference, msmUnpackAtlasDepth(texture2D(uMsmAtlasTex, clampedUv)));
}
`;
}

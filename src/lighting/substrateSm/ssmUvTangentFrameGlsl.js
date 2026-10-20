import { SSM_TANGENT_MINIMUM_ORIENTATION } from './ssmTangentMath.js';

export const SSM_UV_TANGENT_FRAME_GLSL = `
#ifndef SSM_UV_TANGENT_FRAME_V1
#define SSM_UV_TANGENT_FRAME_V1

SsmTangentFrame ssmBuildUvTangentFrame(
  vec3 normal, vec3 positionDx, vec3 positionDy, vec2 uvDx, vec2 uvDy, float rotationRadians
) {
  float uvScale = max(max(abs(uvDx.x), abs(uvDx.y)), max(abs(uvDy.x), abs(uvDy.y)));
  float positionScale = max(max(max(abs(positionDx.x), abs(positionDx.y)), abs(positionDx.z)),
    max(max(abs(positionDy.x), abs(positionDy.y)), abs(positionDy.z)));
  if (!(uvScale > 0.0 && uvScale <= 1e30 && positionScale > 0.0 && positionScale <= 1e30)) {
    return ssmInvalidTangentFrame();
  }
  vec2 scaledUvDx = uvDx / uvScale;
  vec2 scaledUvDy = uvDy / uvScale;
  float determinant = scaledUvDx.x * scaledUvDy.y - scaledUvDx.y * scaledUvDy.x;
  if (!(abs(determinant) > ${SSM_TANGENT_MINIMUM_ORIENTATION})) return ssmInvalidTangentFrame();
  vec3 scaledPositionDx = positionDx / positionScale;
  vec3 scaledPositionDy = positionDy / positionScale;
  vec3 tangent = (scaledPositionDx * scaledUvDy.y - scaledPositionDy * scaledUvDx.y) * sign(determinant);
  vec3 bitangent = (scaledPositionDy * scaledUvDx.x - scaledPositionDx * scaledUvDy.x) * sign(determinant);
  return ssmBuildTangentFrame(normal, tangent, bitangent, rotationRadians);
}

SsmTangentFrame ssmDeriveUvTangentFrame(vec3 normal, vec3 position, vec2 uv, float rotationRadians) {
  return ssmBuildUvTangentFrame(normal, dFdx(position), dFdy(position), dFdx(uv), dFdy(uv), rotationRadians);
}

#endif
`;

import {
  SSM_TANGENT_MINIMUM_LENGTH_SQUARED,
  SSM_TANGENT_MINIMUM_ORIENTATION,
} from './ssmTangentMath.js';

export const SSM_TANGENT_FRAME_GLSL = `
#ifndef SSM_TANGENT_FRAME_V1
#define SSM_TANGENT_FRAME_V1

struct SsmTangentFrame {
  vec3 normal;
  vec3 tangent;
  vec3 bitangent;
  bool valid;
};

SsmTangentFrame ssmInvalidTangentFrame() {
  SsmTangentFrame frame;
  frame.normal = vec3(0.0);
  frame.tangent = vec3(0.0);
  frame.bitangent = vec3(0.0);
  frame.valid = false;
  return frame;
}

bool ssmNormalizeTangentVector(vec3 source, out vec3 direction) {
  direction = vec3(0.0);
  if (!all(lessThanEqual(abs(source), vec3(1e30)))) return false;
  float largest = max(max(abs(source.x), abs(source.y)), abs(source.z));
  if (!(largest > 0.0)) return false;
  vec3 scaled = source / largest;
  direction = scaled * inversesqrt(dot(scaled, scaled));
  return true;
}

SsmTangentFrame ssmBuildTangentFrame(vec3 normal, vec3 tangent, vec3 bitangent, float rotationRadians) {
  SsmTangentFrame frame = ssmInvalidTangentFrame();
  vec3 unitNormal;
  vec3 unitTangent;
  vec3 unitBitangent;
  if (!ssmNormalizeTangentVector(normal, unitNormal) ||
      !ssmNormalizeTangentVector(tangent, unitTangent) ||
      !ssmNormalizeTangentVector(bitangent, unitBitangent)) return frame;
  if (!(abs(rotationRadians) <= 1e30)) return frame;
  unitTangent -= unitNormal * dot(unitNormal, unitTangent);
  float projectedLengthSquared = dot(unitTangent, unitTangent);
  if (!(projectedLengthSquared > ${SSM_TANGENT_MINIMUM_LENGTH_SQUARED})) return frame;
  unitTangent *= inversesqrt(projectedLengthSquared);
  vec3 perpendicular = cross(unitNormal, unitTangent);
  float orientation = dot(perpendicular, unitBitangent);
  if (!(abs(orientation) > ${SSM_TANGENT_MINIMUM_ORIENTATION})) return frame;
  unitBitangent = perpendicular * sign(orientation);
  float rotation = mod(rotationRadians, 3.141592653589793);
  float cosine = cos(rotation);
  float sine = sin(rotation);
  frame.normal = unitNormal;
  frame.tangent = unitTangent * cosine + unitBitangent * sine;
  frame.bitangent = unitBitangent * cosine - unitTangent * sine;
  frame.valid = true;
  return frame;
}

#endif
`;

export const MGL_AREA_SAMPLE_COUNT_UNIFORM = "uMglAreaSampleCount";

export const MGL_AREA_SAMPLING_FUNCTIONS = Object.freeze([
  "mglBuildOrthonormalBasis",
  "mglAreaPdfToSolidAnglePdf",
  "mglSphereSolidAngle",
  "mglSampleSphere",
  "mglRectangleSolidAngle",
  "mglSampleRectangle",
  "mglTubeArea",
  "mglSampleTube",
  "mglIsQuadrantEnabled",
  "mglEnabledQuadrantCount",
  "mglRemapUnitSquareWithBitmask",
]);

export const MGL_AREA_SAMPLING_GLSL = `
                                                               
#define MGL_PI 3.141592653589793
#define MGL_TWO_PI 6.283185307179586
#define MGL_MINIMUM_COSINE_AT_LIGHT 1e-9
#define MGL_MINIMUM_LENGTH 1e-9

uniform int uMglAreaSampleCount;

struct MglAreaSample {
  vec3 position;
  vec3 normal;
  vec3 direction;
  float distanceToSample;
  float cosineAtLight;
  float pdfSolidAngle;
};

void mglBuildOrthonormalBasis(const in vec3 unitDirection, out vec3 tangent, out vec3 bitangent) {
  float axisSign = unitDirection.z >= 0.0 ? 1.0 : -1.0;
  float a = -1.0 / (axisSign + unitDirection.z);
  float b = unitDirection.x * unitDirection.y * a;
  tangent = vec3(1.0 + axisSign * unitDirection.x * unitDirection.x * a, axisSign * b, -axisSign * unitDirection.x);
  bitangent = vec3(b, axisSign + unitDirection.y * unitDirection.y * a, -unitDirection.y);
}

float mglAreaPdfToSolidAnglePdf(float pdfArea, float distanceToSample, float cosineAtLight) {
  if (cosineAtLight <= MGL_MINIMUM_COSINE_AT_LIGHT) return 0.0;
  return pdfArea * distanceToSample * distanceToSample / cosineAtLight;
}

float mglSphereSolidAngle(float radius, float distanceToCenter) {
  if (distanceToCenter <= radius) return 4.0 * MGL_PI;
  float sineSquared = (radius * radius) / (distanceToCenter * distanceToCenter);
  return MGL_TWO_PI * (1.0 - sqrt(max(0.0, 1.0 - sineSquared)));
}

MglAreaSample mglSampleSphere(vec3 shadingPoint, vec3 center, float radius, vec2 randomPair) {
  MglAreaSample areaSample;
  vec3 shadingPointToCenter = center - shadingPoint;
  float distanceToCenter = length(shadingPointToCenter);
  vec3 coneAxis = shadingPointToCenter / max(distanceToCenter, MGL_MINIMUM_LENGTH);
  vec3 tangent;
  vec3 bitangent;
  mglBuildOrthonormalBasis(coneAxis, tangent, bitangent);

  float cosineOfConeEdge = -1.0;
  if (distanceToCenter > radius) {
    cosineOfConeEdge = sqrt(max(0.0, 1.0 - (radius * radius) / (distanceToCenter * distanceToCenter)));
  }
  float solidAngle = MGL_TWO_PI * (1.0 - cosineOfConeEdge);
  float cosineTheta = 1.0 - randomPair.x * (1.0 - cosineOfConeEdge);
  float sineTheta = sqrt(max(0.0, 1.0 - cosineTheta * cosineTheta));
  float azimuth = MGL_TWO_PI * randomPair.y;

  float distanceAlongDirection = distanceToCenter * cosineTheta -
    sqrt(max(0.0, radius * radius - distanceToCenter * distanceToCenter * sineTheta * sineTheta));
  float cosineAlpha = clamp(
    (distanceToCenter * distanceToCenter + radius * radius - distanceAlongDirection * distanceAlongDirection) /
      max(2.0 * distanceToCenter * radius, MGL_MINIMUM_LENGTH), -1.0, 1.0);
  float sineAlpha = sqrt(max(0.0, 1.0 - cosineAlpha * cosineAlpha));

  vec3 normal = normalize(
    -sineAlpha * cos(azimuth) * tangent - sineAlpha * sin(azimuth) * bitangent - cosineAlpha * coneAxis);
  areaSample.position = center + radius * normal;
  areaSample.normal = normal;
  vec3 shadingPointToSample = areaSample.position - shadingPoint;
  areaSample.distanceToSample = length(shadingPointToSample);
  areaSample.direction = shadingPointToSample / max(areaSample.distanceToSample, MGL_MINIMUM_LENGTH);
  areaSample.cosineAtLight = -dot(normal, areaSample.direction);
  areaSample.pdfSolidAngle = solidAngle > 0.0 ? 1.0 / solidAngle : 0.0;
  return areaSample;
}

float mglTriangleSolidAngle(vec3 toFirst, vec3 toSecond, vec3 toThird) {
  float firstLength = length(toFirst);
  float secondLength = length(toSecond);
  float thirdLength = length(toThird);
  float numerator = abs(dot(toFirst, cross(toSecond, toThird)));
  float denominator = firstLength * secondLength * thirdLength +
    dot(toFirst, toSecond) * thirdLength +
    dot(toFirst, toThird) * secondLength +
    dot(toSecond, toThird) * firstLength;
  return 2.0 * atan(numerator, denominator);
}

float mglRectangleSolidAngle(vec3 shadingPoint, vec3 center, vec3 rightAxis, vec3 upAxis, float halfWidth, float halfHeight) {
  vec3 alongWidth = rightAxis * halfWidth;
  vec3 alongHeight = upAxis * halfHeight;
  vec3 toFirst = center - alongWidth - alongHeight - shadingPoint;
  vec3 toSecond = center + alongWidth - alongHeight - shadingPoint;
  vec3 toThird = center + alongWidth + alongHeight - shadingPoint;
  vec3 toFourth = center - alongWidth + alongHeight - shadingPoint;
  return mglTriangleSolidAngle(toFirst, toSecond, toThird) + mglTriangleSolidAngle(toFirst, toThird, toFourth);
}

MglAreaSample mglSampleRectangle(vec3 shadingPoint, vec3 center, vec3 rightAxis, vec3 upAxis, float halfWidth, float halfHeight, vec2 randomPair) {
  MglAreaSample areaSample;
  areaSample.position = center +
    rightAxis * ((2.0 * randomPair.x - 1.0) * halfWidth) +
    upAxis * ((2.0 * randomPair.y - 1.0) * halfHeight);
  areaSample.normal = normalize(cross(rightAxis, upAxis));
  vec3 shadingPointToSample = areaSample.position - shadingPoint;
  areaSample.distanceToSample = length(shadingPointToSample);
  areaSample.direction = shadingPointToSample / max(areaSample.distanceToSample, MGL_MINIMUM_LENGTH);
  areaSample.cosineAtLight = -dot(areaSample.normal, areaSample.direction);
  float area = 4.0 * halfWidth * halfHeight;
  float pdfArea = area > 0.0 ? 1.0 / area : 0.0;
  areaSample.pdfSolidAngle = mglAreaPdfToSolidAnglePdf(pdfArea, areaSample.distanceToSample, areaSample.cosineAtLight);
  return areaSample;
}

float mglTubeArea(float radius, float halfLength) {
  return MGL_TWO_PI * radius * 2.0 * halfLength + 4.0 * MGL_PI * radius * radius;
}

MglAreaSample mglSampleTube(vec3 shadingPoint, vec3 center, vec3 axis, float halfLength, float radius, vec2 randomPair) {
  MglAreaSample areaSample;
  vec3 unitAxis = normalize(axis);
  vec3 tangent;
  vec3 bitangent;
  mglBuildOrthonormalBasis(unitAxis, tangent, bitangent);

  float lateralArea = MGL_TWO_PI * radius * 2.0 * halfLength;
  float totalArea = lateralArea + 4.0 * MGL_PI * radius * radius;
  float lateralFraction = totalArea > 0.0 ? lateralArea / totalArea : 0.0;
  float azimuth = MGL_TWO_PI * randomPair.y;
  vec3 normal;
  vec3 position;

                                                                           
                                                                         
  float capFraction = (1.0 - lateralFraction) * 0.5;
  float lateralEnd = capFraction + lateralFraction;

  if (randomPair.x >= capFraction && randomPair.x < lateralEnd) {
    float lateralParameter = (randomPair.x - capFraction) / max(lateralFraction, MGL_MINIMUM_LENGTH);
    normal = cos(azimuth) * tangent + sin(azimuth) * bitangent;
    position = center + unitAxis * ((2.0 * lateralParameter - 1.0) * halfLength) + normal * radius;
  } else {
    float capSign = randomPair.x >= lateralEnd ? 1.0 : -1.0;
    float capParameter = randomPair.x >= lateralEnd
      ? (randomPair.x - lateralEnd) / max(capFraction, MGL_MINIMUM_LENGTH)
      : 1.0 - randomPair.x / max(capFraction, MGL_MINIMUM_LENGTH);
    float cosinePolar = clamp(capParameter, 0.0, 1.0);
    float sinePolar = sqrt(max(0.0, 1.0 - cosinePolar * cosinePolar));
    normal = sinePolar * cos(azimuth) * tangent + sinePolar * sin(azimuth) * bitangent + capSign * cosinePolar * unitAxis;
    position = center + unitAxis * (capSign * halfLength) + normal * radius;
  }

  areaSample.position = position;
  areaSample.normal = normal;
  vec3 shadingPointToSample = position - shadingPoint;
  areaSample.distanceToSample = length(shadingPointToSample);
  areaSample.direction = shadingPointToSample / max(areaSample.distanceToSample, MGL_MINIMUM_LENGTH);
  areaSample.cosineAtLight = -dot(normal, areaSample.direction);
  float pdfArea = totalArea > 0.0 ? 1.0 / totalArea : 0.0;
  areaSample.pdfSolidAngle = mglAreaPdfToSolidAnglePdf(pdfArea, areaSample.distanceToSample, areaSample.cosineAtLight);
  return areaSample;
}

bool mglIsQuadrantEnabled(int mask, int quadrantIndex) {
  int shifted = mask;
  for (int step = 0; step < 4; step++) {
    if (step == quadrantIndex) {
      return (shifted - (shifted / 2) * 2) == 1;
    }
    shifted = shifted / 2;
  }
  return false;
}

int mglEnabledQuadrantCount(int mask) {
  int count = 0;
  for (int quadrantIndex = 0; quadrantIndex < 4; quadrantIndex++) {
    if (mglIsQuadrantEnabled(mask, quadrantIndex)) {
      count += 1;
    }
  }
  return count;
}

vec2 mglRemapUnitSquareWithBitmask(int mask, vec2 randomPair, out float probabilityDensityScale) {
  int enabledCount = mglEnabledQuadrantCount(mask);
  probabilityDensityScale = 1.0;
  if (enabledCount == 0 || enabledCount == 4) {
    return randomPair;
  }
  float scaledU1 = randomPair.x * float(enabledCount);
  int chosenSlot = int(floor(scaledU1));
  if (chosenSlot > enabledCount - 1) {
    chosenSlot = enabledCount - 1;
  }
  float leftoverU1 = scaledU1 - float(chosenSlot);
  int visitedSlot = -1;
  int chosenQuadrant = 0;
  for (int quadrantIndex = 0; quadrantIndex < 4; quadrantIndex++) {
    if (mglIsQuadrantEnabled(mask, quadrantIndex)) {
      visitedSlot += 1;
      if (visitedSlot == chosenSlot) {
        chosenQuadrant = quadrantIndex;
      }
    }
  }
  float quadrantColumn = float(chosenQuadrant - (chosenQuadrant / 2) * 2);
  float quadrantRow = float(chosenQuadrant / 2);
  probabilityDensityScale = 4.0 / float(enabledCount);
  return vec2((quadrantColumn + leftoverU1) * 0.5, (quadrantRow + randomPair.y) * 0.5);
}
                                    
`;

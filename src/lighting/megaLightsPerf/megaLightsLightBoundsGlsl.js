export function buildLightBoundsUniformGlsl() {
  return [
    "uniform vec3 uLightBoundsCenter;   // centro da esfera envolvente das luzes (view space)",
    "uniform float uLightBoundsRadiusSq; // raio^2 da esfera envolvente",
    "uniform float uLightBoundsOn;       // 0 = sem descarte (fail-open), 1 = descarte ativo",
  ];
}

export function buildLightBoundsEarlyOutGlsl() {
  return [
    "  if (uLightBoundsOn > 0.5) {",
    "    vec3 lightBoundsDelta = P - uLightBoundsCenter;",
    "    if (dot(lightBoundsDelta, lightBoundsDelta) > uLightBoundsRadiusSq) return;",
    "  }",
  ];
}

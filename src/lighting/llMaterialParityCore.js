import { DIELECTRIC_F0, lookupPhongEnergyResidual, shininessToRoughness } from "./llSpecularAlbedoCore.js";


export const MATERIAL_PATHS = Object.freeze([
  Object.freeze({
    id: "standard",
    engineUse: "part individual",
    threeMaterial: "MeshStandardMaterial",
    specularModel: "ggx",
    parityRole: "referencia",
  }),
  Object.freeze({
    id: "poolPhong",
    engineUse: "pool instanciado (Future / SM-Realistic)",
    threeMaterial: "MeshPhongMaterial",
    specularModel: "blinnPhong",
    parityRole: "corrigido pela LL-F8",
  }),
  Object.freeze({
    id: "physical",
    engineUse: "vidro e agua",
    threeMaterial: "MeshPhysicalMaterial",
    specularModel: "ggx",
    parityRole: "igual a referencia",
  }),
  Object.freeze({
    id: "terreno",
    engineUse: "terreno triplanar",
    threeMaterial: "MeshStandardMaterial",
    specularModel: "ggx",
    parityRole: "igual a referencia",
  }),
  Object.freeze({
    id: "skinned",
    engineUse: "malha com skinning",
    threeMaterial: "MeshStandardMaterial",
    specularModel: "ggx",
    parityRole: "igual a referencia",
  }),
]);

export const MATERIAL_PATH_IDS = Object.freeze(MATERIAL_PATHS.map((path) => path.id));
export const REFERENCE_PATH_ID = "standard";
export const CORRECTED_PATH_ID = "poolPhong";




export const LL_FEATURE_REACH_MATRIX = Object.freeze([
  Object.freeze({
    feature: "distanceFalloff",
    phase: "LL-F2",
    expectedPatchId: "ll-f2-falloff",
    expectedAnchor: "getDistanceAttenuation",
    paths: MATERIAL_PATH_IDS,
    note: "a janela do Range e a queda 1/d2 valem para TODO caminho iluminado",
  }),
  Object.freeze({
    feature: "sourceShapeDiffuse",
    phase: "LL-F4",
    expectedPatchId: "ll-f4-source-shape",
    expectedAnchor: "getPointLightInfo",
    paths: MATERIAL_PATH_IDS,
    note: "forma da fonte no difuso: o pool nao pode ficar com fonte pontual",
  }),
  Object.freeze({
    feature: "spotCone",
    phase: "LL-F5",
    expectedPatchId: "ll-f5-spot-cone",
    expectedAnchor: "getSpotLightInfo",
    paths: MATERIAL_PATH_IDS,
    note: "cone inner/outer da UE em todos os caminhos",
  }),
  Object.freeze({
    feature: "areaSpecular",
    phase: "LL-F6",
    expectedPatchId: "ll-f6-area-specular",
    expectedAnchor: "getPointLightInfo",
    paths: MATERIAL_PATH_IDS,
    note: "highlight de area (representative point) depende da BRDF de cada caminho",
  }),
  Object.freeze({
    feature: "phongSpecularParity",
    phase: "LL-F8",
    expectedPatchId: "ll-f8-material-parity",
    expectedAnchor: "phongDirectLighting",
    paths: Object.freeze([CORRECTED_PATH_ID]),
    note: "so o pool Phong precisa: os outros caminhos ja usam a GGX de referencia",
  }),
]);


export const PARITY_GATES = Object.freeze({
  minSsim: 0.99,
  maxEnergyDeviation: 0.05,
  byteForByteSsim: 0.99999,
});

export function describeMaterialPath(pathId) {
  return MATERIAL_PATHS.find((path) => path.id === pathId) || null;
}



export function phongParityPlan(options) {
  const settings = options || {};
  const derivedRoughness = shininessToRoughness(settings.shininess);
  const residual = lookupPhongEnergyResidual(derivedRoughness);
  return {
    shininess: settings.shininess,
    derivedRoughness,
    f0: settings.f0 === undefined ? DIELECTRIC_F0 : settings.f0,
    legacyEnergyRatioNormal: residual.ratioNormal,
    legacyEnergyRatioGrazing: residual.ratioGrazing,
    legacyDeficitNormal: 1 - residual.ratioNormal,
    legacyDeficitGrazing: 1 - residual.ratioGrazing,
    parityEnergyRatio: 1,                                                      
  };
}

function pathsCoveredByPatch(patch, expectedPaths) {
  if (!patch) return [];
  if (!patch.caminhos) return expectedPaths.slice();
  return expectedPaths.filter((pathId) => patch.caminhos.indexOf(pathId) >= 0);
}

function findPatchForFeature(registeredPatches, feature) {
  const byId = registeredPatches.find((patch) => patch.id === feature.expectedPatchId);
  if (byId) return byId;
  return registeredPatches.find((patch) => patch.fase === feature.phase) || null;
}


export function auditFeatureReach(options) {
  const settings = options || {};
  const registeredPatches = Array.isArray(settings.registeredPatches) ? settings.registeredPatches : [];
  const anchorStatus = settings.anchorStatus || {};
  const features = Array.isArray(settings.features) ? settings.features : LL_FEATURE_REACH_MATRIX;
  const rows = [];
  const findings = [];

  features.forEach((feature) => {
    const expectedPaths = feature.paths.slice();
    const patch = findPatchForFeature(registeredPatches, feature);
    const anchorName = patch && patch.ancora ? patch.ancora : feature.expectedAnchor;
    const anchorEntry = anchorStatus[anchorName];
    const anchorOk = anchorEntry ? !!anchorEntry.ok : null;
    const coveredPaths = pathsCoveredByPatch(patch, expectedPaths);
    const missingPaths = expectedPaths.filter((pathId) => coveredPaths.indexOf(pathId) < 0);
    let status = "coberta";

    if (!patch) {
      status = "pendente";
      findings.push({
        code: "patch-missing",
        severity: "pending",
        feature: feature.feature,
        phase: feature.phase,
        patchId: feature.expectedPatchId,
        detalhe: "fase " + feature.phase + " ainda nao registrou patch: nenhum caminho recebe " + feature.feature,
      });
    } else {
      if (missingPaths.length > 0) {
        status = "parcial";
        findings.push({
          code: "path-not-covered",
          severity: "blocking",
          feature: feature.feature,
          phase: feature.phase,
          patchId: patch.id,
          paths: missingPaths,
          detalhe: "patch " + patch.id + " nao alcanca: " + missingPaths.join(", "),
        });
      }
      if (anchorOk === false) {
        status = "quebrada";
        findings.push({
          code: "anchor-unavailable",
          severity: "blocking",
          feature: feature.feature,
          phase: feature.phase,
          patchId: patch.id,
          anchor: anchorName,
          detalhe: "ancora " + anchorName + " indisponivel: o patch cai no fallback legado",
        });
      }
      if (patch.ancora && feature.expectedAnchor && patch.ancora !== feature.expectedAnchor) {
        findings.push({
          code: "anchor-mismatch",
          severity: "pending",
          feature: feature.feature,
          phase: feature.phase,
          patchId: patch.id,
          anchor: patch.ancora,
          detalhe: "ancora usada (" + patch.ancora + ") difere da planejada (" + feature.expectedAnchor + ")",
        });
      }
    }

    rows.push({
      feature: feature.feature,
      phase: feature.phase,
      patchId: patch ? patch.id : null,
      anchor: anchorName,
      anchorOk,
      expectedPaths,
      coveredPaths,
      missingPaths,
      status,
    });
  });

  const blocking = findings.filter((finding) => finding.severity === "blocking");
  const pending = findings.filter((finding) => finding.severity === "pending");
  const covered = rows.filter((row) => row.status === "coberta");
  return {
    rows,
    findings,
    blocking: blocking.length,
    pending: pending.length,
    coveredFeatures: covered.length,
    totalFeatures: rows.length,
    ok: blocking.length === 0,
    resumo:
      "paridade: " + covered.length + "/" + rows.length + " features cobertas, " + blocking.length + " bloqueio(s), " + pending.length + " pendencia(s)",
  };
}


export function evaluateParityVerdict(measurement) {
  const values = measurement || {};
  const gates = Object.assign({}, PARITY_GATES, values.gates || {});
  const ssimValue = Number(values.ssim);
  const energyRatio = Number(values.energyRatio);
  const reasons = [];

  const ssimOk = Number.isFinite(ssimValue) && ssimValue >= gates.minSsim;
  if (!ssimOk) reasons.push("ssim " + (Number.isFinite(ssimValue) ? ssimValue.toFixed(5) : "?") + " abaixo de " + gates.minSsim);

  const energyDeviation = Number.isFinite(energyRatio) ? Math.abs(energyRatio - 1) : Infinity;
  const energyOk = energyDeviation <= gates.maxEnergyDeviation;
  if (!energyOk) {
    reasons.push(
      "energia " +
        (Number.isFinite(energyRatio) ? (energyRatio * 100).toFixed(1) + "% do Standard" : "?") +
        " fora de +-" +
        gates.maxEnergyDeviation * 100 +
        "%",
    );
  }

  return {
    pass: ssimOk && energyOk,
    ssim: ssimValue,
    ssimOk,
    energyRatio,
    energyDeviation,
    energyOk,
    gates,
    reasons,
  };
}

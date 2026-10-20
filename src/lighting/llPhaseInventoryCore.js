export const LOCAL_LIGHT_PHASE_TOTAL = 24;


export const LOCAL_LIGHT_PHASES = Object.freeze([
  Object.freeze({ id: "LL-F1", block: "A", title: "Executable audit, parity ledger and baseline", nodeRunner: null }),
  Object.freeze({ id: "LL-F2", block: "A", title: "Unreal exact falloff and attenuation window", nodeRunner: "tools/specs/runFalloffF2.mjs" }),
  Object.freeze({ id: "LL-F3", block: "A", title: "Photometric units per light and IES brightness", nodeRunner: null }),
  Object.freeze({ id: "LL-F4", block: "A", title: "Source shape in the diffuse term and source length", nodeRunner: "tools/specs/runSourceShapeF4.mjs" }),
  Object.freeze({ id: "LL-F5", block: "A", title: "Unreal spot cones, inner and outer", nodeRunner: null }),
  Object.freeze({ id: "LL-F6", block: "B", title: "Area specular with the Karis representative point", nodeRunner: null }),
  Object.freeze({ id: "LL-F7", block: "B", title: "Complete rect light: barn doors and source texture", nodeRunner: "tools/specs/runRectExtrasF7.mjs" }),
  Object.freeze({ id: "LL-F8", block: "B", title: "Response parity across every material path", nodeRunner: null }),
  Object.freeze({ id: "LL-F9", block: "B", title: "HDR, anti firefly and temporal stability", nodeRunner: null }),
  Object.freeze({ id: "LL-F10", block: "C", title: "Shadow atlas awake for spot and surface lights", nodeRunner: null }),
  Object.freeze({ id: "LL-F11", block: "C", title: "Point light in the atlas with six cube pages", nodeRunner: "tools/specs/runPointAtlasF11.mjs" }),
  Object.freeze({ id: "LL-F12", block: "C", title: "Shadow resolution driven by screen coverage", nodeRunner: null }),
  Object.freeze({ id: "LL-F13", block: "C", title: "Static and dynamic shadow caching per page", nodeRunner: "tools/specs/runShadowCacheF13.mjs" }),
  Object.freeze({ id: "LL-F14", block: "C", title: "Penumbra from the source size per light and bias", nodeRunner: "tools/specs/runShadowSourceF14.mjs" }),
  Object.freeze({ id: "LL-F15", block: "C", title: "Contact shadows per local light", nodeRunner: "tools/specs/runContactShadowF15.mjs" }),
  Object.freeze({ id: "LL-F16", block: "C", title: "Transmission, coloured shadow and ray traced opt in", nodeRunner: "tools/specs/runTransmissionF16.mjs" }),
  Object.freeze({ id: "LL-F17", block: "D", title: "Local volumetric scattering shadowed by the atlas", nodeRunner: "tools/specs/runVolumetricF17.mjs" }),
  Object.freeze({ id: "LL-F18", block: "D", title: "Local global illumination per light", nodeRunner: "tools/specs/runGiLocalF18.mjs" }),
  Object.freeze({ id: "LL-F19", block: "D", title: "The source visible in the reflections", nodeRunner: "tools/specs/runLightProxyF19.mjs" }),
  Object.freeze({ id: "LL-F20", block: "E", title: "Cluster forward plus shading of the local lights", nodeRunner: "tools/specs/runClusterShadingF20.mjs" }),
  Object.freeze({ id: "LL-F21", block: "E", title: "Fade, culling and Unreal like light budgets", nodeRunner: "tools/specs/runLightFadeF21.mjs" }),
  Object.freeze({ id: "LL-F22", block: "E", title: "Public API, panel, gizmos and interop", nodeRunner: "tools/specs/runPublicApiF22.mjs" }),
  Object.freeze({ id: "LL-F23", block: "F", title: "Complete proof battery and performance gates", nodeRunner: "tools/specs/runGatesF23.mjs" }),
  Object.freeze({ id: "LL-F24", block: "F", title: "Blind round against Unreal 5.8 and final seal", nodeRunner: null }),
]);

export function normalizePhaseId(value) {
  return String(value === undefined || value === null ? "" : value)
    .trim()
    .toUpperCase();
}

export function phaseIds() {
  return LOCAL_LIGHT_PHASES.map((phase) => phase.id);
}

export function phaseById(phaseId) {
  const wanted = normalizePhaseId(phaseId);
  return LOCAL_LIGHT_PHASES.find((phase) => phase.id === wanted) || null;
}

export function phasesWithNodeRunner() {
  return LOCAL_LIGHT_PHASES.filter((phase) => !!phase.nodeRunner);
}

function uniqueValues(values) {
  const out = [];
  values.forEach((value) => {
    if (out.indexOf(value) === -1) out.push(value);
  });
  return out;
}

function countTests(suites) {
  return suites.reduce((total, suite) => total + (Number(suite && suite.testes) || 0), 0);
}


export function summarizePhaseCoverage(sources) {
  const source = sources || {};
  const specSuites = Array.isArray(source.specSuites) ? source.specSuites : [];
  const qaEntries = Array.isArray(source.qaEntries) ? source.qaEntries : [];
  const knownIds = phaseIds();

  const phases = LOCAL_LIGHT_PHASES.map((phase) => {
    const suites = specSuites.filter((suite) => normalizePhaseId(suite && suite.fase) === phase.id);
    const qa = qaEntries.filter((entry) => normalizePhaseId(entry && entry.fase) === phase.id);
    return Object.freeze({
      id: phase.id,
      block: phase.block,
      title: phase.title,
      nodeRunner: phase.nodeRunner,
      specSuites: suites.map((suite) => suite.nome),
      specTests: countTests(suites),
      qaIds: qa.map((entry) => entry.id),
      scenes: uniqueValues(qa.map((entry) => entry.cena).filter(Boolean)),
      hasSpec: suites.length > 0,
      hasQa: qa.length > 0,
    });
  });

  const phasesWithSpec = phases.filter((phase) => phase.hasSpec);
  const phasesWithQa = phases.filter((phase) => phase.hasQa);
  const phasesWithBoth = phases.filter((phase) => phase.hasSpec && phase.hasQa);
  const unknownPhaseIds = uniqueValues(
    specSuites
      .concat(qaEntries)
      .map((item) => normalizePhaseId(item && item.fase))
      .filter((id) => id && knownIds.indexOf(id) === -1),
  );

  return {
    total: LOCAL_LIGHT_PHASE_TOTAL,
    phases,
    phasesWithSpec: phasesWithSpec.length,
    phasesWithQa: phasesWithQa.length,
    phasesWithBoth: phasesWithBoth.length,
    missingSpec: phases.filter((phase) => !phase.hasSpec).map((phase) => phase.id),
    missingQa: phases.filter((phase) => !phase.hasQa).map((phase) => phase.id),
    specTests: countTests(specSuites),
    qaTotal: qaEntries.length,
    unknownPhaseIds,
    complete: phasesWithBoth.length === LOCAL_LIGHT_PHASE_TOTAL,
  };
}

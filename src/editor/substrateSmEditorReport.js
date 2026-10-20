const MAX_REPORTED_MATERIALS = 32;
const MAX_FIELD_CHARACTERS = 4000;

function displayValue(value) {
  if (value === null || value === undefined) return 'not reported';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).slice(0, 256);
  }
  return 'unrecognized value';
}

function displayData(value, missingText = 'not reported') {
  if (value === null || value === undefined) return missingText;
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (typeof serialized !== 'string') return missingText;
    return serialized.length <= MAX_FIELD_CHARACTERS
      ? serialized
      : `${serialized.slice(0, MAX_FIELD_CHARACTERS)}\n[Display truncated; authored source is unchanged.]`;
  } catch {
    return 'unreadable diagnostic value';
  }
}

function describeMaterial(material, index) {
  if (!material || typeof material !== 'object') return `Material ${index + 1}: invalid diagnostic record`;
  const hasCurrentDraw = material.evidenceCurrent === true && material.renderedInLastCapture === true;
  return [
    `Material ${displayValue(material.materialId)} (${displayValue(material.materialType)})`,
    `State: ${displayValue(material.state)}`,
    `Reason: ${displayValue(material.reason)}`,
    `Requested quality: ${displayValue(material.requestedQuality)}`,
    `Effective quality (reported): ${displayValue(material.effectiveQuality)}`,
    `Backend confirmed by a current captured draw: ${hasCurrentDraw ? displayValue(material.backend) : 'unverified'}`,
    `Planned backend: ${displayValue(material.plannedBackend)}`,
    `Family: ${displayValue(material.family)}`,
    `Shader committed: ${displayValue(material.shaderCommitted)}`,
    `Program confirmed: ${displayValue(material.programConfirmed)}`,
    `Rendered in last capture: ${displayValue(material.renderedInLastCapture)}`,
    `Evidence current: ${displayValue(material.evidenceCurrent)}`,
    `Source / context / program revision: ${displayValue(material.sourceRevision)} / ${displayValue(material.contextGeneration)} / ${displayValue(material.programGeneration)}`,
    `Losses:\n${displayData(material.losses, 'Not reported; no zero-loss claim.')}`,
    `Routing budget (planned):\n${displayData(material.routingBudget)}`,
    `Actual resources (reported):\n${displayData(material.actualResources)}`,
  ].join('\n');
}

export function createSubstrateSmEditorReport({ settings, snapshot, unavailableReason } = {}) {
  const flag = settings?.enabled === null ? 'AUTO' : settings?.enabled === true ? 'ON' : settings?.enabled === false ? 'OFF' : 'invalid';
  const request = [
    `Lighting request: ${flag} / ${displayValue(settings?.quality)}`,
    `Current mode: ${displayValue(settings?.technology)} / ${displayValue(settings?.renderStyle)}`,
    'A request or routing plan is not proof of rendering. This report does not alter release gates or authored source.',
  ].join('\n');
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.materials)) {
    return Object.freeze({
      available: false,
      summary: unavailableReason || 'Renderer telemetry unavailable. Effective quality and losses are not verified.',
      details: request,
    });
  }
  const counts = snapshot.counts || {};
  const materials = snapshot.materials.slice(0, MAX_REPORTED_MATERIALS);
  const omitted = snapshot.materials.length - materials.length;
  const details = [
    request,
    'Effective quality and losses below are reported metadata, not a visual-equivalence certification. Missing values remain unknown.',
    ...materials.map(describeMaterial),
    ...(omitted > 0 ? [`${omitted} additional material records omitted from this bounded editor view.`] : []),
  ].join('\n\n');
  return Object.freeze({
    available: true,
    summary: `${displayValue(counts.registered)} registered; ${displayValue(counts.programConfirmed)} program-confirmed; ${displayValue(counts.renderedInLastCapture)} rendered in the last capture. Registration alone does not mean SSM is active.`,
    details,
  });
}

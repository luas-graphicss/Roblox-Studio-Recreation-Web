export function failSubstrateSmIndirectCandidate(code, detail = code) {
  const error = new Error(detail);
  error.code = code;
  throw error;
}

export function replaceSubstrateSmIndirectAnchor(
  source,
  anchor,
  replacement,
  label,
) {
  const first = source.indexOf(anchor);
  if (
    !anchor ||
    first < 0 ||
    source.indexOf(anchor, first + anchor.length) >= 0
  ) {
    failSubstrateSmIndirectCandidate('SSM_INDIRECT_ANCHOR_MISMATCH', label);
  }
  return (
    source.slice(0, first) + replacement + source.slice(first + anchor.length)
  );
}

export function expandSubstrateSmIndirectChunk(source, name, chunks) {
  const include = `#include <${name}>`;
  if (!source.includes(include)) return source;
  if (typeof chunks?.[name] !== 'string' || chunks[name].length === 0) {
    failSubstrateSmIndirectCandidate('SSM_INDIRECT_CHUNK_UNAVAILABLE', name);
  }
  return replaceSubstrateSmIndirectAnchor(source, include, chunks[name], name);
}

export function requireSubstrateSmIndirectUniform(uniforms, name, maximum) {
  const holder = uniforms?.[name];
  if (
    !holder ||
    typeof holder !== 'object' ||
    typeof holder.value !== 'number' ||
    !Number.isFinite(holder.value) ||
    holder.value < 0 ||
    holder.value > maximum
  ) {
    failSubstrateSmIndirectCandidate(
      'SSM_INDIRECT_HOST_UNIFORM_REQUIRED',
      name,
    );
  }
  return holder;
}

export function inspectSubstrateSmIndirectFields(fields, defaults) {
  const resolved = { ...defaults };
  if (fields === undefined) return resolved;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    failSubstrateSmIndirectCandidate('SSM_INDIRECT_RESOLVED_FIELDS_REQUIRED');
  }
  const referencePattern =
    /^[A-Za-z_][A-Za-z0-9_]*(?:\[[0-9]+\])?(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
  for (const [field, expression] of Object.entries(fields)) {
    if (
      !Object.hasOwn(defaults, field) ||
      typeof expression !== 'string' ||
      !referencePattern.test(expression)
    ) {
      failSubstrateSmIndirectCandidate(
        'SSM_INDIRECT_FIELD_REFERENCE_INVALID',
        field,
      );
    }
    resolved[field] = expression;
  }
  return resolved;
}

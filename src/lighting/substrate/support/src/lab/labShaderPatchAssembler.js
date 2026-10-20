export function assembleShaderPatches(source, patches, anchors) {
  const groups = new Map();
  const refused = [];
  const applied = [];
  const missingOwners = new Set();
  for (const patch of patches) {
    const chunk = anchors[patch.anchor].chunk;
    if (!source.includes(`#include <${chunk}>`)) missingOwners.add(patch.owner);
  }
  for (const patch of [...patches].sort((left, right) => left.order - right.order)) {
    if (missingOwners.has(patch.owner)) {
      refused.push({ id: patch.id, owner: patch.owner, reason: 'Required shader anchor missing; owner refused atomically' });
      continue;
    }
    const chunk = anchors[patch.anchor].chunk;
    if (!groups.has(chunk)) groups.set(chunk, []);
    groups.get(chunk).push(patch);
    applied.push(patch.id);
  }
  const globalDeclarations = [];
  let result = source;
  for (const [chunk, group] of groups) {
    const include = `#include <${chunk}>`;
    const declarations = group.map(patch => patch.declarations).filter(Boolean).join('\n');
    const code = group.map(patch => patch.code).filter(Boolean).join('\n');
    const insideMain = result.indexOf(include) > result.search(/void\s+main\s*\(/);
    if (insideMain && declarations) globalDeclarations.push(declarations);
    result = result.replace(include, [insideMain ? '' : declarations, include, code].filter(Boolean).join('\n'));
  }
  if (globalDeclarations.length) result = result.replace(/void\s+main\s*\(/, `${globalDeclarations.join('\n')}\nvoid main(`);
  return { source: result, applied, refused };
}

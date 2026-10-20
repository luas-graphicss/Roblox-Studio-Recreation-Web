export function assembleSubstrateShader(source, patches, anchors) {
  const refusedOwners = new Set(patches.filter(patch => !source.includes(`#include <${anchors[patch.anchor].chunk}>`)).map(patch => patch.owner));
  const groups = new Map();
  const applied = [];
  for (const patch of [...patches].sort((left, right) => left.order - right.order)) {
    if (refusedOwners.has(patch.owner)) continue;
    const chunk = anchors[patch.anchor].chunk;
    if (!groups.has(chunk)) groups.set(chunk, []);
    groups.get(chunk).push(patch);
    applied.push(patch.id);
  }
  const globalDeclarations = [];
  for (const [chunk, group] of groups) {
    const include = `#include <${chunk}>`;
    const declarations = group.map(patch => patch.declarations).filter(Boolean).join('\n');
    const code = group.map(patch => patch.code).filter(Boolean).join('\n');
    const insideMain = source.indexOf(include) > source.search(/void\s+main\s*\(/);
    if (insideMain && declarations) globalDeclarations.push(declarations);
    source = source.replace(include, [insideMain ? '' : declarations, include, code].filter(Boolean).join('\n'));
  }
  if (globalDeclarations.length) source = source.replace(/void\s+main\s*\(/, globalDeclarations.join('\n') + '\nvoid main(');
  return { source, applied, refusedOwners: [...refusedOwners] };
}

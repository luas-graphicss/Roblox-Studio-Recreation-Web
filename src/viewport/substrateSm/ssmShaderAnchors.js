export function maskSubstrateSmShaderComments(source) {
  if (typeof source !== 'string' || source.length === 0 || source.length > 1048576) {
    throw new TypeError('SSM_SHADER_SOURCE_REQUIRED');
  }
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, match => match.replace(/[^\n]/g, ' '));
}

function shaderDepthAt(masked, end) {
  let depth = 0;
  const branches = [];
  for (const line of masked.slice(0, end).split('\n')) {
    if (/^\s*#\s*(?:if|ifdef|ifndef)\b/.test(line)) {
      branches.push({ entry: depth, exits: [] });
    } else if (/^\s*#\s*(?:else|elif)\b/.test(line)) {
      const branch = branches.at(-1);
      if (!branch) throw new Error('SSM_SHADER_PREPROCESSOR_UNBALANCED');
      branch.exits.push(depth);
      depth = branch.entry;
    } else if (/^\s*#\s*endif\b/.test(line)) {
      const branch = branches.pop();
      if (!branch) throw new Error('SSM_SHADER_PREPROCESSOR_UNBALANCED');
      if (branch.exits.some(exit => exit !== depth)) throw new Error('SSM_SHADER_CONDITIONAL_SCOPE_AMBIGUOUS');
    } else {
      for (const character of line) {
        if (character === '{') depth += 1;
        if (character === '}') depth -= 1;
      }
    }
  }
  if (branches.length !== 0) throw new Error('SSM_SHADER_ANCHOR_CONDITIONALLY_SCOPED');
  return depth;
}

export function findSubstrateSmShaderAnchor(source, expression, label, requiredDepth) {
  const masked = maskSubstrateSmShaderComments(source);
  const matches = [...masked.matchAll(new RegExp(expression.source, 'gm'))];
  if (matches.length !== 1) throw new Error(`SSM_SHADER_ANCHOR:${label}:${matches.length}`);
  const match = matches[0];
  const depth = shaderDepthAt(masked, match.index);
  if (requiredDepth !== undefined && depth !== requiredDepth) {
    throw new Error(`SSM_SHADER_SCOPE:${label}:${depth}`);
  }
  return { start: match.index, end: match.index + match[0].length, text: source.slice(match.index, match.index + match[0].length) };
}

export function replaceSubstrateSmShaderAnchor(source, expression, label, replacement, requiredDepth) {
  const anchor = findSubstrateSmShaderAnchor(source, expression, label, requiredDepth);
  return source.slice(0, anchor.start) + replacement + source.slice(anchor.end);
}

export function expandSubstrateSmShaderChunk(source, chunks, name) {
  const expression = new RegExp(`^[ \\t]*#include[ \\t]+<${name}>[ \\t]*$`);
  const matches = [...maskSubstrateSmShaderComments(source).matchAll(new RegExp(expression.source, 'gm'))];
  if (matches.length > 1) throw new Error(`SSM_SHADER_ANCHOR:${name}:${matches.length}`);
  if (matches.length === 0) return source;
  if (typeof chunks?.[name] !== 'string' || chunks[name].length === 0) {
    throw new Error(`SSM_SHADER_CHUNK_REQUIRED:${name}`);
  }
  const match = matches[0];
  return source.slice(0, match.index) + chunks[name] + source.slice(match.index + match[0].length);
}

export function locateSubstrateSmShaderChunk(source, chunks, name, depth) {
  const marker = new RegExp(`^[ \\t]*#include[ \\t]+<${name}>[ \\t]*$`);
  const masked = maskSubstrateSmShaderComments(source);
  if (new RegExp(marker.source, 'm').test(masked)) {
    return findSubstrateSmShaderAnchor(source, marker, name, depth);
  }
  const chunk = maskSubstrateSmShaderComments(chunks?.[name]).trim();
  const start = masked.indexOf(chunk);
  if (start < 0 || masked.indexOf(chunk, start + 1) >= 0) {
    throw new Error(`SSM_SHADER_ANCHOR:${name}:expanded`);
  }
  const actualDepth = shaderDepthAt(masked, start);
  if (actualDepth !== depth) throw new Error(`SSM_SHADER_SCOPE:${name}:${actualDepth}`);
  return { start, end: start + chunk.length, text: source.slice(start, start + chunk.length) };
}

export function requireSubstrateSmStockFunction(source, stockSource, name) {
  function functionText(text) {
    const masked = maskSubstrateSmShaderComments(text);
    const anchor = findSubstrateSmShaderAnchor(masked, new RegExp(`\\bvoid\\s+${name}\\s*\\(`), name, 0);
    const opening = masked.indexOf('{', anchor.end);
    if (opening < 0) throw new Error(`SSM_SHADER_FUNCTION:${name}`);
    let depth = 1;
    let end = opening + 1;
    for (; end < masked.length && depth > 0; end += 1) {
      if (masked[end] === '{') depth += 1;
      if (masked[end] === '}') depth -= 1;
    }
    if (depth !== 0) throw new Error(`SSM_SHADER_FUNCTION:${name}`);
    return masked.slice(anchor.start, end).replace(/\s+/g, '');
  }
  if (functionText(source) !== functionText(stockSource)) {
    throw new Error(`SSM_SHADER_RESPONSE_CONFLICT:${name}`);
  }
}

export function requireSubstrateSmShaderOrder(anchors) {
  for (let index = 1; index < anchors.length; index += 1) {
    if (anchors[index - 1].end > anchors[index].start) throw new Error('SSM_SHADER_ANCHOR_ORDER');
  }
}

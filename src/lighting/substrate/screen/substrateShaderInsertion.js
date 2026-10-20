export function insertBeforeShaderMain(source, declarations) {
  const match = /void\s+main\s*\(\s*\)\s*\{/.exec(source);
  if (!match) throw new Error('Shader main function is unavailable');
  return source.slice(0, match.index) + declarations + '\n' + source.slice(match.index);
}

export function appendShaderMain(source, code) {
  const scrubbed = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, match => match.replace(/[^\n]/g, ' '));
  const match = /void\s+main\s*\(\s*\)\s*\{/.exec(scrubbed);
  if (!match) throw new Error('Shader main function is unavailable');
  let depth = 1;
  for (let index = match.index + match[0].length; index < source.length; index++) {
    if (scrubbed[index] === '{') depth++;
    if (scrubbed[index] === '}' && --depth === 0) return source.slice(0, index) + '\n' + code + '\n' + source.slice(index);
  }
  throw new Error('Shader main function is unbalanced');
}

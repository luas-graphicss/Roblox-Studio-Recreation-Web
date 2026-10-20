export function expandMsmShaderIncludes(source, chunks, stack = []) {
  return String(source || '').replace(/#include\s+<([\w]+)>/g, (token, name) => {
    if (stack.includes(name) || typeof chunks?.[name] !== 'string') return token;
    return expandMsmShaderIncludes(chunks[name], chunks, [...stack, name]);
  });
}

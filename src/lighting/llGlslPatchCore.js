const OPEN_BRACE = "{";
const CLOSE_BRACE = "}";


export function findMatchingDelimiter(source, openIndex, openDelimiter, closeDelimiter) {
  if (source[openIndex] !== openDelimiter) return -1;
  let depth = 0;
  for (let index = openIndex; index !== source.length; index++) {
    const character = source[index];
    if (character === openDelimiter) {
      depth++;
    } else if (character === closeDelimiter) {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}


export function findFunctionDefinition(source, functionName) {
  const namePattern = new RegExp("\\b" + functionName + "\\s*\\(", "g");
  let match = namePattern.exec(source);
  while (match !== null) {
    const parametersStart = source.indexOf("(", match.index);
    const parametersEnd = findMatchingDelimiter(source, parametersStart, "(", ")");
    const bodyStart = parametersEnd === -1 ? -1 : source.indexOf(OPEN_BRACE, parametersEnd);
    const gapBeforeBody = bodyStart === -1 ? "not a definition" : source.slice(parametersEnd + 1, bodyStart);
    if (bodyStart !== -1 && gapBeforeBody.trim() === "") {
      const bodyEnd = findMatchingDelimiter(source, bodyStart, OPEN_BRACE, CLOSE_BRACE);
      if (bodyEnd !== -1) {
        return {
          nameStart: match.index,
          nameEnd: match.index + functionName.length,
          bodyStart: bodyStart,
          bodyEnd: bodyEnd,
        };
      }
    }
    match = namePattern.exec(source);
  }
  return null;
}

export function hasFunctionDefinition(source, functionName) {
  return findFunctionDefinition(source, functionName) !== null;
}

export function renameFunctionDefinition(source, functionName, newFunctionName) {
  const definition = findFunctionDefinition(source, functionName);
  if (definition === null) return null;
  return source.slice(0, definition.nameStart) + newFunctionName + source.slice(definition.nameEnd);
}

export function insertAfterFunctionDefinition(source, functionName, code) {
  const definition = findFunctionDefinition(source, functionName);
  if (definition === null) return null;
  const insertionPoint = definition.bodyEnd + 1;
  return source.slice(0, insertionPoint) + "\n" + code + "\n" + source.slice(insertionPoint);
}


export function wrapFunctionDefinition(source, { functionName, legacyFunctionName, wrapperSource }) {
  const renamedSource = renameFunctionDefinition(source, functionName, legacyFunctionName);
  if (renamedSource === null) return null;
  return insertAfterFunctionDefinition(renamedSource, legacyFunctionName, wrapperSource);
}

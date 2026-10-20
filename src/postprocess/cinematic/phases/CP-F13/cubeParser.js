import { createLutTable, LUT_LIMITS, validateLutSize } from "./lutTable.js";

const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function readNumbers(tokens, count, lineNumber) {
  if (tokens.length !== count || tokens.some((token) => !numberPattern.test(token) || !Number.isFinite(Number(token)))) throw new SyntaxError(`Invalid numeric data at cube line ${lineNumber}`);
  return tokens.map(Number);
}

export function parseCubeLut(text) {
  if (typeof text !== "string" || text.length > LUT_LIMITS.maximumTextLength) throw new TypeError("Cube input must be text within the 32 MiB parser limit");
  let size;
  let dimension;
  let title = "Imported cube LUT";
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  let sampleDataStarted = false;
  const headers = new Set();
  const values = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineNumber = lineIndex + 1;
    const line = lines[lineIndex].replace(/#(?=(?:[^"]*"[^"]*")*[^"]*$).*$/, "").trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    const keyword = tokens[0];
    if (numberPattern.test(keyword)) {
      if (!size) throw new SyntaxError(`LUT size must precede samples at cube line ${lineNumber}`);
      sampleDataStarted = true;
      values.push(...readNumbers(tokens, 3, lineNumber));
      if (values.length > 3 * size ** dimension) throw new RangeError(`Too many cube samples at line ${lineNumber}`);
      continue;
    }
    if (sampleDataStarted) throw new SyntaxError(`Unexpected header or invalid sample at cube line ${lineNumber}`);
    if (headers.has(keyword)) throw new SyntaxError(`Duplicate cube header ${keyword}`);
    headers.add(keyword);
    if (keyword === "TITLE") {
      const match = line.match(/^TITLE\s+"([^"\r\n]*)"$/);
      if (!match) throw new SyntaxError(`Invalid TITLE at cube line ${lineNumber}`);
      title = match[1];
    } else if (keyword === "LUT_3D_SIZE" || keyword === "LUT_1D_SIZE") {
      if (size !== undefined) throw new SyntaxError("Combined 1D shaper and 3D cube files are unsupported; bake the transform explicitly");
      dimension = keyword === "LUT_3D_SIZE" ? 3 : 1;
      size = validateLutSize(readNumbers(tokens.slice(1), 1, lineNumber)[0], dimension);
    } else if (keyword === "DOMAIN_MIN" || keyword === "DOMAIN_MAX") {
      const domain = readNumbers(tokens.slice(1), 3, lineNumber);
      if (keyword === "DOMAIN_MIN") domainMin = domain;
      else domainMax = domain;
    } else {
      throw new SyntaxError(`Unsupported cube header or non-finite sample ${keyword} at line ${lineNumber}`);
    }
  }
  if (!size) throw new SyntaxError("Cube file is missing LUT_3D_SIZE or LUT_1D_SIZE");
  return createLutTable({ dimension, size, values, domainMin, domainMax, title });
}

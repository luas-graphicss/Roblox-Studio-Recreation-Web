export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function isBundlePath(path) {
  return isText(path) && !/[\\:%?#\u0000-\u001f]/.test(path) && !path.startsWith("/") && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export function createIssueCollector() {
  const issues = [];
  return {
    issues,
    add(code, path, message) { issues.push({ code, path, message }); },
    require(condition, code, path, message) { if (!condition) issues.push({ code, path, message }); return Boolean(condition); }
  };
}

export function indexById(entries, path, collector) {
  if (!Array.isArray(entries)) { collector.add("MISSING_COLLECTION", path, "A nonempty array is required"); return new Map(); }
  const result = new Map();
  if (!entries.length) collector.add("EMPTY_COLLECTION", path, "A nonempty array is required");
  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry) || !isText(entry.id)) { collector.add("INVALID_ID", `${path}[${index}]`, "A record with an explicit id is required"); continue; }
    if (result.has(entry.id)) collector.add("DUPLICATE_ID", path, entry.id);
    result.set(entry.id, entry);
  }
  return result;
}

export function readSourcedFact(record, path, sources, collector) {
  if (!isRecord(record) || !Object.hasOwn(record, "value") || !isText(record.sourceId) || !isText(record.locator)) {
    collector.add("UNSOURCED_FACT", path, "A value, sourceId and exact locator are required; unknown is not a default");
    return undefined;
  }
  const source = sources.get(record.sourceId);
  const allowedKinds = ["authorized-build", "reference-export", "capture-log", "official-documentation"];
  if (!source || source.version !== "5.9" || !allowedKinds.includes(source.kind) || !isText(source.assetId)) collector.add("INCOMPATIBLE_SOURCE", path, "A source artifact tied to UE5.9 is required; a plan or public 5.8 page is insufficient");
  return record.value;
}

export function readFacts(record, names, path, sources, collector) {
  return Object.fromEntries(names.map((name) => [name, readSourcedFact(record?.[name], `${path}.${name}`, sources, collector)]));
}

export function requireStringSet(actual, expected, path, collector) {
  if (!Array.isArray(actual) || actual.some((value) => !isText(value)) || new Set(actual).size !== actual.length) {
    collector.add("INVALID_SET", path, "Unique nonempty string identifiers are required");
    return;
  }
  const expectedSet = new Set(expected);
  if (actual.length !== expectedSet.size || actual.some((value) => !expectedSet.has(value))) collector.add("INCOMPLETE_COVERAGE", path, "The set differs from the independently required inventory");
}

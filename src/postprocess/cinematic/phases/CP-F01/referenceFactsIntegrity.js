import { canonicalJson } from "./referenceHash.js";

function readPointer(document, pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/") || /~(?![01])/u.test(pointer)) throw new Error("Sourced facts require RFC6901 JSON pointers into a bundled normalized source export");
  let value = document;
  for (const component of pointer.slice(1).split("/")) {
    const key = component.replaceAll("~1", "/").replaceAll("~0", "~");
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error(`Source locator does not exist: ${pointer}`);
    value = value[key];
  }
  return value;
}

export function verifySourcedFacts(manifest, sourceDocuments) {
  const issues = [];
  let checkedFacts = 0;
  function visit(value, path) {
    if (!value || typeof value !== "object") return;
    if (Object.hasOwn(value, "value") && Object.hasOwn(value, "sourceId")) {
      try {
        const source = sourceDocuments.get(value.sourceId);
        if (!source) throw new Error("The source export is missing or is not valid UTF-8 JSON");
        const externalValue = readPointer(source, value.locator);
        if (canonicalJson(externalValue) !== canonicalJson(value.value)) throw new Error("Fact differs from the independent source export at its locator");
        checkedFacts += 1;
      } catch (error) { issues.push({ code: "SOURCE_FACT_MISMATCH", path, message: error.message }); }
      return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
  }
  visit(manifest.build?.facts, "build.facts");
  for (const kind of ["properties", "passes", "profiles"]) for (const entry of manifest.inventory[kind]) visit(entry.facts, `inventory.${kind}.${entry.id}.facts`);
  for (const run of manifest.captureRuns) visit(run.frozen, `captureRuns.${run.id}.frozen`);
  return { passed: issues.length === 0, checkedFacts, issues };
}

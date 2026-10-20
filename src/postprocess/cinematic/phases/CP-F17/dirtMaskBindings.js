export function resolveDirtMaskBindings(authored) {
  if (authored === undefined || authored === null) return Object.freeze([]);
  if (!Array.isArray(authored) || authored.length > 2) throw new TypeError("CP-F17 supports up to two explicit glare providers");
  const bindings = authored.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("Dirt glare binding must be an object");
    const allowed = entry.provider === "linear" ? ["provider", "resource", "metadata"] : ["provider"];
    for (const key of Object.keys(entry)) if (!allowed.includes(key)) throw new TypeError(`Unknown dirt binding property: ${key}`);
    if (entry.provider === "standard") return Object.freeze({ provider: "standard", resource: "CP-F14.glare", metadata: "CP-F14.diagnostics" });
    if (entry.provider === "flare") return Object.freeze({ provider: "flare", resource: "CP-F16.glare", metadata: "CP-F16.diagnostics" });
    if (entry.provider === "convolution") return Object.freeze({ provider: "convolution", resource: "CP-F15.glare", metadata: "CP-F15.layout" });
    if (entry.provider !== "linear") throw new TypeError("Dirt glare provider must be standard, convolution, flare or linear");
    for (const key of ["resource", "metadata"]) {
      if (typeof entry[key] !== "string" || !/^CP-F(?!17\.)\d{2}\.[A-Za-z][A-Za-z0-9_.-]*$/.test(entry[key])) throw new TypeError(`Dirt ${key} requires an explicit phase-owned resource name`);
    }
    if (entry.resource === entry.metadata) throw new TypeError("Dirt glare color and metadata must be different resources");
    return Object.freeze({ provider: "linear", resource: entry.resource, metadata: entry.metadata });
  });
  if (bindings.filter((entry) => ["standard", "convolution"].includes(entry.provider)).length > 1) throw new Error("Select standard OR convolution bloom; CP-F17 does not silently double their energy");
  const names = bindings.flatMap((entry) => [entry.resource, entry.metadata]);
  if (new Set(names).size !== names.length) throw new Error("Duplicate dirt glare resource binding");
  return Object.freeze(bindings);
}

export function dirtBindingSignature(bindings) {
  return JSON.stringify(bindings);
}

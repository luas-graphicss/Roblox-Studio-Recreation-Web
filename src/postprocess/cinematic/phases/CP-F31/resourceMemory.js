import { freeze, integer, record } from "./qualityContract.js";

const bytesPerPixel = Object.freeze({ rgba8: 4, rgba16f: 8, rgba32f: 16, rg16f: 4, r16f: 2, r32f: 4, depth24: 4, depth32f: 4 });
const fields = ["id", "kind", "domain", "ownership", "lifetime", "width", "height", "format", "depth", "mipLevels", "layers", "copies", "samples", "resolve", "bytes", "start", "end"];

export function resourceBytes(resource) {
  record(resource, "resource");
  for (const key of Object.keys(resource)) if (!fields.includes(key)) throw new TypeError(`Unknown memory field: ${key}`);
  if (resource.kind === "bytes") return integer(resource.bytes, "bytes");
  if (resource.kind !== "target") throw new TypeError("Resource kind must be target or bytes");
  const width = integer(resource.width, "width", 1, 65536);
  const height = integer(resource.height, "height", 1, 65536);
  if (!Object.hasOwn(bytesPerPixel, resource.format)) throw new TypeError(`Unknown resource format: ${resource.format}`);
  const mipLevels = integer(resource.mipLevels ?? 1, "mipLevels", 1, Math.floor(Math.log2(Math.max(width, height))) + 1);
  const layers = integer(resource.layers ?? 1, "layers", 1, 2048);
  const copies = integer(resource.copies ?? 1, "copies", 1, 1024);
  const samples = integer(resource.samples ?? 1, "samples", 1, 16);
  if (resource.depth !== undefined && typeof resource.depth !== "boolean") throw new TypeError("depth must be boolean");
  if (resource.resolve !== undefined && typeof resource.resolve !== "boolean") throw new TypeError("resolve must be boolean");
  if (samples > 1 && mipLevels > 1) throw new RangeError("Multisample and mip storage must be declared separately");
  let pixels = 0n;
  for (let level = 0; level < mipLevels; level += 1)
    pixels += BigInt(Math.max(1, Math.floor(width / 2 ** level))) * BigInt(Math.max(1, Math.floor(height / 2 ** level)));
  const colorSamples = samples + (samples > 1 && resource.resolve !== false ? 1 : 0);
  const bytes = (pixels * BigInt(bytesPerPixel[resource.format] * colorSamples) +
    BigInt(width * height * (resource.depth ? 4 * samples : 0))) * BigInt(layers * copies);
  if (bytes > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Resource byte count overflows safe accounting");
  return Number(bytes);
}

export function estimateResourceMemory(resources) {
  if (!Array.isArray(resources)) throw new TypeError("resources must be an array");
  const names = new Set();
  const rows = resources.map((resource) => {
    if (typeof resource.id !== "string" || !resource.id.trim() || names.has(resource.id)) throw new TypeError("Resource ids must be nonempty and unique");
    names.add(resource.id);
    const domain = resource.domain ?? "gpu";
    const ownership = resource.ownership ?? "owned";
    const lifetime = resource.lifetime ?? "persistent";
    if (!["gpu", "cpu"].includes(domain) || !["owned", "borrowed"].includes(ownership) || !["transient", "history", "persistent"].includes(lifetime))
      throw new TypeError("Invalid resource accounting category");
    const start = integer(resource.start ?? 0, "start", 0, 10000);
    const end = integer(resource.end ?? 10000, "end", start, 10000);
    if (lifetime !== "transient" && (start !== 0 || end !== 10000)) throw new RangeError("History and persistent resources remain resident for the full schedule");
    return { id: resource.id, bytes: resourceBytes(resource), domain, ownership, lifetime, start, end };
  });
  const total = (predicate) => integer(rows.filter(predicate).reduce((sum, row) => sum + row.bytes, 0), "totalBytes");
  const residentBytes = total(() => true);
  const boundaries = [...new Set(rows.flatMap((row) => [row.start, row.end]))];
  const schedulePeakBytes = Math.max(0, ...boundaries.map((time) => rows.filter((row) => row.start <= time && time <= row.end).reduce((sum, row) => sum + row.bytes, 0)));
  return freeze({ rows, residentBytes, schedulePeakBytes, gpuBytes: total((row) => row.domain === "gpu"),
    cpuBytes: total((row) => row.domain === "cpu"), borrowedBytes: total((row) => row.ownership === "borrowed"),
    historyBytes: total((row) => row.lifetime === "history"), accounting: "declared-bytes-not-driver-allocation",
    aliasingApplied: false, hardCapBasis: "residentBytes; pooled targets are not automatically lifetime-aliased" });
}

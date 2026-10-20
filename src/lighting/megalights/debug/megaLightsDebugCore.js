export function summarizeDebugValue(value, depth = 0, visited = new WeakSet()) {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : String(value);
  if (typeof value === "function") return "callable";
  if (typeof value !== "object") return String(value);
  if (visited.has(value)) return "shared reference";
  visited.add(value);
  if (value.isTexture)
    return {
      texture: value.name || value.uuid,
      type: value.type,
      width: value.image?.width,
      height: value.image?.height,
      depth: value.image?.depth,
    };
  if (ArrayBuffer.isView(value))
    return {
      type: value.constructor.name,
      length: value.length,
      firstValues: Array.from(value.subarray(0, 16), (entry) =>
        typeof entry === "number" && !Number.isFinite(entry)
          ? String(entry)
          : entry,
      ),
    };
  if (depth >= 5)
    return {
      type: value.constructor?.name || "object",
      keys: Object.keys(value).slice(0, 20),
    };
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 64)
      .map((item) => summarizeDebugValue(item, depth + 1, visited));
    return value.length > 64
      ? {
          type: "Array",
          length: value.length,
          omitted: value.length - 64,
          items,
        }
      : items;
  }
  const result = {};
  for (const key of Object.keys(value).slice(0, 100)) {
    if (["THREE", "renderer", "scene", "camera", "bench"].includes(key))
      continue;
    try {
      result[key] = summarizeDebugValue(value[key], depth + 1, visited);
    } catch (error) {
      result[key] = { error: String(error?.message || error) };
    }
  }
  return result;
}

export function numericSummary(values) {
  let minimum = Infinity;
  let maximum = -Infinity;
  let sum = 0;
  let finiteCount = 0;
  let nonzeroCount = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    sum += value;
    finiteCount += 1;
    if (value !== 0) nonzeroCount += 1;
  }
  return {
    minimum: finiteCount ? minimum : null,
    maximum: finiteCount ? maximum : null,
    mean: finiteCount ? sum / finiteCount : null,
    finiteCount,
    invalidCount: values.length - finiteCount,
    nonzeroCount,
  };
}

export function createDebugHistory(capacity = 180) {
  const frames = [];
  return {
    push(frame) {
      frames.push(frame);
      if (frames.length > capacity) frames.shift();
    },
    read: () => frames.map((frame) => ({ ...frame })),
    clear() {
      frames.length = 0;
    },
  };
}

export function debugHeatColor(value) {
  const normalized = Math.max(0, Math.min(1, Number(value) || 0));
  return [
    Math.round(255 * Math.max(0, Math.min(1, normalized * 2))),
    Math.round(220 * (1 - Math.abs(normalized * 2 - 1)) + 25),
    Math.round(230 * (1 - normalized)),
  ];
}

export function debugIdColor(value) {
  if (!Number.isFinite(value) || value < 0) return [24, 30, 40];
  const identifier = Math.floor(value) + 1;
  return [
    60 + ((identifier * 97) % 190),
    60 + ((identifier * 57) % 190),
    60 + ((identifier * 137) % 190),
  ];
}

export function makeDebugCheck(id, condition, detail, evidence = null) {
  return {
    id,
    status: condition === null ? "BLOCKED" : condition ? "PASS" : "FAIL",
    detail,
    evidence,
  };
}

export function compareDebugImages(left, right) {
  if (
    !left ||
    !right ||
    left.width !== right.width ||
    left.height !== right.height
  )
    return {
      comparable: false,
      reason: "Two captures with matching dimensions are required",
    };
  const expectedLength = left.width * left.height * 4;
  if (
    !Number.isInteger(left.width) ||
    !Number.isInteger(left.height) ||
    left.width < 1 ||
    left.height < 1 ||
    left.pixels?.length !== expectedLength ||
    right.pixels?.length !== expectedLength
  )
    return {
      comparable: false,
      reason: "Captures require a complete nonempty RGBA pixel array",
    };
  if (
    Array.from(left.pixels).some((value) => !Number.isFinite(value)) ||
    Array.from(right.pixels).some((value) => !Number.isFinite(value))
  )
    return {
      comparable: false,
      reason: "Non-finite pixel values cannot be compared",
    };
  let changedPixels = 0;
  let totalDifference = 0;
  let maximumDifference = 0;
  for (let offset = 0; offset < left.pixels.length; offset += 4) {
    let pixelDifference = 0;
    for (let channel = 0; channel < 3; channel += 1)
      pixelDifference += Math.abs(
        left.pixels[offset + channel] - right.pixels[offset + channel],
      );
    if (pixelDifference > 0) changedPixels += 1;
    totalDifference += pixelDifference;
    maximumDifference = Math.max(maximumDifference, pixelDifference / 3);
  }
  return {
    comparable: true,
    changedPixels,
    changedRatio: changedPixels / (left.width * left.height),
    meanAbsoluteDifference: totalDifference / (left.width * left.height * 3),
    maximumDifference,
    interpretation:
      "A difference proves a pixel change, not physical correctness or parity",
  };
}

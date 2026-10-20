const MAX_PENDING_RANGES = 64;
const trackedAttributes = new WeakSet();

function trackUploads(attribute) {
  if (trackedAttributes.has(attribute) || typeof attribute.onUpload !== "function") return;
  const previousUpload = attribute.onUploadCallback;
  attribute.onUpload(function () {
    this.clearUpdateRanges();
    if (typeof previousUpload === "function") previousUpload.call(this);
  });
  trackedAttributes.add(attribute);
}

export function markInstanceAttributeRange(attribute, firstSlot, slotCount = 1) {
  if (!attribute?.array) return false;
  const itemSize = attribute.itemSize;
  const capacity = Math.floor(attribute.array.length / itemSize);
  if (!Number.isSafeInteger(firstSlot) || !Number.isSafeInteger(slotCount)
    || firstSlot < 0 || slotCount < 0 || firstSlot + slotCount > capacity) {
    throw new RangeError("Instance update exceeds allocated attribute capacity");
  }
  if (slotCount === 0) return false;
  if (Array.isArray(attribute.updateRanges) && typeof attribute.addUpdateRange === "function") {
    trackUploads(attribute);
    let start = firstSlot * itemSize;
    let end = start + slotCount * itemSize;
    const ranges = attribute.updateRanges;
    for (let index = ranges.length - 1; index >= 0; index -= 1) {
      const range = ranges[index];
      if (range.start > end || range.start + range.count < start) continue;
      start = Math.min(start, range.start);
      end = Math.max(end, range.start + range.count);
      ranges.splice(index, 1);
      index = ranges.length;
    }
    if (ranges.length >= MAX_PENDING_RANGES) {
      for (const range of ranges) {
        start = Math.min(start, range.start);
        end = Math.max(end, range.start + range.count);
      }
      attribute.clearUpdateRanges();
    }
    attribute.addUpdateRange(start, end - start);
  }
  attribute.needsUpdate = true;
  return true;
}

export function writeInstanceAttribute(attribute, slot, values) {
  if (!attribute?.array || values.length !== attribute.itemSize
    || !Number.isSafeInteger(slot) || slot < 0
    || (slot + 1) * attribute.itemSize > attribute.array.length) {
    throw new RangeError("Invalid instance attribute write");
  }
  const offset = slot * attribute.itemSize;
  const float32 = attribute.array instanceof Float32Array;
  let changed = false;
  for (let component = 0; component < values.length; component += 1) {
    const value = float32 ? Math.fround(values[component]) : values[component];
    if (!Number.isFinite(value)) throw new TypeError("Instance attributes must remain finite");
  }
  for (let component = 0; component < values.length; component += 1) {
    const value = float32 ? Math.fround(values[component]) : values[component];
    if (attribute.array[offset + component] === value) continue;
    attribute.array[offset + component] = value;
    changed = true;
  }
  return changed && markInstanceAttributeRange(attribute, slot);
}

export function writeInstanceColor(mesh, slot, color) {
  if (!mesh.instanceColor) {
    mesh.setColorAt(slot, color);
    return markInstanceAttributeRange(mesh.instanceColor, slot);
  }
  return writeInstanceAttribute(mesh.instanceColor, slot, [color.r, color.g, color.b]);
}

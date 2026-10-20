export function stitchCaptureTile(destination, source, tile, plan, outputWidth) {
  const crop = plan.crop;
  const left = Math.max(tile.destination.x, crop.x);
  const bottom = Math.max(tile.destination.y, crop.y);
  const right = Math.min(tile.destination.x + tile.destination.width, crop.x + crop.width);
  const top = Math.min(tile.destination.y + tile.destination.height, crop.y + crop.height);
  if (right <= left || top <= bottom) return;
  for (let y = bottom; y < top; y += 1) {
    const sourceOffset = ((y - tile.origin[1]) * tile.width + left - tile.origin[0]) * 4;
    const destinationOffset = ((y - crop.y) * outputWidth + left - crop.x) * 4;
    destination.set(source.subarray(sourceOffset, sourceOffset + (right - left) * 4), destinationOffset);
  }
}

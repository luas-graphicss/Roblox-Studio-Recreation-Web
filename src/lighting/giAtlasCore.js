export function giAtlasLayout(dim) {
  const d = Math.max(1, Math.floor(Number.isFinite(dim) ? dim : 1));
  let tilesX = Math.max(1, Math.round(Math.sqrt(d)));
  while (tilesX < d && d % tilesX !== 0) tilesX += 1;
  const tilesY = Math.ceil(d / tilesX);
  return {
    dim: d,
    tilesX,
    tilesY,
    width: d * tilesX,
    height: d * tilesY,
  };
}


export function repackGiAtlas(src, dst, dim, tilesX) {
  const d = Math.max(1, Math.floor(Number.isFinite(dim) ? dim : 1));
  const tx = Math.max(1, Math.floor(Number.isFinite(tilesX) ? tilesX : 1));
  const ty = Math.ceil(d / tx);
  const width = d * tx;
  if (!src || !dst || src.length < d * d * d * 4 || dst.length < width * ty * d * 4) return dst;
  const rowBytes = d * 4;
  for (let z = 0; z < d; z++) {
    const tileX = (z % tx) * d;
    const tileY = Math.floor(z / tx) * d;
    for (let y = 0; y < d; y++) {
      const so = (d * (y + d * z)) * 4;
      const doff = ((tileY + y) * width + tileX) * 4;
      dst.set(src.subarray(so, so + rowBytes), doff);
    }
  }
  return dst;
}

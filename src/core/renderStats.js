const sample = { seq: 0, frameMs: 0, calls: 0, triangles: 0, points: 0, lines: 0, geometries: 0, textures: 0 };

export function setRenderSample(frameMs, info) {
  sample.seq++;
  sample.frameMs = Number.isFinite(frameMs) && frameMs >= 0 ? Math.min(frameMs, 1000) : 0;
  if (info && info.render) {
    sample.calls = info.render.calls | 0;
    sample.triangles = info.render.triangles | 0;
    sample.points = info.render.points | 0;
    sample.lines = info.render.lines | 0;
  }
  if (info && info.memory) {
    sample.geometries = info.memory.geometries | 0;
    sample.textures = info.memory.textures | 0;
  }
}

export function getRenderSample() {
  return sample;
}

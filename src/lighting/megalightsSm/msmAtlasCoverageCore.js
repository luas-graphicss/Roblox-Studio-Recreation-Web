import { SA_META_TEXELS, SA_ML_MAX } from "../shadowAtlasCore.js";

const CHANNELS_PER_TEXEL = 4;
const VIEW_PROJECTION_FLOAT_COUNT = 16;

export function isMsmAtlasPageReady(metaData, row) {
  if (!metaData || !Number.isInteger(row) || row < 0 || row >= SA_ML_MAX) return false;
  const scaleOffset = row * SA_META_TEXELS * CHANNELS_PER_TEXEL + VIEW_PROJECTION_FLOAT_COUNT;
  return metaData[scaleOffset] > 0 && metaData[scaleOffset + 1] > 0;
}

export function collectMsmAtlasCoveredKeys(frame = {}, target = new Set()) {
  target.clear();
  const { metaData } = frame;
  if (frame.spotEnabled && Array.isArray(frame.spotRows)) {
    frame.spotRows.forEach((spot, row) => {
      if (!spot || !isMsmAtlasPageReady(metaData, row)) return;
      const key = spot.threeLight ? spot.threeLight.uuid : spot.id;
      if (key) target.add(String(key));
    });
  }
  if (frame.pointEnabled && Array.isArray(frame.cubePages)) {
    for (const page of frame.cubePages) {
      if (!page || !page.lightKey || !isMsmAtlasPageReady(metaData, page.metaRow)) continue;


      target.add(String(page.lightKey));
    }
  }
  return target;
}

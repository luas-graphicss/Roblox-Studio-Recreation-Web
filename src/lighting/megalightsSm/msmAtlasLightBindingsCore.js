import { isMsmAtlasPageReady } from './msmAtlasCoverageCore.js';

export function bindMsmAtlasLightRows(lights, { metaData, spotRows, cubePages } = {}) {
  const descriptors = new Map((lights || []).map(light => [String(light.lightKey), light]));
  for (const light of descriptors.values()) light.atlasSlot = -1;
  (spotRows || []).forEach((spot, row) => {
    if (!spot || !isMsmAtlasPageReady(metaData, row)) return;
    const descriptor = descriptors.get(String(spot.threeLight?.uuid || spot.id));
    if (descriptor) descriptor.atlasSlot = row;
  });
  for (const page of cubePages || []) {
    if (!isMsmAtlasPageReady(metaData, page.metaRow)) continue;
    const descriptor = descriptors.get(String(page.lightKey));


    if (descriptor) descriptor.atlasSlot = page.metaRow - page.faceIndex;
  }
  return lights;
}

import { createLightIndexTable } from '../lighting/megalightsSm/msmLightIndexTableCore.js';
export function createMsmStableLightRecords() {
  const indices = createLightIndexTable();
  let lastSync = null;
  return {
    update(records) {
      indices.advanceFrame();
      lastSync = indices.syncLights(records);
      const slots = [];
      for (const record of records) {
        const index = indices.indexOf(record.lightKey);
        if (index >= 0) slots[index] = record;
      }
      return slots;
    },
    reset: () => indices.reset(),
    describe: () => ({ ...indices.snapshot(), lastSync }),
  };
}

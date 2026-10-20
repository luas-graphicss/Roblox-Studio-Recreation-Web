import { bus } from '../core/eventBus.js';
import { commands } from '../core/commands.js';
import { store } from '../core/state.js';
import { Events, getService } from '../datamodel/index.js';
import { createSubstrateSmPanelBridge } from './substrateSmPanelBridge.js';

export function createSubstrateSmEditorHost() {
  return createSubstrateSmPanelBridge({
    getLighting: () => getService(store.getDataModel(), 'Lighting'),
    commandManager: commands,
    eventBus: bus,
    propertyChangedEvent: Events.PropertyChanged,
    readQaSurface: () => globalThis.__rswLightingQa?.substrateSm ?? null,
  });
}

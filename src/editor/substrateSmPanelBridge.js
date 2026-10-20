import { createSubstrateSmSettingsController } from './substrateSmSettings.js';
import { createSubstrateSmEditorReport } from './substrateSmEditorReport.js';

const LIGHTING_REPORT_PROPERTIES = new Set(['SubstrateSM', 'SubstrateSMQuality', 'Technology', 'RenderStyle']);

export function createSubstrateSmPanelBridge({ getLighting, commandManager, eventBus, propertyChangedEvent, readQaSurface } = {}) {
  if (typeof eventBus?.on !== 'function' || typeof readQaSurface !== 'function' || typeof propertyChangedEvent !== 'string') {
    throw new TypeError('An event bus, property event and QA surface reader are required.');
  }
  const settingsController = createSubstrateSmSettingsController({ getLighting, commandManager });

  async function readReport() {
    const settings = settingsController.read();
    try {
      const surface = readQaSurface();
      const snapshot = typeof surface?.getSnapshot === 'function' ? await surface.getSnapshot() : null;
      return createSubstrateSmEditorReport({ settings, snapshot });
    } catch {
      return createSubstrateSmEditorReport({ settings, unavailableReason: 'Renderer telemetry failed. Effective quality and losses are not verified.' });
    }
  }

  function subscribe(handler) {
    const unsubscribers = [
      eventBus.on('history:changed', handler),
      eventBus.on('selection:changed', handler),
      eventBus.on(propertyChangedEvent, event => {
        if (event?.property === 'SubstrateMaterial'
          || (event?.instance === getLighting() && LIGHTING_REPORT_PROPERTIES.has(event?.property))) handler();
      }),
    ];
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }

  return Object.freeze({ settingsController, readReport, subscribe });
}

const stores = new WeakMap();

export function attachSubstrateSmTelemetryStore(telemetry, store) {
  if (stores.has(telemetry)) throw new Error('SSM_QA_TELEMETRY_ALREADY_ATTACHED');
  stores.set(telemetry, store);
}

export function getSubstrateSmTelemetryStore(telemetry) {
  const store = stores.get(telemetry);
  if (!store || store.disposed) throw new Error('SSM_QA_TELEMETRY_UNAVAILABLE');
  return store;
}

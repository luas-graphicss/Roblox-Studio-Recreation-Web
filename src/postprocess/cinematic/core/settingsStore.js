export function createSettingsStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  let revision = 0;
  return Object.freeze({
    get: (key) => values.get(key),
    set(key, value) {
      if (typeof key !== "string" || key.length === 0) throw new TypeError("Setting name is required");
      if (Object.is(values.get(key), value)) return revision;
      values.set(key, value);
      revision += 1;
      return revision;
    },
    snapshot: () => Object.fromEntries(values),
    revision: () => revision
  });
}

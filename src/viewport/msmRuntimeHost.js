import { MSM_OVERRIDE_NAMES, MSM_PUBLIC_API, normalizeMsmOverride } from '../lighting/megalightsSm/msmPublicApiCore.js';
import { MSM_QA_GLOBAL_NAME } from '../lighting/megalightsSm/msmPipelineContract.js';

const installedHosts = new WeakMap();
export function readMsmRuntimeHost(requestRender, globalObject = typeof window === 'undefined' ? null : window) {
  if (!globalObject) return null;
  const host = globalObject[MSM_QA_GLOBAL_NAME] && typeof globalObject[MSM_QA_GLOBAL_NAME] === 'object'
    ? globalObject[MSM_QA_GLOBAL_NAME] : {};
  globalObject[MSM_QA_GLOBAL_NAME] = host;
  let binding = installedHosts.get(host);
  if (!binding) {
    binding = { wake: null, values: Object.create(null), batching: false, changed: false };
    for (const name of MSM_OVERRIDE_NAMES) {
      binding.values[name] = host[name] ?? null;
      Object.defineProperty(host, name, { enumerable: true, configurable: true,
        get: () => binding.values[name],
        set(value) {
          const normalized = normalizeMsmOverride(name, value);
          if (Object.is(normalized, binding.values[name])) return;
          binding.values[name] = normalized;
          if (binding.batching) binding.changed = true;
          else binding.wake?.();
        },
      });
    }
    host.set = changes => {
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('MSM.set expects an override object');
      const validated = Object.entries(changes).map(([name, value]) => [name, normalizeMsmOverride(name, value)]);
      binding.batching = true;
      try { for (const [name, value] of validated) host[name] = value; }
      finally {
        binding.batching = false;
        if (binding.changed) { binding.changed = false; binding.wake?.(); }
      }
      return host.get?.();
    };
    host.reset = () => host.set(Object.fromEntries(MSM_OVERRIDE_NAMES.map(name => [name, null])));
    host.api = MSM_PUBLIC_API;
    host.help = 'Use __rswMsm.set({flag:"on", mode:"B"}) or assign individual overrides. Changes wake the viewport. reset() follows Lighting again; get() reads runtime evidence.';
    installedHosts.set(host, binding);
  }
  if (typeof requestRender === 'function') binding.wake = requestRender;
  return host;
}

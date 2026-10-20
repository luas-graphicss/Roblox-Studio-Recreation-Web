export const SB_SOURCE_CONTRACT_VERSION = 1;
export const SB_SOURCE_MAX_TEXT_BYTES = 65536;
export const SB_SOURCE_MAX_DATA_DEPTH = 64;
export const SB_SOURCE_MAX_DATA_VALUES = 8192;
export const SB_SOURCE_MAX_TREE_NODES = 64;
export const SB_SOURCE_ENVELOPE_KEYS = Object.freeze(['format', 'version', 'root']);
export const SB_SOURCE_NODE_KEYS = Object.freeze({
  bsdf: Object.freeze(['type', 'bsdf', 'parameters', 'label', 'path']),
  operator: Object.freeze(['type', 'operator', 'parameters', 'children', 'label', 'path']),
});

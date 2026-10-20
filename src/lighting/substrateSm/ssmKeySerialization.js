const SSM_KEY_MAX_DEPTH = 64;
const SSM_KEY_MAX_NODES = 32768;
const SSM_KEY_MAX_TEXT_LENGTH = 1048576;

export function serializeSubstrateSmKeyDescriptor(value) {
  const ancestors = new Set();
  let visitedNodes = 0;
  let textLength = 0;

  function serialize(entry, depth) {
    visitedNodes += 1;
    if (visitedNodes > SSM_KEY_MAX_NODES || depth > SSM_KEY_MAX_DEPTH) {
      throw new RangeError('SSM key descriptor exceeds structural limits');
    }
    if (entry === null) return 'null';
    if (typeof entry === 'boolean') return entry ? 'true' : 'false';
    if (typeof entry === 'number' && Number.isFinite(entry)) return JSON.stringify(entry);
    if (typeof entry === 'string') {
      textLength += entry.length;
      if (textLength > SSM_KEY_MAX_TEXT_LENGTH) throw new RangeError('SSM key descriptor is too large');
      return JSON.stringify(entry);
    }
    if (!entry || typeof entry !== 'object' || ancestors.has(entry)) {
      throw new TypeError('SSM key descriptors require acyclic finite JSON data');
    }
    const prototype = Object.getPrototypeOf(entry);
    if (!Array.isArray(entry) && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('SSM key descriptors require plain objects');
    }
    ancestors.add(entry);
    let result;
    if (Array.isArray(entry)) {
      if (entry.length > SSM_KEY_MAX_NODES) throw new RangeError('SSM key array is too large');
      const elements = [];
      for (let index = 0; index < entry.length; index += 1) {
        const property = Object.getOwnPropertyDescriptor(entry, String(index));
        if (!property || !Object.hasOwn(property, 'value')) {
          throw new TypeError('SSM key arrays must be dense data arrays');
        }
        elements.push(serialize(property.value, depth + 1));
      }
      result = `[${elements.join(',')}]`;
    } else {
      const fields = [];
      for (const name of Object.keys(entry).sort()) {
        const property = Object.getOwnPropertyDescriptor(entry, name);
        if (!Object.hasOwn(property, 'value')) throw new TypeError('SSM key getters are not supported');
        textLength += name.length;
        fields.push(`${JSON.stringify(name)}:${serialize(property.value, depth + 1)}`);
      }
      result = `{${fields.join(',')}}`;
    }
    ancestors.delete(entry);
    return result;
  }

  const result = serialize(value, 0);
  if (result.length > SSM_KEY_MAX_TEXT_LENGTH) throw new RangeError('SSM key signature is too large');
  return result;
}

export function hashSubstrateSmKeySignature(signature) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < signature.length; index += 1) {
    hash = Math.imul(hash ^ signature.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

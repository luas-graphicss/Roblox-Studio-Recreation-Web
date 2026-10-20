const ownershipByShader = new WeakMap();
const recordsByToken = new WeakMap();

export function beginSubstrateSmShaderOwnership(shader) {
  if (!shader || typeof shader !== "object") {
    throw new TypeError("A shader object is required for Substrate SM ownership");
  }
  if (ownershipByShader.has(shader)) {
    throw new Error("Substrate SM already owns this shader compilation");
  }
  const token = Object.freeze({});
  const record = { shader, token, state: "preparing" };
  ownershipByShader.set(shader, record);
  recordsByToken.set(token, record);
  return token;
}

export function commitSubstrateSmShaderOwnership(token) {
  const record = recordsByToken.get(token);
  if (!record || record.state !== "preparing") return false;
  if (ownershipByShader.get(record.shader) !== record) return false;
  record.state = "active";
  return true;
}

export function rollbackSubstrateSmShaderOwnership(token) {
  const record = recordsByToken.get(token);
  if (!record) return false;
  if (ownershipByShader.get(record.shader) !== record) return false;
  ownershipByShader.delete(record.shader);
  recordsByToken.delete(token);
  return true;
}

export function isSubstrateSmShaderResponseOwned(shader) {
  return !!shader && typeof shader === "object" && ownershipByShader.has(shader);
}

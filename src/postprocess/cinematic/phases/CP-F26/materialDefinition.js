import { MATERIAL_LOCATIONS, MATERIAL_QUALITY_TIERS, DISPLAY_ENCODINGS } from "./materialContract.js";
import { requireRecord, requireKeys, requireIdentifier, requireNumber, requireBoolean, requireShader, validateParameter, inherit } from "./materialValidation.js";
import { normalizeMaterialOutput } from "./materialOutput.js";

export function normalizeMaterialDefinition(authored) {
  requireKeys(authored, ["id", "domain", "location", "priority", "weight", "enabled", "blendable", "source", "shader", "qualityShaders", "inputs", "parameters", "output", "volumeWeight"], "material");
  const id = requireIdentifier(authored.id, "material.id");
  if (authored.domain !== "post-process") throw new TypeError("Material domain must be post-process");
  if (!Object.hasOwn(MATERIAL_LOCATIONS, authored.location)) throw new TypeError(`Unsupported blendable location: ${authored.location}`);
  const location = MATERIAL_LOCATIONS[authored.location];
  const priority = requireNumber(inherit(authored.priority, 0), "priority", -100000, 100000);
  if (!Number.isInteger(priority)) throw new TypeError("priority must be an integer");
  const weight = requireNumber(inherit(authored.weight, 1), "weight", 0, 1);
  const enabled = requireBoolean(inherit(authored.enabled, true), "enabled");
  const blendable = requireBoolean(inherit(authored.blendable, true), "blendable");
  const source = authored.source ?? location.source;
  if (typeof source !== "string" || source.length === 0) throw new TypeError("source resource is required");
  const shader = requireShader(authored.shader);
  const qualityShaders = {};
  for (const [tier, body] of Object.entries(requireRecord(authored.qualityShaders ?? {}, "qualityShaders"))) {
    if (!MATERIAL_QUALITY_TIERS.includes(tier)) throw new TypeError(`Unknown quality tier: ${tier}`);
    qualityShaders[tier] = requireShader(body);
  }
  const inputs = Object.entries(requireRecord(authored.inputs ?? {}, "inputs")).map(([name, binding]) => {
    requireIdentifier(name, "input alias");
    if (name === "Input") throw new TypeError("Input is a reserved sampler alias");
    requireKeys(binding, ["resource", "encoding", "format", "filter"], `input ${name}`);
    if (typeof binding.resource !== "string" || !binding.resource || typeof binding.encoding !== "string" || !binding.encoding || binding.encoding === "preserve") throw new TypeError("Scene texture inputs require a resource and an explicit encoding");
    if (binding.format !== undefined && typeof binding.format !== "string") throw new TypeError("Input format must be a string");
    if (binding.filter !== undefined && binding.filter !== "nearest") throw new TypeError("Input v1 uses nearest sampling; filtered depth/stencil is not permitted");
    return Object.freeze({ name, resource: binding.resource, encoding: binding.encoding, format: binding.format });
  });
  if (inputs.length > 12) throw new RangeError("A material supports at most 12 lateral texture inputs");
  const parameters = Object.fromEntries(Object.entries(requireRecord(authored.parameters ?? {}, "parameters")).map(([name, parameter]) => {
    requireIdentifier(name, "parameter name");
    requireKeys(parameter, ["type", "value"], name);
    return [name, Object.freeze({ type: parameter.type, value: validateParameter(parameter.type, parameter.value, name) })];
  }));
  const output = normalizeMaterialOutput(authored.output, id, location);
  if (authored.location === "replacingTonemapper" && (!DISPLAY_ENCODINGS.includes(output.encoding) || weight !== 1 || !enabled || !output.transformsColor)) throw new TypeError("Tonemapper replacement requires weight 1, enabled true, full-size main color and an explicit display encoding");
  if (output.encoding !== "preserve" && typeof output.encoding !== "string") throw new TypeError("Output encoding must be explicit or preserve");
  if (output.transformsColor && source !== "$color") throw new TypeError("Main color materials must read $color as primary; bind user textures as lateral inputs");
  if (authored.location !== "replacingTonemapper" && output.transformsColor && output.encoding !== "preserve") throw new TypeError("Only the selected tonemapper may change the main color encoding");
  if (typeof output.encoding !== "string" || !output.encoding.length) throw new TypeError("Output encoding cannot be empty");
  let volumeWeight = null;
  if (authored.volumeWeight !== undefined) {
    requireKeys(authored.volumeWeight, ["resource", "property"], "volumeWeight");
    const { resource, property } = authored.volumeWeight;
    if (typeof resource !== "string" || !resource || typeof property !== "string" || !property) throw new TypeError("volumeWeight requires resource and property");
    if (authored.location === "replacingTonemapper") throw new TypeError("Tonemapper ownership cannot be blended by a volume");
    volumeWeight = Object.freeze({ resource, property });
  }
  const reads = [...new Set(["$color", source, ...inputs.map((input) => input.resource), ...(volumeWeight ? [volumeWeight.resource] : [])])];
  if (reads.includes(output.name)) throw new Error(`Read/write feedback: ${output.name}`);
  return Object.freeze({ id, domain: authored.domain, location: authored.location, priority, weight, enabled, blendable, source, shader, qualityShaders: Object.freeze(qualityShaders), inputs: Object.freeze(inputs), parameters: Object.freeze(parameters), output, volumeWeight, reads: Object.freeze(reads) });
}

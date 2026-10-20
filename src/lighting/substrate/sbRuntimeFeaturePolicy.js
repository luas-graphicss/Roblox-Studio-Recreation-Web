export const REQUIRED_RUNTIME_FLAGS = Object.freeze(['SubstrateEnabled', 'SubstrateMaterialTree', 'SubstrateSlabParameters',
  'SubstrateTopologyCompiler', 'SubstrateMaterialBuffer', 'SubstrateClosureDispatch',
  'SubstrateClosureLighting', 'SubstrateFutureIntegration']);
export function resolveRuntimeFeaturePolicy(tier, isFlagActive, integrationGate = null) {
  const required = REQUIRED_RUNTIME_FLAGS;
  const missing = required.filter(id => !isFlagActive(id, tier));
  return {
    enabled: tier !== 'fraco' && missing.length === 0 && integrationGate?.substrateActive !== false,
    reason: tier === 'fraco' ? 'Weak tier uses the legacy renderer' : integrationGate?.substrateActive === false
      ? integrationGate.reason : missing.length ? `Disabled dependency: ${missing.join(', ')}` : null,
    layering: isFlagActive('SubstrateVerticalLayering', tier),
    mixing: isFlagActive('substrateHorizontalMixing', tier),
    simplify: isFlagActive('SubstrateSimplification', tier) && isFlagActive('SubstrateTierBudget', tier),
  };
}

export function resolveRuntimeOperators(root, policy) {
  if (!root || !root.operator) return root;
  const children = root.children ?? [];
  if (!policy.layering && root.operator === 'verticalLayering') return resolveRuntimeOperators(children[1], policy);
  if (!policy.mixing && ['horizontalMixing', 'add', 'weight'].includes(root.operator)) return resolveRuntimeOperators(children[0], policy);
  return {...root, children: children.map(child => resolveRuntimeOperators(child, policy))};
}

export function synchronizeSpecializedDefines(material) {
  const kind = material.userData?.sbBsdfKind;
  const requested = {SB_HAIR_MATERIAL: kind === 'hair', SB_EYE_MATERIAL: kind === 'eye' && !material.transparent};
  material.defines ??= {};
  for (const [name, enabled] of Object.entries(requested)) {
    if (enabled && material.defines[name] !== '1') { material.defines[name] = '1'; material.needsUpdate = true; }
    if (!enabled && name in material.defines) { delete material.defines[name]; material.needsUpdate = true; }
  }
}

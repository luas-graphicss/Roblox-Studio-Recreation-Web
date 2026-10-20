import { COC_OWNER, COC_RESOURCES } from "./cocContract.js";
import { readCocBindings, readCocSettings } from "./cocSettings.js";
import { createCocRenderPlan } from "./cocRenderPlan.js";
import { validateCocInputs } from "./cocInputContract.js";
import { createCocRenderer } from "./createCocRenderer.js";
import { createCocParameters, createCocResource } from "./cocResourceMetadata.js";

export function installPhysicalCoc(services) {
  if (typeof services.settings?.get !== "function") throw new TypeError("CP-F18 requires the settings service");
  const bindings = readCocBindings(services.settings);
  const bindingSignature = JSON.stringify(bindings);
  const renderer = createCocRenderer(services);
  const unregisters = [];
  let disposed = false;
  function register(name, order, reads, writes, execute) {
    unregisters.push(services.graph.register({ id: `${COC_OWNER}.${name}`, owner: COC_OWNER, stage: "dof", order, reads, writes, transformsColor: false, execute }));
  }
  function cleanup() {
    if (disposed) return;
    disposed = true;
    for (const unregister of unregisters.splice(0).reverse()) unregister();
    renderer.dispose();
  }
  try {
    register("setupCoc", 1800, [bindings.camera, bindings.depth, bindings.coverage, "$color"], [COC_RESOURCES.fullResolution, COC_RESOURCES.parameters], (context) => {
      if (JSON.stringify(readCocBindings(services.settings)) !== bindingSignature) throw new Error("CP-F18 bindings changed; reinstall to update declared graph dependencies");
      const { frame } = context;
      const settings = readCocSettings(services.settings, frame.viewId);
      const camera = context.read(bindings.camera);
      const depth = context.read(bindings.depth);
      const coverage = context.read(bindings.coverage);
      const color = context.read("$color");
      const plan = createCocRenderPlan(frame, camera.value, settings);
      const policy = validateCocInputs(frame, { camera, depth, coverage, color }, plan);
      const target = renderer.setup(frame, plan, depth, coverage, policy);
      context.publish(COC_RESOURCES.fullResolution, createCocResource("fullResolution", target, frame, plan));
      context.publish(COC_RESOURCES.parameters, createCocParameters(frame, plan, color, policy));
    });
    register("prefilterLayers", 1810, [COC_RESOURCES.fullResolution, COC_RESOURCES.parameters, "$color"], [COC_RESOURCES.reducedRadii, COC_RESOURCES.nearColor, COC_RESOURCES.farColor, COC_RESOURCES.reducedInfo], (context) => {
      const plan = context.read(COC_RESOURCES.parameters).value;
      const source = context.read("$color");
      const targets = renderer.reduce(context.frame, plan, context.read(COC_RESOURCES.fullResolution), source, plan.inputPolicy);
      for (const name of ["reducedRadii", "nearColor", "farColor", "reducedInfo"]) context.publish(COC_RESOURCES[name], createCocResource(name, targets[name], context.frame, plan, name.endsWith("Color") ? source : null));
    });
    register("classifyTiles", 1820, [COC_RESOURCES.reducedRadii, COC_RESOURCES.reducedInfo, COC_RESOURCES.parameters], [COC_RESOURCES.tiles], (context) => {
      const plan = context.read(COC_RESOURCES.parameters).value;
      const target = renderer.classify(context.frame, plan, context.read(COC_RESOURCES.reducedRadii), context.read(COC_RESOURCES.reducedInfo));
      context.publish(COC_RESOURCES.tiles, createCocResource("tiles", target, context.frame, plan));
    });
    register("dilateTiles", 1830, [COC_RESOURCES.tiles, COC_RESOURCES.parameters], [COC_RESOURCES.dilatedTiles], (context) => {
      const plan = context.read(COC_RESOURCES.parameters).value;
      const target = renderer.dilate(context.frame, plan, context.read(COC_RESOURCES.tiles));
      context.publish(COC_RESOURCES.dilatedTiles, createCocResource("tiles", target, context.frame, plan));
    });
  } catch (error) { cleanup(); throw error; }
  services.report?.({ owner: COC_OWNER, event: "physical-coc-installed", bindings, passes: 4, draws: 8, referenceVerified: false, downstreamConsumer: "CP-F19-required-for-visible-bokeh" });
  return cleanup;
}

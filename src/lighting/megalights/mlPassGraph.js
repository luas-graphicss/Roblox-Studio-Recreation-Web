import { MGL_PASSES, MGL_PASS_OWNER } from "./mlPipelineContract.js";
import { mlQa } from "./runtime/megaLightsTelemetry.js";

function createIdentityStub(passName) {
  return {
    passName,
    owner: MGL_PASS_OWNER[passName] || "?",
    isStub: true,
    execute(frameContext) {
      return frameContext;
    },
  };
}

const passImplementations = new Map();
MGL_PASSES.forEach((passName) => {
  passImplementations.set(passName, createIdentityStub(passName));
});

const passErrors = new Map();
const passDisabledByError = new Set();


const executedPasses = [];
const stubbedPasses = [];
const skippedPasses = [];
let lastPublishedRunSignature = "";

function passErrorSignature() {
  if (passErrors.size === 0) return "";
  let signature = "";
  passErrors.forEach((message, passName) => {
    signature += passName + " " + message + ";";
  });
  return signature;
}

function publishGraphRunWhenChanged() {
  const signature = [
    executedPasses.join(","),
    stubbedPasses.join(","),
    skippedPasses.join(","),
    passErrorSignature(),
  ].join("|");
  if (signature === lastPublishedRunSignature) return;
  lastPublishedRunSignature = signature;


  mlQa.passGraph({
    executed: executedPasses.slice(),
    stubbed: stubbedPasses.slice(),
    skipped: skippedPasses.slice(),
    errors: Array.from(passErrors.entries()).map(([passName, message]) => ({ passName, message })),
  });
}


export function registerPass(passName, implementation) {
  if (!passImplementations.has(passName)) {
    throw new Error("registerPass: unknown pass \"" + passName + "\". Add it to MGL_PASSES first.");
  }
  if (!implementation || typeof implementation.execute !== "function") {
    throw new Error("registerPass(" + passName + "): implementation needs an execute(frameContext) function.");
  }
  const expectedOwner = MGL_PASS_OWNER[passName];
  const declaredOwner = implementation.owner || "?";
  if (expectedOwner && declaredOwner !== expectedOwner) {


    mlQa.error(
      "pass \"" + passName + "\" is owned by " + expectedOwner + " but was registered by " + declaredOwner,
      "mlPassGraph.registerPass",
    );
  }
  passImplementations.set(passName, {
    passName,
    owner: declaredOwner,
    isStub: false,
    isEnabled: typeof implementation.isEnabled === "function" ? implementation.isEnabled : null,
    execute: implementation.execute,
  });
  passDisabledByError.delete(passName);
  passErrors.delete(passName);
  publishGraphState();
  return true;
}

export function restoreStub(passName) {
  if (!passImplementations.has(passName)) return false;
  passImplementations.set(passName, createIdentityStub(passName));
  publishGraphState();
  return true;
}


export function executeGraph(initialFrameContext) {


  const frameContext = initialFrameContext || {};
  executedPasses.length = 0;
  stubbedPasses.length = 0;
  skippedPasses.length = 0;

  for (const passName of MGL_PASSES) {
    const pass = passImplementations.get(passName);
    if (pass.isStub) {
      stubbedPasses.push(passName);
      continue;
    }
    if (passDisabledByError.has(passName)) {
      skippedPasses.push(passName);
      continue;
    }
    if (pass.isEnabled) {
      let enabled = false;
      try {
        enabled = !!pass.isEnabled(frameContext);
      } catch (error) {
        mlQa.error(error, "pass " + passName + ".isEnabled");
      }
      if (!enabled) {
        skippedPasses.push(passName);
        continue;
      }
    }
    try {
      const returnedValue = pass.execute(frameContext);
      if (returnedValue && returnedValue !== frameContext) {


        mlQa.error(
          "pass \"" + passName + "\" returned an object that is not the shared frame context; " +
            "the return was ignored so the frame keeps every input published before it",
          "mlPassGraph.executeGraph",
        );
      }
      executedPasses.push(passName);
    } catch (error) {


      passErrors.set(passName, String((error && error.message) || error));
      passDisabledByError.add(passName);
      mlQa.error(error, "pass " + passName + ".execute (pass disabled, identity fallback)");
      skippedPasses.push(passName);
    }
  }

  publishGraphRunWhenChanged();
  return frameContext;
}

export function listPasses() {
  return MGL_PASSES.map((passName) => {
    const pass = passImplementations.get(passName);
    return {
      passName,
      expectedOwner: MGL_PASS_OWNER[passName] || "?",
      registeredOwner: pass.owner,
      isStub: pass.isStub,
      disabledByError: passDisabledByError.has(passName),
      error: passErrors.get(passName) || null,
    };
  });
}

export function implementedPassCount() {
  return MGL_PASSES.filter((passName) => !passImplementations.get(passName).isStub).length;
}

function publishGraphState() {


  lastPublishedRunSignature = "";
  mlQa.phase("base", {
    passesTotal: MGL_PASSES.length,
    passesImplemented: implementedPassCount(),
    passesStubbed: MGL_PASSES.length - implementedPassCount(),
  });
}

publishGraphState();

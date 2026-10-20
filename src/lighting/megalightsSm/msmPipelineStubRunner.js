import { findPass, listPasses } from "./msmPipelineContract.js";


export const MSM_IDENTITY_STUB_KIND = "identity-stub";
export const MSM_IMPLEMENTATION_KIND = "implementation";


export const MSM_PASS_LEDGER_KIND = "gpu";


export const MSM_STUB_OWNER_PHASE = "MSM-F2";

function returnInputUnchanged(input) {
  return input;
}


export function createIdentityStubPass(passId) {
  const pass = findPass(passId);
  return Object.freeze({
    id: pass ? pass.id : String(passId),
    kind: MSM_IDENTITY_STUB_KIND,
    ownerPhase: MSM_STUB_OWNER_PHASE,
    run: returnInputUnchanged,
  });
}

function normalizeImplementation(passId, implementation) {
  const source = implementation && typeof implementation === "object" ? implementation : {};
  if (typeof source.run !== "function") return null;
  return Object.freeze({
    id: passId,
    kind: source.kind === MSM_IDENTITY_STUB_KIND ? MSM_IDENTITY_STUB_KIND : MSM_IMPLEMENTATION_KIND,
    ownerPhase: typeof source.ownerPhase === "string" && source.ownerPhase ? source.ownerPhase : "desconhecida",
    run: source.run,
  });
}

function toFiniteMs(startedAt, endedAt) {
  const elapsed = Number(endedAt) - Number(startedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}


export function createMsmPipelineRunner(options) {
  const settings = options && typeof options === "object" ? options : {};
  const ledger = settings.ledger && typeof settings.ledger.add === "function" ? settings.ledger : null;
  const now = typeof settings.now === "function" ? settings.now : null;
  const implementations = new Map();
  let frameIndex = 0;

  for (const pass of listPasses()) {
    implementations.set(pass.id, createIdentityStubPass(pass.id));
  }

  function registerPass(passId, implementation) {
    const pass = findPass(passId);
    if (!pass) return { ok: false, reason: "passe fora do contrato: " + String(passId) };
    const normalized = normalizeImplementation(pass.id, implementation);
    if (!normalized) return { ok: false, reason: "implementacao sem funcao run em " + pass.id };
    implementations.set(pass.id, normalized);
    return { ok: true, reason: "" };
  }

  function getPass(passId) {
    return implementations.get(passId) || null;
  }

  function isIdentity() {
    for (const implementation of implementations.values()) {
      if (implementation.kind !== MSM_IDENTITY_STUB_KIND) return false;
    }
    return true;
  }

  function runPass(pass, input) {
    const implementation = implementations.get(pass.id) || createIdentityStubPass(pass.id);
    const startedAt = now ? now() : 0;
    let output = input;
    let failureReason = "";
    try {
      output = implementation.run(input, pass);
    } catch (error) {
      output = input;
      failureReason = error && error.message ? String(error.message) : "erro sem mensagem";
    }
    const elapsedMs = toFiniteMs(startedAt, now ? now() : 0);
    if (ledger) ledger.add(pass.id, elapsedMs, { kind: MSM_PASS_LEDGER_KIND });
    return {
      report: Object.freeze({
        id: pass.id,
        shortName: pass.shortName,
        kind: implementation.kind,
        ownerPhase: implementation.ownerPhase,
        ms: elapsedMs,
        changedOutput: output !== input,
        failed: failureReason !== "",
        failureReason,
      }),
      output,
    };
  }


  function runFrame(frameInput) {
    const reports = [];
    let value = frameInput;
    for (const pass of listPasses()) {
      const result = runPass(pass, value);
      reports.push(result.report);
      value = result.output;
    }
    frameIndex += 1;
    return Object.freeze({
      frameIndex,
      output: value,
      identity: isIdentity() && value === frameInput,
      passes: Object.freeze(reports),
    });
  }

  function describe() {
    return {
      frames: frameIndex,
      identity: isIdentity(),
      measuresMs: !!now,
      feedsLedger: !!ledger,
      passes: listPasses().map((pass) => {
        const implementation = implementations.get(pass.id);
        return { id: pass.id, kind: implementation.kind, ownerPhase: implementation.ownerPhase };
      }),
    };
  }

  return { registerPass, getPass, isIdentity, runFrame, describe };
}

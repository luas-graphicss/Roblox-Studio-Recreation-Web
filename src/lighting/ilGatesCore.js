function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function fin(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function r1(v) {
  return Math.round(num(v, 0) * 10) / 10;
}

function r3(v) {
  return Math.round(num(v, 0) * 1000) / 1000;
}

export const GPU_CLASSES = Object.freeze(["fraco", "medio", "alto"]);


export const IL_TIER_TARGETS = Object.freeze({
  alto: Object.freeze({ id: "alto", nome: "GPU forte — Realistic FULL @1080p", fpsMovMin: 60, fpsParadoMin: 60, p95MovMaxMs: 0 }),
  medio: Object.freeze({ id: "medio", nome: "GPU média — Realistic FULL", fpsMovMin: 40, fpsParadoMin: 40, p95MovMaxMs: 0 }),
  fraco: Object.freeze({ id: "fraco", nome: "G210/fraca — Realistic-lite", fpsMovMin: 25, fpsMovIdeal: 35, fpsParadoMin: 60, p95MovMaxMs: 45 }),
});


export const REALISTIC_LITE_SET = Object.freeze(["tonemap", "tabela-pbr", "fog-altura", "spec-occlusion"]);


export const REGRESSION_TOL = 0.05;


export const IL_PHASE_COST_MAP = Object.freeze([
  Object.freeze({ fase: "IL-F2", nome: "HDR fim-a-fim (teto do CC)", onde: "postfx", chainLabel: "", telemetria: "hdr", lite: false, nota: "1 uniform por pass de CC — custo ~0, dentro do passe postfx" }),
  Object.freeze({ fase: "IL-F3", nome: "tone mapping fílmico", onde: "postfx", chainLabel: "", telemetria: "tonemap", lite: true, nota: "uniform no grade/fundido — dentro do passe postfx (item do Realistic-lite)" }),
  Object.freeze({ fase: "IL-F4", nome: "fotometria física (EV100)", onde: "principal", chainLabel: "", telemetria: "photometry", lite: false, nota: "CPU no applyLighting — custo ~0" }),
  Object.freeze({ fase: "IL-F5", nome: "auto-exposure (adaptação ocular)", onde: "postfx", chainLabel: "auto-exposure", telemetria: "autoExposure", lite: false, nota: "3 draws 64→1 + readback async" }),
  Object.freeze({ fase: "IL-F6", nome: "exposição local", onde: "postfx", chainLabel: "exposicao-local", telemetria: "localExposure", lite: false, nota: "3 blits 1/4 res (guia bilateral)" }),
  Object.freeze({ fase: "IL-F7", nome: "tabela física PBR (38 materiais)", onde: "principal", chainLabel: "", telemetria: "", lite: true, nota: "uniforms por material; telemetria em global próprio __rswMaterialPhysicsQa (consolidação pendente)" }),
  Object.freeze({ fase: "IL-F8", nome: "mapas PBR procedurais", onde: "principal", chainLabel: "", telemetria: "", lite: false, nota: "geração one-shot CPU (≤50 ms, pbrMapsStats); custo de frame = amostragem de textura" }),
  Object.freeze({ fase: "IL-F9", nome: "specular AA + multi-scatter GGX", onde: "principal", chainLabel: "", telemetria: "specAa", lite: false, nota: "~8 ALU + 2 derivadas por fragmento" }),
  Object.freeze({ fase: "IL-F10", nome: "SurfaceAppearance (ORM/POM/detail)", onde: "principal", chainLabel: "", telemetria: "surfaceAppearance", lite: false, nota: "POM só em GPU forte (gate próprio da fase)" }),
  Object.freeze({ fase: "IL-F11", nome: "features físicas de material", onde: "principal", chainLabel: "", telemetria: "matFeat", lite: false, nota: "lobos por uniform (coat/aniso/sheen/sss)" }),
  Object.freeze({ fase: "IL-F12", nome: "refração real de vidro", onde: "vidro", chainLabel: "", telemetria: "refraction", lite: false, compartilhadoCom: "F13-sombras (transmissão) divide o pass 'vidro'", nota: "grab-pass 1/2 res teto 1280" }),
  Object.freeze({ fase: "IL-F13", nome: "emissivos HDR em nits", onde: "principal", chainLabel: "", telemetria: "emissiveHdr", lite: false, nota: "uniform de ganho — custo ~0" }),
  Object.freeze({ fase: "IL-F14", nome: "céu físico (Hosek-Wilkie)", onde: "principal", chainLabel: "", telemetria: "skyPhysical", lite: false, nota: "skydome por uniform" }),
  Object.freeze({ fase: "IL-F15", nome: "IBL do céu (skydome 64px→PMREM)", onde: "principal", chainLabel: "", telemetria: "envCapture", lite: false, nota: "captura one-shot no ócio (envCapture; re-bake só quando o céu muda) — não é custo contínuo de frame" }),
  Object.freeze({ fase: "IL-F16", nome: "HDRI do usuário como luz", onde: "principal", chainLabel: "", telemetria: "hdri", lite: false, nota: "parse em worker + PMREM one-shot (não é custo de frame)" }),
  Object.freeze({ fase: "IL-F17", nome: "height fog físico + aerial", onde: "principal", chainLabel: "", telemetria: "heightFog", lite: true, nota: "integral analítica no chunk de fog (item do Realistic-lite)" }),
  Object.freeze({ fase: "IL-F18", nome: "fog volumétrico (god rays)", onde: "postfx", chainLabel: "fogVolumetrico", telemetria: "volumetricFog", lite: false, nota: "marcha 1/4 res + temporal; AUTO só em GPU forte" }),
]);


export const IL_SELL_ORDER = Object.freeze([
  Object.freeze({ id: "fog-volumetrico", fase: "IL-F18", prop: "Lighting.VolumetricFog=false", estMs: 2.0, lite: false }),
  Object.freeze({ id: "refracao-vidro", fase: "IL-F12", prop: "Lighting.GlassRefraction=false", estMs: 1.0, lite: false }),
  Object.freeze({ id: "exposicao-local", fase: "IL-F6", prop: "Lighting.LocalExposure=false", estMs: 0.8, lite: false }),
  Object.freeze({ id: "pom-surface", fase: "IL-F10", prop: "HeightScale=0 (POM off)", estMs: 0.6, lite: false }),
  Object.freeze({ id: "material-features", fase: "IL-F11", prop: "Lighting.MaterialFeatures=false", estMs: 0.5, lite: false }),
  Object.freeze({ id: "auto-exposure", fase: "IL-F5", prop: "Lighting.AutoExposure=false", estMs: 0.4, lite: false }),
  Object.freeze({ id: "specular-aa", fase: "IL-F9", prop: "__rswSpecAa.set(false) (A/B)", estMs: 0.15, lite: false }),
]);




export function classifyGpuClass(t) {
  const o = t && typeof t === "object" ? t : null;
  if (!o) return { classe: "", reason: "telemetria ausente" };
  if (o.weakGpu === true) return { classe: "fraco", reason: "weakGpu=true (perfil fraco da sessão)" };
  if (o.weakGpu !== false) return { classe: "", reason: "weakGpu indefinido — telemetria incompleta" };
  const tier = typeof o.tier === "string" ? o.tier.toLowerCase() : "";
  if (tier === "ultra" || tier === "high") return { classe: "alto", reason: "GPU forte em tier " + tier };
  if (tier === "medium") return { classe: "medio", reason: "GPU forte em tier medium" };
  if (tier === "low" || tier === "lite" || tier === "micro") return { classe: "medio", reason: "GPU forte degradada para tier " + tier + " — classificada como médio (conservador)" };
  return { classe: "", reason: tier ? "tier desconhecido: " + tier : "tier ausente" };
}


export function evalFpsGates(classe, stats) {
  const gates = [];
  const alvo = IL_TIER_TARGETS[classe];
  if (!alvo) {
    gates.push({ id: "FPS-CLASSE", nome: "classe de GPU conhecida", status: "PENDENTE", detalhe: "classe inválida: " + String(classe) });
    return gates;
  }
  const s = stats && typeof stats === "object" ? stats : {};
  const fpsMov = fin(s.fpsMov);
  const fpsParado = fin(s.fpsParado);
  const p95 = fin(s.p95MovMs);
  if (fpsMov === null) {
    gates.push({ id: "FPS-MOV", nome: "fps em movimento (" + alvo.nome + ")", status: "PENDENTE", detalhe: "sem medição de fps em movimento" });
  } else {
    const ok = fpsMov >= alvo.fpsMovMin;
    let det = r1(fpsMov) + " fps (alvo ≥" + alvo.fpsMovMin + ")";
    if (ok && alvo.fpsMovIdeal && fpsMov < alvo.fpsMovIdeal) det += " — dentro da faixa " + alvo.fpsMovMin + "-" + alvo.fpsMovIdeal + ", abaixo do ideal " + alvo.fpsMovIdeal;
    gates.push({ id: "FPS-MOV", nome: "fps em movimento (" + alvo.nome + ")", status: ok ? "PASS" : "FAIL", detalhe: det });
  }
  if (fpsParado === null) {
    gates.push({ id: "FPS-PARADO", nome: "fps parado (" + alvo.nome + ")", status: "PENDENTE", detalhe: "sem medição de fps parado" });
  } else {
    const ok = fpsParado >= alvo.fpsParadoMin;
    gates.push({ id: "FPS-PARADO", nome: "fps parado (" + alvo.nome + ")", status: ok ? "PASS" : "FAIL", detalhe: r1(fpsParado) + " fps (alvo ≥" + alvo.fpsParadoMin + ")" });
  }
  if (alvo.p95MovMaxMs > 0) {
    if (p95 === null) {
      gates.push({ id: "FPS-P95", nome: "p95 de frame em movimento", status: "PENDENTE", detalhe: "sem medição de p95" });
    } else {
      const ok = p95 <= alvo.p95MovMaxMs;
      gates.push({ id: "FPS-P95", nome: "p95 de frame em movimento", status: ok ? "PASS" : "FAIL", detalhe: r1(p95) + " ms (gate ≤" + alvo.p95MovMaxMs + " ms, herdado do plano de sombras §5)" });
    }
  }
  return gates;
}


export function evalRegression(baselineRows, currentRows, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  let tol = num(o.tolPct, REGRESSION_TOL);
  if (tol < 0) tol = 0;
  if (tol > 0.5) tol = 0.5;
  const base = Array.isArray(baselineRows) ? baselineRows : [];
  const cur = Array.isArray(currentRows) ? currentRows : [];
  if (!base.length || !cur.length) {
    return { status: "PENDENTE", porCena: [], semPar: [], detalhe: "precisa de DUAS medições IL-F1 (baseline e atual): rode tools/qa/iluminacao/il-f1-baseline.qa.js no estado-base, guarde __ilF1 em globalThis.__ilF1Baseline e rode de novo agora" };
  }






  const curMap = new Map();
  for (const r of cur) {
    if (r && typeof r === "object" && typeof r.cena === "string" && !curMap.has(r.cena)) curMap.set(r.cena, r);
  }
  const porCena = [];
  const semPar = [];
  const vistos = new Set();
  let fails = 0;
  let matched = 0;
  for (const b of base) {
    if (!b || typeof b !== "object" || typeof b.cena !== "string" || vistos.has(b.cena)) continue;
    vistos.add(b.cena);
    const fb = fin(b.fpsParado);
    const c = curMap.get(b.cena);
    const fc = fin(c && c.fpsParado);
    if (fb === null || fb <= 0) { semPar.push({ cena: b.cena, motivo: "fpsParado do baseline inválido" }); continue; }


    if (fc === null || fc <= 0) { semPar.push({ cena: b.cena, motivo: c ? "fpsParado atual inválido" : "sem medição atual" }); continue; }
    matched += 1;
    const piso = fb * (1 - tol);
    const ok = fc >= piso;
    if (!ok) fails += 1;
    porCena.push({ cena: b.cena, baseline: fb, atual: fc, piso: r3(piso), gate: ok ? "PASS" : "FAIL" });
  }
  if (!matched) return { status: "PENDENTE", porCena: [], semPar, detalhe: "nenhuma cena em comum com fpsParado válido entre baseline e atual" };
  if (fails > 0) {
    return { status: "FAIL", porCena, semPar, detalhe: fails + " de " + matched + " cena(s) regrediu(ram) além de " + Math.round(tol * 100) + "%" + (semPar.length ? " (e " + semPar.length + " cena(s) do baseline sem par atual)" : "") };
  }
  if (semPar.length) {
    return { status: "PENDENTE", porCena, semPar, detalhe: "0 regressão nas " + matched + " cena(s) medidas, mas cobertura INCOMPLETA do baseline — sem par atual: " + semPar.map((x) => x.cena).join(", ") };
  }
  return { status: "PASS", porCena, semPar, detalhe: "0 de " + matched + " cena(s) regrediu além de " + Math.round(tol * 100) + "% (cobertura completa do baseline)" };
}


export function buildPhaseCostTable(ledger, chainLabels, telemetry) {
  const passes = ledger && typeof ledger === "object" && Array.isArray(ledger.passes) ? ledger.passes : [];
  const chain = Array.isArray(chainLabels) ? chainLabels.map((c) => String(c)) : [];
  const tele = telemetry && typeof telemetry === "object" ? telemetry : {};
  const emaOf = (id) => {
    for (const p of passes) {
      if (p && p.id === id) return { ema: num(p.emaMs, 0), samples: Math.max(0, num(p.samples, 0)) };
    }
    return null;
  };
  const shareCount = {};
  for (const def of IL_PHASE_COST_MAP) shareCount[def.onde] = (shareCount[def.onde] || 0) + 1;
  const rows = [];
  for (const def of IL_PHASE_COST_MAP) {
    const led = emaOf(def.onde);
    const compartilhado = (shareCount[def.onde] || 0) > 1 || !!def.compartilhadoCom;
    rows.push({
      fase: def.fase,
      nome: def.nome,
      ondeLedger: def.onde,
      passeEmaMs: led ? r3(led.ema) : null,
      passeSamples: led ? led.samples : 0,
      custoIsolado: !compartilhado && led ? r3(led.ema) : null,
      compartilhado,
      compartilhadoCom: def.compartilhadoCom || "",
      chainLabel: def.chainLabel || "",
      naChain: def.chainLabel ? chain.indexOf(def.chainLabel) !== -1 : null,
      telemetria: def.telemetria || "",
      teleVivo: def.telemetria ? def.telemetria in tele : null,
      lite: def.lite === true,
      nota: def.nota || "",
    });
  }
  return rows;
}


export function autotuneSuggestions(input) {
  const a = input && typeof input === "object" ? input : {};
  const classe = GPU_CLASSES.indexOf(a.classe) !== -1 ? a.classe : "";
  if (!classe) return [];
  const alvo = IL_TIER_TARGETS[classe];
  const fps = fin(a.fpsMov);
  if (fps === null || fps <= 0 || fps >= alvo.fpsMovMin) return [];
  const vivos = Array.isArray(a.vivos) ? a.vivos : null;
  const deficitMs = 1000 / fps - 1000 / alvo.fpsMovMin;
  const out = [];
  let recovered = 0;
  for (const sObj of IL_SELL_ORDER) {
    if (sObj.lite === true || REALISTIC_LITE_SET.indexOf(sObj.id) !== -1) continue;
    if (vivos && vivos.indexOf(sObj.id) === -1) continue;
    if (classe === "fraco") {
      out.push({ id: sObj.id, fase: sObj.fase, acao: "OFF: " + sObj.prop, motivo: "classe fraco: fora do conjunto Realistic-lite (deveria estar OFF)", estGanhoMs: sObj.estMs });
      continue;
    }
    if (recovered >= deficitMs) break;
    out.push({ id: sObj.id, fase: sObj.fase, acao: "OFF: " + sObj.prop, motivo: "recuperar ~" + sObj.estMs + " ms (déficit " + r1(deficitMs) + " ms até " + alvo.fpsMovMin + " fps)", estGanhoMs: sObj.estMs });
    recovered += sObj.estMs;
  }
  const gov = a.governor && typeof a.governor === "object" ? a.governor : null;
  if (gov && typeof gov.blocked === "string" && gov.blocked) {
    out.push({ id: "governor", fase: "F19/F36", acao: "governor (consome-only)", motivo: "governor bloqueado: " + gov.blocked, estGanhoMs: 0 });
  }
  return out;
}


export function gatesVerdict(gates) {
  const list = Array.isArray(gates) ? gates : [];
  let pass = 0;
  let fail = 0;
  let pend = 0;
  for (const g of list) {
    const st = g && typeof g === "object" ? String(g.status) : "";
    if (st === "PASS") pass += 1;
    else if (st === "FAIL") fail += 1;
    else pend += 1;
  }
  const releaseOk = fail === 0 && pend === 0 && pass > 0;
  return {
    pass,
    fail,
    pend,
    releaseOk,
    veredito:
      "IL-GATES: " + pass + " PASS, " + fail + " FAIL, " + pend + " PENDENTE — " +
      (releaseOk
        ? "TUDO VERDE nesta classe: elegível a certificar (precisa TAMBÉM da outra classe de GPU verde antes de Realistic virar default)."
        : "RenderStyle Realistic NÃO pode virar default (regra da casa: FAIL/PENDENTE bloqueiam; nunca ligar por fé)."),
  };
}


export function evalCrossClass(outra, minhaClasse) {
  const o = outra && typeof outra === "object" ? outra : null;
  const instr = "rode este harness na OUTRA classe de GPU e cole o __ilGatesFinais de la em globalThis.__ilGatesOutraClasse";
  if (!o || typeof o.classe !== "string" || !o.classe) return { status: "PENDENTE", detalhe: instr };
  if (o.classe === String(minhaClasse || "")) return { status: "PENDENTE", detalhe: "resultado importado e da MESMA classe ('" + o.classe + "') — " + instr };
  if (o.done !== true) return { status: "PENDENTE", detalhe: "resultado importado esta incompleto (done!==true) — rode o harness ate o fim na outra classe" };
  const gates = Array.isArray(o.gates) ? o.gates.filter((g) => g && typeof g === "object" && g.id !== "CROSS") : [];
  const v = gatesVerdict(gates);
  const placar = v.pass + " PASS, " + v.fail + " FAIL, " + v.pend + " PENDENTE (gate CROSS dela filtrado — anti-circular)";
  if (v.fail > 0) return { status: "FAIL", detalhe: "classe '" + o.classe + "' importada: " + placar };
  if (!v.releaseOk) return { status: "PENDENTE", detalhe: "classe '" + o.classe + "' importada sem prova completa: " + placar };
  return { status: "PASS", detalhe: "classe '" + o.classe + "' importada: " + placar };
}

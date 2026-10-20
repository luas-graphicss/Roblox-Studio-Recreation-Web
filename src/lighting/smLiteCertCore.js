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

export const SM_LITE_CERT_VERSION = "sm-lite-f6-r1";


export const SM_LITE_CERT_TARGETS = Object.freeze({
  fpsMovMin: 25,
  fpsMovIdeal: 35,
  frameEmaMaxMs: 40,
  idleFramesMax: 0,
  renderScaleRef: 0.75,
});


export const SM_LITE_PHASE_BUDGETS = Object.freeze([
  Object.freeze({ fase: "F1", nome: "Blinn-Phong no ShadowMap (matKind phong)", budgetMs: 0, onde: "principal", chainLabel: "", telemetria: "matKind", nota: "só ALU no shader base — zero pass novo, zero RT novo" }),
  Object.freeze({ fase: "F2", nome: "GTAO-lite ¼ res FIXO + specular occlusion no phong", budgetMs: 2.5, onde: "ao", chainLabel: "", telemetria: "aoLite", nota: "kernel F10 reusado (denoise SÓ espacial, sem TSR); custo no pass do AO, compartilhado" }),
  Object.freeze({ fase: "F3", nome: "PCSS-lite do sol (8 taps Vogel, penumbra constante)", budgetMs: 2, onde: "principal", chainLabel: "", telemetria: "pcssLite", nota: "8 fetches vs 17 do PCF legado — custo dentro do shader principal" }),
  Object.freeze({ fase: "F4", nome: "IBL-lite 32 px (cubo cru + PMREM)", budgetMs: 0, onde: "principal", chainLabel: "", telemetria: "iblLite", nota: "captura one-shot no ócio (cadência IL-F22) — não é custo contínuo de frame" }),
  Object.freeze({ fase: "F5", nome: "pós cinematográfico barato (flare-lite/vinheta/grading/knob)", budgetMs: 1, onde: "postfx", chainLabel: "lensFlare", telemetria: "f5", nota: "vinheta+grading no pass FUNDIDO do CC (~0); flare-lite 3 ghosts @ 1/8" }),
]);


export function classifySmLiteClass(t) {
  const o = t && typeof t === "object" ? t : null;
  if (!o) return { classe: "", reason: "telemetria ausente" };
  if (o.weakGpu === true) return { classe: "fraco", reason: "weakGpu=true — alvo 25–35 fps do pacote (G210)" };
  if (o.weakGpu === false) return { classe: "forte", reason: "weakGpu=false — pacote AUTO OFF: a prova aqui é byte a byte" };
  return { classe: "", reason: "weakGpu indefinido — telemetria incompleta" };
}


export function fpsFromBench(bench) {
  const b = bench && typeof bench === "object" ? bench : null;
  if (!b || b.modo !== "atividade") return null;
  const frames = fin(b.dFrames);
  const ms = fin(b.janelaMs);
  if (frames === null || ms === null || ms <= 0 || frames < 0) return null;
  return (frames * 1000) / ms;
}

function aoVivo(v) {
  if (v === true) return true;
  if (v && typeof v === "object") {
    if (v.on === true) return true;
    if (num(v.resDiv, 0) > 0) return true;
  }
  return false;
}





export function evalPackageCoherence(sm) {
  const gates = [];
  const o = sm && typeof sm === "object" ? sm : null;
  if (!o) {
    gates.push({ id: "PKG-ON", nome: "pacote SM-Realista Lite ativo (F1)", status: "PENDENTE", detalhe: "telemetria smRealistaLite ausente — force __rswSmRealista=true em ShadowMap+Realistic e leia __rswLightingQa.get().smRealistaLite" });
    gates.push({ id: "PKG-AO", nome: "GTAO-lite ¼ fixo + specOcc phong (F2)", status: "PENDENTE", detalhe: "sem telemetria" });
    gates.push({ id: "PKG-PCSS", nome: "PCSS-lite do sol (F3)", status: "PENDENTE", detalhe: "sem telemetria" });
    gates.push({ id: "PKG-IBL", nome: "IBL-lite 32 px (F4)", status: "PENDENTE", detalhe: "sem telemetria" });
    gates.push({ id: "PKG-F5", nome: "pós cinematográfico + flare-lite (F5)", status: "PENDENTE", detalhe: "sem telemetria" });
    return gates;
  }
  const on = o.on === true;
  const phong = o.matKind === "phong";
  const razao = typeof o.reason === "string" && o.reason ? o.reason : "";
  gates.push({
    id: "PKG-ON",
    nome: "pacote SM-Realista Lite ativo (F1)",
    status: on && phong ? "PASS" : on || o.on === false ? "FAIL" : "PENDENTE",
    detalhe: on && phong ? "on=true + matKind=phong" + (razao ? " (" + razao + ")" : "") : "on=" + String(o.on) + " matKind=" + String(o.matKind) + (razao ? " — " + razao : ""),
  });
  const offDet = "pacote OFF — ligue __rswSmRealista=true em ShadowMap+Realistic";
  if (!on) {
    gates.push({ id: "PKG-AO", nome: "GTAO-lite ¼ fixo + specOcc phong (F2)", status: "PENDENTE", detalhe: offDet });
  } else if (o.aoLite === undefined && o.aoNoTemporal === undefined && o.specOccPhong === undefined) {
    gates.push({ id: "PKG-AO", nome: "GTAO-lite ¼ fixo + specOcc phong (F2)", status: "PENDENTE", detalhe: "telemetria F2 (aoLite/aoNoTemporal/specOccPhong) ausente" });
  } else {
    gates.push({ id: "PKG-AO", nome: "GTAO-lite ¼ fixo + specOcc phong (F2)", status: aoVivo(o.aoLite) ? "PASS" : "FAIL", detalhe: "aoLite=" + (o.aoLite && typeof o.aoLite === "object" ? "{resDiv:" + String(o.aoLite.resDiv) + ",temporal:" + String(o.aoLite.temporal) + "}" : String(o.aoLite)) + " aoNoTemporal=" + String(o.aoNoTemporal) + " specOccPhong=" + String(o.specOccPhong) });
  }
  const pcss = o.pcssLite && typeof o.pcssLite === "object" ? o.pcssLite : null;
  if (!on) gates.push({ id: "PKG-PCSS", nome: "PCSS-lite do sol (F3)", status: "PENDENTE", detalhe: offDet });
  else if (!pcss) gates.push({ id: "PKG-PCSS", nome: "PCSS-lite do sol (F3)", status: "PENDENTE", detalhe: "telemetria pcssLite ausente" });
  else gates.push({ id: "PKG-PCSS", nome: "PCSS-lite do sol (F3)", status: pcss.on === true ? "PASS" : "FAIL", detalhe: "on=" + String(pcss.on) + " marker=" + String(pcss.marker) + " taps=" + String(pcss.taps) + " supported=" + String(pcss.supported) });
  const ibl = o.iblLite && typeof o.iblLite === "object" ? o.iblLite : null;
  if (!on) gates.push({ id: "PKG-IBL", nome: "IBL-lite 32 px (F4)", status: "PENDENTE", detalhe: offDet });
  else if (!ibl) gates.push({ id: "PKG-IBL", nome: "IBL-lite 32 px (F4)", status: "PENDENTE", detalhe: "telemetria iblLite ausente" });
  else gates.push({ id: "PKG-IBL", nome: "IBL-lite 32 px (F4)", status: ibl.on === true && num(ibl.sizePx, 0) === 32 ? "PASS" : "FAIL", detalhe: "on=" + String(ibl.on) + " sizePx=" + String(ibl.sizePx) + " ready=" + String(ibl.ready) + " (aceite F4: 32 px com pacote ON)" });
  const f5 = o.f5 && typeof o.f5 === "object" ? o.f5 : null;
  if (!on) gates.push({ id: "PKG-F5", nome: "pós cinematográfico + flare-lite (F5)", status: "PENDENTE", detalhe: offDet });
  else if (!f5) gates.push({ id: "PKG-F5", nome: "pós cinematográfico + flare-lite (F5)", status: "PENDENTE", detalhe: "telemetria f5 ausente" });
  else gates.push({ id: "PKG-F5", nome: "pós cinematográfico + flare-lite (F5)", status: f5.on === true && f5.flareLite === true ? "PASS" : "FAIL", detalhe: "on=" + String(f5.on) + " flareLite=" + String(f5.flareLite) + " specIntensity=" + String(f5.specIntensity) + " vignette=" + String(f5.vignette) });
  return gates;
}



export function evalWeakPerfGates(stats) {
  const s = stats && typeof stats === "object" ? stats : {};
  const t = SM_LITE_CERT_TARGETS;
  const gates = [];
  const fps = fin(s.fpsMov);
  if (fps === null) {
    gates.push({ id: "FPS-MOV", nome: "fps em atividade no G210 (pacote ON)", status: "PENDENTE", detalhe: "sem medição — rode o bench de atividade (janela 5 s, §3 do plano)" });
  } else {
    const ok = fps >= t.fpsMovMin;
    let det = r1(fps) + " fps (alvo " + t.fpsMovMin + "–" + t.fpsMovIdeal + " @ renderScale " + t.renderScaleRef + ")";
    if (ok && fps < t.fpsMovIdeal) det += " — dentro da faixa, abaixo do ideal " + t.fpsMovIdeal;
    gates.push({ id: "FPS-MOV", nome: "fps em atividade no G210 (pacote ON)", status: ok ? "PASS" : "FAIL", detalhe: det });
  }
  const ema = fin(s.frameEmaMs);
  if (ema === null) {
    gates.push({ id: "FRAME-EMA", nome: "frame EMA ≤ " + t.frameEmaMaxMs + " ms (ledger)", status: "PENDENTE", detalhe: "sem medição do ledger (totalMs)" });
  } else {
    gates.push({ id: "FRAME-EMA", nome: "frame EMA ≤ " + t.frameEmaMaxMs + " ms (ledger)", status: ema <= t.frameEmaMaxMs ? "PASS" : "FAIL", detalhe: r1(ema) + " ms (§1.4: frame ≤ ~40 ms; baseline 2026-08-15: ~37,9 ms)" });
  }
  const idle = fin(s.idleFrames);
  if (idle === null) {
    gates.push({ id: "IDLE-0", nome: "ócio com 0 frames (render-on-demand)", status: "PENDENTE", detalhe: "sem bench ocioso — rode a janela sem tocar em NADA" });
  } else {
    gates.push({ id: "IDLE-0", nome: "ócio com 0 frames (render-on-demand)", status: idle <= t.idleFramesMax ? "PASS" : "FAIL", detalhe: idle <= t.idleFramesMax ? "0 frames novos no ócio (aceite do MAPA intacto — princípio 8)" : idle + " frame(s) novo(s) no ócio — render-on-demand QUEBRADO (nenhuma fase pode custar em idle)" });
  }
  return gates;
}


export function evalCaptureDiff(id, nome, diff) {
  const gid = typeof id === "string" && id ? id : "DIFF";
  const gnome = typeof nome === "string" && nome ? nome : "capture-diff byte a byte";
  const d = diff && typeof diff === "object" ? diff : null;
  if (!d || d.equal === null || d.equal === undefined) {
    return { id: gid, nome: gnome, status: "PENDENTE", detalhe: (d && typeof d.motivo === "string" && d.motivo) || "sem captura comparável — faça o diff externo com o capture shot do editor" };
  }
  if (d.equal === true) return { id: gid, nome: gnome, status: "PASS", detalhe: "capturas idênticas" + (num(d.bytes, 0) > 0 ? " (" + num(d.bytes, 0) + " bytes)" : "") };
  return { id: gid, nome: gnome, status: "FAIL", detalhe: (typeof d.motivo === "string" && d.motivo) || "capturas DIFERENTES — byte a byte violado" };
}


export function smLiteGatesVerdict(gates) {
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
    veredito: "SM-LITE F6: " + pass + " PASS, " + fail + " FAIL, " + pend + " PENDENTE — " + (releaseOk ? "TUDO VERDE nesta classe (feche o par fraco+forte via CROSS antes de declarar o pacote certificado)." : "NÃO certificado (régua da casa: FAIL/PENDENTE bloqueiam — nunca por fé)."),
  };
}






export function evalOutraClasse(outra, minhaClasse) {
  const instr = "rode o runner sm-lite-f6 na OUTRA classe (fraco mede fps; forte prova byte a byte) e cole o __smLiteF6.exportRun de lá em globalThis.__smLiteF6OutraClasse";
  const o = outra && typeof outra === "object" ? outra : null;
  if (!o || typeof o.classe !== "string" || !o.classe) return { id: "CROSS", nome: "par fraco+forte fechado", status: "PENDENTE", detalhe: instr };
  if (o.classe === String(minhaClasse || "")) return { id: "CROSS", nome: "par fraco+forte fechado", status: "PENDENTE", detalhe: "resultado importado é da MESMA classe ('" + o.classe + "') — " + instr };
  if (o.done !== true) return { id: "CROSS", nome: "par fraco+forte fechado", status: "PENDENTE", detalhe: "resultado importado incompleto (done!==true) — rode o runner até o fim na outra classe" };
  const gates = Array.isArray(o.gates) ? o.gates.filter((g) => g && typeof g === "object" && g.id !== "CROSS") : [];
  const v = smLiteGatesVerdict(gates);
  const placar = v.pass + " PASS, " + v.fail + " FAIL, " + v.pend + " PENDENTE (CROSS de lá filtrado — anti-circular)";
  if (v.fail > 0) return { id: "CROSS", nome: "par fraco+forte fechado", status: "FAIL", detalhe: "classe '" + o.classe + "' importada: " + placar };
  if (!v.releaseOk) return { id: "CROSS", nome: "par fraco+forte fechado", status: "PENDENTE", detalhe: "classe '" + o.classe + "' importada sem prova completa: " + placar };
  return { id: "CROSS", nome: "par fraco+forte fechado", status: "PASS", detalhe: "classe '" + o.classe + "' importada: " + placar };
}


export function buildSmLiteCostTable(ledger, chainLabels, sm) {
  const passes = ledger && typeof ledger === "object" && Array.isArray(ledger.passes) ? ledger.passes : [];
  const chain = Array.isArray(chainLabels) ? chainLabels.map((c) => String(c)) : [];
  const tele = sm && typeof sm === "object" ? sm : {};
  const emaOf = (id) => {
    for (const p of passes) {
      if (p && typeof p === "object" && p.id === id) return { ema: num(p.emaMs, 0), samples: Math.max(0, num(p.samples, 0)) };
    }
    return null;
  };
  const rows = [];
  for (const def of SM_LITE_PHASE_BUDGETS) {
    const led = emaOf(def.onde);
    rows.push({
      fase: def.fase,
      nome: def.nome,
      budgetMs: def.budgetMs,
      ondeLedger: def.onde,
      passeEmaMs: led ? Math.round(led.ema * 1000) / 1000 : null,
      passeSamples: led ? led.samples : 0,
      compartilhado: true,
      chainLabel: def.chainLabel || "",
      naChain: def.chainLabel ? chain.indexOf(def.chainLabel) !== -1 : null,
      telemetria: def.telemetria || "",
      teleVivo: def.telemetria ? def.telemetria in tele : null,
      nota: def.nota || "",
    });
  }
  return rows;
}


export function smLiteCertMarkdown(gates, rows) {
  const g = Array.isArray(gates) ? gates : [];
  const r = Array.isArray(rows) ? rows : [];
  const md = [];
  md.push("### Certificação SM-Realista Lite (F6 — " + SM_LITE_CERT_VERSION + ")");
  md.push("");
  md.push("| Gate | Status | Detalhe |");
  md.push("| --- | --- | --- |");
  for (const x of g) {
    if (x && typeof x === "object") md.push("| " + String(x.id) + " — " + String(x.nome) + " | " + String(x.status) + " | " + String(x.detalhe || "").replace(/\|/g, "/") + " |");
  }
  md.push("");
  md.push("| Fase | Budget (ms) | Pass do ledger (EMA ms, compartilhado) | Telemetria viva |");
  md.push("| --- | --- | --- | --- |");
  for (const x of r) {
    if (x && typeof x === "object") md.push("| " + String(x.fase) + " — " + String(x.nome) + " | " + (x.budgetMs === 0 ? "~0" : "≤ " + String(x.budgetMs)) + " | " + String(x.ondeLedger) + ": " + (x.passeEmaMs === null ? "PENDENTE" : String(x.passeEmaMs)) + " | " + (x.teleVivo === true ? "sim" : x.teleVivo === false ? "NÃO" : "?") + " |");
  }
  return md.join("\n");
}


export function exportSmLiteRun(run, now) {
  const o = run && typeof run === "object" ? run : null;
  if (!o) return "";
  const gates = Array.isArray(o.gates) ? o.gates.filter((g) => g && typeof g === "object").map((g) => ({ id: String(g.id), nome: String(g.nome || ""), status: String(g.status), detalhe: String(g.detalhe || "") })) : [];
  try {
    return JSON.stringify({ v: SM_LITE_CERT_VERSION, t: num(now, 0), classe: typeof o.classe === "string" ? o.classe : "", done: o.done === true, gates });
  } catch (_e) {
    return "";
  }
}

export function parseSmLiteRun(raw) {
  let o = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch (_e) {
      return null;
    }
  }
  if (!o || typeof o !== "object" || typeof o.classe !== "string" || !Array.isArray(o.gates)) return null;
  return { v: typeof o.v === "string" ? o.v : "", t: num(o.t, 0), classe: o.classe, done: o.done === true, gates: o.gates.filter((g) => g && typeof g === "object") };
}

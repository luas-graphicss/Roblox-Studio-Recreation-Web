import { GPU_CLASSES, IL_PHASE_COST_MAP, gatesVerdict } from "./ilGatesCore.js";
import { ILF1_SCENE_IDS } from "./lightingBenchCore.js";

export const CERT_VERSION = "il-f42-r1";


export const CLASSES_FORTES = Object.freeze(["alto", "medio"]);


export const DEFAULT_POR_CLASSE_PASS = Object.freeze({ alto: "Realistic", medio: "Realistic", fraco: "Realistic-lite" });

function fin(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}


export function evalRunSemCross(run) {
  const r = run && typeof run === "object" ? run : null;
  if (!r) return { status: "PENDENTE", classe: "", resumo: null, detalhe: "sem resultado do harness IL-F34 (rode tools/qa/iluminacao/il-gates-finais.qa.js ate __ilGatesFinais.done=true)" };
  const classe = typeof r.classe === "string" && GPU_CLASSES.indexOf(r.classe) !== -1 ? r.classe : "";
  if (r.done !== true) return { status: "PENDENTE", classe, resumo: null, detalhe: "resultado incompleto (done!==true) — espere o harness terminar" };
  if (!classe) return { status: "PENDENTE", classe: "", resumo: null, detalhe: "classe de GPU desconhecida no resultado (telemetria incompleta — weakGpu/tier sem chute)" };
  const gates = Array.isArray(r.gates) ? r.gates.filter((g) => g && typeof g === "object" && g.id !== "CROSS") : [];
  const v = gatesVerdict(gates);
  const placar = v.pass + " PASS, " + v.fail + " FAIL, " + v.pend + " PENDENTE (gate CROSS fora — anti-circular)";
  if (v.fail > 0) return { status: "FAIL", classe, resumo: v, detalhe: "classe '" + classe + "': " + placar };
  if (!v.releaseOk) return { status: "PENDENTE", classe, resumo: v, detalhe: "classe '" + classe + "' sem prova completa (aceite exige PASS SEM PENDENTE): " + placar };
  return { status: "PASS", classe, resumo: v, detalhe: "classe '" + classe + "': " + placar };
}


export function certTwoClasses(runA, runB) {
  const a = evalRunSemCross(runA);
  const b = evalRunSemCross(runB);
  const porClasse = [a, b];
  const instr = "protocolo: rode o runner il-f42-certificacao.qa.js na maquina G210 (fraco) e na maquina forte; transporte o __ilF42.exportRun de uma p/ a outra em globalThis.__ilGatesOutraClasse";
  const fails = porClasse.filter((x) => x.status === "FAIL");
  if (fails.length) {
    return { versao: CERT_VERSION, status: "FAIL", porClasse, detalhe: "FAIL real em " + fails.map((x) => "'" + (x.classe || "?") + "'").join(" e ") + " — corrigir e medir de novo antes de certificar" };
  }
  if (a.classe && b.classe && a.classe === b.classe) {
    return { versao: CERT_VERSION, status: "PENDENTE", porClasse, detalhe: "as duas rodadas sao da MESMA classe ('" + a.classe + "') — " + instr };
  }
  if (a.status !== "PASS" || b.status !== "PASS") {
    return { versao: CERT_VERSION, status: "PENDENTE", porClasse, detalhe: "sem prova completa nas 2 classes — " + porClasse.map((x) => "'" + (x.classe || "?") + "'=" + x.status).join(", ") + "; " + instr };
  }
  const temFraco = a.classe === "fraco" || b.classe === "fraco";
  const forte = porClasse.find((x) => CLASSES_FORTES.indexOf(x.classe) !== -1) || null;
  if (!temFraco || !forte) {
    return { versao: CERT_VERSION, status: "PENDENTE", porClasse, detalhe: "par invalido: precisa de fraco (G210) + forte (alto|medio); veio '" + (a.classe || "?") + "' + '" + (b.classe || "?") + "'" };
  }
  return { versao: CERT_VERSION, status: "PASS", porClasse, detalhe: "certificado: fraco + " + forte.classe + " — PASS sem PENDENTE nas 2 classes (CROSS filtrado)" };
}




export function decideRealisticDefault(cert) {
  const c = cert && typeof cert === "object" ? cert : null;
  const provadas = new Set();
  if (c && Array.isArray(c.porClasse)) {
    for (const p of c.porClasse) {
      if (p && typeof p === "object" && p.status === "PASS" && typeof p.classe === "string" && p.classe) provadas.add(p.classe);
    }
  }
  const certificado = !!(c && c.status === "PASS");
  const decisoes = [];
  for (const classe of GPU_CLASSES) {
    if (!certificado) {
      decisoes.push({ classe, default: "Classic", motivo: "regua da casa: FAIL/PENDENTE na certificacao bloqueiam Realistic default (status: " + (c && c.status ? String(c.status) : "sem certificacao") + ")" });
      continue;
    }
    if (!provadas.has(classe)) {
      decisoes.push({ classe, default: "Classic", motivo: "classe NAO medida nesta certificacao — sem prova, sem flip" });
      continue;
    }
    decisoes.push({ classe, default: DEFAULT_POR_CLASSE_PASS[classe], motivo: classe === "fraco" ? "PASS certificado — conjunto Realistic-lite CONGELADO (nunca FULL no fraco); alvo 25-35 mov / 60 parado preservado" : "PASS certificado nas 2 classes (fraco + forte)" });
  }
  return { certificado, decisoes, nota: "CONSOME-ONLY: recomendacao p/ o dono do plano — nada aqui liga/desliga default na engine" };
}



export function baselineCoverage(snap) {
  const rows = snap && typeof snap === "object" && Array.isArray(snap.rows) ? snap.rows : Array.isArray(snap) ? snap : [];
  const porCena = new Map();
  for (const r of rows) {
    if (r && typeof r === "object" && typeof r.cena === "string" && !porCena.has(r.cena)) porCena.set(r.cena, fin(r.fpsParado));
  }
  const faltantes = [];
  let validas = 0;
  for (const id of ILF1_SCENE_IDS) {
    const fps = porCena.has(id) ? porCena.get(id) : null;
    if (fps !== null && fps > 0) validas += 1;
    else faltantes.push(id);
  }
  const ok = validas === ILF1_SCENE_IDS.length;
  return {
    ok,
    total: ILF1_SCENE_IDS.length,
    validas,
    faltantes,
    detalhe: ok
      ? validas + "/" + ILF1_SCENE_IDS.length + " cenas com fpsParado valido"
      : validas + "/" + ILF1_SCENE_IDS.length + " validas — faltam: " + (faltantes.join(", ") || "?"),
  };
}


const MD_HEADER = "| Fase | Nome | Pass (ledger F1) | EMA medida (ms) | Custo isolado | Chain postfx | Telemetria | Lite | Nota |";
const MD_SEP = "| --- | --- | --- | --- | --- | --- | --- | --- | --- |";

function mdCell(s) {
  const v = s === null || s === undefined || s === "" ? "—" : String(s);
  return v.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}


export function costTableMarkdown(rows) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === "object") : [];
  if (!list.length) return costTableEstaticaMarkdown();
  const out = [MD_HEADER, MD_SEP];
  for (const r of list) {
    const ema = r.passeEmaMs === null || r.passeEmaMs === undefined || !(r.passeSamples > 0) ? "PENDENTE (medição viva)" : r.passeEmaMs;


    const isolado = r.custoIsolado === null || r.custoIsolado === undefined || !(r.passeSamples > 0)
      ? (r.compartilhado ? "não (pass compartilhado" + (r.compartilhadoCom ? ": " + r.compartilhadoCom : "") + ")" : "PENDENTE (medição viva)")
      : r.custoIsolado;
    const chain = r.chainLabel ? r.chainLabel + (r.naChain === true ? " (viva)" : r.naChain === false ? " (FORA da chain)" : "") : "—";
    const tele = r.telemetria ? r.telemetria + (r.teleVivo === true ? " (vivo)" : r.teleVivo === false ? " (AUSENTE)" : "") : "—";
    out.push("| " + [r.fase, r.nome, r.ondeLedger, ema, isolado, chain, tele, r.lite ? "LITE" : "—", r.nota].map(mdCell).join(" | ") + " |");
  }
  return out.join("\n");
}


export function costTableEstaticaMarkdown() {
  const shareCount = {};
  for (const def of IL_PHASE_COST_MAP) shareCount[def.onde] = (shareCount[def.onde] || 0) + 1;
  const out = [MD_HEADER, MD_SEP];
  for (const def of IL_PHASE_COST_MAP) {
    const compartilhado = (shareCount[def.onde] || 0) > 1 || !!def.compartilhadoCom;
    const isolado = compartilhado ? "não (pass compartilhado" + (def.compartilhadoCom ? ": " + def.compartilhadoCom : "") + ")" : "PENDENTE (medição viva)";
    out.push("| " + [def.fase, def.nome, def.onde, "PENDENTE (medição viva)", isolado, def.chainLabel || "—", def.telemetria || "—", def.lite ? "LITE" : "—", def.nota].map(mdCell).join(" | ") + " |");
  }
  return out.join("\n");
}


export function exportRun(run, t) {
  const r = run && typeof run === "object" ? run : null;
  if (!r || r.done !== true) return "";
  const gates = Array.isArray(r.gates)
    ? r.gates.filter((g) => g && typeof g === "object").map((g) => ({ id: String(g.id || ""), nome: String(g.nome || ""), status: String(g.status || ""), detalhe: String(g.detalhe || "") }))
    : [];
  const ts = fin(t);
  const blob = {
    v: CERT_VERSION,
    t: ts === null ? 0 : ts,
    run: { done: true, classe: String(r.classe || ""), classeReason: String(r.classeReason || ""), gates, veredito: String(r.veredito || "") },
  };
  try { return JSON.stringify(blob); } catch (_e) { return ""; }
}


export function parseRun(input) {
  let o = input;
  if (typeof o === "string") {
    const s = o.trim();
    if (!s) return null;
    try { o = JSON.parse(s); } catch (_e) { return null; }
  }
  if (!o || typeof o !== "object") return null;
  const r = o.run && typeof o.run === "object" ? o.run : o;
  if (!r || typeof r !== "object" || !Array.isArray(r.gates)) return null;
  return {
    done: r.done === true,
    classe: typeof r.classe === "string" ? r.classe : "",
    classeReason: typeof r.classeReason === "string" ? r.classeReason : "",
    gates: r.gates.filter((g) => g && typeof g === "object"),
    veredito: typeof r.veredito === "string" ? r.veredito : "",
  };
}

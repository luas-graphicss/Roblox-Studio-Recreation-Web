import { confusionRate, PARITY_SCENES } from "./rtFullResCore.js";


export { confusionRate, PARITY_SCENES };

export const FASE16_VERSION = "fase16-cega-sombras-1";


export const MIN_AVALIADORES = 3;


export const GATE_CONFUSAO = 0.7;


export const PERF_FPS_MIN = 60;

export const CENA_IDS = Object.freeze(PARITY_SCENES.map((c) => c.id));


export const ROTULOS_61 = Object.freeze({
	a: "(a) contato",
	b: "(b) cidade 4096",
	c: "(c) vale/far",
	d: "(d) interior 24 luzes",
	e: "(e) avatares",
	f: "(f) penumbra extrema",
});


export const DONAS_DO_GAP = Object.freeze({
	a: Object.freeze(["Fase 1", "Fase 9", "Fase 13"]),
	b: Object.freeze(["Fase 1", "Fase 4", "Fase 12"]),
	c: Object.freeze(["Fase 5", "Fase 12"]),
	d: Object.freeze(["Fase 6", "Fase 14", "Fase 15"]),
	e: Object.freeze(["Fase 2", "Fase 3", "Fase 13"]),
	f: Object.freeze(["Fase 1", "Fase 7", "Fase 11", "Fase 13"]),
});


export function maquinaBanida(gpu) {
	return /\bg\s*210\b/i.test(String(gpu || ""));
}


export function classeDaMaquina(tier) {
	const t = String(tier || "").trim().toLowerCase();
	if (t === "high") return "media";
	if (t === "ultra") return "forte";
	return null;
}


export function normalizeTrial(t) {
	if (!t || typeof t !== "object") return null;
	const truth = t.truth === "engine" || t.truth === "ue" ? t.truth : null;
	const guess =
		t.guess === "engine" || t.guess === "ue" || t.guess === "indistinto" ? t.guess : null;
	if (!truth || !guess) return null;
	const out = {
		sceneId: typeof t.sceneId === "string" ? t.sceneId : "?",
		truth,
		guess,
	};
	if (typeof t.avaliador === "string" && t.avaliador.trim()) out.avaliador = t.avaliador.trim();
	return out;
}


export function countAvaliadores(trials) {
	const list = Array.isArray(trials) ? trials : [];
	const nomes = new Set();
	for (let i = 0; i < list.length; i++) {
		const n = normalizeTrial(list[i]);
		if (!n) continue;
		nomes.add(n.avaliador || "(sem nome)");
	}
	return nomes.size;
}

function rotuloRodada(rodada, idx) {
	const m = rodada && rodada.meta ? rodada.meta : {};
	const gpu = typeof m.gpu === "string" && m.gpu.trim() ? m.gpu.trim() : "GPU?";
	const tier = typeof m.tier === "string" && m.tier.trim() ? m.tier.trim() : "tier?";
	return "rodada#" + (idx + 1) + " (" + gpu + " / " + tier + ")";
}


export function validarRodada(rodada) {
	const r = rodada && typeof rodada === "object" ? rodada : {};
	const meta = r.meta && typeof r.meta === "object" ? r.meta : {};
	const perf = r.perf && typeof r.perf === "object" ? r.perf : {};
	const failures = [];
	const pendencias = [];
	const reabrir = [];

	const gpu = typeof meta.gpu === "string" ? meta.gpu.trim() : "";
	const tier = typeof meta.tier === "string" ? meta.tier.trim() : "";
	const data = typeof meta.data === "string" ? meta.data.trim() : "";
	if (!gpu || !tier) pendencias.push("GPU/tier não declarados (obrigatório na 6.1)");
	if (!data) pendencias.push("data da rodada não declarada (obrigatório na 6.1)");
	if (gpu && maquinaBanida(gpu)) {
		pendencias.push("máquina de referência banida (G210 — §1.2): a rodada não vale como prova");
	}
	const classe = classeDaMaquina(tier);
	if (tier && classe === null) {
		pendencias.push('tier "' + tier + '" fora do protocolo (high = GPU média, ultra = GPU forte)');
	}

	const score = confusionRate(Array.isArray(r.trials) ? r.trials : []);
	if (score.total === 0) {
		pendencias.push("zero respostas válidas");
	} else if (score.scenesCovered !== CENA_IDS.length) {
		pendencias.push(
			"cobertura " + score.scenesCovered + "/" + CENA_IDS.length +
				" — o gate exige >= 1 resposta válida em CADA cena"
		);
	}

	const avaliadores = countAvaliadores(r.trials);
	if (avaliadores < MIN_AVALIADORES) {
		pendencias.push("avaliadores " + avaliadores + "/" + MIN_AVALIADORES + " — protocolo exige >= 3");
	}


	const fps = perf.fps1080p;
	if (!Number.isFinite(fps)) {
		pendencias.push("fps @1080p não medido (perf gate da fase)");
	} else if (fps < PERF_FPS_MIN) {
		failures.push("perf gate reprovado: " + fps + " fps < " + PERF_FPS_MIN + " @1080p");
	}
	if (perf.fallbacksSemRegressao === false) {
		failures.push("regressão nos fallbacks (Voxel/ShadowMap/Compatibility)");
	} else if (perf.fallbacksSemRegressao !== true) {
		pendencias.push("fallbacks (Voxel/ShadowMap/Compatibility) não conferidos");
	}
	if (classe === "forte") {
		if (perf.rtAtivo === false) {
			failures.push("rodada forte sem RT ativo (config da fase: tier ultra + RT)");
		} else if (perf.rtAtivo !== true) {
			pendencias.push("RT não confirmado na rodada forte (perf.rtAtivo)");
		}
	}


	for (let i = 0; i < CENA_IDS.length; i++) {
		const id = CENA_IDS[i];
		const ps = score.perScene[id];
		if (!ps || ps.total === 0) continue;
		const pct = ps.confused / ps.total;
		if (pct < GATE_CONFUSAO) {
			const item = {
				sceneId: id,
				rotulo: ROTULOS_61[id],
				pct,
				donas: DONAS_DO_GAP[id],
			};
			reabrir.push(item);
			failures.push(
				ROTULOS_61[id] + " abaixo do gate (" + Math.round(pct * 100) + "% < 70%) — reabrir: " +
					DONAS_DO_GAP[id].join(", ")
			);
		}
	}

	return { classe, meta: { data, gpu, tier }, score, avaliadores, failures, pendencias, reabrir };
}


export function gateFase16(input) {
	const rodadas = Array.isArray(input)
		? input
		: input && Array.isArray(input.rodadas)
			? input.rodadas
			: [];
	const failures = [];
	const pendencias = [];
	const reabrir = [];
	const porRodada = [];
	const classes = new Set();
	let totalGeral = 0;
	let confusedGeral = 0;

	for (let i = 0; i < rodadas.length; i++) {
		const v = validarRodada(rodadas[i]);
		porRodada.push(v);
		const rot = rotuloRodada(rodadas[i], i);
		for (let k = 0; k < v.failures.length; k++) failures.push(rot + ": " + v.failures[k]);
		for (let k = 0; k < v.pendencias.length; k++) pendencias.push(rot + ": " + v.pendencias[k]);
		for (let k = 0; k < v.reabrir.length; k++) reabrir.push(v.reabrir[k]);
		if (v.classe && !maquinaBanida(v.meta.gpu)) classes.add(v.classe);
		totalGeral += v.score.total;
		confusedGeral += v.score.confused;
	}

	if (rodadas.length === 0) pendencias.push("nenhuma rodada registrada");
	if (!classes.has("media")) {
		pendencias.push("falta rodada em GPU MÉDIA (tier high) — config obrigatória da fase");
	}
	if (!classes.has("forte")) {
		pendencias.push("falta rodada em GPU FORTE (tier ultra + RT) — config obrigatória da fase");
	}

	const verdict = failures.length > 0 ? "FAIL" : pendencias.length > 0 ? "PENDENTE" : "PASS";
	return {
		verdict,

		vereditoArquivo: verdict === "PASS" ? "SIM" : "NÃO",
		failures,
		pendencias,
		reabrir,
		porRodada,
		classes: Array.from(classes).sort(),
		total: totalGeral,
		confused: confusedGeral,
		rate: totalGeral > 0 ? confusedGeral / totalGeral : 0,
	};
}



export function mulberry32(seed) {
	let a = (Number(seed) >>> 0) || 1;
	return function () {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}



export function buildPairPlan(opts) {
	const o = opts && typeof opts === "object" ? opts : {};
	const seed = Number.isFinite(o.seed) ? o.seed >>> 0 : 61;
	const ids = Array.isArray(o.sceneIds) && o.sceneIds.length > 0 ? o.sceneIds : CENA_IDS;
	const slides = [];
	for (let i = 0; i < ids.length; i++) {
		slides.push({ sceneId: String(ids[i]), truth: "engine" });
		slides.push({ sceneId: String(ids[i]), truth: "ue" });
	}
	const rnd = mulberry32(seed);
	for (let i = slides.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		const tmp = slides[i];
		slides[i] = slides[j];
		slides[j] = tmp;
	}
	return { seed, slides };
}


export function buildTabela61Rows(rodada) {
	const r = rodada && typeof rodada === "object" ? rodada : {};
	const meta = r.meta && typeof r.meta === "object" ? r.meta : {};
	const data = typeof meta.data === "string" && meta.data.trim() ? meta.data.trim() : "—";
	const gpu = typeof meta.gpu === "string" && meta.gpu.trim() ? meta.gpu.trim() : "—";
	const tier = typeof meta.tier === "string" && meta.tier.trim() ? meta.tier.trim() : "—";
	const score = confusionRate(Array.isArray(r.trials) ? r.trials : []);
	const rows = [];
	for (let i = 0; i < CENA_IDS.length; i++) {
		const id = CENA_IDS[i];
		const ps = score.perScene[id];
		let confusao = "—";
		let veredito = "pendente";
		let shotEng = "pendente";
		let shotUe = "pendente (export externo)";
		if (ps && ps.total > 0) {
			const p = (ps.confused / ps.total) * 100;
			confusao = ps.confused + "/" + ps.total + " (" + p.toFixed(0) + "%)";
			veredito = p >= GATE_CONFUSAO * 100 ? "OK (>=70%)" : "REABRE dona (<70%)";
			shotEng = "cena-" + id + "-engine.png";
			shotUe = "cena-" + id + "-ue58.png";
		}
		rows.push(
			"| " + ROTULOS_61[id] + " | " + data + " | " + gpu + " / " + tier + " | " +
				shotEng + " | " + shotUe + " | " + confusao + " | " + veredito + " |"
		);
	}
	return rows.join("\n");
}


export function buildRegistroExecucao(gate, opts) {
	const g = gate && typeof gate === "object" ? gate : gateFase16([]);
	const o = opts && typeof opts === "object" ? opts : {};
	const numero = Number.isFinite(o.numero) ? o.numero : 0;
	const data = typeof o.data === "string" && o.data ? o.data : "—";
	const partes = [
		"**Registro de execução #" + numero + " (" + data + ", cabine Fase 16):** " +
			"veredito **" + g.verdict + "** — " +
			g.confused + "/" + g.total + " confusões (" + (g.rate * 100).toFixed(1) + "%), classes cobertas: " +
			(g.classes.length ? g.classes.join(" + ") : "nenhuma") + ".",
	];
	if (g.failures.length) partes.push("Falhas: " + g.failures.join("; ") + ".");
	if (g.pendencias.length) partes.push("Pendências: " + g.pendencias.join("; ") + ".");
	partes.push("Veredito do arquivo: **" + g.vereditoArquivo + "**.");
	return partes.join(" ");
}


export function checklistRodada() {
	return [
		"1. Engine: rodar tools/qa/sombras/paridade-ue58-cenas.luau com _G.PARIDADE_CENA=\"a\"..\"f\" (Future + GlobalShadows + RT).",
		"2. Capturar com tools/qa/sombras/fase16-captura-cenas.qa.js — cena-<id>-engine.png @1080p + fps + manifesto JSON.",
		"3. Dono: montar as MESMAS 6 cenas na UE 5.8 (VSM + Lumen, scalability Epic) e exportar cena-<id>-ue58.png @1080p.",
		"4. Rodadas em DUAS máquinas: GPU MÉDIA (tier high) e FORTE (tier ultra + RT). A G210 NÃO vale como referência (§1.2).",
		"5. Cabine: tools/qa/sombras/fase16-cabine-cega-sombras.html — >= 3 avaliadores por rodada, lâminas por seed, teclas 1/2/3.",
		"6. Preencher a 6.1 com as linhas copiadas da cabine; cena < 70% reabre a fase dona ANTES de nova rodada.",
	]
}

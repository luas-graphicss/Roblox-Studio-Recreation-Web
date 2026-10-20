export const IL_F43_VERSION = "il-f43-cega-2";


export const MIN_AVALIADORES = 3;


export const CENAS_LUZ = Object.freeze([
	Object.freeze({ id: "1", nome: "chart PBR" }),
	Object.freeze({ id: "2", nome: "exterior meio-dia" }),
	Object.freeze({ id: "3", nome: "golden hour" }),
	Object.freeze({ id: "4", nome: "noite neon" }),
	Object.freeze({ id: "5", nome: "interior contraste" }),
	Object.freeze({ id: "6", nome: "piso molhado/espelho" }),
	Object.freeze({ id: "7", nome: "vidro/água" }),
	Object.freeze({ id: "8", nome: "emissivos" }),
]);

export const CENA_IDS_LUZ = Object.freeze(CENAS_LUZ.map((c) => c.id));


export function normalizeTrialLuz(t) {
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


export function confusionRateLuz(trials) {
	const list = Array.isArray(trials) ? trials : [];
	let total = 0;
	let confused = 0;
	const perScene = {};
	for (let i = 0; i < list.length; i++) {
		const n = normalizeTrialLuz(list[i]);
		if (!n) continue;
		total++;
		const c = n.guess === "indistinto" || n.guess !== n.truth;
		if (c) confused++;
		if (!perScene[n.sceneId]) perScene[n.sceneId] = { total: 0, confused: 0 };
		perScene[n.sceneId].total++;
		if (c) perScene[n.sceneId].confused++;
	}
	const rate = total > 0 ? confused / total : 0;
	let scenesCovered = 0;
	for (let i = 0; i < CENA_IDS_LUZ.length; i++) {
		const ps = perScene[CENA_IDS_LUZ[i]];
		if (ps && ps.total > 0) scenesCovered++;
	}
	return {
		total,
		confused,
		rate,
		scenesCovered,
		pass70: scenesCovered === CENA_IDS_LUZ.length && rate >= 0.7,
		perScene,
	};
}


export function protocolWarningsLuz(trials) {
	const list = Array.isArray(trials) ? trials : [];
	let badSid = 0;
	const sceneTruth = {};
	for (let i = 0; i < list.length; i++) {
		const t = list[i];
		const n = normalizeTrialLuz(t);
		if (!n) continue;
		if (typeof t.sceneId !== "string") {
			badSid++;
		} else {
			const st = sceneTruth[n.sceneId] || (sceneTruth[n.sceneId] = {});
			st[n.truth] = (st[n.truth] || 0) + 1;
		}
	}
	const singleTruthScenes = [];
	for (let i = 0; i < CENA_IDS_LUZ.length; i++) {
		const st = sceneTruth[CENA_IDS_LUZ[i]];
		if (!st) continue;
		const kinds = (st.engine > 0 ? 1 : 0) + (st.ue > 0 ? 1 : 0);
		if (kinds === 1) singleTruthScenes.push(CENA_IDS_LUZ[i]);
	}
	return { badSid, singleTruthScenes };
}


export function countAvaliadores(trials) {
	const list = Array.isArray(trials) ? trials : [];
	const nomes = new Set();
	for (let i = 0; i < list.length; i++) {
		const n = normalizeTrialLuz(list[i]);
		if (!n) continue;
		nomes.add((n.avaliador || "(sem nome)").toLowerCase());
	}
	return nomes.size;
}


export function gateIlF43(trials, opts) {
	const o = opts && typeof opts === "object" ? opts : {};
	const r = confusionRateLuz(trials);
	const warnings = protocolWarningsLuz(trials);
	const avaliadores = Number.isFinite(o.avaliadores)
		? Math.max(0, Math.floor(o.avaliadores))
		: countAvaliadores(trials);
	const reasons = [];
	if (r.total === 0) reasons.push("zero respostas válidas");
	if (r.scenesCovered !== CENA_IDS_LUZ.length) {
		reasons.push(
			"cobertura " +
				r.scenesCovered +
				"/" +
				CENA_IDS_LUZ.length +
				" — o gate exige >= 1 resposta válida em CADA cena"
		);
	}
	if (avaliadores < MIN_AVALIADORES) {
		reasons.push(
			"avaliadores " + avaliadores + "/" + MIN_AVALIADORES + " — protocolo exige >= 3"
		);
	}
	if (warnings.badSid > 0) {
		reasons.push(
			warnings.badSid +
				' resposta(s) com sceneId não-string caem na cena "?" e não contam cobertura'
		);
	}
	if (warnings.singleTruthScenes.length > 0) {
		reasons.push(
			"cena(s) com verdade única (sem par aleatorizado): " +
				warnings.singleTruthScenes.join(", ")
		);
	}
	let verdict = "PENDENTE";
	if (r.scenesCovered === CENA_IDS_LUZ.length && avaliadores >= MIN_AVALIADORES) {
		verdict = r.rate >= 0.7 ? "PASS" : "FAIL";
	}
	return {
		verdict,
		avaliadores,
		minAvaliadores: MIN_AVALIADORES,
		reasons,
		warnings,
		total: r.total,
		confused: r.confused,
		rate: r.rate,
		scenesCovered: r.scenesCovered,
		pass70: r.pass70,
		perScene: r.perScene,
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


	const seed = (Number.isFinite(o.seed) ? o.seed >>> 0 : 43) || 1;
	const ids =
		Array.isArray(o.sceneIds) && o.sceneIds.length > 0 ? o.sceneIds : CENA_IDS_LUZ;
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

function luaSafe(s) {
	return String(s)
		.replace(/[\\"]/g, "")
		.replace(/[\r\n\t]+/g, " ")
		.trim();
}


export function formatRespostasLua(trials) {
	const list = Array.isArray(trials) ? trials : [];
	const lines = ["_G.PARIDADE_LUZ_RESPOSTAS = {"];
	for (let i = 0; i < list.length; i++) {
		const n = normalizeTrialLuz(list[i]);
		if (!n) continue;
		const comentario = n.avaliador ? " -- " + luaSafe(n.avaliador) : "";
		lines.push(
			'\t{ sceneId = "' +
				luaSafe(n.sceneId) +
				'", truth = "' +
				n.truth +
				'", guess = "' +
				n.guess +
				'" },' +
				comentario
		);
	}
	lines.push("}");
	return lines.join("\n");
}


export function buildTabela1133(gate, meta) {
	const g = gate && typeof gate === "object" ? gate : confusionRateLuz([]);
	const m = meta && typeof meta === "object" ? meta : {};
	const data = typeof m.data === "string" && m.data ? m.data : "—";
	const gpu = typeof m.gpuTier === "string" && m.gpuTier ? m.gpuTier : "—";
	const perScene = g.perScene || {};
	const rows = [];
	for (let i = 0; i < CENAS_LUZ.length; i++) {
		const c = CENAS_LUZ[i];
		const ps = perScene[c.id];
		let confusao = "—";
		let veredito = "PENDENTE";
		if (ps && ps.total > 0) {
			const p = (ps.confused / ps.total) * 100;
			confusao = ps.confused + "/" + ps.total + " (" + p.toFixed(0) + "%)";
			veredito = p >= 70 ? "OK (>=70%)" : "REABRE dona (<70%)";
		}
		rows.push(
			"| " +
				c.id +
				" " +
				c.nome +
				" | " +
				data +
				" | " +
				gpu +
				" | cena-luz-" +
				c.id +
				"-engine.png | cena-luz-" +
				c.id +
				"-ue58.png | " +
				confusao +
				" | " +
				veredito +
				" |"
		);
	}
	const globalConf =
		g.total > 0
			? g.confused +
				"/" +
				g.total +
				" (" +
				(g.rate * 100).toFixed(1) +
				"%) · cobertura " +
				g.scenesCovered +
				"/8" +
				(Number.isFinite(g.avaliadores) ? " · avaliadores " + g.avaliadores : "")
			: "— (exige >=70% + cobertura 8/8)";
	const globalVerd = g.verdict ? g.verdict : g.pass70 ? "pass70" : "NÃO RODADO";
	rows.push(
		"| **GLOBAL (gate)** | " +
			data +
			" | " +
			gpu +
			" | — | — | " +
			globalConf +
			" | **" +
			globalVerd +
			"** |"
	);
	return rows.join("\n");
}

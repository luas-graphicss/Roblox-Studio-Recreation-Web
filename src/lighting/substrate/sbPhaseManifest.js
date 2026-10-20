export const SB_PHASE_MANIFEST = [

	{ id: "SB-F1", block: "A", wave: 1, title: "Ledger de paridade e conferencia UE 5.9", load: () => import("./phases/sbPhaseF1Ledger.js") },
	{ id: "SB-F2", block: "A", wave: 1, title: "Contrato Substrate (congela a versao 1)", load: () => import("./phases/sbPhaseF2Contract.js") },
	{ id: "SB-F3", block: "A", wave: 1, title: "IR da arvore de material", load: () => import("./phases/sbPhaseF3MaterialTree.js") },
	{ id: "SB-F4", block: "A", wave: 1, title: "Parametros do Slab e conversao do legado", load: () => import("./phases/sbPhaseF4SlabParameters.js") },
	{ id: "SB-F5", block: "A", wave: 1, title: "Integrador de referencia (ground truth)", load: () => import("./phases/sbPhaseF5Reference.js") },


	{ id: "SB-F6", block: "B", wave: 2, title: "Compilador de topologia", pass: "materialTopologyResolve", load: () => import("./phases/sbPhaseF6TopologyCompiler.js") },
	{ id: "SB-F7", block: "B", wave: 2, title: "Parameter blending e simplificacao", load: () => import("./phases/sbPhaseF7Simplification.js") },
	{ id: "SB-F8", block: "B", wave: 2, title: "Buffer de material quantizado", pass: "materialBufferUpload", load: () => import("./phases/sbPhaseF8MaterialBuffer.js") },
	{ id: "SB-F9", block: "B", wave: 2, title: "Despacho de avaliacao de closures", pass: "closureDispatchPrepare", load: () => import("./phases/sbPhaseF9ClosureDispatch.js") },


	{ id: "SB-F10", block: "C", wave: 2, title: "Especular GGX com F0/F90 e multi-scatter", load: () => import("./phases/sbPhaseF10SlabSpecular.js") },
	{ id: "SB-F11", block: "C", wave: 2, title: "Anisotropia e frame tangente", load: () => import("./phases/sbPhaseF11Anisotropy.js") },
	{ id: "SB-F12", block: "C", wave: 3, title: "Segundo lobo especular e haziness", load: () => import("./phases/sbPhaseF12DualSpecularLobe.js") },
	{ id: "SB-F13", block: "C", wave: 3, title: "Fuzz e sheen com qualidade por tier", load: () => import("./phases/sbPhaseF13FuzzSheen.js") },
	{ id: "SB-F14", block: "C", wave: 3, title: "Thin film e iridescencia", load: () => import("./phases/sbPhaseF14ThinFilm.js") },
	{ id: "SB-F15", block: "C", wave: 3, title: "Glints procedurais com LOD", pass: "glintNoisePrepare", load: () => import("./phases/sbPhaseF15Glints.js") },
	{ id: "SB-F16", block: "C", wave: 3, title: "Specular profile por LUT", pass: "specularProfileAtlas", load: () => import("./phases/sbPhaseF16SpecularProfile.js") },
	{ id: "SB-F17", block: "C", wave: 2, title: "Difusa do slab com rugosidade", load: () => import("./phases/sbPhaseF17SlabDiffuse.js") },


	{ id: "SB-F18", block: "D", wave: 3, title: "Vertical layering com Beer-Lambert", load: () => import("./phases/sbPhaseF18VerticalLayering.js") },
	{ id: "SB-F19", block: "D", wave: 4, title: "Opaque rough refraction", pass: "opaqueRoughRefraction", load: () => import("./phases/sbPhaseF19RoughRefraction.js") },
	{ id: "SB-F20", block: "D", wave: 3, title: "Horizontal mixing, Add e Weight", load: () => import("./phases/sbPhaseF20HorizontalMixing.js") },
	{ id: "SB-F21", block: "D", wave: 4, title: "SSS por MFP com perfil de difusao", pass: "subsurfaceScattering", load: () => import("./phases/sbPhaseF21Subsurface.js") },
	{ id: "SB-F22", block: "D", wave: 3, title: "Two-sided foliage e thin translucency", load: () => import("./phases/sbPhaseF22ThinTranslucency.js") },
	{ id: "SB-F23", block: "D", wave: 4, title: "Translucidez ordenada (OIT)", pass: "translucencyResolve", load: () => import("./phases/sbPhaseF23Translucency.js") },


	{ id: "SB-F24", block: "E", wave: 4, title: "Hair BSDF (R, TT, TRT)", load: () => import("./phases/sbPhaseF24HairBsdf.js") },
	{ id: "SB-F25", block: "E", wave: 4, title: "Eye BSDF", load: () => import("./phases/sbPhaseF25EyeBsdf.js") },
	{ id: "SB-F26", block: "E", wave: 4, title: "Single Layer Water BSDF", load: () => import("./phases/sbPhaseF26SingleLayerWater.js") },
	{ id: "SB-F27", block: "E", wave: 4, title: "Dominios: volume, unlit, light function, post process", load: () => import("./phases/sbPhaseF27MaterialDomains.js") },


	{ id: "SB-F28", block: "F", wave: 2, title: "Mapas por slab e orcamento de texturas", load: () => import("./phases/sbPhaseF28SlabMaps.js") },
	{ id: "SB-F29", block: "F", wave: 4, title: "Decais no buffer de material (DBuffer)", load: () => import("./phases/sbPhaseF29DecalBuffer.js") },
	{ id: "SB-F30", block: "F", wave: 5, title: "Autoria, API publica e interop", load: () => import("./phases/sbPhaseF30PublicApi.js") },


	{ id: "SB-F31", block: "G", wave: 5, title: "Iluminacao avalia closures", pass: "lightingBridge", load: () => import("./phases/sbPhaseF31LightingBridge.js") },
	{ id: "SB-F32", block: "G", wave: 5, title: "Roughness tracking para reflexao", load: () => import("./phases/sbPhaseF32RoughnessTracking.js") },
	{ id: "SB-F33", block: "G", wave: 5, title: "Integracao Future: gate, duas ramificacoes, modo seguro", load: () => import("./phases/sbPhaseF33FutureIntegration.js") },


	{ id: "SB-F34", block: "H", wave: 6, title: "Governador de orcamento por tier e warmup", load: () => import("./phases/sbPhaseF34TierBudget.js") },
	{ id: "SB-F35", block: "H", wave: 6, title: "Modos de debug de material", pass: "debugVisualization", load: () => import("./phases/sbPhaseF35DebugVisualization.js") },
	{ id: "SB-F36", block: "H", wave: 6, title: "Portoes de performance", load: () => import("./phases/sbPhaseF36PerfGates.js") },
	{ id: "SB-F37", block: "H", wave: 7, title: "Certificacao de paridade e rodada cega", load: () => import("./phases/sbPhaseF37ParityCertification.js") },
]

export function phaseIds() {
	return SB_PHASE_MANIFEST.map((phase) => phase.id)
}

export function phaseEntry(phaseId) {
	return SB_PHASE_MANIFEST.find((phase) => phase.id === phaseId) ?? null
}

export function phasesByWave(wave) {
	return SB_PHASE_MANIFEST.filter((phase) => phase.wave === wave)
}

export function phasesByBlock(block) {
	return SB_PHASE_MANIFEST.filter((phase) => phase.block === block)
}

export function waveNumbers() {
	return Array.from(new Set(SB_PHASE_MANIFEST.map((phase) => phase.wave))).sort((left, right) => left - right)
}

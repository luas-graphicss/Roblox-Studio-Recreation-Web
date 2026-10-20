export const LIGHT_PROXY_PHASE_ID = "LL-F19";
export const LIGHT_PROXY_FLAG_ID = "LightSourceProxy";
export const LIGHT_PROXY_PATCH_ID = "ll-f19-light-proxy";
export const LIGHT_PROXY_QA_ID = "ll-f19-reflexo";


export const LIGHT_PROXY_PROOF_SCENE_ID = "cena4";


export const BASELINE_FREEZE_FLAG_ID = "LlBaseline";


export const LIGHT_PROXY_ANCHOR = "lightsFragmentMaps";
export const LIGHT_PROXY_RADIANCE_CHUNK = "lights_fragment_maps";



export const LIGHT_PROXY_DECLARATION_CHUNK = "common";

export const LIGHT_PROXY_UNIFORMS = Object.freeze({
	enabled: "uLlLightProxyOn",
	probe: "uLlLightProxyProbe",
	intensity: "uLlLightProxyIntensity",
	roughnessCutoff: "uLlLightProxyRoughnessCutoff",
	roughnessSoftEdge: "uLlLightProxyRoughnessSoftEdge",
});


export const LIGHT_PROXY_LAYER = 3;


export const LIGHT_PROXY_PROBE_TEXTURE_UNITS = 1;


export const LIGHT_PROXY_MATERIAL_PATHS = Object.freeze(["standard", "physical", "terreno", "skinned"]);


export const LIGHT_PROXY_PATCH_ORDER = 120;

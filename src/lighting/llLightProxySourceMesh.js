import * as THREE from "three";
import { LIGHT_PROXY_LAYER } from "./llLightProxyContract.js";
import { proxyProjectedArea, resolveProxyDimensions } from "./llLightProxyMeshCore.js";
import { proxyLuminanceNits } from "./llLightProxyRadianceCore.js";
import { rectLightCandela, surfaceLightFaceRotation } from "./llRectExtrasCore.js";

const SURFACE_LIGHT_TYPE = "SurfaceLight";
const NITS_USER_DATA_KEY = "llProxyNits";

const legacyProxyQuaternions = new WeakMap();
const faceQuaternion = new THREE.Quaternion();

function rememberLegacyPose(proxy) {
	if (!legacyProxyQuaternions.has(proxy)) legacyProxyQuaternions.set(proxy, proxy.quaternion.clone());
	return legacyProxyQuaternions.get(proxy);
}

function restoreLegacyPose(proxy) {
	const legacyQuaternion = legacyProxyQuaternions.get(proxy);
	if (legacyQuaternion) proxy.quaternion.copy(legacyQuaternion);
	return proxy.quaternion;
}


export function readSourceCandela(localLight) {
	const light = localLight ? localLight.luz : null;
	if (!light) return 0;
	if (light.isRectAreaLight) return rectLightCandela(light.intensity, light.width, light.height);
	return light.intensity;
}


export function describeLightForPlan(localLight) {
	const props = localLight.props;
	return {
		name: localLight.nome,
		type: localLight.tipo,
		enabled: props.Enabled !== false,
		candela: readSourceCandela(localLight),
		width: props.Width,
		height: props.Height,
		sourceRadius: props.SourceRadius,
		sourceLength: props.SourceLength,
	};
}

export function visibleSourceNits(localLight) {
	const descriptor = describeLightForPlan(localLight);
	const dimensions = resolveProxyDimensions(descriptor);
	return proxyLuminanceNits(descriptor.candela, proxyProjectedArea(dimensions));
}


function applyEmittingFaceRotation(localLight) {
	if (localLight.tipo !== SURFACE_LIGHT_TYPE) return false;
	const rotation = surfaceLightFaceRotation(localLight.props.Face);
	faceQuaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
	localLight.proxy.quaternion.copy(legacyProxyQuaternions.get(localLight.proxy)).multiply(faceQuaternion);
	return true;
}

export function describeVisibleSource(localLight) {
	const proxy = localLight.proxy;
	const descriptor = describeLightForPlan(localLight);
	const dimensions = resolveProxyDimensions(descriptor);
	return {
		nome: localLight.nome,
		tipo: localLight.tipo,
		forma: dimensions.shape,
		visivelNoReflexo: !!(proxy && proxy.userData[NITS_USER_DATA_KEY] > 0),
		nits: proxy ? Number(proxy.userData[NITS_USER_DATA_KEY]) || 0 : 0,
		candela: descriptor.candela,
		areaProjetada: proxyProjectedArea(dimensions),
		dimensoes: dimensions,
	};
}


export function paintVisibleSource(localLight, options) {
	const settings = options || {};
	const proxy = localLight ? localLight.proxy : null;
	if (!proxy || !proxy.material) return null;
	rememberLegacyPose(proxy);
	const lightColor = localLight.luz ? localLight.luz.color : null;
	if (!settings.visible) {


		if (lightColor) proxy.material.color.copy(lightColor);
		proxy.layers.disable(LIGHT_PROXY_LAYER);
		restoreLegacyPose(proxy);
		proxy.userData[NITS_USER_DATA_KEY] = 0;
		return describeVisibleSource(localLight);
	}
	const nits = visibleSourceNits(localLight);
	if (lightColor) proxy.material.color.copy(lightColor).multiplyScalar(nits);
	proxy.layers.enable(LIGHT_PROXY_LAYER);
	applyEmittingFaceRotation(localLight);
	proxy.userData[NITS_USER_DATA_KEY] = nits;
	return describeVisibleSource(localLight);
}

export function visibleSourcePoseSignature(localLight) {
	const proxy = localLight ? localLight.proxy : null;
	if (!proxy || !(proxy.userData[NITS_USER_DATA_KEY] > 0)) return "";
	proxy.updateWorldMatrix(true, false);
	const worldMatrix = proxy.matrixWorld.elements;
	const round = (value) => Math.round(Number(value) * 1000) / 1000;
	return [
		localLight.nome,
		round(proxy.userData[NITS_USER_DATA_KEY]),
		round(worldMatrix[12]),
		round(worldMatrix[13]),
		round(worldMatrix[14]),
		round(proxy.quaternion.x),
		round(proxy.quaternion.y),
		round(proxy.quaternion.z),
		round(proxy.quaternion.w),
	].join(":");
}

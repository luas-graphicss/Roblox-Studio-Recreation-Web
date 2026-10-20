import { copySubstrateSmDiagnosticData } from './ssmDiagnosticData.js';

export function readSubstrateSmCaptureEnvironment(renderer, renderTarget) {
  const context = renderer.getContext();
  const debug = context.getExtension('WEBGL_debug_renderer_info');
  const vendor = context.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : context.VENDOR);
  const gpu = context.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : context.RENDERER);
  const software = /swiftshader|llvmpipe|softpipe|software rasterizer/i.test(String(gpu));
  const extensions = context.getSupportedExtensions() ?? [];
  return copySubstrateSmDiagnosticData({
    vendor, gpu, softwareRenderer: software ? true : null,
    softwareDetection: software ? 'renderer-string-positive' : 'physical-hardware-not-certified',
    webglVersion: context.getParameter(context.VERSION), shadingLanguageVersion: context.getParameter(context.SHADING_LANGUAGE_VERSION),
    userAgent: globalThis.navigator?.userAgent ?? null, contextAttributes: context.getContextAttributes(),
    timerQueryAvailable: extensions.includes('EXT_disjoint_timer_query_webgl2'),
    parallelCompileAvailable: extensions.includes('KHR_parallel_shader_compile'),
    renderWidth: renderTarget.width, renderHeight: renderTarget.height, renderDpr: renderer.getPixelRatio?.() ?? null,
    outputColorSpace: renderer.outputColorSpace ?? null, targetColorSpace: renderTarget.texture.colorSpace ?? null,
    toneMapping: renderer.toneMapping ?? null, exposure: renderer.toneMappingExposure ?? null,
    targetSamples: renderTarget.samples ?? 0, pixelEncoding: 'rgba8', pixelOrigin: 'bottom-left',
    rendererTotals: { programs: renderer.info?.programs?.length ?? null,
      textures: renderer.info?.memory?.textures ?? null, geometries: renderer.info?.memory?.geometries ?? null },
    rendererTotalScope: 'whole-renderer-not-ssm-incremental', gpuBytes: null,
    limits: { fragmentSamplers: context.getParameter(context.MAX_TEXTURE_IMAGE_UNITS),
      combinedSamplers: context.getParameter(context.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
      vertexAttributes: context.getParameter(context.MAX_VERTEX_ATTRIBS) },
  });
}

export async function hashSubstrateSmCaptureBytes(value) {
  if (!globalThis.crypto?.subtle) throw new Error('SSM_QA_SHA256_UNAVAILABLE');
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function inspectSubstrateSmCapturePixels(pixels) {
  let nonUniform = false;
  let minimum = 255;
  let maximum = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = pixels[index + channel];
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
      if (value !== pixels[channel]) nonUniform = true;
    }
  }
  return Object.freeze({ nonUniform, minimum, maximum, pixelCount: pixels.length / 4,
    interpretation: 'readback-only-not-optical-or-performance-certification' });
}

import { logger } from "../core/logger.js";
import {
  AE_SMALL_SIZE,
  buildAeEncodeGlsl,
  buildAeMeasureGlsl,
  buildAeReduceGlsl,
  createAutoExposureController,
  decodeFixed16,
} from "../lighting/autoExposureCore.js";

const AE_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;


const AE_PENDING_TIMEOUT_MS = 2000;
const AE_MAX_GL_ERRORS = 3;

export function createAutoExposurePass({ THREE, renderer, FullScreenQuad }) {
  const quad = new FullScreenQuad(null);
  const mkMat = (frag) =>
    new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null } },
      vertexShader: AE_VERT,
      fragmentShader: frag,
      depthTest: false,
      depthWrite: false,
    });
  const measureMat = mkMat(buildAeMeasureGlsl());
  const reduceMat = mkMat(buildAeReduceGlsl());
  const encodeMat = mkMat(buildAeEncodeGlsl());
  const ctl = createAutoExposureController();
  const isWebGL2 = !!(renderer && renderer.capabilities && renderer.capabilities.isWebGL2);
  const px = new Uint8Array(4);
  let chain = null;                                                    
  let encodeRT = null;                                                       
  let fmt = "off";                                                  
  let pbo = null;
  let fence = null;
  let pendingSince = 0;
  let frame = 0;
  let glErrors = 0;
  let dead = false;
  let deadReason = "";
  let warned = false;
  let plan = null;
  let lastSampleAt = 0;
  let samplesOk = 0;
  let samplesDropped = 0;
  let disposed = false;
  const qaBuf = {};

  const nowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

  function abandonReadback() {
    if (!fence) return;
    try {
      renderer.getContext().deleteSync(fence);
    } catch (_e) {

    }
    fence = null;
  }

  function die(reason, msg) {
    dead = true;
    deadReason = reason;
    ctl.deactivate();
    abandonReadback();
    if (!warned) {
      warned = true;
      logger.warn(
        "[Iluminação] IL-F5: auto-exposure desativado (" + reason + ")" + (msg ? ": " + msg : "") + ". A exposição segue manual (uAutoExposure = 1)."
      );
    }
  }

  function ensureTargets() {
    if (chain) return;
    const gl = renderer.getContext();


    const floatOk = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
    fmt = floatOk ? "half" : "byte";
    const midType = floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const mk = (s, type) =>
      new THREE.WebGLRenderTarget(s, s, {
        type,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
    chain = [];
    for (let s = AE_SMALL_SIZE; s >= 1; s = s >> 1) chain.push(mk(s, midType));
    encodeRT = mk(1, THREE.UnsignedByteType);
  }

  function pollSample() {
    if (!fence) return;
    const gl = renderer.getContext();
    const st = gl.clientWaitSync(fence, 0, 0);
    if (st === gl.TIMEOUT_EXPIRED) {
      if (nowMs() - pendingSince > AE_PENDING_TIMEOUT_MS) {
        abandonReadback();
        samplesDropped++;
      }
      return;
    }
    gl.deleteSync(fence);
    fence = null;
    if (st === gl.WAIT_FAILED) {
      samplesDropped++;
      return;
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);


    const errPoll = gl.getError();
    if (errPoll !== 0) {
      glErrors++;
      samplesDropped++;
      if (glErrors >= AE_MAX_GL_ERRORS) die("gl-error", "0x" + errPoll.toString(16) + " no readback");
      return;
    }
    const t = nowMs();
    const dtMs = lastSampleAt > 0 ? t - lastSampleAt : 16.7;
    lastSampleAt = t;
    ctl.step({ meanNl: decodeFixed16(px[0], px[1]), p95Nl: decodeFixed16(px[2], px[3]), dtMs });
    samplesOk++;
  }

  function runChainAndKick(rnd, srcTexture) {
    const prev = rnd.getRenderTarget();
    measureMat.uniforms.tSrc.value = srcTexture;
    quad.material = measureMat;
    rnd.setRenderTarget(chain[0]);
    quad.render(rnd);
    for (let i = 1; i < chain.length; i++) {
      reduceMat.uniforms.tSrc.value = chain[i - 1].texture;
      quad.material = reduceMat;
      rnd.setRenderTarget(chain[i]);
      quad.render(rnd);
    }
    encodeMat.uniforms.tSrc.value = chain[chain.length - 1].texture;
    quad.material = encodeMat;
    rnd.setRenderTarget(encodeRT);
    quad.render(rnd);


    const gl = rnd.getContext();
    if (!pbo) pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, 4, gl.STREAM_READ);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    pendingSince = nowMs();
    rnd.setRenderTarget(prev);


    const errKick = gl.getError();
    if (errKick !== 0) {
      glErrors++;
      samplesDropped++;
      abandonReadback();
      if (glErrors >= AE_MAX_GL_ERRORS) die("gl-error", "0x" + errKick.toString(16) + " no kick da medição");
    }
  }

  const pass = {
    enabled: true,
    needsSwap: false,
    clear: false,
    renderToScreen: false,
    setSize() {

    },

    applyState(p) {
      plan = p || null;
      if ((!plan || !plan.active) && !dead) {
        ctl.deactivate();


        abandonReadback();
        lastSampleAt = 0;
      }
    },

    getScale() {
      if (dead || disposed || !plan || !plan.active) return 1;
      return ctl.getState().scale;
    },
    render(rnd, _writeBuffer, readBuffer) {
      if (disposed || dead || !plan || !plan.active) return;
      if (!isWebGL2) {
        die("webgl1");
        return;
      }
      try {
        pollSample();
        frame++;
        const cad = plan.cadence >= 1 ? plan.cadence | 0 : 1;
        if (!fence && readBuffer && readBuffer.texture && frame % cad === 0) {
          ensureTargets();
          runChainAndKick(rnd, readBuffer.texture);
        }
      } catch (e) {
        glErrors++;
        samplesDropped++;
        abandonReadback();
        if (glErrors >= AE_MAX_GL_ERRORS) {
          die("gl-error", e && e.message ? e.message : String(e));
        }
      }
    },
    getQa() {
      const st = ctl.getState();
      const active = !dead && !disposed && !!(plan && plan.active);
      qaBuf.on = active;
      qaBuf.reason = dead ? deadReason : disposed ? "disposed" : plan ? plan.reason : "sem-plano";
      qaBuf.format = fmt;


      qaBuf.scale = active ? Math.round(st.scale * 10000) / 10000 : 1;
      qaBuf.scaleRaw = Math.round(st.scale * 10000) / 10000;
      qaBuf.evAdapt = st.evAdapt === null ? null : Math.round(st.evAdapt * 100) / 100;
      qaBuf.evTarget = st.evTarget === null ? null : Math.round(st.evTarget * 100) / 100;
      qaBuf.moving = !!st.moving;
      qaBuf.samples = samplesOk;
      qaBuf.dropped = samplesDropped + st.dropped;
      qaBuf.glErrors = glErrors;
      qaBuf.pending = !!fence;
      return qaBuf;
    },
    dispose() {
      disposed = true;
      abandonReadback();
      if (pbo) {
        try {
          renderer.getContext().deleteBuffer(pbo);
        } catch (_e) {

        }
        pbo = null;
      }
      if (chain) {
        for (const rt of chain) {
          try {
            rt.dispose();
          } catch (_e) {

          }
        }
        chain = null;
      }
      if (encodeRT) {
        try {
          encodeRT.dispose();
        } catch (_e) {

        }
        encodeRT = null;
      }
      try {
        measureMat.dispose();
        reduceMat.dispose();
        encodeMat.dispose();
        quad.dispose();
      } catch (_e) {

      }
    },
  };


  if (typeof window !== "undefined") {
    window.__rswAutoExposureQa = { get: () => pass.getQa() };
  }

  return pass;
}

import { MSM_TRANSITION_FRAME_CEILING_MS } from '../lighting/megalightsSm/msmWarmupPlanCore.js';

export function compileMsmMaterial({ THREE, renderer, material }) {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const startedAt = performance.now();
  const previousPrograms = new Set(renderer.info?.programs || []);
  const gl = renderer.getContext?.();
  const extension = gl?.getExtension?.('KHR_parallel_shader_compile');
  let programs = [], disposed = false;
  const job = { name: material.name || 'MSM sample', compiled: false, ready: false,
    error: null, parallel: !!extension, waitMs: 0, cpuMs: 0, validatedPrograms: 0 };
  function releaseGeometry() {
    if (!disposed) geometry.dispose();
    disposed = true;
  }
  function fail(error) { job.error = error instanceof Error ? error : new Error(String(error)); releaseGeometry(); }
  try {
    renderer.compile(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    programs = (renderer.info?.programs || []).filter(program => !previousPrograms.has(program));

    gl?.flush?.();
  } catch (error) { fail(error); }
  job.cpuMs = performance.now() - startedAt;
  job.poll = ({ prepare = true } = {}) => {
    if (job.ready || job.error) return job.ready;
    const pollStartedAt = performance.now();
    job.waitMs = pollStartedAt - startedAt;
    try {
      if (job.waitMs > MSM_TRANSITION_FRAME_CEILING_MS * 60) throw new Error('MSM parallel shader compilation timed out');
      if (extension && programs.some(program => !gl.getProgramParameter(program.program, extension.COMPLETION_STATUS_KHR))) return false;
      job.compiled = true;

      if (!prepare) return false;
      if (typeof gl?.getProgramParameter === 'function' && typeof gl.LINK_STATUS === 'number') {
        for (const program of programs) {
          if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
            throw new Error('MSM shader linking failed: ' + (gl.getProgramInfoLog?.(program.program) || 'no driver diagnostic'));
          }


          program.getUniforms?.();
          program.getAttributes?.();
          job.validatedPrograms += 1;
        }
      }
      job.cpuMs = Math.max(job.cpuMs, performance.now() - pollStartedAt);
      if (job.cpuMs > MSM_TRANSITION_FRAME_CEILING_MS) throw new Error('MSM shader preparation exceeded the CPU slice ceiling');
      job.ready = true;
      releaseGeometry();
    } catch (error) { fail(error); }
    return job.ready;
  };
  job.cancel = () => { if (!job.ready) fail(new Error('MSM shader preparation cancelled')); else releaseGeometry(); };
  return job;
}

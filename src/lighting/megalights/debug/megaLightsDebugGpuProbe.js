import { createMegaLightsGBuffer } from "../runtime/megaLightsGBuffer.js";
import { createSceneInputsPass } from "../mlSceneInputsGlue.js";
import { createMegaLightsDebugTextureReader } from "./megaLightsDebugTextureReader.js";
import { captureDebugSource } from "./megaLightsDebugCapture.js";
import { makeDebugCheck } from "./megaLightsDebugCore.js";

export function runMegaLightsDebugGpuProbe({ THREE, renderer }) {
  const checks = [];
  const near = (actual, expected, tolerance = 0.006) =>
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  if (
    !renderer.capabilities.isWebGL2 ||
    !renderer.extensions.has("EXT_color_buffer_float")
  )
    return {
      checks: [
        makeDebugCheck(
          "GPU input probe",
          null,
          "WebGL2 float attachments unavailable",
        ),
      ],
      preview: null,
    };
  const previousTarget = renderer.getRenderTarget();
  const viewport = renderer.getViewport(new THREE.Vector4());
  const scissor = renderer.getScissor(new THREE.Vector4());
  const previousScissorTest = renderer.getScissorTest();
  const previousRenderInfo = { ...renderer.info.render };
  const telemetry = {
    phase() {},
    error(error) {
      throw error instanceof Error ? error : new Error(String(error));
    },
  };
  let gBuffer;
  let pass;
  let reader;
  let geometry;
  let material;
  let preview = null;
  try {
    gBuffer = createMegaLightsGBuffer({
      THREE,
      renderer,
      width: 32,
      height: 32,
      telemetry,
    });
    pass = createSceneInputsPass({ THREE, renderer, gBuffer, telemetry });
    reader = createMegaLightsDebugTextureReader({ THREE, renderer });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    camera.position.z = 3;
    geometry = new THREE.PlaneGeometry(1.5, 1.5);
    material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.2, 0.4, 0.6),
      roughness: 0.35,
      metalness: 0.6,
    });
    const plane = new THREE.Mesh(geometry, material);
    scene.add(plane);
    const frame = {
      scene,
      camera,
      frameIndex: 0,
      drawingBufferSize: { x: 32, y: 32 },
    };
    pass.execute(frame);
    const read = (name) =>
      Array.from(
        pass.readAttachmentPixels({
          attachmentName: name,
          x: 16,
          y: 16,
          width: 1,
          height: 1,
        }).pixels,
      );
    const depth = read("sceneDepth");
    const normal = read("sceneNormal");
    const albedo = read("sceneAlbedo");
    const initialVelocity = read("sceneVelocity");
    checks.push(
      makeDebugCheck(
        "GPU MRT depth",
        near(depth[0], 3) && near(depth[3], 1),
        "Expected linear depth 3 and coverage 1",
        depth,
      ),
    );
    checks.push(
      makeDebugCheck(
        "GPU normal / roughness",
        near(normal[0], 0.5) &&
          near(normal[1], 0.5) &&
          near(normal[2], 1) &&
          near(normal[3], 0.35),
        "Expected encoded +Z normal and roughness 0.35",
        normal,
      ),
    );
    checks.push(
      makeDebugCheck(
        "GPU albedo / metalness",
        near(albedo[0], 0.2) &&
          near(albedo[1], 0.4) &&
          near(albedo[2], 0.6) &&
          near(albedo[3], 0.6),
        "Expected linear RGB 0.2/0.4/0.6, metalness 0.6",
        albedo,
      ),
    );
    checks.push(
      makeDebugCheck(
        "GPU first-frame velocity refusal",
        initialVelocity[3] < 0.5,
        "No history must produce invalid velocity",
        initialVelocity,
      ),
    );
    const sky = pass.readAttachmentPixels({
      attachmentName: "sceneDepth",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }).pixels;
    checks.push(
      makeDebugCheck(
        "GPU sky coverage",
        near(sky[3], 0),
        "An uncovered sky pixel must not be shaded",
        Array.from(sky),
      ),
    );
    frame.frameIndex = 1;
    pass.execute(frame);
    const still = read("sceneVelocity");
    checks.push(
      makeDebugCheck(
        "GPU static velocity",
        near(still[0], 0.5) && near(still[1], 0.5) && still[3] > 0.5,
        "Second static frame must have zero motion and valid history",
        still,
      ),
    );
    plane.position.x = 0.2;
    frame.frameIndex = 2;
    pass.execute(frame);
    const moving = read("sceneVelocity");
    checks.push(
      makeDebugCheck(
        "GPU moving-object velocity",
        moving[0] > 0.51 && moving[3] > 0.5,
        "Moving right must produce a positive screen velocity",
        moving,
      ),
    );
    const levelCount = pass.handle().hierarchicalDepth.levelCount;
    const root = pass.readHierarchicalDepthLevel(levelCount - 1, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    checks.push(
      makeDebugCheck(
        "GPU HZB min / max",
        near(root.pixels[0], 3) && near(root.pixels[1], 10),
        "Root includes geometry at 3 and sky at far plane 10",
        Array.from(root.pixels),
      ),
    );
    const source = {
      available: true,
      texture: pass.handle().textures.sceneAlbedo,
      width: 32,
      height: 32,
      origin: "Isolated 32×32 GPU fixture",
      backend: "Actual MRT readback",
    };
    preview = captureDebugSource({
      source,
      mode: { encoding: "rgb" },
      textureReader: reader,
    });
    const copied = reader.read(source.texture, source, { x: 16, y: 16 });
    checks.push(
      makeDebugCheck(
        "Debug reader channel fidelity",
        near(copied.pixels[0], albedo[0]) && near(copied.pixels[3], albedo[3]),
        "The panel reader must return the same GPU texels as F3",
        Array.from(copied.pixels),
      ),
    );
    material.transparent = true;
    frame.frameIndex = 3;
    pass.execute(frame);
    checks.push(
      makeDebugCheck(
        "GPU transparency refusal",
        pass.inspect().report.skippedTransparentMeshCount === 1 &&
          read("sceneDepth")[3] < 0.5,
        "Transparent geometry is deliberately omitted, not silently misrepresented",
      ),
    );
  } catch (error) {
    checks.push(
      makeDebugCheck(
        "GPU probe execution",
        false,
        String(error?.message || error),
      ),
    );
  } finally {
    reader?.dispose();
    pass?.dispose();
    gBuffer?.dispose();
    geometry?.dispose();
    material?.dispose();
    renderer.setRenderTarget(previousTarget);
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(previousScissorTest);
    Object.assign(renderer.info.render, previousRenderInfo);
  }
  checks.push(
    makeDebugCheck(
      "GPU probe renderer restoration",
      renderer.getRenderTarget() === previousTarget &&
        renderer.getViewport(new THREE.Vector4()).equals(viewport) &&
        renderer.getScissor(new THREE.Vector4()).equals(scissor) &&
        renderer.getScissorTest() === previousScissorTest &&
        Object.entries(previousRenderInfo).every(
          ([key, value]) => renderer.info.render[key] === value,
        ),
      "The probe restores the render target, viewport, scissor and frame counters",
    ),
  );
  return { checks, preview };
}

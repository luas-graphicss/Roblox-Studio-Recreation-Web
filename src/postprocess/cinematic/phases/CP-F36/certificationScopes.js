const resourceFormats = Object.freeze({ "rgba8unorm": "rgba8", "rgba16float-le": "rgba16f", "rgba32float-le": "rgba32f" });

export function createCertifiedRuntimeScopes(referenceManifest) {
  const assets = new Map((referenceManifest?.assets ?? []).map((asset) => [asset.id, asset]));
  const profiles = new Map((referenceManifest?.inventory?.profiles ?? []).map((profile) => [profile.id, profile]));
  const scopes = new Map();
  for (const run of referenceManifest?.captureRuns ?? []) {
    for (const frame of run.frames ?? []) {
      const capture = assets.get(frame.captures?.["output:displayColor"])?.capture;
      if (!capture || !resourceFormats[capture.format]) continue;
      const scope = { profileId: run.profileId, qualityTier: profiles.get(run.profileId)?.facts?.quality?.value, width: capture.width, height: capture.height, renderWidth: run.frozen?.renderSize?.value?.width, renderHeight: run.frozen?.renderSize?.value?.height, encoding: capture.encoding, format: resourceFormats[capture.format] };
      if (typeof scope.qualityTier === "string" && Number.isInteger(scope.renderWidth) && Number.isInteger(scope.renderHeight)) scopes.set(JSON.stringify(scope), scope);
    }
  }
  return [...scopes.values()];
}

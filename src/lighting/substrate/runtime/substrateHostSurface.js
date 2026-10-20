let hostSurface = null;
export function getSubstrateHostSurface() { return hostSurface; }
export function setSubstrateHostSurface(surface) {
  if (surface && hostSurface && hostSurface !== surface) throw new Error('A Substrate phase host is already attached');
  hostSurface = surface;
}
export function releaseSubstrateHostSurface(surface) {
  if (hostSurface === surface) hostSurface = null;
}

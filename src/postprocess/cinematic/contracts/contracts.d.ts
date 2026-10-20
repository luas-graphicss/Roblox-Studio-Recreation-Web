export type Provenance = "gpu" | "synthetic" | "reference";
export type PhaseStatus = "planned" | "implemented";
export interface PixelSize { width: number; height: number }
export interface ResourceStamp { frameId: number; viewId: string; generation: number; provenance: Provenance }
export interface TextureResource extends PixelSize, ResourceStamp {
  texture: object;
  target?: object;
  format: string;
  encoding: string;
  origin: "bottom-left";
}
export interface ValueResource extends ResourceStamp { value: unknown }
export type FrameResource = TextureResource | ValueResource;
export interface FrameContext {
  frameId: number;
  viewId: string;
  generation: number;
  timeSeconds: number;
  deltaSeconds: number;
  cameraCut: boolean;
  preExposure: number;
  previousPreExposure: number;
  renderSize: PixelSize;
  outputSize: PixelSize;
  jitterPixels: readonly [number, number];
  previousJitterPixels: readonly [number, number];
  referenceMode: boolean;
  qualityTier: string;
  matrices: Record<string, readonly number[]>;
  camera: Record<string, number>;
}
export interface PassContext {
  frame: FrameContext;
  color: TextureResource | null;
  read(name: string): FrameResource;
  publish(name: string, resource: FrameResource): void;
  rendererAdapter: unknown;
  settings: unknown;
}
export interface PassDefinition {
  id: string;
  owner: string;
  stage: string;
  order: number;
  reads: readonly string[];
  writes: readonly string[];
  transformsColor: boolean;
  execute(context: PassContext): { color?: TextureResource } | void;
  dispose?(): void;
}
export interface PhaseServices {
  graph: { register(pass: PassDefinition): () => void };
  history: unknown;
  pool: unknown;
  settings: unknown;
  capabilities: unknown;
  rendererAdapter: unknown;
  report(event: Record<string, unknown>): void;
}
export interface PhaseModule {
  id: string;
  contractVersion: string;
  status: PhaseStatus;
  install(services: PhaseServices): (() => void) | Promise<() => void>;
}

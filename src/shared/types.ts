// Types shared by the main process, the preload bridge and the renderer.

// FLUX.2 [klein] multi-reference editing: every extra image adds its full
// latent to the attention context, so time and memory grow with each one.
export const MAX_REFERENCE_IMAGES = 4

export interface ModelFileInfo {
  name: string
  file: string
  quantization: string
  sizeBytes: number
}

export interface DownloadProgress {
  file: string
  downloaded: number
  total: number
  percentage: number
}

export type ModelStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; modelId: string }
  | { state: 'error'; message: string }

export interface GenerateRequest {
  prompt: string
  // PNG/JPEG bytes of the reference images, in @image1..@imageN order.
  // Empty or omitted for text-to-image.
  initImages?: Uint8Array[]
  width: number
  height: number
  steps: number
  guidance: number
  seed: number // -1 = random
}

export interface StepProgress {
  step: number
  totalSteps: number
  elapsedMs: number
}

export interface GenerateResult {
  png: Uint8Array
  seed?: number
  denoiseMs?: number
  vaeMs?: number
  totalMs?: number
}

export interface LogLine {
  level: string
  namespace: string
  message: string
}

export interface StudioInfo {
  models: ModelFileInfo[]
  memoryBudgetGiB: number
  gpuBackend: string
  streamLayers: boolean
}

export interface StudioAPI {
  info: () => Promise<StudioInfo>
  // Current model state; a window opened after the model loaded needs it.
  status: () => Promise<ModelStatus>
  loadModel: () => Promise<ModelStatus>
  generate: (req: GenerateRequest) => Promise<GenerateResult>
  cancel: () => Promise<void>
  saveImage: (png: Uint8Array, suggestedName: string) => Promise<string | null>
  onStatus: (cb: (s: ModelStatus) => void) => () => void
  onDownload: (cb: (p: DownloadProgress) => void) => () => void
  onStep: (cb: (p: StepProgress) => void) => () => void
  onLog: (cb: (l: LogLine) => void) => () => void
}

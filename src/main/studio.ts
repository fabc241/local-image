// Owns the QVAC model lifecycle for the app: one FLUX.2 [klein] 4B instance,
// loaded once and reused for both text-to-image and image editing.
import { cancel, diffusion, loadModel, subscribeServerLogs, unloadModel } from '@qvac/sdk'
import type {
  DownloadProgress,
  GenerateRequest,
  GenerateResult,
  LogLine,
  ModelStatus,
  StepProgress,
  StudioInfo
} from '../shared/types'
import { MAX_REFERENCE_IMAGES } from '../shared/types'
import {
  DIFFUSION_MODEL,
  GPU_BACKEND,
  LAYER_STREAMING,
  MEMORY_BUDGET_GIB,
  MODELS,
  MODEL_CONFIG
} from './modelConfig'

const MAX_INIT_IMAGE_BYTES = 3 * 1024 * 1024

type DiffusionParams = Parameters<typeof diffusion>[0]

export interface StudioEvents {
  status: (s: ModelStatus) => void
  download: (p: DownloadProgress) => void
  step: (p: StepProgress) => void
  log: (l: LogLine) => void
}

export class Studio {
  private status: ModelStatus = { state: 'idle' }
  private loading: Promise<ModelStatus> | null = null
  private generating = false
  private unsubscribeLogs: (() => void) | null = null

  constructor(private readonly events: StudioEvents) {}

  info(): StudioInfo {
    return {
      models: MODELS.map((m) => ({
        name: m.name,
        file: m.modelId,
        quantization: m.quantization,
        sizeBytes: m.expectedSize
      })),
      memoryBudgetGiB: MEMORY_BUDGET_GIB,
      gpuBackend: GPU_BACKEND,
      streamLayers: LAYER_STREAMING
    }
  }

  getStatus(): ModelStatus {
    return this.status
  }

  load(): Promise<ModelStatus> {
    if (this.status.state === 'ready') return Promise.resolve(this.status)
    this.loading ??= this.doLoad().finally(() => {
      this.loading = null
    })
    return this.loading
  }

  private async doLoad(): Promise<ModelStatus> {
    this.setStatus({ state: 'loading' })
    this.unsubscribeLogs ??= subscribeServerLogs((log) => {
      const line = { level: log.level, namespace: log.namespace, message: log.message }
      console.log(`[engine] [${line.level}] [${line.namespace}] ${line.message}`)
      this.events.log(line)
    })
    try {
      const modelId = await loadModel({
        modelSrc: DIFFUSION_MODEL,
        modelType: 'sdcpp-generation',
        modelConfig: MODEL_CONFIG,
        onProgress: (p) => {
          const file = MODELS.find((m) => p.downloadKey?.includes(m.modelId))?.modelId
          this.events.download({
            file: file ?? p.downloadKey ?? 'model',
            downloaded: p.downloaded,
            total: p.total,
            percentage: p.percentage
          })
        }
      })
      this.setStatus({ state: 'ready', modelId })
    } catch (err) {
      this.setStatus({ state: 'error', message: errorMessage(err) })
    }
    return this.status
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const status = await this.load()
    if (status.state !== 'ready') {
      throw new Error(status.state === 'error' ? status.message : 'Model is not loaded')
    }
    if (this.generating) throw new Error('A generation is already running')
    const refs = req.initImages ?? []
    if (refs.length > MAX_REFERENCE_IMAGES) {
      throw new Error(`Use at most ${MAX_REFERENCE_IMAGES} reference images`)
    }
    // The SDK's base64 validation overflows the stack on very large payloads.
    refs.forEach((img, i) => {
      if (img.byteLength > MAX_INIT_IMAGE_BYTES) {
        throw new Error(`@image${i + 1} is too large; use one under 3 MB`)
      }
    })
    this.generating = true
    // Resolve a random seed here so the result reports a reproducible value.
    const seed = req.seed >= 0 ? req.seed : Math.floor(Math.random() * 2 ** 31)
    try {
      const base = {
        modelId: status.modelId,
        prompt: req.prompt,
        width: req.width,
        height: req.height,
        steps: req.steps,
        guidance: req.guidance,
        // FLUX.2 [klein] is guidance-distilled; classic CFG stays off.
        cfg_scale: 1,
        seed
      }
      // One image is a plain FLUX.2 edit; several use multi-reference fusion,
      // where the model attends to every image and @imageN tags in the prompt
      // are plain words that point at them.
      const params: DiffusionParams =
        refs.length > 1
          ? { ...base, init_images: refs }
          : refs.length === 1
            ? { ...base, init_image: refs[0] }
            : base
      const { progressStream, outputs, stats } = diffusion(params)
      for await (const tick of progressStream) this.events.step(tick)
      const [png] = await outputs
      if (!png) throw new Error('The model returned no image')
      const s = await stats
      return {
        png,
        seed,
        denoiseMs: s?.denoiseMs,
        vaeMs: s?.vaeMs,
        totalMs: s?.totalWallMs ?? s?.generationMs
      }
    } finally {
      this.generating = false
    }
  }

  async cancel(): Promise<void> {
    if (this.status.state === 'ready' && this.generating) {
      await cancel({ modelId: this.status.modelId })
    }
  }

  async dispose(): Promise<void> {
    this.unsubscribeLogs?.()
    this.unsubscribeLogs = null
    if (this.status.state === 'ready') {
      const { modelId } = this.status
      this.status = { state: 'idle' }
      await unloadModel({ modelId, clearStorage: false })
    }
  }

  private setStatus(s: ModelStatus): void {
    this.status = s
    this.events.status(s)
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

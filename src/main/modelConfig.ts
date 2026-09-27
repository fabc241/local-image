// FLUX.2 [klein] 4B load configuration, shared by the Electron main process and
// the headless smoke test (scripts/smoke.ts). Keep this file free of Electron
// imports and non-erasable TypeScript so Node can run it with type stripping.
import { FLUX_2_KLEIN_4B_Q4_0, FLUX_2_KLEIN_4B_VAE, QWEN3_4B_Q4_K_M } from '@qvac/sdk'

// Lowest quantization of FLUX.2 [klein] 4B in the QVAC registry (Q4_0, 2.46 GB).
export const DIFFUSION_MODEL = FLUX_2_KLEIN_4B_Q4_0
// FLUX.2 requires a Qwen3 text encoder and its own VAE.
export const TEXT_ENCODER_MODEL = QWEN3_4B_Q4_K_M
export const VAE_MODEL = FLUX_2_KLEIN_4B_VAE

export const MODELS = [DIFFUSION_MODEL, TEXT_ENCODER_MODEL, VAE_MODEL]

// Layer streaming is off: all weights, including the diffusion model, are
// resident in GPU memory. Set to true to keep the diffusion weights in CPU RAM
// and stream them to the GPU layer by layer within MEMORY_BUDGET_GIB.
export const LAYER_STREAMING = false
// Layer-streaming budget, in GiB (the unit `max_vram` uses).
export const MEMORY_BUDGET_GIB = 4

// Where diffusion and VAE graphs execute. Pinned to the Metal GPU so neither
// can silently land on the CPU. Override with LOCAL_IMAGE_BACKEND if needed.
export const GPU_BACKEND = process.env['LOCAL_IMAGE_BACKEND'] ?? 'diffusion=MTL0,vae=MTL0'

// Streaming needs all three settings; graph cutting (max_vram) is dropped too
// when streaming is off, so the diffusion graph runs in one piece.
const STREAMING_CONFIG = {
  params_backend: 'diffusion=cpu',
  max_vram: MEMORY_BUDGET_GIB,
  stream_layers: true
}

export const MODEL_CONFIG = {
  device: 'gpu' as const,
  backend: GPU_BACKEND,
  ...(LAYER_STREAMING ? STREAMING_CONFIG : {}),
  // Never move the VAE to the CPU under memory pressure.
  vae_auto_cpu_fallback: false,
  // In-context conditioning: required for FLUX.2 image editing (init_image).
  prediction: 'flux2_flow' as const,
  llmModelSrc: TEXT_ENCODER_MODEL,
  vaeModelSrc: VAE_MODEL,
  // INFO-level native logs, so backend placement is visible in the app log.
  verbosity: 2
}

# Local Image

A macOS app that creates images from a text prompt, or edits an image you give it, entirely on-device with FLUX.2 [klein] 4B.

It's built on the [QVAC SDK](https://github.com/tetherto/qvac) by Tether (`@qvac/sdk`), which provides the model registry, downloads, and the stable-diffusion.cpp inference engine with Metal acceleration.

- **Create:** text → image.
- **Edit:** drop an image anywhere in the window, describe the change, and it uses FLUX.2 in-context conditioning. Use **Edit this image** to chain edits.

## Engine configuration

All of this lives in [`src/main/modelConfig.ts`](src/main/modelConfig.ts):

| Requirement | Setting |
|---|---|
| FLUX.2 4B from the QVAC registry, lowest quantization | `FLUX_2_KLEIN_4B_Q4_0` (2.46 GB). The registry also has Q4_K_M, Q6_K and Q8_0. |
| Text encoder and VAE FLUX.2 needs | `QWEN3_4B_Q4_K_M` (2.5 GB) and `FLUX_2_KLEIN_4B_VAE` (168 MB) |
| Layer streaming | **Off**: all weights (about 6 GB) stay in GPU memory. To turn it on, set `LAYER_STREAMING = true`; it then uses `stream_layers`, `params_backend: 'diffusion=cpu'` and `max_vram: 4` (GiB). |
| Diffusion and VAE on the GPU | `device: 'gpu'`, `backend: 'diffusion=MTL0,vae=MTL0'` (Metal), `vae_auto_cpu_fallback: false` |
| Image editing | `prediction: 'flux2_flow'`, plus `init_image` per request |

Set `LOCAL_IMAGE_BACKEND` to override the backend assignment, for example to add `te=MTL0` for the text encoder.

Open **Engine log** at the bottom of the window to see the native stable-diffusion.cpp log (INFO level). It shows the backend picked for each module and where each model's weights live (VRAM or RAM).

## Requirements

- macOS 14+ on Apple Silicon. QVAC runs CPU-only on Intel Macs, so this app targets arm64.
- 16 GB unified memory recommended.
- About 5.2 GB of disk for the models. They're cached in `~/.qvac/models` and downloaded on first launch.
- Node.js 22 LTS (≥ 22.17) to build. On Homebrew that's `brew install node@22`, then `export PATH="$(brew --prefix node@22)/bin:$PATH"`. Node 26 breaks the zip extraction Electron and Electron Forge use to unpack the Electron runtime.

## Develop

```bash
npm install
npm run dev
```

The first **Generate** (or **Download & load model**) downloads the three model files with progress bars. Later launches load straight from the cache.

A headless end-to-end check uses the same config. It generates one image, edits it, and prints every native log line:

```bash
npm run smoke -- ./smoke-out
```

## Package

```bash
npm run make
```

This builds `out/make/zip/darwin/arm64/Local Image-darwin-arm64-*.zip` and a `.dmg` with Electron Forge and `@qvac/sdk/electron-forge`. That plugin bundles the QVAC worker, keeps only the darwin-arm64 prebuilds and disables ASAR, because native addons can't load from inside an archive. `qvac.config.json` limits the bundle to the diffusion plugin.

The app isn't code-signed. The first time, open it with right-click → **Open**.

## Notes

- The image to edit is scaled to at most 1024 px and sent as JPEG. `@qvac/sdk` 0.20 validates it with a base64 regex that overflows V8's stack above about 5 MB ("Maximum call stack size exceeded"). FLUX.2 resizes reference images internally anyway.
- FLUX.2 [klein] 4B is step-distilled, so 4 steps is the default. Raise it for more detail.
- `strength` has no effect on FLUX.2 edits: it conditions on the input image instead of noising it. Steer the edit with the prompt.
- Output size is set explicitly. In Edit mode it defaults to the input's aspect ratio and size, capped at 1024 px on the long side, with sides rounded to multiples of 16. Time grows quickly with resolution: on an M4, a 512² image takes about 26 s and a 688×1024 edit takes about 2.5 minutes.
- Cancel stops the request, but the native step already underway finishes first.

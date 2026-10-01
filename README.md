# Local Image

A macOS app that creates images from a text prompt, or edits an image you give it, entirely on-device with FLUX.2 [klein] 4B.

It's built on the [QVAC SDK](https://github.com/tetherto/qvac) by Tether (`@qvac/sdk`), which provides the model registry, downloads, and the stable-diffusion.cpp inference engine with Metal acceleration.

- **Create:** text → image.
- **Edit:** drop one or more images (up to 4) anywhere in the window and describe the change. Use **Edit this image** to chain edits, or **Add as @imageN** to use a result as another reference.

## Multi-image editing with tags

Every image in the Edit tray gets a colored tag: `@image1`, `@image2`, and so on, in tray order. Refer to the images by tag in the prompt:

> Place `@image1` sitting on the sofa in `@image2`, keep the room and its daylight unchanged

- **Type `@`** in the prompt to open a picker with each image's thumbnail. Use ↑/↓ and Enter, or click. You can also click an image's badge, or the chips under the prompt, to insert its tag at the cursor.
- **Tags are highlighted** in their image's color. A tag with no matching image is flagged in red and blocks generation.
- **Label each image** ("What is it?", e.g. "the fox"). FLUX.2 [klein]'s text encoder never sees the images, so a tag on its own is just a word to the model. The app spells each label out next to its tag's first mention, e.g. `@image1 (the fox)`, which helps the model match words to pictures. "Sent to the model" under the prompt shows the exact text.
- **Remove or reorder** an image (hover its thumbnail) and the tags already in the prompt are renumbered to match. Mentions of a removed image become plain "image", so they never silently point at a different picture.
- An image the prompt doesn't mention is drawn with a dashed border. It's still used as a reference.

### Combine into one, or edit each separately

With two or more images, choose what the edit does:

- **Combine into one:** the images are merged into a single result (FLUX.2 multi-reference fusion, `init_images`). Use tags to say what comes from where, for example "the fox from `@image1` on the sofa from `@image2`".
- **Edit each separately:** the same prompt runs on every image in turn (a plain edit, `init_image`), giving one result per image. Tags aren't needed; any tags become "the image", so "a red background in `@image1` and `@image2`" is sent as "a red background in the image" for each one. With "Match each image", every result keeps its own aspect ratio.

A single image is always sent as a plain FLUX.2 edit (`init_image`). In Combine mode each reference adds its full latent to the attention context, so time grows with every image. On an M4, a 512×512 edit with two references takes about 1.5 minutes.

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

## Security

- **No network at runtime:** once the models are cached, loading, generating and editing open no internet connections. The first model download uses QVAC's registry and peer-to-peer network.
- **Locked-down window:** renderer sandbox and context isolation are on, Node.js integration is off, and a strict Content Security Policy is set. The window can't navigate away from the app, open pop-ups, or embed `<webview>`. Links open in the browser only if they're `https:`. Camera, microphone, notifications and every other permission are denied.
- **Validated IPC:** the main process accepts requests only from the app's own page and validates every field: prompt length, image count and size, output size, steps, guidance and seed (`src/main/validate.ts`, tested by `npm test`).
- **Hardened binary:** Electron fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and the inspector flags. The `file://` privileges fuse stays on because the UI loads from `file://`.

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

Unit tests for the tag helpers:

```bash
npm test
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

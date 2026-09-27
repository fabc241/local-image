// Image helpers for the renderer: normalise any browser-decodable image to
// compact JPEG bytes the diffusion addon can read, and pick FLUX-friendly
// output sizes.

export interface SourceImage {
  bytes: Uint8Array
  url: string
  width: number
  height: number
  name: string
}

// FLUX latents are 8x downsampled and 2x2 patchified, so sides must be
// multiples of 16 to avoid padding artifacts.
const SIDE_MULTIPLE = 16
// The SDK validates init_image with a base64 regex that overflows V8's stack
// above ~5 MB of base64, so the reference image is capped at 1024 px and sent
// as JPEG (well under 1 MB). FLUX.2 resizes references internally anyway.
const MAX_SOURCE_SIDE = 1024
const JPEG_QUALITY = 0.95

export function snapSide(n: number): number {
  return Math.max(SIDE_MULTIPLE * 16, Math.round(n / SIDE_MULTIPLE) * SIDE_MULTIPLE)
}

// Output size for an edit: keep the source aspect ratio with the longest side
// at `longSide` (callers cap it so small inputs aren't upscaled).
export function fitAspect(width: number, height: number, longSide: number): [number, number] {
  const scale = longSide / Math.max(width, height)
  return [snapSide(width * scale), snapSide(height * scale)]
}

export async function loadSourceImage(file: Blob, name: string): Promise<SourceImage> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_SOURCE_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0, width, height)
    // JPEG has no alpha: paint transparent areas white instead of black.
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('JPEG encode failed'))),
        'image/jpeg',
        JPEG_QUALITY
      )
    )
    const bytes = new Uint8Array(await blob.arrayBuffer())
    return { bytes, url: URL.createObjectURL(blob), width, height, name }
  } finally {
    bitmap.close()
  }
}

export function pngToUrl(png: Uint8Array): string {
  return URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`
  return `${(n / 1e3).toFixed(0)} KB`
}

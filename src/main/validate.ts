// Validation for everything the renderer sends over IPC. The renderer is the
// app's own page, but the main process still treats its input as untrusted.
// Kept free of Electron imports so it can be unit-tested with plain Node.
import { MAX_REFERENCE_IMAGES, type GenerateRequest } from '../shared/types.ts'

export const LIMITS = {
  promptChars: 2000,
  minSide: 256,
  maxSide: 1024,
  sideMultiple: 8, // required by the diffusion request schema
  maxSteps: 50,
  minGuidance: 1,
  maxGuidance: 10,
  maxSeed: 2 ** 31 - 1,
  maxImageBytes: 3 * 1024 * 1024, // the SDK's base64 check overflows above ~5 MB
  maxFileNameChars: 120
}

export class InvalidRequestError extends Error {}

function fail(message: string): never {
  throw new InvalidRequestError(message)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function integer(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    fail(`${name} must be an integer between ${min} and ${max}`)
  }
  return v
}

function side(v: unknown, name: string): number {
  const n = integer(v, name, LIMITS.minSide, LIMITS.maxSide)
  if (n % LIMITS.sideMultiple !== 0) fail(`${name} must be a multiple of ${LIMITS.sideMultiple}`)
  return n
}

function imageBytes(v: unknown, name: string): Uint8Array {
  if (!(v instanceof Uint8Array)) fail(`${name} must be image bytes`)
  if (v.byteLength === 0) fail(`${name} is empty`)
  if (v.byteLength > LIMITS.maxImageBytes) fail(`${name} is too large; use one under 3 MB`)
  return v
}

// Returns a clean copy of a generate request, or throws InvalidRequestError.
export function parseGenerateRequest(raw: unknown): GenerateRequest {
  if (!isRecord(raw)) fail('Invalid request')
  const { prompt, initImages, width, height, steps, guidance, seed } = raw

  if (typeof prompt !== 'string' || prompt.trim().length === 0) fail('The prompt is empty')
  if (prompt.length > LIMITS.promptChars)
    fail(`The prompt is longer than ${LIMITS.promptChars} characters`)

  let images: Uint8Array[] = []
  if (initImages !== undefined) {
    if (!Array.isArray(initImages)) fail('initImages must be a list of images')
    if (initImages.length > MAX_REFERENCE_IMAGES)
      fail(`Use at most ${MAX_REFERENCE_IMAGES} reference images`)
    images = initImages.map((img, i) => imageBytes(img, `@image${i + 1}`))
  }

  if (
    typeof guidance !== 'number' ||
    !Number.isFinite(guidance) ||
    guidance < LIMITS.minGuidance ||
    guidance > LIMITS.maxGuidance
  ) {
    fail(`guidance must be between ${LIMITS.minGuidance} and ${LIMITS.maxGuidance}`)
  }

  return {
    prompt,
    initImages: images,
    width: side(width, 'width'),
    height: side(height, 'height'),
    steps: integer(steps, 'steps', 1, LIMITS.maxSteps),
    guidance,
    seed: integer(seed, 'seed', -1, LIMITS.maxSeed)
  }
}

// Validates the PNG bytes and suggested file name for "Save PNG…". The name
// only pre-fills the save dialog; the user picks the final location.
export function parseSaveRequest(
  png: unknown,
  suggestedName: unknown
): { png: Uint8Array; name: string } {
  if (!(png instanceof Uint8Array) || png.byteLength === 0) fail('Nothing to save')
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!PNG_SIGNATURE.every((b, i) => png[i] === b)) fail('Only PNG images can be saved')
  const base = typeof suggestedName === 'string' ? suggestedName : ''
  // Keep a bare file name: no directories, no control or reserved characters.
  const clean = base
    .replace(/^.*[/\\]/, '')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/^\.+/, '')
    .slice(0, LIMITS.maxFileNameChars)
    .trim()
  const name = clean
    ? clean.toLowerCase().endsWith('.png')
      ? clean
      : `${clean}.png`
    : 'local-image.png'
  return { png, name }
}

// Only web links leave the app, and only to the default browser.
export function isAllowedExternalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.username === '' && u.password === ''
  } catch {
    return false
  }
}

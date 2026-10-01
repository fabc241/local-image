// Unit tests for IPC input validation: npm test
import assert from 'node:assert/strict'
import {
  InvalidRequestError,
  LIMITS,
  isAllowedExternalUrl,
  parseGenerateRequest,
  parseSaveRequest
} from '../src/main/validate.ts'

const ok = { prompt: 'a cat', width: 768, height: 512, steps: 4, guidance: 3.5, seed: -1 }
const rejects = (raw: unknown, why: RegExp): void =>
  assert.throws(
    () => parseGenerateRequest(raw),
    (e: unknown) => e instanceof InvalidRequestError && why.test(e.message)
  )

// valid requests pass and are copied
const parsed = parseGenerateRequest({
  ...ok,
  extra: 'ignored',
  initImages: [new Uint8Array([1, 2, 3])]
})
assert.deepEqual(Object.keys(parsed).sort(), [
  'guidance',
  'height',
  'initImages',
  'prompt',
  'seed',
  'steps',
  'width'
])
assert.equal(parsed.initImages!.length, 1)
assert.equal(parseGenerateRequest(ok).initImages!.length, 0)

// malformed or hostile requests are rejected
rejects(null, /Invalid request/)
rejects('prompt', /Invalid request/)
rejects({ ...ok, prompt: '   ' }, /empty/)
rejects({ ...ok, prompt: 42 }, /empty/)
rejects({ ...ok, prompt: 'x'.repeat(LIMITS.promptChars + 1) }, /longer/)
rejects({ ...ok, width: 100000 }, /width/)
rejects({ ...ok, height: 64 }, /height/)
rejects({ ...ok, width: 770 }, /multiple of 8/)
rejects({ ...ok, width: 512.5 }, /width/)
rejects({ ...ok, steps: 0 }, /steps/)
rejects({ ...ok, steps: 1e9 }, /steps/)
rejects({ ...ok, guidance: Number.NaN }, /guidance/)
rejects({ ...ok, guidance: 99 }, /guidance/)
rejects({ ...ok, seed: -5 }, /seed/)
rejects({ ...ok, seed: '1' }, /seed/)
rejects({ ...ok, initImages: 'not a list' }, /list/)
rejects(
  {
    ...ok,
    initImages: [
      new Uint8Array(1),
      new Uint8Array(1),
      new Uint8Array(1),
      new Uint8Array(1),
      new Uint8Array(1)
    ]
  },
  /at most 4/
)
rejects({ ...ok, initImages: ['base64string'] }, /image bytes/)
rejects({ ...ok, initImages: [new Uint8Array(0)] }, /empty/)
rejects({ ...ok, initImages: [new Uint8Array(LIMITS.maxImageBytes + 1)] }, /too large/)

// saving: PNG only, bare file names
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
assert.equal(parseSaveRequest(png, 'local-image-create-11.png').name, 'local-image-create-11.png')
assert.equal(parseSaveRequest(png, '../../Library/LaunchAgents/evil.plist').name, 'evil.plist.png')
assert.equal(parseSaveRequest(png, '/etc/passwd').name, 'passwd.png')
assert.equal(parseSaveRequest(png, '..\\..\\x').name, 'x.png')
assert.equal(parseSaveRequest(png, '.hidden').name, 'hidden.png')
assert.equal(parseSaveRequest(png, 42).name, 'local-image.png')
assert.throws(() => parseSaveRequest(new Uint8Array([1, 2, 3]), 'a.png'), /Only PNG/)
assert.throws(() => parseSaveRequest('data', 'a.png'), /Nothing to save/)

// external links: https only
assert.equal(isAllowedExternalUrl('https://github.com/fabc241/local-image'), true)
for (const bad of [
  'http://example.com',
  'file:///etc/passwd',
  'javascript:alert(1)',
  'smb://host/share',
  'x-apple.systempreferences:',
  'https://user:pw@example.com',
  'not a url'
]) {
  assert.equal(isAllowedExternalUrl(bad), false, bad)
}

console.log('all validation tests passed')

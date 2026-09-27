// Unit tests for the @imageN tag helpers: npm test
import assert from 'node:assert/strict'
import { renumberAfterRemoval, renumberAfterMove, expandPrompt, unknownTags, activeTagQuery, segmentPrompt } from '../src/renderer/src/tags.ts'
const p = 'Put @image1 on @image2 next to @image3'
assert.equal(renumberAfterRemoval(p, 0), 'Put image on @image1 next to @image2')
assert.equal(renumberAfterRemoval(p, 1), 'Put @image1 on image next to @image2')
assert.equal(renumberAfterMove(p, 0, 2), 'Put @image3 on @image1 next to @image2')
assert.equal(renumberAfterMove(p, 2, 0), 'Put @image2 on @image3 next to @image1')
assert.equal(renumberAfterMove(p, 0, 1), 'Put @image2 on @image1 next to @image3')
assert.equal(expandPrompt('Place @image1 in @image2 , keep @image1 small', ['the fox', 'the room']), 'Place @image1 (the fox) in @image2 (the room), keep @image1 small')
assert.equal(expandPrompt('@image1 x', ['']), '@image1 x')
assert.deepEqual(unknownTags('a @image1 b @image5 c @image5', 2), ['@image5'])
assert.deepEqual(activeTagQuery('Place @im', 9), { start: 6, query: 'im' })
assert.equal(activeTagQuery('mail me@home', 12), null)
assert.equal(activeTagQuery('Place @image1 on', 16), null)
assert.equal(segmentPrompt('a @image1 b', 1).filter(s => s.ref !== undefined).length, 1)
console.log('all tag tests passed')

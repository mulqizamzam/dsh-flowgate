import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateEvidenceBlock } from '../lib/evidence.js'

const COMPLETE_BLOCK = [
  '## EVIDENCE',
  'FACTS:',
  '  - npm test exits 0 with 41 tests passing',
  'ASSUMPTIONS:',
  '  - the host loader matches the published rc package',
  'PROOF:',
  '  - ran npm test, output pasted above',
  'UNKNOWN:',
  '  - whether the live host catalog resolves the same skills',
  'DECISION:',
  '  - chose the published package over a checkout import',
].join('\n')

test('a complete evidence block validates', () => {
  assert.deepEqual(validateEvidenceBlock(`Some stage output.\n\n${COMPLETE_BLOCK}`), [
    'FACTS', 'ASSUMPTIONS', 'PROOF', 'UNKNOWN', 'DECISION',
  ])
})

test('a block whose fields are written as none validates', () => {
  const block = [
    '## EVIDENCE',
    'FACTS:',
    '  - none',
    'ASSUMPTIONS:',
    '  - none',
    'PROOF:',
    '  - none',
    'UNKNOWN:',
    '  - none',
    'DECISION:',
    '  - none',
  ].join('\n')
  assert.doesNotThrow(() => validateEvidenceBlock(block))
})

test('a missing evidence block is rejected', () => {
  assert.throws(() => validateEvidenceBlock('Stage output with no evidence block at all.'), /no "## EVIDENCE" heading/)
})

test('a missing field is rejected', () => {
  const block = [
    '## EVIDENCE',
    'FACTS:',
    '  - one fact',
    'ASSUMPTIONS:',
    '  - one assumption',
    'PROOF:',
    '  - one proof',
    'UNKNOWN:',
    '  - one unknown',
  ].join('\n')
  assert.throws(() => validateEvidenceBlock(block), /evidence block incomplete/)
})

test('an out-of-order field is rejected', () => {
  const block = [
    '## EVIDENCE',
    'FACTS:',
    '  - one fact',
    'PROOF:',
    '  - one proof',
    'ASSUMPTIONS:',
    '  - one assumption',
    'UNKNOWN:',
    '  - one unknown',
    'DECISION:',
    '  - one decision',
  ].join('\n')
  assert.throws(() => validateEvidenceBlock(block), /evidence block out of order/)
})

test('an empty evidence block is rejected', () => {
  assert.throws(() => validateEvidenceBlock('## EVIDENCE\n'), /evidence block incomplete/)
})

test('fields after the block heading ends do not count', () => {
  const block = [
    '## EVIDENCE',
    'FACTS:',
    '  - one fact',
    'ASSUMPTIONS:',
    '  - one assumption',
    '## SOMETHING ELSE',
    'PROOF:',
    '  - smuggled proof',
    'UNKNOWN:',
    '  - smuggled unknown',
    'DECISION:',
    '  - smuggled decision',
  ].join('\n')
  assert.throws(() => validateEvidenceBlock(block), /evidence block incomplete/)
})

test('a duplicated field is rejected', () => {
  const block = [
    '## EVIDENCE',
    'FACTS:',
    '  - one fact',
    'FACTS:',
    '  - a second fact',
    'ASSUMPTIONS:',
    '  - one assumption',
    'PROOF:',
    '  - one proof',
    'UNKNOWN:',
    '  - one unknown',
    'DECISION:',
    '  - one decision',
  ].join('\n')
  assert.throws(() => validateEvidenceBlock(block), /evidence block incomplete/)
})

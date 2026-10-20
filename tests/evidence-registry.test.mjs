import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateEvidenceBlock } from '../lib/evidence.js'
import { loadArtifactFields, parseStageOutput, validateArtifactStructure } from '../lib/artifact.js'
import { EVIDENCE_STATUSES, buildEvidenceRecord, evidenceStatus } from '../lib/registry.js'
import {
  LOGIN_COMMAND,
  recordDiagnosis,
  recordIntent,
  recordProof,
  recordSpec,
  sliceText,
  startRun,
} from './helpers.mjs'

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

function evidenceRecord(overrides = {}) {
  return buildEvidenceRecord({
    evidence_id: 'ev-001',
    contract_evidence_id: 'repro_observed',
    evidence_type: 'command_execution',
    supports: ['REPRO'],
    provenance: { kind: 'observed_command', observation_id: 'obs-001', command: 'node --test' },
    observed: { result: 'fail', excerpt: '1 failing assertion' },
    binds_to: [{ ref: 'input:user-request', digest: 'sha256:req' }],
    validation: { method: 'observed_command_match', ok: true, errors: [] },
    producer: { stage: 'recover', attempt_id: 'att-001' },
    now: '2026-01-01T00:00:00.000Z',
    ...overrides,
  })
}

const FIELDS = loadArtifactFields()

function diagnosisWithEvidence(block) {
  return [
    'DIAGNOSIS',
    'SYMPTOM: login returns 500',
    'REPRO: node --test fails',
    'ROOT_CAUSE: the serializer drops the user id',
    'FIX: none recorded yet',
    'PREVENTION: a regression test',
    'CONFIDENCE: high',
    '',
    block,
  ].join('\n')
}

test('an evidence field may carry its content on continuation lines', () => {
  const text = diagnosisWithEvidence([
    '## EVIDENCE',
    'FACTS:',
    '  - the login route returns 500',
    '  - the failure reproduces on demand',
    'ASSUMPTIONS:',
    '  - none',
    'PROOF:',
    '  - node --test tests/login.test.mjs exits 1',
    'UNKNOWN:',
    '  - none',
    'DECISION:',
    '  - record the reproduction before touching the serializer',
  ].join('\n'))
  const parsed = parseStageOutput(text, 'Diagnosis')
  assert.notEqual(parsed, undefined)
  const result = validateArtifactStructure(parsed, FIELDS.fields.Diagnosis)
  assert.deepEqual(result.errors, [])
  assert.equal(parsed.evidence.FACTS, 'the login route returns 500 the failure reproduces on demand')
  assert.equal(parsed.evidence.ASSUMPTIONS, 'none')
})

test('a field with neither an inline value nor continuation lines is still empty', () => {
  const text = diagnosisWithEvidence([
    '## EVIDENCE',
    'FACTS:',
    'ASSUMPTIONS:',
    '  - none',
    'PROOF:',
    '  - node --test exits 1',
    'UNKNOWN:',
    '  - none',
    'DECISION:',
    '  - record it',
  ].join('\n'))
  const parsed = parseStageOutput(text, 'Diagnosis')
  const result = validateArtifactStructure(parsed, FIELDS.fields.Diagnosis)
  assert.equal(result.errors.some(error => /evidence field "FACTS" is empty/.test(error.message)), true, JSON.stringify(result.errors))
})

test('an evidence record requires provenance and is rejected with an unknown status', () => {
  const evidence = evidenceRecord()
  assert.equal(evidence.provenance.kind, 'observed_command')
  assert.equal(evidence.provenance.observation_id, 'obs-001')
  assert.equal(evidence.observed.result, 'fail')
  assert.equal(evidence.status, 'current')
  assert.deepEqual(evidence.binds_to, [{ ref: 'input:user-request', digest: 'sha256:req' }])
  assert.deepEqual([...EVIDENCE_STATUSES], ['missing', 'current', 'stale', 'needs_revalidation', 'invalid'])
  assert.throws(() => evidenceRecord({ status: 'probably-fine' }), error => {
    assert.equal(error.code, 'EVIDENCE_RECORD_INVALID')
    assert.match(error.message, /unknown status/)
    return true
  })
  const long = evidenceRecord({ observed: { result: 'fail', excerpt: 'x'.repeat(4096) } })
  assert.equal(Buffer.byteLength(long.observed.excerpt, 'utf8') <= 2048, true, 'the excerpt is bounded')
})

test('evidence status is decided by validation and accepted provenance together', () => {
  assert.equal(evidenceStatus({ validation: { ok: false }, acceptedProvenance: ['observed_command'], provenanceKind: 'observed_command' }), 'invalid')
  assert.equal(evidenceStatus({ validation: { ok: true }, acceptedProvenance: ['observed_command'], provenanceKind: 'agent_statement' }), 'needs_revalidation')
  assert.equal(evidenceStatus({ validation: { ok: true }, acceptedProvenance: ['agent_statement'], provenanceKind: 'agent_statement' }), 'current')
})

test('an observed declaration upgrades provenance and binds to the produced artifact', async () => {
  const { controller, run } = await startRun()
  recordIntent(controller, run)
  const result = recordDiagnosis(controller, run)
  assert.equal(result.gate, 'passed')
  const stored = controller.status(run.run_id)
  const repro = stored.evidence.filter(entry => entry.contract_evidence_id === 'repro_observed').at(-1)
  assert.equal(repro.provenance.kind, 'observed_command')
  assert.equal(repro.provenance.command, LOGIN_COMMAND)
  assert.equal(repro.provenance.observation_id !== null, true)
  assert.equal(repro.status, 'current')
  const artifact = stored.artifacts.find(entry => entry.artifact_id === repro.binds_to.at(-1).ref.split(':').at(-1))
  assert.equal(repro.binds_to.at(-1).digest, artifact.digest)
  assert.equal(repro.binds_to[0].ref, 'input:user-request')
  assert.equal(repro.binds_to[0].digest, stored.request.digest)
})

test('an unobserved command declaration cannot satisfy an observed-only requirement', async () => {
  const { controller, run } = await startRun({ request: 'add a health endpoint' })
  recordIntent(controller, run)
  recordSpec(controller, run)
  const slice = controller.recordStageOutput(run.run_id, sliceText({
    records: [{ id: 'slices_recorded', type: 'declared_evidence', result: 'declared' }],
  }))
  assert.equal(slice.gate, 'passed')
  const proof = recordProof(controller, run, { withoutObservations: true })
  assert.equal(proof.gate, 'blocked')
  assert.deepEqual(proof.reasons.map(reason => reason.code), ['EVIDENCE_IMPACT_UNKNOWN'])
  const stored = controller.status(run.run_id)
  const declared = stored.evidence.filter(entry => entry.provenance.kind === 'agent_statement' && entry.evidence_type === 'test_execution')
  assert.equal(declared.length, 2)
  for (const entry of declared) assert.equal(entry.status, 'needs_revalidation', entry.evidence_id)
})

test('a declared result that contradicts the observation is invalid', async () => {
  const { controller, run } = await startRun()
  recordIntent(controller, run)
  const result = recordDiagnosis(controller, run, {
    reproResult: 'pass',
    records: [
      { id: 'repro_observed', type: 'command_execution', command: LOGIN_COMMAND, result: 'fail' },
      { id: 'root_cause_recorded', type: 'artifact_inspection', result: 'declared' },
    ],
  })
  assert.equal(result.gate, 'blocked')
  assert.deepEqual(result.reasons.map(reason => reason.code), ['EVIDENCE_INVALID'])
  const stored = controller.status(run.run_id)
  const repro = stored.evidence.filter(entry => entry.contract_evidence_id === 'repro_observed').at(-1)
  assert.equal(repro.validation.ok, false)
  assert.equal(repro.status, 'invalid')
  assert.match(repro.validation.errors[0].message, /declared "fail" but the observed command result was "pass"/)
})

test('a missing evidence declaration blocks the gate instead of passing it', async () => {
  const { controller, run } = await startRun({ request: 'add a health endpoint' })
  recordIntent(controller, run)
  const result = recordSpec(controller, run, { withoutDeclaration: true })
  assert.equal(result.recorded, true)
  assert.equal(result.gate, 'blocked')
  assert.deepEqual(result.reasons.map(reason => reason.code), ['EVIDENCE_MISSING'])
})

test('existing evidence becomes stale when its bound inputs change', async () => {
  const { controller, run } = await startRun()
  recordIntent(controller, run)
  recordDiagnosis(controller, run)
  const before = controller.status(run.run_id)
  assert.ok(before.evidence.every(entry => entry.status === 'current'))
  controller.applyChange(run.run_id, { changed: 'input:user-request', reason: 'the request was revised' })
  const after = controller.status(run.run_id)
  assert.ok(after.evidence.length >= 3)
  assert.ok(after.evidence.some(entry => entry.status !== 'current'), 'a bound input change must not leave evidence current')
  for (const entry of after.evidence) {
    assert.equal(['current', 'stale', 'needs_revalidation', 'invalid'].includes(entry.status), true, entry.status)
    assert.equal(entry.freshness_reason === null, entry.status === 'current')
  }
})

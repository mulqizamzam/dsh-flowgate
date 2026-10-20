import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ARTIFACT_STATUSES,
  bindingsDiffer,
  buildArtifactRecord,
  findArtifact,
  latestArtifactOfType,
  revalidateArtifact,
} from '../lib/registry.js'
import { recordIntent, startRun } from './helpers.mjs'

const AT = '2026-01-01T00:00:00.000Z'

function record(overrides = {}) {
  return buildArtifactRecord({
    artifact_id: 'art-001',
    artifact_type: 'Intent',
    producer: { stage: 'intent', attempt_id: 'att-001' },
    content: 'INTENT\nGOAL: the login is diagnosed\n',
    inputs: [],
    validation: { ok: true, checks: [{ id: 'intent_fields', ok: true, detail: null }], errors: [] },
    now: AT,
    ...overrides,
  })
}

test('an artifact record carries its identity, version, digest, and validation facts', () => {
  const artifact = record()
  assert.equal(artifact.artifact_id, 'art-001')
  assert.equal(artifact.artifact_type, 'Intent')
  assert.equal(artifact.schema_version, 1)
  assert.equal(artifact.status, 'valid')
  assert.equal(artifact.freshness.status, 'current')
  assert.match(artifact.digest, /^sha256:[0-9a-f]{64}$/)
  assert.equal(artifact.content_bytes, Buffer.byteLength(artifact.content, 'utf8'))
  assert.equal(artifact.validation.ok, true)
  assert.equal(artifact.validation.checks.length, 1)
  assert.equal(artifact.validated_at, AT)
})

test('presence is not validity: a failed validation yields invalid, never present', () => {
  const failed = record({ validation: { ok: false, checks: [{ id: 'intent_fields', ok: false, detail: 'missing GOAL' }], errors: [{ path: '#/GOAL', message: 'missing' }] } })
  assert.equal(failed.status, 'invalid')
  assert.equal(failed.validated_at, null)
  assert.equal(failed.validation.ok, false)

  const present = record({ validation: { ok: false, checks: [], errors: [] }, status: 'present' })
  assert.equal(present.status, 'present')
  assert.equal(present.validation.ok, false)
})

test('an unknown artifact status is rejected with a stable code', () => {
  assert.throws(() => record({ status: 'nearly-valid' }), error => {
    assert.equal(error.code, 'ARTIFACT_SCHEMA_INVALID')
    assert.match(error.message, /unknown status/)
    return true
  })
  assert.deepEqual([...ARTIFACT_STATUSES], ['missing', 'present', 'valid', 'invalid'])
})

test('an oversized artifact record is rejected rather than truncated', () => {
  assert.throws(() => record({ content: 'x'.repeat(65537) }), error => {
    assert.equal(error.code, 'ARTIFACT_SCHEMA_INVALID')
    assert.match(error.message, /over the 65536 byte record limit/)
    return true
  })
})

test('revalidation keeps identity and digest while updating the verdict', () => {
  const artifact = record()
  const next = revalidateArtifact(artifact, { ok: false, checks: [{ id: 'intent_fields', ok: false, detail: 'GOAL removed' }], errors: [] }, '2026-01-01T00:01:00.000Z')
  assert.equal(next.artifact_id, artifact.artifact_id)
  assert.equal(next.digest, artifact.digest)
  assert.equal(next.created_at, artifact.created_at)
  assert.equal(next.status, 'invalid')
  assert.equal(next.validation.ok, false)
  assert.equal(next.validated_at, '2026-01-01T00:01:00.000Z')
})

test('a content change produces a different digest; identical content does not', () => {
  assert.equal(record().digest, record().digest)
  assert.notEqual(record({ content: 'INTENT\nGOAL: something else\n' }).digest, record().digest)
})

test('the registry finds records by id and by the latest artifact of a type', () => {
  const run = { artifacts: [record({ artifact_id: 'art-001' }), record({ artifact_id: 'art-002' })] }
  assert.equal(findArtifact(run, 'art-002').artifact_id, 'art-002')
  assert.equal(findArtifact(run, 'art-404'), undefined)
  assert.equal(latestArtifactOfType(run, 'Intent').artifact_id, 'art-002')
  assert.equal(latestArtifactOfType(run, 'Spec'), undefined)
})

test('a binding change is detected by ref and digest', () => {
  const artifact = record({ inputs: [{ ref: 'input:user-request', digest: 'sha256:aaa' }] })
  assert.equal(bindingsDiffer(artifact, [{ ref: 'input:user-request', digest: 'sha256:aaa' }]), false)
  assert.equal(bindingsDiffer(artifact, [{ ref: 'input:user-request', digest: 'sha256:bbb' }]), true)
  assert.equal(bindingsDiffer(artifact, [{ ref: 'artifact:Intent:art-000', digest: 'sha256:aaa' }]), true)
  assert.equal(bindingsDiffer(artifact, []), true)
})

test('a valid stage artifact is recorded as valid with schema-bound inputs', async () => {
  const { controller, run } = await startRun()
  const result = recordIntent(controller, run)
  assert.equal(result.gate, 'passed')
  const stored = controller.status(run.run_id)
  const artifact = stored.artifacts.at(-1)
  assert.match(artifact.artifact_id, /^art-[a-z0-9-]+$/)
  assert.equal(artifact.artifact_type, 'Intent')
  assert.equal(artifact.status, 'valid')
  assert.equal(artifact.freshness.status, 'current')
  assert.equal(artifact.producer.stage, 'intent')
  assert.equal(artifact.inputs[0].ref, 'input:user-request')
  assert.equal(artifact.inputs[0].digest, stored.request.digest)
  assert.equal(artifact.evidence_ids.length, 1)
})

test('an artifact missing a required field is recorded invalid and fails its gate', async () => {
  const { controller, run } = await startRun()
  const result = controller.recordStageOutput(run.run_id, [
    'INTENT',
    'GOAL: the login is diagnosed',
    'NON_GOALS: none',
    'UNKNOWNS: none',
    '',
    '## EVIDENCE',
    'FACTS: none',
    'ASSUMPTIONS: none',
    'PROOF: none',
    'UNKNOWN: none',
    'DECISION: none',
  ].join('\n'))
  assert.equal(result.gate, 'failed')
  assert.equal(result.reasons[0].code, 'ARTIFACT_SCHEMA_INVALID')
  const stored = controller.status(run.run_id)
  assert.equal(stored.artifacts.at(-1).status, 'invalid')
  assert.equal(stored.artifacts.at(-1).validation.ok, false)
  assert.equal(stored.status, 'failed')
})

test('a present-but-unvalidated artifact can never pass a gate', async () => {
  const { controller, run } = await startRun()
  recordIntent(controller, run)
  const stored = controller.load(run.run_id)
  stored.artifacts[0].status = 'present'
  controller.recomputeGates(stored, '2026-01-01T00:10:00.000Z')
  const gate = stored.gates.find(entry => entry.stage === 'intent')
  assert.equal(gate.status, 'failed')
  assert.equal(gate.reasons[0].code, 'ARTIFACT_SCHEMA_INVALID')
})

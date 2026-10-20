import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkpointIntegrity, planResume, selectLastValid, validateCheckpoint } from '../lib/checkpoint.js'
import { recordDiagnosis, recordIntent, startRun } from './helpers.mjs'

function lastCheckpoint(run) {
  return run.checkpoints.at(-1)
}

test('a passed stage writes a versioned checkpoint that names what it covers', async () => {
  const { controller, run } = await startRun()
  recordIntent(controller, run)
  const stored = controller.status(run.run_id)
  assert.equal(stored.checkpoints.length, 1)
  const checkpoint = lastCheckpoint(stored)
  assert.match(checkpoint.checkpoint_id, /^cp-[a-z0-9-]+$/)
  assert.equal(checkpoint.schema_version, 2)
  assert.equal(checkpoint.run_id, run.run_id)
  assert.equal(checkpoint.workflow.name, 'investigation')
  assert.equal(checkpoint.gates.find(entry => entry.stage === 'intent').status, 'passed')
  assert.deepEqual(checkpoint.pending_stages, ['recover', 'handoff'])
  assert.equal(checkpoint.artifacts.length, 1)
  assert.equal(checkpoint.artifacts[0].artifact_type, 'Intent')
  assert.equal(checkpoint.evidence.length >= 1, true)
  assert.match(checkpoint.dependencies_digest, /^sha256:[0-9a-f]{64}$/)
  assert.match(checkpoint.checksum, /^sha256:[0-9a-f]{64}$/)
  assert.equal(checkpointIntegrity(checkpoint), true)
})

test('every checkpoint of a multi-stage run validates against the live records', async () => {
  const { controller, run, contracts } = await startRun()
  recordIntent(controller, run)
  recordDiagnosis(controller, run)
  const stored = controller.status(run.run_id)
  assert.equal(stored.checkpoints.length, 2)
  for (const checkpoint of stored.checkpoints) {
    const result = validateCheckpoint(stored, checkpoint, { contracts })
    assert.deepEqual(result.reasons, [], checkpoint.checkpoint_id)
    assert.equal(result.valid, true)
  }
})

test('a tampered checkpoint fails its own checksum and is rejected', async () => {
  const { controller, run, contracts } = await startRun()
  recordIntent(controller, run)
  const stored = controller.load(run.run_id)
  const checkpoint = lastCheckpoint(stored)
  checkpoint.gates[0].status = 'failed'
  assert.equal(checkpointIntegrity(checkpoint), false)
  const result = validateCheckpoint(stored, checkpoint, { contracts })
  assert.equal(result.valid, false)
  assert.equal(result.reasons.some(reason => /checksum/.test(reason.message)), true)
})

test('the last valid checkpoint is chosen when the newest one is corrupt', async () => {
  const { controller, run, contracts } = await startRun()
  recordIntent(controller, run)
  recordDiagnosis(controller, run)
  const stored = controller.load(run.run_id)
  const newest = stored.checkpoints.at(-1)
  newest.evidence[0].status = 'stale'
  newest.checksum = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
  const selection = selectLastValid(stored, { contracts })
  assert.equal(selection.checkpoint.checkpoint_id, 'cp-001')
  assert.deepEqual(selection.rejected.map(entry => entry.checkpoint_id), ['cp-002'])
  assert.equal(selection.rejected[0].reasons.length > 0, true)
})

test('a checkpoint whose evidence went stale is no longer valid', async () => {
  const { controller, run, contracts } = await startRun()
  recordIntent(controller, run)
  recordDiagnosis(controller, run)
  controller.applyChange(run.run_id, { changed: 'input:user-request', reason: 'the request was revised' })
  const stored = controller.status(run.run_id)
  const selection = selectLastValid(stored, { contracts })
  assert.equal(selection.checkpoint, null)
  assert.equal(selection.rejected.length, 2)
  const messages = selection.rejected.flatMap(entry => entry.reasons.map(reason => reason.message)).join(' ')
  assert.match(messages, /not current|changed since the checkpoint/)
})

test('resume refuses when no checkpoint can be validated', async () => {
  const { controller, run } = await startRun()
  assert.throws(() => controller.resume(run.run_id), error => {
    assert.equal(error.code, 'RESUME_BLOCKED')
    assert.match(error.message, /no valid checkpoint exists/)
    return true
  })
  recordIntent(controller, run)
  controller.applyChange(run.run_id, { changed: 'input:user-request', reason: 'revised' })
  assert.throws(() => controller.resume(run.run_id), error => {
    assert.equal(error.code, 'RESUME_BLOCKED')
    return true
  })
})

test('resume from the last valid checkpoint continues with the remaining stages only', async () => {
  const { controller, run } = await startRun()
  recordIntent(controller, run)
  const plan = controller.resume(run.run_id)
  assert.equal(plan.checkpoint_id, 'cp-001')
  assert.deepEqual(plan.stages, ['recover', 'handoff'])
  assert.deepEqual(plan.rejected, [])
  const stored = controller.status(run.run_id)
  assert.equal(stored.stages.find(stage => stage.skill === 'recover').attempts.at(-1).state, 'running')
  assert.equal(stored.gates.find(entry => entry.stage === 'recover').status, 'pending')
})

test('a checkpoint does not pin stale evidence as current', async () => {
  const { controller, run, contracts } = await startRun()
  recordIntent(controller, run)
  recordDiagnosis(controller, run)
  const stored = controller.load(run.run_id)
  stored.checkpoints.at(-1).evidence.forEach(entry => { entry.status = 'current' })
  stored.evidence.forEach(entry => { entry.status = 'needs_revalidation' })
  const result = validateCheckpoint(stored, stored.checkpoints.at(-1), { contracts })
  assert.equal(result.valid, false)
  assert.equal(result.reasons.some(reason => /not current/.test(reason.message)), true)
})

test('planResume reports the decision time it used', async () => {
  const { controller, run, contracts } = await startRun()
  recordIntent(controller, run)
  const stored = controller.status(run.run_id)
  const plan = planResume(stored, { contracts, now: '2026-02-02T00:00:00.000Z' })
  assert.equal(plan.decided_at, '2026-02-02T00:00:00.000Z')
  assert.equal(plan.checkpoint.checkpoint_id, 'cp-001')
})

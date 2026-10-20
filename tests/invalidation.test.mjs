import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unresolvedEvidence } from '../lib/invalidation.js'
import { recordDiagnosis, recordIntent, startRun } from './helpers.mjs'

test('a changed input marks every dependent result as needing revalidation', async () => {
  const { controller, run } = await startRun()
  recordIntent(controller, run)
  recordDiagnosis(controller, run)
  const before = controller.status(run.run_id)
  assert.ok(before.evidence.every(entry => entry.status === 'current'))

  const decision = controller.applyChange(run.run_id, { changed: 'input:user-request', reason: 'the request was revised' })
  assert.equal(decision.fingerprint_changed, true)
  assert.equal(['stale', 'revalidate'].includes(decision.policy), true)
  assert.ok(decision.affected.includes('artifact:intent:art-005'), decision.affected.join(' '))
  assert.ok(decision.affected.some(node => node.startsWith('evidence:')))

  const after = controller.status(run.run_id)
  assert.equal(after.invalidations.length, 1)
  assert.ok(after.evidence.every(entry => entry.status !== 'current'), 'no dependent evidence may stay current')
  assert.equal(after.gates.find(entry => entry.stage === 'intent').status, 'blocked')
  assert.equal(after.gates.find(entry => entry.stage === 'recover').status, 'blocked')
  assert.equal(after.status, 'blocked')
})

test('a change outside the declared graph is treated as unknown impact', async () => {
  const { controller, run } = await startRun()
  recordIntent(controller, run)
  const decision = controller.applyChange(run.run_id, { changed: 'artifact:Ghost:art-999', reason: 'unknown source' })
  assert.equal(decision.policy, 'revalidate')
  assert.match(decision.reason, /outside the declared dependency graph/)
  const stored = controller.status(run.run_id)
  assert.ok(stored.evidence.length > 0)
  for (const entry of stored.evidence) assert.equal(entry.status, 'needs_revalidation')
})

test('an unchanged fingerprint retains results and records the decision anyway', async () => {
  const { controller, run } = await startRun()
  recordIntent(controller, run)
  const decision = controller.applyChange(run.run_id, {
    changed: 'input:user-request',
    fingerprintChanged: false,
    reason: 'same bytes',
  })
  assert.equal(decision.policy, 'retain')
  assert.deepEqual(decision.affected, [])
  const stored = controller.status(run.run_id)
  assert.ok(stored.evidence.every(entry => entry.status === 'current'))
  assert.equal(stored.gates.find(entry => entry.stage === 'intent').status, 'passed')
  assert.equal(stored.invalidations.length, 1, 'the decision is recorded even when nothing changes')
})

test('a change affects downstream results and never its own predecessors', async () => {
  const { controller, run } = await startRun()
  recordIntent(controller, run)
  recordDiagnosis(controller, run)
  const decision = controller.applyChange(run.run_id, { changed: 'stage:recover', reason: 'recover was rerun' })
  assert.equal(decision.affected.includes('stage:intent'), false, 'ordering must not travel backwards')
  const stored = controller.status(run.run_id)
  const intentEvidence = stored.evidence.filter(entry => entry.producer.stage === 'intent')
  assert.ok(intentEvidence.length > 0)
  for (const entry of intentEvidence) assert.equal(entry.status, 'current', 'upstream evidence stays current')
  const recoverEvidence = stored.evidence.filter(entry => entry.producer.stage === 'recover')
  assert.ok(recoverEvidence.some(entry => entry.status !== 'current'))
})

test('invalidation decisions accumulate with deterministic ids', async () => {
  const { controller, run } = await startRun()
  recordIntent(controller, run)
  controller.applyChange(run.run_id, { changed: 'input:user-request', reason: 'first' })
  controller.applyChange(run.run_id, { changed: 'stage:intent', reason: 'second' })
  const stored = controller.status(run.run_id)
  assert.deepEqual(stored.invalidations.map(entry => entry.decision_id), ['inv-1', 'inv-2'])
  assert.deepEqual(stored.invalidations.map(entry => entry.reason === undefined, false), [false, false])
  assert.equal(unresolvedEvidence(stored).length, stored.evidence.filter(entry => entry.status !== 'current').length)
})

test('the same change on two identical runs produces the same affected set', async () => {
  const first = await startRun()
  const second = await startRun()
  recordIntent(first.controller, first.run)
  recordIntent(second.controller, second.run)
  const left = first.controller.applyChange(first.run.run_id, { changed: 'input:user-request', reason: 'same' })
  const right = second.controller.applyChange(second.run.run_id, { changed: 'input:user-request', reason: 'same' })
  assert.deepEqual(left.affected, right.affected)
  assert.equal(left.policy, right.policy)
})

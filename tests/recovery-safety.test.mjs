import assert from 'node:assert/strict'
import { test } from 'node:test'
import { digestOf } from '../lib/canonical.js'
import { checkpointIntegrity } from '../lib/checkpoint.js'
import { FlowgateController } from '../lib/controller.js'
import { recordIntent, startRun } from './helpers.mjs'

function patchPolicy(contracts, skill, retryPolicy) {
  return {
    ...contracts,
    contracts: {
      ...contracts.contracts,
      [skill]: {
        ...contracts.contracts[skill],
        side_effects: { ...contracts.contracts[skill].side_effects, retry_policy: retryPolicy },
      },
    },
  }
}

function controllerWith(stack, contracts) {
  return new FlowgateController({
    stateDir: stack.stateDir,
    workflows: stack.workflows,
    contracts,
    artifactFields: stack.artifactFields,
    schemas: stack.schemas,
    now: stack.now,
    ids: stack.ids,
  })
}

function interrupt(run, skill) {
  const attempt = run.stages.find(stage => stage.skill === skill).attempts.at(-1)
  attempt.state = 'running'
  attempt.ended_at = null
  attempt.artifact_ids = []
  attempt.evidence_ids = []
  attempt.checks = []
  return attempt
}

test('a resume may not skip a required stage the checkpoint does not record as pending', async () => {
  const stack = await startRun()
  recordIntent(stack.controller, stack.run)
  const stored = stack.controller.load(stack.run.run_id)
  const checkpoint = stored.checkpoints[0]
  checkpoint.pending_stages = checkpoint.pending_stages.filter(skill => skill !== 'recover')
  const { checksum, ...rest } = checkpoint
  checkpoint.checksum = digestOf(rest)
  assert.equal(checkpointIntegrity(checkpoint), true, 'the tampered checkpoint must still look self-consistent')
  stack.controller.persist(stored)
  assert.throws(() => stack.controller.resume(stored.run_id), error => {
    assert.equal(error.code, 'RESUME_BLOCKED')
    assert.match(error.message, /omits required stage "recover"/)
    return true
  })
})

test('a stage with an unknown side-effect outcome is not retried automatically', async () => {
  const stack = await startRun()
  recordIntent(stack.controller, stack.run)
  const stored = stack.controller.load(stack.run.run_id)
  interrupt(stored, 'recover')
  const before = JSON.stringify(stored)
  const patched = patchPolicy(stack.contracts, 'recover', 'not_retryable')
  const controller = controllerWith(stack, patched)
  assert.throws(() => controller.resume(stored.run_id), error => {
    assert.equal(error.code, 'SIDE_EFFECT_RETRY_DENIED')
    assert.match(error.message, /unknown outcome and retry policy "not_retryable"/)
    return true
  })
  void before
})

test('manual approval is required before retrying a manual_approval_required stage', async () => {
  const stack = await startRun()
  recordIntent(stack.controller, stack.run)
  const stored = stack.controller.load(stack.run.run_id)
  interrupt(stored, 'recover')
  const patched = patchPolicy(stack.contracts, 'recover', 'manual_approval_required')
  const controller = controllerWith(stack, patched)

  assert.throws(() => controller.resume(stored.run_id), error => {
    assert.equal(error.code, 'SIDE_EFFECT_RETRY_DENIED')
    assert.match(error.message, /manual_approval_required/)
    return true
  })

  const approval = controller.grantRetryApproval(stored.run_id, 'recover')
  assert.match(approval.approval_id, /^ap-[a-z0-9-]+$/)
  assert.equal(approval.stage, 'recover')
  assert.equal(approval.kind, 'retry')

  const plan = controller.resume(stored.run_id)
  assert.equal(plan.checkpoint_id, 'cp-001')
  assert.deepEqual(plan.stages, ['research', 'recover', 'handoff'])
  const after = controller.status(stored.run_id)
  assert.equal(after.approvals.length, 1)
  assert.equal(after.approvals[0].stage, 'recover')
})

test('a safe_idempotent stage is resumed without an approval', async () => {
  const stack = await startRun()
  recordIntent(stack.controller, stack.run)
  const stored = stack.controller.load(stack.run.run_id)
  interrupt(stored, 'recover')
  const patched = patchPolicy(stack.contracts, 'recover', 'safe_idempotent')
  const controller = controllerWith(stack, patched)
  const plan = controller.resume(stored.run_id)
  assert.deepEqual(plan.stages, ['research', 'recover', 'handoff'])
  const after = controller.status(stored.run_id)
  assert.equal(after.approvals.length, 0)
})

test('an interrupted attempt is closed as cancelled by resume, never left running', async () => {
  const stack = await startRun()
  recordIntent(stack.controller, stack.run)
  const stored = stack.controller.load(stack.run.run_id)
  interrupt(stored, 'recover')
  const controller = controllerWith(stack, stack.contracts)
  controller.resume(stored.run_id)
  const after = controller.status(stored.run_id)
  const attempts = after.stages.find(stage => stage.skill === 'recover').attempts
  const cancelled = attempts.filter(attempt => attempt.state === 'cancelled')
  assert.equal(cancelled.length, 1)
  assert.match(cancelled[0].reason, /interrupted before its outcome was observed/)
  assert.equal(typeof cancelled[0].ended_at, 'string')
  assert.equal(attempts.at(-1).state, 'running', 'the resumed stage gets a fresh running attempt')
})

test('an approval for a stage that does not exist is refused', async () => {
  const stack = await startRun()
  assert.throws(() => stack.controller.grantRetryApproval(stack.run.run_id, 'ghost'), error => {
    assert.equal(error.code, 'SIDE_EFFECT_RETRY_DENIED')
    return true
  })
})

test('a denied retry leaves the persisted state untouched', async () => {
  const stack = await startRun()
  recordIntent(stack.controller, stack.run)
  const stored = stack.controller.load(stack.run.run_id)
  interrupt(stored, 'recover')
  const patched = patchPolicy(stack.contracts, 'recover', 'not_retryable')
  const controller = controllerWith(stack, patched)
  const before = controller.status(stored.run_id)
  assert.throws(() => controller.resume(stored.run_id), error => error.code === 'SIDE_EFFECT_RETRY_DENIED')
  const after = controller.status(stored.run_id)
  assert.deepEqual(after, before, 'a refused resume must not mutate state')
})

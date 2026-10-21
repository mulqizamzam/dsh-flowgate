import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FlowgateController } from '../lib/controller.js'
import { addAttempt, evaluateStage } from '../lib/state.js'
import { GATE_STATUSES } from '../lib/registry.js'
import { handoffText, intentText, decisionText, researchText, recordDecision, recordDiagnosis, recordIntent, recordHandoff, recordResearch, startRun } from './helpers.mjs'

function gate(run, skill) {
  return run.gates.find(entry => entry.stage === skill)
}

test('every stage starts pending and the run starts running', async () => {
  const { controller, run } = await startRun()
  const stored = controller.status(run.run_id)
  assert.equal(stored.status, 'running')
  assert.equal(stored.gates.length, stored.stages.length)
  for (const entry of stored.gates) {
    assert.equal(entry.status, 'pending', `${entry.stage}: a stage with no attempt must be pending`)
    assert.equal(entry.checked_at, null)
  }
  for (const stage of stored.stages) {
    for (const attempt of stage.attempts) {
      assert.equal(attempt.state, 'running', `${stage.skill}: an opened stage is running, not passed`)
      assert.equal(attempt.ended_at, null)
    }
  }
  assert.deepEqual([...GATE_STATUSES], ['pending', 'passed', 'failed', 'blocked', 'error'])
})

test('an artifact for a later required stage is rejected while its prerequisite is missing', async () => {
  const { controller, run } = await startRun()
  const before = controller.status(run.run_id)
  const result = controller.recordStageOutput(run.run_id, require_text_bundle())
  assert.equal(result.recorded, false)
  assert.equal(result.code, 'STAGE_INPUT_MISSING')
  assert.match(result.message, /required stage "intent" has not passed/)
  const after = controller.status(run.run_id)
  assert.equal(after.artifacts.length, before.artifacts.length, 'a rejected output must not be recorded')
  assert.equal(after.gates.every(entry => entry.status === 'pending'), true)
})

function require_text_bundle() {
  return [
    'DIAGNOSIS',
    'SYMPTOM: any',
    'REPRO: any',
    'ROOT_CAUSE: any',
    'FIX: any',
    'PREVENTION: any',
    'CONFIDENCE: high',
    '',
    '## EVIDENCE',
    'FACTS: none',
    'ASSUMPTIONS: none',
    'PROOF: none',
    'UNKNOWN: none',
    'DECISION: none',
  ].join('\n')
}

test('a missing prerequisite input blocks evaluation with a stable code', async () => {
  const { controller, run, contracts } = await startRun({ request: 'add a health endpoint' })
  const stored = controller.load(run.run_id)
  addAttempt(stored, 'spec', { attemptId: 'att-900', now: '2026-01-01T00:00:00.000Z' })
  const result = evaluateStage(stored, 'spec', { contracts, now: '2026-01-01T00:00:00.000Z' })
  assert.equal(result.status, 'blocked')
  assert.deepEqual(result.reasons.map(reason => reason.code), ['STAGE_INPUT_MISSING'])
  assert.match(result.reasons[0].message, /required input artifact Intent/)
})

test('a failed artifact check fails the gate and stops the run', async () => {
  const { controller, run } = await startRun()
  const result = controller.recordStageOutput(run.run_id, intentText({ fields: { SUCCESS_CRITERIA: '' } }))
  assert.equal(result.gate, 'failed')
  assert.deepEqual(result.reasons.map(reason => reason.code), ['ARTIFACT_SCHEMA_INVALID'])
  const stored = controller.status(run.run_id)
  assert.equal(stored.status, 'failed')
  assert.equal(gate(stored, 'intent').status, 'failed')
})

test('a checker that cannot run turns the gate into error, not failed', async () => {
  const { controller, run, workflows, contracts, artifactFields, schemas, stateDir, now, ids } = await startRun()
  const failed = controller.runCheck({ id: 'impossible', type: 'ghost_check' }, { fieldErrors: [], evidenceBlockError: undefined, evidence: { records: [], errors: [] }, contract: contracts.contracts.intent })
  assert.equal(failed.status, 'error')
  assert.match(failed.detail, /unknown check type/)

  recordIntent(controller, run)
  const stored = controller.load(run.run_id)
  const attempt = stored.stages.find(stage => stage.skill === 'intent').attempts[0]
  attempt.checks = attempt.checks.map(check => ({ ...check, status: 'error', detail: 'the checker threw' }))
  const evaluated = evaluateStage(stored, 'intent', { contracts, now: '2026-01-01T00:10:00.000Z' })
  assert.equal(evaluated.status, 'error')
  assert.deepEqual(evaluated.reasons.map(reason => reason.code), ['VALIDATOR_ERROR'])
  assert.match(evaluated.reasons[0].message, /could not run/)

  const patched = {
    ...contracts,
    contracts: {
      ...contracts.contracts,
      intent: { ...contracts.contracts.intent, checks: [{ id: 'impossible', type: 'ghost_check' }] },
    },
  }
  const broken = new FlowgateController({ stateDir, workflows, contracts: patched, artifactFields, schemas, now, ids })
  const fresh = broken.createRun({
    request: run.request.excerpt,
    sessionId: 'session-test',
    route: {
      scores: run.routing.scores,
      selected: run.routing.selected,
      reason: 'transition-rules fixture',
      fallback: run.routing.fallback,
    },
    workflow: workflows.get(run.workflow.name),
  })
  assert.throws(() => broken.recordStageOutput(fresh.run_id, intentText()), error => {
    assert.equal(error.code, 'VALIDATOR_ERROR')
    assert.match(error.message, /refusing to persist invalid run state/)
    return true
  })
})

test('a gate cannot pass while required evidence is unresolved', async () => {
  const { controller, run, contracts } = await startRun()
  recordIntent(controller, run)
  const stored = controller.load(run.run_id)
  assert.equal(gate(stored, 'intent').status, 'passed')
  stored.evidence[0].status = 'needs_revalidation'
  stored.evidence[0].freshness_reason = 'its bound input changed'
  const result = evaluateStage(stored, 'intent', { contracts, now: '2026-01-01T00:10:00.000Z' })
  assert.equal(result.status, 'blocked')
  assert.deepEqual(result.reasons.map(reason => reason.code), ['EVIDENCE_IMPACT_UNKNOWN'])

  stored.evidence[0].status = 'stale'
  const stale = evaluateStage(stored, 'intent', { contracts, now: '2026-01-01T00:10:00.000Z' })
  assert.deepEqual(stale.reasons.map(reason => reason.code), ['EVIDENCE_STALE'])

  stored.evidence[0].status = 'invalid'
  stored.evidence[0].validation = { method: 'observed_command_match', ok: false, errors: [{ path: '#/result', message: 'mismatch' }] }
  const invalid = evaluateStage(stored, 'intent', { contracts, now: '2026-01-01T00:10:00.000Z' })
  assert.deepEqual(invalid.reasons.map(reason => reason.code), ['EVIDENCE_INVALID'])
})

test('the decide stage passes on a complete artifact with both declared evidence records', async () => {
  const { controller, run } = await startRun({ request: 'add a rate limiter' })
  recordIntent(controller, run)
  const result = recordDecision(controller, run)
  assert.equal(result.recorded, true)
  assert.equal(result.stage, 'decide')
  assert.equal(result.gate, 'passed')
  const stored = controller.status(run.run_id)
  const artifact = stored.artifacts.find(entry => entry.artifact_type === 'Decision')
  assert.equal(artifact.status, 'valid')
  assert.equal(artifact.producer.stage, 'decide')
  const evidence = stored.evidence.filter(entry => entry.producer.stage === 'decide')
  assert.deepEqual(evidence.map(entry => entry.contract_evidence_id).sort(), ['options_recorded', 'rationale_recorded'])
  assert.equal(evidence.every(entry => entry.status === 'current'), true)
})

test('the decide stage fails when a required field is missing', async () => {
  const { controller, run } = await startRun({ request: 'add a rate limiter' })
  recordIntent(controller, run)
  const result = controller.recordStageOutput(run.run_id, decisionText({ fields: { REVISED_BY: '' } }))
  assert.equal(result.gate, 'failed')
  assert.deepEqual(result.reasons.map(reason => reason.code), ['ARTIFACT_SCHEMA_INVALID'])
})

test('the decide stage is blocked until the intent it depends on is valid', async () => {
  const { controller, run, contracts } = await startRun({ request: 'add a rate limiter' })
  const stored = controller.load(run.run_id)
  addAttempt(stored, 'decide', { attemptId: 'att-901', now: '2026-01-01T00:00:00.000Z' })
  const result = evaluateStage(stored, 'decide', { contracts, now: '2026-01-01T00:00:00.000Z' })
  assert.equal(result.status, 'blocked')
  assert.deepEqual(result.reasons.map(reason => reason.code), ['STAGE_INPUT_MISSING'])
  assert.match(result.reasons[0].message, /required input artifact Intent/)
})

test('the research stage passes on a complete artifact with both declared evidence records', async () => {
  const { controller, run } = await startRun({ request: 'add a rate limiter' })
  recordIntent(controller, run)
  const result = recordResearch(controller, run)
  assert.equal(result.recorded, true)
  assert.equal(result.stage, 'research')
  assert.equal(result.gate, 'passed')
  const stored = controller.status(run.run_id)
  const artifact = stored.artifacts.find(entry => entry.artifact_type === 'Research')
  assert.equal(artifact.status, 'valid')
  assert.equal(artifact.producer.stage, 'research')
  const evidence = stored.evidence.filter(entry => entry.producer.stage === 'research')
  assert.deepEqual(evidence.map(entry => entry.contract_evidence_id).sort(), ['claims_graded', 'sources_fetched'])
  assert.equal(evidence.every(entry => entry.status === 'current'), true)
})

test('the research stage fails when a required field is missing', async () => {
  const { controller, run } = await startRun({ request: 'add a rate limiter' })
  recordIntent(controller, run)
  const result = controller.recordStageOutput(run.run_id, researchText({ fields: { SOURCES: '' } }))
  assert.equal(result.gate, 'failed')
  assert.deepEqual(result.reasons.map(reason => reason.code), ['ARTIFACT_SCHEMA_INVALID'])
})

test('the research stage is blocked until both evidence records are declared', async () => {
  const { controller, run } = await startRun({ request: 'add a rate limiter' })
  recordIntent(controller, run)
  const result = controller.recordStageOutput(run.run_id, researchText({
    records: [{ id: 'sources_fetched', type: 'declared_evidence', result: 'declared' }],
  }))
  assert.equal(result.gate, 'blocked')
  assert.deepEqual(result.reasons.map(reason => reason.code), ['EVIDENCE_MISSING'])
  assert.match(result.reasons[0].message, /claims_graded/)
})

test('the research stage is blocked until the intent it depends on is valid', async () => {
  const { controller, run, contracts } = await startRun({ request: 'add a rate limiter' })
  const stored = controller.load(run.run_id)
  addAttempt(stored, 'research', { attemptId: 'att-902', now: '2026-01-01T00:00:00.000Z' })
  const result = evaluateStage(stored, 'research', { contracts, now: '2026-01-01T00:00:00.000Z' })
  assert.equal(result.status, 'blocked')
  assert.deepEqual(result.reasons.map(reason => reason.code), ['STAGE_INPUT_MISSING'])
  assert.match(result.reasons[0].message, /required input artifact Intent/)
})

test('a changed intent marks the research evidence stale', async () => {
  const { controller, run } = await startRun({ request: 'add a rate limiter' })
  recordIntent(controller, run)
  recordResearch(controller, run)
  const intent = controller.status(run.run_id).artifacts.find(entry => entry.artifact_type === 'Intent')
  const decision = controller.applyChange(run.run_id, {
    changed: `artifact:intent:${intent.artifact_id}`,
    reason: 'the intent was rewritten',
  })
  assert.equal(decision.fingerprint_changed, true)
  const stored = controller.status(run.run_id)
  const research = stored.evidence.filter(entry => entry.producer.stage === 'research')
  assert.equal(research.length, 2)
  assert.ok(research.every(entry => entry.status !== 'current'), 'research evidence must not stay current after the intent changed')
  assert.equal(stored.gates.find(entry => entry.stage === 'research').status, 'blocked')
})

test('an attempt records the gate outcome it produced', async () => {
  const { controller, run } = await startRun()
  recordIntent(controller, run)
  recordDiagnosis(controller, run)
  const stored = controller.status(run.run_id)
  const intent = stored.stages.find(stage => stage.skill === 'intent')
  assert.equal(intent.attempts.length, 1)
  assert.equal(intent.attempts[0].state, 'passed')
  assert.deepEqual(intent.attempts[0].gate, { status: 'passed', reasons: [] })
  assert.equal(typeof intent.attempts[0].ended_at, 'string')
  assert.equal(intent.attempts[0].artifact_ids.length, 1)
})

test('completion stays blocked until every required gate passes, then completes', async () => {
  const { controller, run } = await startRun()
  recordIntent(controller, run)
  recordDiagnosis(controller, run)
  let stored = controller.status(run.run_id)
  assert.equal(stored.completion.status, 'pending')
  assert.match(stored.completion.reasons.join(' '), /handoff/)

  const result = recordHandoff(controller, run)
  assert.equal(result.gate, 'passed')
  stored = controller.status(run.run_id)
  assert.equal(stored.status, 'completed')
  assert.equal(stored.completion.status, 'completed')
  assert.match(stored.completion.reasons[0], /all required stages passed with current evidence/)
})

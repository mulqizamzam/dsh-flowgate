import { FlowgateError, CODES } from './errors.js'
import { reviewRequired } from './workflows.js'
import {
  findArtifact,
  latestArtifactOfType,
  latestEvidenceFor,
} from './registry.js'

const DEFAULT_ENFORCEMENT = Object.freeze({
  level: 'validated',
  pre_step: 'available_not_used',
  limitations: [
    'Stage gates are validated by the plugin after the agent reports an artifact; the host does not let a plugin distinguish a prohibited continuation from a remediation step, so the strongest safe control is application validation plus a corrective message.',
  ],
})

/**
 * Create a planned run. Stages are resolved by the workflow resolver; the
 * controller records attempts and gate outcomes against them.
 */
export function createRun({ runId, sessionId = null, request, routing, workflow, contracts, enforcement = DEFAULT_ENFORCEMENT, now, }) {
  const stages = workflow.stages.map((stage, index) => {
    const contract = contracts.contracts[stage.skill]
    if (contract === undefined) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `workflow "${workflow.name}": stage "${stage.skill}" has no contract`)
    }
    return {
      position: index + 1,
      skill: stage.skill,
      artifact: contract.produces[0],
      required: stage.required,
      contract_version: contract.contract_version,
      attempts: [],
    }
  })
  return {
    schema_version: 2,
    engine_version: '2.0.0',
    run_id: runId,
    session_id: sessionId,
    created_at: now,
    updated_at: now,
    request,
    routing,
    workflow: {
      name: workflow.name,
      contract_version: contracts.contract_version,
      stage_count: stages.length,
    },
    enforcement: { ...enforcement },
    status: 'planned',
    stages,
    artifacts: [],
    evidence: [],
    observations: [],
    approvals: [],
    gates: stages.map(stage => ({ stage: stage.skill, status: 'pending', reasons: [], checked_at: null })),
    review: reviewPolicyFor(workflow),
    checkpoints: [],
    invalidations: [],
    errors: [],
    completion: { status: 'pending', reasons: ['run planned; no stage attempt recorded yet'], decided_at: null },
  }
}

export function reviewPolicyFor(workflow) {
  const required = reviewRequired(workflow)
  return {
    required,
    status: required ? 'pending' : 'not_required',
    reason: required
      ? 'the workflow declares the review stage as required'
      : 'the workflow does not require the review stage',
  }
}

export function findStage(run, skill) {
  return run.stages.find(stage => stage.skill === skill)
}

export function stageForArtifact(run, artifactType) {
  return run.stages.find(stage => stage.artifact === artifactType)
}

export function latestAttempt(run, skill) {
  const stage = findStage(run, skill)
  return stage === undefined ? undefined : stage.attempts.at(-1)
}

export function gateFor(run, skill) {
  return run.gates.find(gate => gate.stage === skill)
}

/** Append a new stage attempt; a stage never overwrites its historical attempts. */
export function addAttempt(run, skill, { attemptId, now }) {
  const stage = findStage(run, skill)
  if (stage === undefined) {
    throw new FlowgateError(CODES.CONTRACT_INVALID, `run ${run.run_id}: no stage "${skill}"`)
  }
  const attempt = {
    attempt_id: attemptId,
    state: 'running',
    started_at: now,
    ended_at: null,
    artifact_ids: [],
    evidence_ids: [],
    checks: [],
    gate: { status: 'pending', reasons: [] },
    reason: null,
  }
  stage.attempts.push(attempt)
  run.status = 'running'
  run.updated_at = now
  return attempt
}

/** Start an attempt only when the stage has none and its gate has not passed. */
export function ensureAttempt(run, skill, { attemptId, now }) {
  const existing = latestAttempt(run, skill)
  if (existing !== undefined && ['running', 'validating'].includes(existing.state)) return existing
  if (existing !== undefined && ['passed', 'failed', 'blocked', 'error', 'cancelled'].includes(existing.state)) return existing
  return addAttempt(run, skill, { attemptId, now })
}

export function nextOpenStage(run) {
  return run.stages.find(stage => {
    const gate = gateFor(run, stage.skill)
    return gate.status !== 'passed' && stage.attempts.length === 0
  })
}

export function markOptionalSkipped(run, skill, message, now) {
  const stage = findStage(run, skill)
  if (stage === undefined || stage.required) {
    throw new FlowgateError(CODES.CONTRACT_INVALID, `run ${run.run_id}: cannot skip required stage "${skill}"`)
  }
  const gate = gateFor(run, skill)
  gate.status = 'pending'
  gate.reasons = [{ code: 'STAGE_OPTIONAL_SKIPPED', message }]
  gate.checked_at = now
  run.updated_at = now
}

/** Record a gate outcome and fold it into the attempt that produced it. */
export function setGate(run, skill, gate, now, options = {}) {
  const record = gateFor(run, skill)
  record.status = gate.status
  record.reasons = [...gate.reasons]
  record.checked_at = now
  const attempt = options.updateAttempt === false ? undefined : latestAttempt(run, skill)
  if (attempt !== undefined) {
    attempt.gate = { status: gate.status, reasons: [...gate.reasons] }
    if (gate.status === 'passed') attempt.state = 'passed'
    else if (gate.status === 'failed') attempt.state = 'failed'
    else if (gate.status === 'blocked') attempt.state = 'blocked'
    else if (gate.status === 'error') attempt.state = 'error'
    if (['passed', 'failed', 'blocked', 'error', 'cancelled'].includes(attempt.state) && attempt.ended_at === null) {
      attempt.ended_at = now
    }
  }
  run.updated_at = now
}

/**
 * Evaluate one stage gate from the recorded facts. The evaluation order is the
 * transition policy: a missing prerequisite blocks before artifact criteria are
 * judged; an artifact that does not satisfy its contract fails; evidence that is
 * missing or stale blocks; a checker that could not run errors.
 */
export function evaluateStage(run, skill, { contracts, now }) {
  const stage = findStage(run, skill)
  if (stage === undefined) {
    throw new FlowgateError(CODES.CONTRACT_INVALID, `run ${run.run_id}: no stage "${skill}"`)
  }
  const contract = contracts.contracts[skill]
  const attempt = latestAttempt(run, skill)
  if (attempt === undefined) {
    return { status: 'pending', reasons: [] }
  }

  const missingInputs = contract.requires
    .filter(ref => ref !== 'user-request')
    .filter(ref => {
      const artifact = latestArtifactOfType(run, ref)
      return artifact === undefined || artifact.status !== 'valid' || artifact.freshness.status !== 'current'
    })
  if (missingInputs.length > 0) {
    return {
      status: 'blocked',
      reasons: missingInputs.map(ref => ({
        code: CODES.STAGE_INPUT_MISSING,
        message: `required input artifact ${ref} is missing, invalid, or stale`,
      })),
    }
  }

  const artifact = attempt.artifact_ids
    .map(id => findArtifact(run, id))
    .find(record => record !== undefined && record.artifact_type === stage.artifact)
  if (artifact === undefined) {
    // A stage that was opened but has not produced or validated anything yet is
    // still in progress, not failed. Once it claims a result or records checks,
    // a missing artifact is a real failure.
    if (attempt.artifact_ids.length === 0 && attempt.checks.length === 0) {
      return { status: 'pending', reasons: [] }
    }
    return {
      status: 'failed',
      reasons: [{
        code: CODES.ARTIFACT_MISSING,
        message: `stage ${skill} claimed a result without emitting the ${stage.artifact} artifact`,
      }],
    }
  }
  if (artifact.freshness.status !== 'current') {
    return {
      status: 'blocked',
      reasons: [{
        code: CODES.EVIDENCE_STALE,
        message: `artifact ${artifact.artifact_id} requires revalidation: ${artifact.freshness.reason ?? 'its inputs changed'}`,
      }],
    }
  }
  if (artifact.status !== 'valid' || artifact.validation.ok !== true) {
    return {
      status: 'failed',
      reasons: [{
        code: CODES.ARTIFACT_SCHEMA_INVALID,
        message: `artifact ${artifact.artifact_id} does not satisfy the ${stage.artifact} contract`,
      }],
    }
  }

  for (const requirement of contract.evidence) {
    const record = latestEvidenceFor(run, requirement.id, skill)
    if (record === undefined) {
      return {
        status: 'blocked',
        reasons: [{
          code: CODES.EVIDENCE_MISSING,
          message: `required evidence "${requirement.id}" (${requirement.type}) has not been recorded`,
        }],
      }
    }
    if (record.validation.ok !== true || record.status === 'invalid') {
      return {
        status: 'blocked',
        reasons: [{
          code: CODES.EVIDENCE_INVALID,
          message: `evidence "${requirement.id}" failed validation: ${describeEvidenceErrors(record)}`,
        }],
      }
    }
    if (record.status === 'stale') {
      return {
        status: 'blocked',
        reasons: [{
          code: CODES.EVIDENCE_STALE,
          message: `evidence "${requirement.id}" is stale: ${record.freshness_reason ?? 'its bound inputs changed'}`,
        }],
      }
    }
    if (record.status !== 'current') {
      return {
        status: 'blocked',
        reasons: [{
          code: CODES.EVIDENCE_IMPACT_UNKNOWN,
          message: `evidence "${requirement.id}" cannot be shown current: ${record.freshness_reason ?? record.status}`,
        }],
      }
    }
  }

  const errored = attempt.checks.find(check => check.status === 'error')
  if (errored !== undefined) {
    return {
      status: 'error',
      reasons: [{
        code: CODES.VALIDATOR_ERROR,
        message: `check "${errored.id}" could not run: ${errored.detail ?? 'no detail'}`,
      }],
    }
  }
  const failed = attempt.checks.find(check => check.status === 'failed')
  if (failed !== undefined) {
    return {
      status: 'failed',
      reasons: [{
        code: CODES.GATE_FAILED,
        message: `check "${failed.id}" did not pass: ${failed.detail ?? 'no detail'}`,
      }],
    }
  }

  return { status: 'passed', reasons: [] }
}

function describeEvidenceErrors(record) {
  if (record.validation.errors.length === 0) return 'no validator detail'
  return record.validation.errors.map(error => error.message).join('; ')
}

/**
 * Derive the run status from recorded facts. A completed run requires every
 * required gate passed, required evidence current, and the review policy
 * satisfied; any relevant change downgrades it on the next derivation.
 */
export function deriveRunStatus(run, workflow) {
  if (run.status === 'cancelled') return 'cancelled'
  const required = run.stages.filter(stage => stage.required)
  const gateStatuses = required.map(stage => gateFor(run, stage.skill).status)
  if (gateStatuses.includes('failed')) return 'failed'
  if (gateStatuses.includes('error') || gateStatuses.includes('blocked')) return 'blocked'
  if (gateStatuses.every(status => status === 'passed')) {
    const decision = completionDecision(run, workflow)
    if (decision.status === 'completed') return 'completed'
    if (decision.status === 'failed') return 'failed'
    return 'blocked'
  }
  if (run.stages.some(stage => stage.attempts.some(attempt => ['running', 'validating'].includes(attempt.state)))) {
    return 'running'
  }
  if (run.stages.every(stage => stage.attempts.length === 0)) return 'planned'
  return 'running'
}

/** The completion decision, always derived from current state rather than stored claims. */
export function completionDecision(run, workflow) {
  const reasons = []
  let failed = false
  let blocked = false
  const requiredSkills = new Set(run.stages.filter(stage => stage.required).map(stage => stage.skill))
  for (const stage of run.stages) {
    if (!stage.required) continue
    const gate = gateFor(run, stage.skill)
    if (gate.status === 'failed') {
      failed = true
      reasons.push(`${stage.skill}: gate failed (${gate.reasons.map(reason => reason.code).join(', ') || 'no reason'})`)
    } else if (gate.status === 'blocked' || gate.status === 'error') {
      blocked = true
      reasons.push(`${stage.skill}: gate ${gate.status} (${gate.reasons.map(reason => reason.code).join(', ') || 'no reason'})`)
    } else if (gate.status === 'pending') {
      reasons.push(`${stage.skill}: gate pending`)
    }
  }
  for (const record of run.evidence) {
    if (!requiredSkills.has(record.producer.stage)) continue
    if (record.status !== 'current') {
      blocked = true
      reasons.push(`evidence ${record.evidence_id} (${record.contract_evidence_id}) is ${record.status}`)
    }
  }
  if (run.review.required) {
    if (run.review.status === 'changes_requested') {
      failed = true
      reasons.push('review requested changes that are not yet resolved')
    } else if (run.review.status !== 'approved') {
      reasons.push(`review is ${run.review.status}; approval is required`)
    }
  }
  for (const stage of run.stages) {
    if (stage.attempts.some(attempt => ['running', 'validating'].includes(attempt.state))) {
      reasons.push(`${stage.skill}: attempt still ${latestAttempt(run, stage.skill).state}`)
    }
  }
  if (failed) return { status: 'failed', reasons }
  if (blocked) return { status: 'blocked', reasons }
  if (reasons.length > 0) return { status: 'pending', reasons }
  return { status: 'completed', reasons: ['all required stages passed with current evidence'] }
}

export function applyCompletion(run, workflow, now) {
  const decision = completionDecision(run, workflow)
  run.completion = {
    status: decision.status,
    reasons: decision.reasons,
    decided_at: decision.status === 'completed' ? now : run.completion.decided_at,
  }
  run.status = deriveRunStatus(run, workflow)
  run.updated_at = now
  return decision
}

export function recordError(run, error, now) {
  const record = {
    code: error.code ?? CODES.VALIDATOR_ERROR,
    message: error.message ?? String(error),
    at: now,
  }
  if (typeof error.remediation === 'string' && error.remediation !== '') record.remediation = error.remediation
  run.errors.push(record)
  if (run.errors.length > 100) run.errors.splice(0, run.errors.length - 100)
  run.updated_at = now
}

/**
 * Structural invariants the controller rechecks after every load. A violation
 * means the persisted record cannot be trusted, so it is reported as corrupt
 * state rather than repaired silently.
 */
export function checkRunInvariants(run) {
  const problems = []
  if (run.schema_version !== 2) problems.push(`schema_version is ${run.schema_version}, expected 2`)
  const skills = new Set()
  for (const stage of run.stages) {
    if (skills.has(stage.skill)) problems.push(`stage "${stage.skill}" appears twice`)
    skills.add(stage.skill)
    for (const attempt of stage.attempts) {
      if (attempt.gate.status === 'passed' && attempt.artifact_ids.length === 0) {
        problems.push(`attempt ${attempt.attempt_id} passed without an artifact`)
      }
      for (const artifactId of attempt.artifact_ids) {
        if (run.artifacts.every(record => record.artifact_id !== artifactId)) {
          problems.push(`attempt ${attempt.attempt_id} references unknown artifact "${artifactId}"`)
        }
      }
    }
  }
  for (const gate of run.gates) {
    if (!skills.has(gate.stage)) problems.push(`gate references unknown stage "${gate.stage}"`)
  }
  if (run.status === 'completed') {
    const decision = completionDecision(run, { stages: run.stages })
    if (decision.status !== 'completed') problems.push('run is completed but the completion decision disagrees')
  }
  return problems
}

export function throwIfCorrupt(run) {
  const problems = checkRunInvariants(run)
  if (problems.length > 0) {
    throw new FlowgateError(CODES.STATE_CORRUPT, `persisted run state is inconsistent: ${problems.join('; ')}`, 'Preserve the file for inspection; do not delete it and report success.')
  }
  return run
}

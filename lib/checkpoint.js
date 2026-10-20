import { digestOf } from './canonical.js'
import { FlowgateError, CODES } from './errors.js'
import { gateFor, latestAttempt, findStage } from './state.js'

/**
 * A checkpoint captures identifiers, versions, and gate outcomes. It does not
 * duplicate artifact content; validity is rechecked against the live records so
 * a checkpoint cannot pin a stale result as current.
 */
export function createCheckpoint(run, { now, contracts, checkpointId }) {
  const checkpoint = {
    checkpoint_id: checkpointId ?? `cp-${String(run.checkpoints.length + 1).padStart(3, '0')}`,
    schema_version: 2,
    run_id: run.run_id,
    engine_version: run.engine_version,
    workflow: { name: run.workflow.name, contract_version: run.workflow.contract_version },
    created_at: now,
    stages: run.stages.map(stage => {
      const attempt = latestAttempt(run, stage.skill)
      return {
        position: stage.position,
        skill: stage.skill,
        state: attempt?.state ?? 'pending',
        attempt_id: attempt?.attempt_id ?? null,
      }
    }),
    artifacts: run.artifacts.map(record => ({
      artifact_id: record.artifact_id,
      artifact_type: record.artifact_type,
      digest: record.digest,
      status: record.status,
    })),
    evidence: run.evidence.map(record => ({
      evidence_id: record.evidence_id,
      status: record.status,
      digest: evidenceDigest(record),
    })),
    gates: run.gates.map(gate => ({ stage: gate.stage, status: gate.status })),
    pending_stages: run.stages
      .filter(stage => gateFor(run, stage.skill).status !== 'passed')
      .map(stage => stage.skill),
    side_effects: run.stages
      .map(stage => {
        const contract = contracts.contracts[stage.skill]
        const attempt = latestAttempt(run, stage.skill)
        return {
          stage: stage.skill,
          class: contract.side_effects.class,
          retry_policy: contract.side_effects.retry_policy,
          outcome_known: attempt === undefined || attempt.ended_at !== null,
        }
      })
      .filter(entry => entry.class !== 'read_only' || entry.retry_policy !== 'safe_idempotent'),
    dependencies_digest: '',
    checksum: '',
  }
  checkpoint.dependencies_digest = digestOf({
    artifacts: checkpoint.artifacts,
    evidence: checkpoint.evidence,
    gates: checkpoint.gates,
  })
  checkpoint.checksum = digestOf(withoutChecksum(checkpoint))
  return checkpoint
}

export function evidenceDigest(record) {
  return digestOf({
    binds_to: record.binds_to,
    observed: record.observed,
    validation: record.validation,
    status: record.status,
  })
}

function withoutChecksum(checkpoint) {
  const { checksum, ...rest } = checkpoint
  return rest
}

export function checkpointIntegrity(checkpoint) {
  return checkpoint.checksum === digestOf(withoutChecksum(checkpoint))
}

/**
 * A checkpoint is valid only when every record it names still exists, versions
 * still match, gates it recorded as passed are still passed, and the evidence
 * behind those gates is still current.
 */
export function validateCheckpoint(run, checkpoint, { contracts }) {
  const reasons = []
  if (!checkpointIntegrity(checkpoint)) {
    reasons.push({ code: CODES.CHECKPOINT_INVALID, message: 'checkpoint checksum does not match its contents' })
  }
  if (checkpoint.run_id !== run.run_id) {
    reasons.push({ code: CODES.CHECKPOINT_INVALID, message: `checkpoint belongs to run "${checkpoint.run_id}"` })
  }
  if (checkpoint.schema_version !== 2) {
    reasons.push({ code: CODES.CHECKPOINT_INVALID, message: `checkpoint schema version ${checkpoint.schema_version} is not supported` })
  }
  if (checkpoint.workflow.name !== run.workflow.name) {
    reasons.push({ code: CODES.CHECKPOINT_INVALID, message: 'checkpoint workflow identity does not match the run' })
  }

  for (const stage of checkpoint.stages) {
    const live = findStage(run, stage.skill)
    if (live === undefined) {
      reasons.push({ code: CODES.CHECKPOINT_INVALID, message: `checkpoint names unknown stage "${stage.skill}"` })
      continue
    }
    if (stage.attempt_id !== null) {
      const attempt = live.attempts.find(entry => entry.attempt_id === stage.attempt_id)
      if (attempt === undefined) {
        reasons.push({ code: CODES.CHECKPOINT_INVALID, message: `checkpoint names missing attempt "${stage.attempt_id}"` })
      }
    }
  }

  for (const reference of checkpoint.artifacts) {
    const live = run.artifacts.find(record => record.artifact_id === reference.artifact_id)
    if (live === undefined) {
      reasons.push({ code: CODES.CHECKPOINT_INVALID, message: `checkpoint names missing artifact "${reference.artifact_id}"` })
      continue
    }
    if (live.digest !== reference.digest) {
      reasons.push({ code: CODES.CHECKPOINT_INVALID, message: `artifact "${reference.artifact_id}" changed since the checkpoint` })
    }
    if (reference.status === 'valid' && live.status !== 'valid') {
      reasons.push({ code: CODES.CHECKPOINT_INVALID, message: `artifact "${reference.artifact_id}" is no longer valid` })
    }
  }

  for (const reference of checkpoint.evidence) {
    const live = run.evidence.find(record => record.evidence_id === reference.evidence_id)
    if (live === undefined) {
      reasons.push({ code: CODES.CHECKPOINT_INVALID, message: `checkpoint names missing evidence "${reference.evidence_id}"` })
      continue
    }
    if (evidenceDigest(live) !== reference.digest) {
      reasons.push({ code: CODES.CHECKPOINT_INVALID, message: `evidence "${reference.evidence_id}" changed since the checkpoint` })
    }
    if (reference.status === 'current' && live.status !== 'current') {
      reasons.push({ code: CODES.EVIDENCE_STALE, message: `evidence "${reference.evidence_id}" is ${live.status}` })
    }
  }

  for (const gate of checkpoint.gates) {
    if (gate.status !== 'passed') continue
    const live = gateFor(run, gate.stage)
    if (live === undefined) {
      reasons.push({ code: CODES.CHECKPOINT_INVALID, message: `checkpoint names unknown gate "${gate.stage}"` })
      continue
    }
    if (live.status !== 'passed') {
      reasons.push({ code: CODES.CHECKPOINT_INVALID, message: `gate "${gate.stage}" was passed at checkpoint time but is now ${live.status}` })
    }
    const contract = contracts.contracts[gate.stage]
    if (contract?.recovery.require_current_evidence === true) {
      for (const requirement of contract.evidence) {
        const record = run.evidence
          .filter(entry => entry.contract_evidence_id === requirement.id && entry.producer.stage === gate.stage)
          .at(-1)
        if (record === undefined || record.status !== 'current') {
          reasons.push({
            code: CODES.EVIDENCE_STALE,
            message: `required evidence "${requirement.id}" for passed stage "${gate.stage}" is not current`,
          })
        }
      }
    }
  }

  return { valid: reasons.length === 0, reasons }
}

/** Walk checkpoints newest-first and return the first one that is still valid. */
export function selectLastValid(run, { contracts }) {
  const rejected = []
  for (let index = run.checkpoints.length - 1; index >= 0; index -= 1) {
    const checkpoint = run.checkpoints[index]
    const result = validateCheckpoint(run, checkpoint, { contracts })
    if (result.valid) {
      return { checkpoint, rejected }
    }
    rejected.push({ checkpoint_id: checkpoint.checkpoint_id, reasons: result.reasons })
  }
  return { checkpoint: null, rejected }
}

/**
 * Build a resume plan from the last valid checkpoint. Throws RESUME_BLOCKED when
 * no checkpoint is valid or when continuing would repeat an unsafe side effect.
 */
export function planResume(run, { contracts, now }) {
  const { checkpoint, rejected } = selectLastValid(run, { contracts })
  if (checkpoint === null) {
    const reasons = rejected.flatMap(entry => entry.reasons)
    throw new FlowgateError(
      CODES.RESUME_BLOCKED,
      `run ${run.run_id}: no valid checkpoint exists (${reasons.map(reason => reason.message).join('; ') || 'no checkpoints recorded'})`,
      'Revalidate the affected stages, or start a fresh run. Flowgate will not resume from a checkpoint it cannot validate.',
    )
  }
  const completedSkills = new Set(checkpoint.gates.filter(gate => gate.status === 'passed').map(gate => gate.stage))
  const stages = run.stages
    .filter(stage => !completedSkills.has(stage.skill))
    .map(stage => stage.skill)
  for (const stage of run.stages) {
    if (!stage.required) continue
    if (completedSkills.has(stage.skill)) continue
    if (checkpoint.pending_stages.includes(stage.skill)) continue
    throw new FlowgateError(
      CODES.RESUME_BLOCKED,
      `run ${run.run_id}: checkpoint "${checkpoint.checkpoint_id}" omits required stage "${stage.skill}" without recording it as pending`,
      'Rerun the omitted stage; a resume may not skip required work.',
    )
  }
  for (const skill of stages) {
    const attempt = latestAttempt(run, skill)
    if (attempt === undefined || attempt.ended_at !== null) continue
    const contract = contracts.contracts[skill]
    const policy = contract.side_effects.retry_policy
    if (policy === 'safe_idempotent') continue
    const approved = run.approvals.some(approval => approval.stage === skill && approval.kind === 'retry')
    if (policy === 'manual_approval_required' && approved) continue
    throw new FlowgateError(
      CODES.SIDE_EFFECT_RETRY_DENIED,
      `run ${run.run_id}: stage "${skill}" has an attempt with unknown outcome and retry policy "${policy}"`,
      'Grant an explicit retry approval before resuming, or inspect the side effect manually.',
    )
  }
  return {
    checkpoint,
    stages,
    rejected,
    decided_at: now,
  }
}

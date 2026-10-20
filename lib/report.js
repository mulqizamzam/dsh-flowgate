import { FlowgateError, CODES } from './errors.js'
import { validateValue } from './schema.js'
import { selectLastValid } from './checkpoint.js'
import { gateFor, latestAttempt } from './state.js'
import { truncateUtf8 } from './registry.js'

const SECRET_PATTERNS = [
  [/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}/g, '[redacted-key]'],
  [/(api[_-]?key|access[_-]?token|secret|password|passwd)\s*[:=]\s*\S+/gi, '$1=[redacted]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  [/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '[redacted-private-key]'],
  [/\/(?:home|Users)\/[^/\s]+/g, '/home/[user]'],
]

export const STATIC_LIMITATIONS = Object.freeze([
  'Evidence relevance is bounded by the declared dependency graph; a change outside the graph cannot be detected.',
  'Validators establish structure, provenance, and version binding; they cannot prove that a claim is semantically true.',
  'Artifact content is stored locally for validation and is omitted from reports.',
  'The host does not let a plugin distinguish a prohibited continuation from a legitimate remediation step, so gates are validated by Flowgate rather than runtime-enforced at the model boundary.',
])

/** Redact obvious credentials and user home paths from report-bound text. */
export function redactText(text) {
  let value = String(text ?? '')
  for (const [pattern, replacement] of SECRET_PATTERNS) value = value.replace(pattern, replacement)
  return value
}

export function reportEvidenceExcerpt(record) {
  return redactText(truncateUtf8(record.observed.excerpt, 200))
}

/** Build the deterministic run report from stored facts. */
export function buildReport(run, { contracts, workflow, schemas, generatedAt }) {
  const selection = selectLastValid(run, { contracts })
  const report = {
    report_version: 1,
    schema_version: 2,
    run_id: run.run_id,
    generated_at: generatedAt,
    engine_version: run.engine_version,
    status: run.status,
    workflow: { ...run.workflow },
    routing: {
      scores: run.routing.scores.map(entry => ({ ...entry })),
      selected: run.routing.selected,
      reason: run.routing.reason,
      fallback: run.routing.fallback,
    },
    stages: run.stages.map(stage => {
      const attempt = latestAttempt(run, stage.skill)
      const gate = gateFor(run, stage.skill)
      return {
        position: stage.position,
        skill: stage.skill,
        artifact: stage.artifact,
        required: stage.required,
        attempts: stage.attempts.length,
        state: attempt?.state ?? 'pending',
        gate: {
          stage: gate.stage,
          status: gate.status,
          reasons: gate.reasons.map(reason => ({ code: reason.code, message: redactText(reason.message) })),
          checked_at: gate.checked_at,
        },
        artifact_ids: [...(attempt?.artifact_ids ?? [])],
        evidence_ids: [...(attempt?.evidence_ids ?? [])],
        checks: (attempt?.checks ?? []).map(check => ({
          id: check.id,
          type: check.type,
          status: check.status,
          detail: check.detail === null ? null : redactText(check.detail),
        })),
      }
    }),
    artifacts: run.artifacts.map(record => ({
      artifact_id: record.artifact_id,
      artifact_type: record.artifact_type,
      status: record.status,
      freshness: record.freshness.status,
      digest: record.digest,
      validation_ok: record.validation.ok,
      input_refs: record.inputs.map(input => input.ref),
      created_at: record.created_at,
    })),
    evidence: run.evidence.map(record => ({
      evidence_id: record.evidence_id,
      contract_evidence_id: record.contract_evidence_id,
      evidence_type: record.evidence_type,
      status: record.status,
      provenance: record.provenance.kind,
      supports: [...record.supports],
      bind_refs: record.binds_to.map(binding => binding.ref),
      validation_ok: record.validation.ok,
      freshness_reason: record.freshness_reason === null ? null : redactText(record.freshness_reason),
      observed_excerpt: reportEvidenceExcerpt(record),
    })),
    gates: run.gates.map(gate => ({
      stage: gate.stage,
      status: gate.status,
      reasons: gate.reasons.map(reason => ({ code: reason.code, message: redactText(reason.message) })),
      checked_at: gate.checked_at,
    })),
    review: { ...run.review, reason: run.review.reason === null ? null : redactText(run.review.reason) },
    invalidations: run.invalidations.map(decision => ({
      decision_id: decision.decision_id,
      changed: decision.changed,
      fingerprint_changed: decision.fingerprint_changed,
      policy: decision.policy,
      affected: [...decision.affected],
      reason: redactText(decision.reason),
    })),
    checkpoints: {
      created: run.checkpoints.map(checkpoint => checkpoint.checkpoint_id),
      selected: selection.checkpoint?.checkpoint_id ?? null,
      rejected: selection.rejected.map(entry => ({
        checkpoint_id: entry.checkpoint_id,
        reasons: entry.reasons.map(reason => ({ code: reason.code, message: redactText(reason.message) })),
      })),
    },
    errors: run.errors.map(error => {
      const record = { code: error.code, message: redactText(error.message) }
      if (error.remediation !== undefined) record.remediation = redactText(error.remediation)
      return record
    }),
    enforcement: {
      level: run.enforcement.level,
      pre_step: run.enforcement.pre_step,
      limitations: [...run.enforcement.limitations],
    },
    completion: {
      status: run.completion.status,
      reasons: run.completion.reasons.map(reason => redactText(reason)),
      decided_at: run.completion.decided_at,
    },
    limitations: [...STATIC_LIMITATIONS],
  }
  if (schemas !== undefined) {
    const schema = schemas.get('run-report')
    if (schema !== undefined) {
      const result = validateValue(report, schema, schema)
      if (!result.ok) {
        const first = result.errors[0]
        throw new FlowgateError(CODES.VALIDATOR_ERROR, `report does not match its own schema: ${first.message} at ${first.path}`)
      }
    }
  }
  return report
}

/** Deterministic human-readable rendering of a report. */
export function renderReportText(report) {
  const lines = [
    `RUN ${report.run_id}`,
    `Status: ${report.status}`,
    `Workflow: ${report.workflow.name} (${report.workflow.stage_count} stages, contract v${report.workflow.contract_version})`,
    `Routing: ${report.routing.reason}`,
    `Enforcement: ${report.enforcement.level} (pre-step: ${report.enforcement.pre_step})`,
    '',
    'Stages:',
  ]
  for (const stage of report.stages) {
    const required = stage.required ? 'required' : 'optional'
    lines.push(`  ${stage.position}. ${stage.skill} [${required}] -> ${stage.artifact} :: ${stage.gate.status} (attempts ${stage.attempts}, ${stage.state})`)
    for (const reason of stage.gate.reasons) lines.push(`     - ${reason.code}: ${reason.message}`)
    for (const check of stage.checks) {
      lines.push(`     check ${check.id} (${check.type}): ${check.status}${check.detail === null ? '' : ` — ${check.detail}`}`)
    }
  }
  lines.push('', 'Artifacts:')
  if (report.artifacts.length === 0) lines.push('  none')
  for (const artifact of report.artifacts) {
    lines.push(`  ${artifact.artifact_id} ${artifact.artifact_type} :: ${artifact.status}/${artifact.freshness} digest=${artifact.digest.slice(0, 15)}… inputs=${artifact.input_refs.join(', ') || 'none'}`)
  }
  lines.push('', 'Evidence:')
  if (report.evidence.length === 0) lines.push('  none')
  for (const evidence of report.evidence) {
    lines.push(`  ${evidence.evidence_id} ${evidence.contract_evidence_id} (${evidence.evidence_type}) :: ${evidence.status} provenance=${evidence.provenance} binds=${evidence.bind_refs.join(', ') || 'none'}`)
    if (evidence.freshness_reason !== null) lines.push(`     reason: ${evidence.freshness_reason}`)
  }
  lines.push('', 'Invalidation decisions:')
  if (report.invalidations.length === 0) lines.push('  none')
  for (const decision of report.invalidations) {
    lines.push(`  ${decision.decision_id} ${decision.changed} -> ${decision.policy} (${decision.affected.length} affected): ${decision.reason}`)
  }
  lines.push('', 'Checkpoints:')
  lines.push(`  created: ${report.checkpoints.created.join(', ') || 'none'}`)
  lines.push(`  selected: ${report.checkpoints.selected ?? 'none'}`)
  for (const rejected of report.checkpoints.rejected) {
    lines.push(`  rejected ${rejected.checkpoint_id}: ${rejected.reasons.map(reason => `${reason.code}: ${reason.message}`).join('; ')}`)
  }
  lines.push('', 'Errors:')
  if (report.errors.length === 0) lines.push('  none')
  for (const error of report.errors) {
    lines.push(`  ${error.code}: ${error.message}${error.remediation === undefined ? '' : ` (remediation: ${error.remediation})`}`)
  }
  lines.push('', `Completion: ${report.completion.status}`)
  for (const reason of report.completion.reasons) lines.push(`  - ${reason}`)
  lines.push('', 'Limitations:')
  for (const limitation of report.limitations) lines.push(`  - ${limitation}`)
  return lines.join('\n')
}

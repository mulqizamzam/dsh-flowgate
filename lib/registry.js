import { digestText } from './canonical.js'
import { FlowgateError, CODES } from './errors.js'

export const ARTIFACT_STATUSES = ['missing', 'present', 'valid', 'invalid']
export const EVIDENCE_STATUSES = ['missing', 'current', 'stale', 'needs_revalidation', 'invalid']
export const GATE_STATUSES = ['pending', 'passed', 'failed', 'blocked', 'error']

const MAX_ARTIFACT_BYTES = 65536
const MAX_EXCERPT_BYTES = 2048

/**
 * Build an artifact record. Validation is a separate, recorded fact: an
 * artifact being recorded as `present` never means it passed its contract.
 */
export function buildArtifactRecord({
  artifact_id,
  artifact_type,
  producer,
  content,
  inputs = [],
  validation,
  now,
  status,
  freshness = { status: 'current', reason: null },
}) {
  const text = String(content)
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > MAX_ARTIFACT_BYTES) {
    throw new FlowgateError(CODES.ARTIFACT_SCHEMA_INVALID, `artifact ${artifact_id} is ${bytes} bytes, over the ${MAX_ARTIFACT_BYTES} byte record limit`)
  }
  const validated = validation ?? { ok: false, checks: [], errors: [] }
  const resolvedStatus = status ?? (validated.ok ? 'valid' : 'invalid')
  if (!ARTIFACT_STATUSES.includes(resolvedStatus)) {
    throw new FlowgateError(CODES.ARTIFACT_SCHEMA_INVALID, `artifact ${artifact_id} has unknown status "${resolvedStatus}"`)
  }
  return {
    artifact_id,
    artifact_type,
    schema_version: 1,
    producer,
    status: resolvedStatus,
    freshness,
    digest: digestText(text),
    content: text,
    content_bytes: bytes,
    inputs,
    validation: {
      ok: validated.ok === true,
      checks: [...(validated.checks ?? [])],
      errors: [...(validated.errors ?? [])],
    },
    evidence_ids: [],
    created_at: now,
    validated_at: validated.ok === true ? now : null,
  }
}

/** Re-run validation on an existing record without losing its identity. */
export function revalidateArtifact(record, validation, now) {
  return {
    ...record,
    status: validation.ok ? 'valid' : 'invalid',
    validation: {
      ok: validation.ok === true,
      checks: [...(validation.checks ?? [])],
      errors: [...(validation.errors ?? [])],
    },
    validated_at: now,
  }
}

export function buildEvidenceRecord({
  evidence_id,
  contract_evidence_id,
  evidence_type,
  supports,
  provenance,
  observed,
  binds_to,
  validation,
  status,
  freshness_reason = null,
  producer,
  now,
}) {
  const excerpt = String(observed?.excerpt ?? '')
  const bounded = Buffer.byteLength(excerpt, 'utf8') > MAX_EXCERPT_BYTES
    ? truncateUtf8(excerpt, MAX_EXCERPT_BYTES)
    : excerpt
  const resolvedStatus = status ?? (validation?.ok === true ? 'current' : 'invalid')
  if (!EVIDENCE_STATUSES.includes(resolvedStatus)) {
    throw new FlowgateError(CODES.EVIDENCE_RECORD_INVALID, `evidence ${evidence_id} has unknown status "${resolvedStatus}"`)
  }
  return {
    evidence_id,
    contract_evidence_id,
    evidence_type,
    supports: [...supports],
    provenance: {
      kind: provenance.kind,
      observation_id: provenance.observation_id ?? null,
      command: provenance.command ?? null,
    },
    observed: {
      result: observed?.result ?? 'declared',
      excerpt: bounded,
    },
    binds_to: [...binds_to],
    validation: {
      method: validation?.method ?? 'structural',
      ok: validation?.ok === true,
      errors: [...(validation?.errors ?? [])],
    },
    status: resolvedStatus,
    freshness_reason,
    producer,
    created_at: now,
  }
}

/**
 * Decide an evidence record's status from its validation and the contract's
 * accepted provenance. A provenance the contract does not accept cannot be
 * treated as current evidence, even when the record is well formed.
 */
export function evidenceStatus({ validation, acceptedProvenance, provenanceKind }) {
  if (validation?.ok !== true) return 'invalid'
  if (!acceptedProvenance.includes(provenanceKind)) return 'needs_revalidation'
  return 'current'
}

export function findArtifact(run, artifactId) {
  return run.artifacts.find(record => record.artifact_id === artifactId)
}

export function latestArtifactOfType(run, artifactType, stage) {
  const matches = run.artifacts.filter(record => record.artifact_type === artifactType
    && (stage === undefined || record.producer.stage === stage))
  return matches.sort((left, right) => compare(left.artifact_id, right.artifact_id)).at(-1)
}

export function findEvidence(run, evidenceId) {
  return run.evidence.find(record => record.evidence_id === evidenceId)
}

export function latestEvidenceFor(run, contractEvidenceId, stage) {
  const matches = run.evidence.filter(record => record.contract_evidence_id === contractEvidenceId
    && (stage === undefined || record.producer.stage === stage))
  return matches.sort((left, right) => compare(left.evidence_id, right.evidence_id)).at(-1)
}

/** True when the artifact's recorded input bindings no longer match current ones. */
export function bindingsDiffer(record, current) {
  const recorded = record.inputs.map(binding => `${binding.ref}=${binding.digest}`).sort(compare)
  const now = current.map(binding => `${binding.ref}=${binding.digest}`).sort(compare)
  return recorded.join('\n') !== now.join('\n')
}

export function isCurrentEvidence(record) {
  return record !== undefined && record.status === 'current'
}

export function truncateUtf8(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const ellipsis = '…'
  const budget = maxBytes - Buffer.byteLength(ellipsis, 'utf8')
  let end = Math.min(text.length, Math.max(0, budget))
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > budget) end -= 1
  return `${text.slice(0, end)}${ellipsis}`
}

function compare(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

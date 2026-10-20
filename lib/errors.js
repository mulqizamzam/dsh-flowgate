/**
 * Stable error taxonomy for Flowgate. Every user-visible or report-bound
 * failure carries one of these codes so a caller can test the class of failure
 * without parsing prose.
 */

export const CODES = Object.freeze({
  FLOW_REQUEST_TOO_LARGE: 'FLOW_REQUEST_TOO_LARGE',
  FLOW_NO_MATCH_FALLBACK: 'FLOW_NO_MATCH_FALLBACK',
  WORKFLOW_INVALID: 'WORKFLOW_INVALID',
  CONTRACT_INVALID: 'CONTRACT_INVALID',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  DEPENDENCY_DANGLING_REFERENCE: 'DEPENDENCY_DANGLING_REFERENCE',
  DEPENDENCY_CYCLE: 'DEPENDENCY_CYCLE',
  STAGE_INPUT_MISSING: 'STAGE_INPUT_MISSING',
  ARTIFACT_MISSING: 'ARTIFACT_MISSING',
  ARTIFACT_SCHEMA_INVALID: 'ARTIFACT_SCHEMA_INVALID',
  EVIDENCE_MISSING: 'EVIDENCE_MISSING',
  EVIDENCE_STALE: 'EVIDENCE_STALE',
  EVIDENCE_IMPACT_UNKNOWN: 'EVIDENCE_IMPACT_UNKNOWN',
  EVIDENCE_INVALID: 'EVIDENCE_INVALID',
  EVIDENCE_RECORD_INVALID: 'EVIDENCE_RECORD_INVALID',
  GATE_FAILED: 'GATE_FAILED',
  VALIDATOR_ERROR: 'VALIDATOR_ERROR',
  CHECKPOINT_INVALID: 'CHECKPOINT_INVALID',
  RESUME_BLOCKED: 'RESUME_BLOCKED',
  SIDE_EFFECT_RETRY_DENIED: 'SIDE_EFFECT_RETRY_DENIED',
  HOST_CAPABILITY_UNAVAILABLE: 'HOST_CAPABILITY_UNAVAILABLE',
  STATE_CORRUPT: 'STATE_CORRUPT',
  STATE_VERSION_UNSUPPORTED: 'STATE_VERSION_UNSUPPORTED',
  STATE_LOCKED: 'STATE_LOCKED',
  COMPOSITION_TOO_LARGE: 'COMPOSITION_TOO_LARGE',
  RUN_NOT_FOUND: 'RUN_NOT_FOUND',
  COMMAND_INVALID: 'COMMAND_INVALID',
  STAGE_OUTPUT_UNPARSEABLE: 'STAGE_OUTPUT_UNPARSEABLE',
})

const KNOWN = new Set(Object.values(CODES))

export class FlowgateError extends Error {
  /**
   * @param {string} code stable taxonomy code
   * @param {string} message human-readable message
   * @param {string} [remediation] actionable next step
   */
  constructor(code, message, remediation) {
    super(message)
    this.name = 'FlowgateError'
    this.code = code
    this.remediation = remediation
  }

  toJSON() {
    const record = { code: this.code, message: this.message }
    if (this.remediation !== undefined) record.remediation = this.remediation
    return record
  }
}

export function flowError(code, message, remediation) {
  return new FlowgateError(code, message, remediation)
}

export function throwFlow(code, message, remediation) {
  throw new FlowgateError(code, message, remediation)
}

export function isFlowgateError(error) {
  return error instanceof FlowgateError
}

/** Normalize any thrown value into the report-facing error record. */
export function toErrorRecord(error) {
  if (error instanceof FlowgateError) return error.toJSON()
  return {
    code: CODES.VALIDATOR_ERROR,
    message: error instanceof Error && error.message !== '' ? error.message : String(error),
  }
}

/** Wrap an unexpected throw from a validator or persistence primitive. */
export function asValidatorError(error, context) {
  if (error instanceof FlowgateError) return error
  const reason = error instanceof Error && error.message !== '' ? error.message : String(error)
  return new FlowgateError(CODES.VALIDATOR_ERROR, `${context}: ${reason}`)
}

export function isKnownCode(code) {
  return KNOWN.has(code)
}

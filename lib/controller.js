import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { digestText } from './canonical.js'
import { FlowgateError, CODES } from './errors.js'
import { assertRequestSize } from './flow-compose.js'
import { atomicWrite, loadRun, resolveStateDir, saveRun, withRunLock } from './persistence.js'
import {
  addAttempt,
  applyCompletion,
  completionDecision,
  createRun as createRunState,
  ensureAttempt,
  evaluateStage,
  findStage,
  gateFor,
  latestAttempt,
  markOptionalSkipped,
  recordError,
  setGate,
  throwIfCorrupt,
} from './state.js'
import {
  buildArtifactRecord,
  buildEvidenceRecord,
  evidenceStatus,
  latestArtifactOfType,
  truncateUtf8,
} from './registry.js'
import { parseEvidenceRecords, parseStageOutput, validateArtifactStructure } from './artifact.js'
import {
  INPUT_NODE,
  addArtifact,
  addEvidence,
  artifactNode,
  buildPlanGraph,
  validateGraph,
} from './graph.js'
import { applyInvalidation } from './invalidation.js'
import { createCheckpoint, planResume } from './checkpoint.js'
import { buildReport, redactText, renderReportText } from './report.js'
import { validateValue } from './schema.js'

/** Check types that decide an artifact's own structural validity. */
const ARTIFACT_CHECK_TYPES = new Set(['artifact_fields', 'artifact_schema', 'evidence_block'])

/**
 * Owns the run lifecycle: plan, record stage output, evaluate gates, propagate
 * invalidation, checkpoint, and resume. Every mutation reads current state under
 * the run lock and writes atomically.
 */
export class FlowgateController {
  constructor({ stateDir, workflows, contracts, artifactFields, schemas, now, ids } = {}) {
    if (workflows === undefined || contracts === undefined) {
      throw new FlowgateError(CODES.WORKFLOW_INVALID, 'controller requires resolved workflows and contracts')
    }
    this.stateDir = resolveStateDir({ stateDir })
    this.workflows = workflows
    this.contracts = contracts
    this.artifactFields = artifactFields
    this.schemas = schemas
    this.now = typeof now === 'function' ? now : () => new Date().toISOString()
    this.ids = ids ?? defaultIdFactory()
  }

  resolveWorkflow(run) {
    const workflow = this.workflows.get(run.workflow.name)
    if (workflow === undefined) {
      throw new FlowgateError(CODES.WORKFLOW_INVALID, `run ${run.run_id} names workflow "${run.workflow.name}", which is not installed`)
    }
    return workflow
  }

  load(runId) {
    const run = loadRun(this.stateDir, runId, { schemas: this.schemas })
    return throwIfCorrupt(run)
  }

  persist(run) {
    run.updated_at = this.now()
    const schema = this.schemas?.get('run-state')
    if (schema !== undefined) {
      const result = validateValue(run, schema, schema)
      if (!result.ok) {
        const first = result.errors[0]
        throw new FlowgateError(
          CODES.VALIDATOR_ERROR,
          `refusing to persist invalid run state: ${first.message} at ${first.path}`,
          'This is an internal state-shape error; the previous state file was left untouched.',
        )
      }
    }
    saveRun(this.stateDir, run, { now: run.updated_at })
    return run
  }

  update(runId, mutator) {
    return withRunLock(this.stateDir, runId, () => {
      const run = this.load(runId)
      const result = mutator(run, this.now())
      this.persist(run)
      return result
    })
  }

  /** Create a run, preflight its dependency graph, and open the first attempt. */
  createRun({ request, sessionId = null, route, workflow, enforcement, runId }) {
    assertRequestSize(request)
    const at = this.now()
    const id = runId ?? this.ids.next('run')
    const requestRecord = {
      bytes: Buffer.byteLength(String(request), 'utf8'),
      digest: digestText(String(request)),
      excerpt: redactText(truncateUtf8(String(request), 280)),
    }
    const run = createRunState({
      runId: id,
      sessionId,
      request: requestRecord,
      routing: {
        scores: route.scores.map(entry => ({ ...entry })),
        selected: route.selected,
        reason: route.reason,
        fallback: route.fallback === true,
      },
      workflow,
      contracts: this.contracts,
      enforcement,
      now: at,
    })
    const graph = buildPlanGraph(workflow, this.contracts.contracts)
    validateGraph(graph)
    const first = run.stages[0]
    if (first !== undefined) {
      addAttempt(run, first.skill, { attemptId: this.ids.next('att'), now: at })
    }
    this.persist(run)
    this.indexSession(sessionId, run.run_id, at)
    return run
  }

  /** Find the run this session is working on, if any. */
  findActiveRun(sessionId) {
    if (sessionId === null || sessionId === undefined || sessionId === '') return undefined
    const path = join(this.stateDir, 'sessions', `${safeId(String(sessionId))}.json`)
    if (!existsSync(path)) return undefined
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'))
      if (typeof data.run_id !== 'string') return undefined
      return this.load(data.run_id)
    } catch {
      return undefined
    }
  }

  indexSession(sessionId, runId, at) {
    if (sessionId === null || sessionId === undefined || sessionId === '') return
    const path = join(this.stateDir, 'sessions', `${safeId(String(sessionId))}.json`)
    atomicWrite(path, `${JSON.stringify({ session_id: String(sessionId), run_id: runId, at })}\n`)
  }

  /** Record an observed tool result. Provenance is only granted to observed commands. */
  recordObservation(runId, { command, exit_code = null, is_error = false, excerpt = '' }) {
    if (typeof command !== 'string' || command.trim() === '') {
      throw new FlowgateError(CODES.COMMAND_INVALID, 'an observation requires the exact command that produced it')
    }
    return this.update(runId, (run, at) => {
      const observation = {
        observation_id: this.ids.next('obs'),
        kind: 'tool_result',
        command,
        exit_code: Number.isInteger(exit_code) ? exit_code : null,
        is_error: is_error === true,
        excerpt: truncateUtf8(String(excerpt), 2048),
        at,
      }
      run.observations.push(observation)
      if (run.observations.length > 200) run.observations.splice(0, run.observations.length - 200)
      return observation
    })
  }

  /**
   * Parse a stage output and record its artifact/evidence, or refuse when the
   * output cannot satisfy the current stage. Recording never advances a stage
   * merely because prose says it succeeded.
   */
  recordStageOutput(runId, text) {
    return this.update(runId, (run, at) => this.applyStageOutput(run, text, at))
  }

  applyStageOutput(run, text, at) {
    const pending = run.stages.filter(stage => gateFor(run, stage.skill).status !== 'passed')
    let target
    for (const stage of pending) {
      const parsed = parseStageOutput(text, stage.artifact)
      if (parsed !== undefined) {
        target = { stage, parsed }
        break
      }
    }
    if (target === undefined) {
      return {
        recorded: false,
        code: CODES.STAGE_OUTPUT_UNPARSEABLE,
        message: 'no artifact block matched a pending stage',
      }
    }
    const targetIndex = run.stages.findIndex(stage => stage.skill === target.stage.skill)
    for (const stage of run.stages.slice(0, targetIndex)) {
      if (gateFor(run, stage.skill).status === 'passed') continue
      if (stage.required) {
        return {
          recorded: false,
          code: CODES.STAGE_INPUT_MISSING,
          message: `required stage "${stage.skill}" has not passed; an artifact for "${target.stage.skill}" is premature`,
        }
      }
      markOptionalSkipped(run, stage.skill, `skipped when "${target.stage.skill}" produced its artifact`, at)
    }

    const workflow = this.resolveWorkflow(run)
    const contract = this.contracts.contracts[target.stage.skill]
    const attempt = ensureAttempt(run, target.stage.skill, { attemptId: this.ids.next('att'), now: at })
    const bindings = this.bindingsFor(run, contract)
    const evidence = this.buildStageEvidence(run, target.stage, contract, text, bindings, attempt, at)
    const spec = this.artifactFields.fields[target.stage.artifact]
    const structure = validateArtifactStructure(target.parsed, spec)
    const fieldErrors = structure.errors.filter(error => error.path !== '#/EVIDENCE')
    const evidenceBlockError = structure.errors.find(error => error.path === '#/EVIDENCE')
    const checks = contract.checks.map(check => this.runCheck(check, {
      fieldErrors,
      evidenceBlockError,
      evidence,
      contract,
    }))
    // Only artifact-structure checks decide the artifact's own status. Evidence
    // problems stay on the evidence records and in the attempt checks, so a gate
    // reports them as EVIDENCE_* blocked reasons instead of a schema failure.
    const artifactChecks = checks.filter(check => ARTIFACT_CHECK_TYPES.has(check.type))
    const validationOk = artifactChecks.every(check => check.status === 'passed')
    const artifact = buildArtifactRecord({
      artifact_id: this.ids.next('art'),
      artifact_type: target.stage.artifact,
      producer: { stage: target.stage.skill, attempt_id: attempt.attempt_id },
      content: target.parsed.content,
      inputs: bindings,
      validation: {
        ok: validationOk,
        checks: artifactChecks.map(check => ({
          id: check.id,
          ok: check.status === 'passed',
          detail: check.detail ?? null,
        })),
        errors: [
          ...fieldErrors,
          ...(evidenceBlockError === undefined ? [] : [evidenceBlockError]),
        ],
      },
      now: at,
    })
    for (const record of evidence.records) {
      record.binds_to.push({ ref: `artifact:${target.stage.artifact}:${artifact.artifact_id}`, digest: artifact.digest })
      artifact.evidence_ids.push(record.evidence_id)
    }
    run.artifacts.push(artifact)
    run.evidence.push(...evidence.records)
    attempt.artifact_ids = [artifact.artifact_id]
    attempt.evidence_ids = evidence.records.map(record => record.evidence_id)
    attempt.checks = checks

    const gate = evaluateStage(run, target.stage.skill, { contracts: this.contracts, now: at })
    setGate(run, target.stage.skill, gate, at)
    if (gate.status === 'passed') {
      run.checkpoints.push(createCheckpoint(run, { now: at, contracts: this.contracts }))
      this.advance(run, target.stage.skill, at)
    }
    applyCompletion(run, workflow, at)
    return {
      recorded: true,
      run_id: run.run_id,
      stage: target.stage.skill,
      artifact_id: artifact.artifact_id,
      gate: gate.status,
      reasons: gate.reasons,
      status: run.status,
      completion: run.completion.status,
    }
  }

  runCheck(check, { fieldErrors, evidenceBlockError, evidence, contract }) {
    switch (check.type) {
      case 'artifact_fields':
      case 'artifact_schema':
        return {
          id: check.id,
          type: check.type,
          status: fieldErrors.length > 0 ? 'failed' : 'passed',
          detail: fieldErrors.length > 0 ? fieldErrors[0].message : null,
        }
      case 'evidence_block':
        return {
          id: check.id,
          type: check.type,
          status: evidenceBlockError === undefined ? 'passed' : 'failed',
          detail: evidenceBlockError === undefined ? null : evidenceBlockError.message,
        }
      case 'evidence_validation':
        return {
          id: check.id,
          type: check.type,
          status: evidence.errors.length > 0 ? 'failed' : 'passed',
          detail: evidence.errors.length > 0 ? evidence.errors[0].message : null,
        }
      case 'evidence_current': {
        const missing = contract.evidence.filter(requirement =>
          !evidence.records.some(record => record.contract_evidence_id === requirement.id))
        const notCurrent = evidence.records.filter(record => record.status !== 'current')
        let detail = null
        if (missing.length > 0) detail = `missing evidence declarations: ${missing.map(requirement => requirement.id).join(', ')}`
        else if (notCurrent.length > 0) detail = `evidence not current: ${notCurrent.map(record => `${record.evidence_id} (${record.status})`).join(', ')}`
        return { id: check.id, type: check.type, status: detail === null ? 'passed' : 'failed', detail }
      }
      default:
        return { id: check.id, type: check.type, status: 'error', detail: `unknown check type "${check.type}"` }
    }
  }

  buildStageEvidence(run, stage, contract, text, bindings, attempt, at) {
    const declarations = parseEvidenceRecords(text)
    const errors = declarations.errors.map(error => ({
      path: '#/EVIDENCE_RECORD',
      message: `line ${error.line}: ${error.message}`,
    }))
    const records = []
    for (const requirement of contract.evidence) {
      if (requirement.type === 'operator_input') {
        records.push(buildEvidenceRecord({
          evidence_id: this.ids.next('ev'),
          contract_evidence_id: requirement.id,
          evidence_type: requirement.type,
          supports: requirement.supports,
          provenance: { kind: 'operator_input', observation_id: null, command: null },
          observed: { result: 'declared', excerpt: `operator request recorded (${run.request.bytes} bytes)` },
          binds_to: bindings,
          validation: { method: 'operator_input', ok: true, errors: [] },
          status: 'current',
          freshness_reason: null,
          producer: { stage: stage.skill, attempt_id: attempt.attempt_id },
          now: at,
        }))
        continue
      }
      const declaration = declarations.records.filter(record => record.id === requirement.id).at(-1)
      if (declaration === undefined) {
        errors.push({
          path: `#/${requirement.id}`,
          message: `no EVIDENCE_RECORD declared for required evidence "${requirement.id}" (${requirement.type})`,
        })
        continue
      }
      if (declaration.type !== undefined && declaration.type !== requirement.type) {
        errors.push({
          path: `#/${requirement.id}`,
          message: `evidence type "${declaration.type}" does not match required "${requirement.type}"`,
        })
        continue
      }
      const candidates = declaration.observation_id !== undefined
        ? run.observations.filter(entry => entry.observation_id === declaration.observation_id)
        : declaration.command === undefined
          ? []
          : run.observations.filter(entry => entry.command === declaration.command)
      const observation = candidates.find(entry => observedResultOf(entry) === declaration.result) ?? candidates.at(-1)
      let validation = {
        method: observation === undefined ? 'structural' : 'observed_command_match',
        ok: true,
        errors: [],
      }
      if (observation !== undefined) {
        const observedResult = observedResultOf(observation)
        if (declaration.result !== observedResult) {
          validation = {
            method: 'observed_command_match',
            ok: false,
            errors: [{
              path: '#/result',
              message: `declared "${declaration.result}" but the observed command result was "${observedResult}"`,
            }],
          }
        }
      }
      const provenanceKind = observation === undefined ? 'agent_statement' : 'observed_command'
      const status = evidenceStatus({
        validation,
        acceptedProvenance: requirement.accepted_provenance,
        provenanceKind,
      })
      records.push(buildEvidenceRecord({
        evidence_id: this.ids.next('ev'),
        contract_evidence_id: requirement.id,
        evidence_type: requirement.type,
        supports: requirement.supports,
        provenance: {
          kind: provenanceKind,
          observation_id: observation?.observation_id ?? null,
          command: declaration.command ?? observation?.command ?? null,
        },
        observed: {
          result: declaration.result,
          excerpt: observation?.excerpt ?? `declared by ${stage.skill} without a matching observed command`,
        },
        binds_to: bindings,
        validation,
        status,
        freshness_reason: status === 'current'
          ? null
          : `provenance "${provenanceKind}" is not accepted for "${requirement.id}"`,
        producer: { stage: stage.skill, attempt_id: attempt.attempt_id },
        now: at,
      }))
    }
    for (const declaration of declarations.records) {
      if (!contract.evidence.some(requirement => requirement.id === declaration.id)) {
        errors.push({
          path: '#/EVIDENCE_RECORD',
          message: `EVIDENCE_RECORD "${declaration.id}" is not required by the ${stage.skill} contract`,
        })
      }
    }
    return { records, errors }
  }

  bindingsFor(run, contract) {
    const bindings = [{ ref: 'input:user-request', digest: run.request.digest }]
    for (const ref of contract.requires) {
      if (ref === 'user-request') continue
      const artifact = latestArtifactOfType(run, ref)
      if (artifact !== undefined) bindings.push({ ref: `artifact:${ref}:${artifact.artifact_id}`, digest: artifact.digest })
    }
    return bindings
  }

  advance(run, skill, at) {
    const index = run.stages.findIndex(stage => stage.skill === skill)
    const rest = run.stages.slice(index + 1)
    const next = rest.find(stage => stage.required && gateFor(run, stage.skill).status !== 'passed')
    for (const stage of rest) {
      if (next !== undefined && stage.skill === next.skill) break
      if (!stage.required && gateFor(run, stage.skill).status !== 'passed') {
        markOptionalSkipped(run, stage.skill, 'the workflow advanced past this optional stage', at)
      }
    }
    if (next !== undefined) {
      ensureAttempt(run, next.skill, { attemptId: this.ids.next('att'), now: at })
    }
  }

  /** Rebuild the dependency graph from the workflow plus every recorded record. */
  buildRunGraph(run) {
    const workflow = this.resolveWorkflow(run)
    let graph = buildPlanGraph(workflow, this.contracts.contracts)
    validateGraph(graph)
    for (const artifact of run.artifacts) {
      const inputs = artifact.inputs
        .map(binding => binding.ref === 'input:user-request' ? INPUT_NODE : artifactNodeFromRef(binding.ref))
        .filter(node => node !== undefined)
      graph = addArtifact(graph, artifact, artifact.producer.stage, inputs)
    }
    for (const evidence of run.evidence) {
      const boundTo = evidence.binds_to
        .map(binding => artifactNodeFromRef(binding.ref))
        .filter(node => node !== undefined)
      graph = addEvidence(graph, evidence, boundTo)
    }
    validateGraph(graph)
    return graph
  }

  recomputeGates(run, at) {
    for (const stage of run.stages) {
      if (latestAttempt(run, stage.skill) === undefined) continue
      const gate = evaluateStage(run, stage.skill, { contracts: this.contracts, now: at })
      setGate(run, stage.skill, gate, at, { updateAttempt: false })
    }
  }

  /**
   * Apply a dependency change. Known descendants are marked stale; unknown
   * impact marks every evidence record as requiring revalidation.
   */
  applyChange(runId, { changed, fingerprintChanged = true, reason }) {
    if (typeof changed !== 'string' || changed === '') {
      throw new FlowgateError(CODES.COMMAND_INVALID, 'applyChange requires the changed node id')
    }
    return this.update(runId, (run, at) => {
      const graph = this.buildRunGraph(run)
      const decision = applyInvalidation(run, {
        graph,
        changed,
        fingerprintChanged,
        reason,
        now: at,
      })
      this.recomputeGates(run, at)
      applyCompletion(run, this.resolveWorkflow(run), at)
      return decision
    })
  }

  createCheckpoint(runId) {
    return this.update(runId, (run, at) => {
      const checkpoint = createCheckpoint(run, { now: at, contracts: this.contracts })
      run.checkpoints.push(checkpoint)
      return checkpoint
    })
  }

  grantRetryApproval(runId, stage) {
    return this.update(runId, (run, at) => {
      const target = findStage(run, stage)
      if (target === undefined) {
        throw new FlowgateError(CODES.SIDE_EFFECT_RETRY_DENIED, `run ${run.run_id}: no stage "${stage}"`)
      }
      const approval = {
        approval_id: this.ids.next('ap'),
        stage,
        granted_at: at,
        kind: 'retry',
      }
      run.approvals.push(approval)
      return approval
    })
  }

  status(runId) {
    return this.load(runId)
  }

  report(runId, { format = 'text' } = {}) {
    const run = this.load(runId)
    const report = buildReport(run, {
      contracts: this.contracts,
      workflow: this.resolveWorkflow(run),
      schemas: this.schemas,
      generatedAt: this.now(),
    })
    if (format === 'json') return { report, text: `${JSON.stringify(report, null, 2)}\n` }
    return { report, text: renderReportText(report) }
  }

  /** Resume from the last valid checkpoint; refuse rather than repeat unsafe work. */
  resume(runId) {
    return this.update(runId, (run, at) => {
      const workflow = this.resolveWorkflow(run)
      const plan = planResume(run, { contracts: this.contracts, now: at })
      for (const stage of run.stages) {
        const attempt = latestAttempt(run, stage.skill)
        if (attempt !== undefined && ['running', 'validating'].includes(attempt.state)) {
          attempt.state = 'cancelled'
          attempt.ended_at = at
          attempt.reason = 'interrupted before its outcome was observed; resumed from a validated checkpoint'
        }
      }
      // A resume opens the next stage that has to run. An optional stage the
      // workflow already advanced past is still listed in the plan, so taking
      // the first stage in the plan would hand the attempt to a stage that may
      // be skipped and leave the next required stage without one.
      const planned = run.stages.filter(stage => plan.stages.includes(stage.skill))
      const first = planned.find(stage => stage.required) ?? planned[0]
      if (first !== undefined) {
        addAttempt(run, first.skill, { attemptId: this.ids.next('att'), now: at })
      }
      applyCompletion(run, workflow, at)
      return {
        run_id: run.run_id,
        checkpoint_id: plan.checkpoint.checkpoint_id,
        stages: plan.stages,
        rejected: plan.rejected.map(entry => entry.checkpoint_id),
      }
    })
  }

  /** Record the operator's review decision; Flowgate never fabricates approval. */
  decideReview(runId, { status, reason = null }) {
    if (!['approved', 'changes_requested', 'pending'].includes(status)) {
      throw new FlowgateError(CODES.COMMAND_INVALID, `review status "${status}" is not one of approved, changes_requested, pending`)
    }
    return this.update(runId, (run, at) => {
      if (run.review.required !== true) {
        throw new FlowgateError(CODES.COMMAND_INVALID, `run ${run.run_id}: the ${run.workflow.name} workflow does not require a review decision`)
      }
      run.review.status = status
      run.review.reason = reason
      applyCompletion(run, this.resolveWorkflow(run), at)
      return { ...run.review }
    })
  }

  /** The completion decision for a run, without mutating it. */
  completion(runId) {
    const run = this.load(runId)
    return completionDecision(run, this.resolveWorkflow(run))
  }

  recordError(runId, error) {
    return this.update(runId, (run, at) => {
      recordError(run, error, at)
      return error
    })
  }
}

export function artifactNodeFromRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('artifact:')) return undefined
  const parts = ref.split(':')
  if (parts.length < 3) return undefined
  return artifactNode(parts[1], parts.slice(2).join(':'))
}

function observedResultOf(observation) {
  if (observation.is_error === true) return 'fail'
  if (observation.exit_code !== null && observation.exit_code !== 0) return 'fail'
  return 'pass'
}

function defaultIdFactory() {
  let sequence = 0
  return {
    next(prefix) {
      sequence += 1
      return `${prefix}-${Date.now().toString(36)}${sequence.toString(36)}`
    },
  }
}

function safeId(value) {
  return String(value).replace(/[^A-Za-z0-9_-]+/g, '-')
}

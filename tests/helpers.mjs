import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadContracts } from '../lib/contracts.js'
import { loadWorkflows } from '../lib/workflows.js'
import { loadArtifactFields } from '../lib/artifact.js'
import { loadSchemas } from '../lib/schema.js'
import { SCHEMAS_DIR } from '../lib/catalog.js'
import { FlowgateController } from '../lib/controller.js'
import { composeWorkflow } from '../lib/flow.js'

export const WORKFLOW_REQUEST = 'investigate why the failing login breaks'

export function tempStateDir(prefix = 'flowgate-test-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** Deterministic clock that advances one second per call. */
export function clock(start = '2026-01-01T00:00:00.000Z') {
  let milliseconds = Date.parse(start)
  return () => {
    milliseconds += 1000
    return new Date(milliseconds).toISOString()
  }
}

/** Deterministic ids matching every schema pattern the state uses. */
export function idFactory(start = 0) {
  let sequence = start
  return {
    next(prefix) {
      sequence += 1
      return `${prefix}-${String(sequence).padStart(3, '0')}`
    },
  }
}

export function testCatalog(bodies = {}) {
  return {
    get: async name => ({
      name,
      provider: 'flowgate-test',
      content: bodies[name] ?? `BODY ${name}\n`,
      invocation: { modelInvocable: true, userInvocable: true },
    }),
  }
}

export async function buildStack({
  request = WORKFLOW_REQUEST,
  stateDir = tempStateDir(),
  now = clock(),
  ids = idFactory(),
  catalog = testCatalog(),
} = {}) {
  const schemas = loadSchemas(SCHEMAS_DIR)
  const contracts = loadContracts()
  const workflows = loadWorkflows()
  const artifactFields = loadArtifactFields()
  const composed = await composeWorkflow(request, { catalog, contracts, workflows })
  const controller = new FlowgateController({ stateDir, workflows, contracts, artifactFields, schemas, now, ids })
  return { schemas, contracts, workflows, artifactFields, composed, controller, stateDir, catalog, request, now, ids }
}

export async function startRun(options = {}) {
  const stack = await buildStack(options)
  const run = stack.controller.createRun({
    request: stack.request,
    sessionId: options.sessionId ?? 'session-test',
    route: stack.composed.route,
    workflow: stack.composed.workflow,
  })
  return { ...stack, run }
}

export function evidenceBlock(overrides = {}) {
  const values = {
    FACTS: 'observed facts',
    ASSUMPTIONS: 'none',
    PROOF: 'command output',
    UNKNOWN: 'none',
    DECISION: 'proceed',
    ...overrides,
  }
  return [
    '## EVIDENCE',
    `FACTS: ${values.FACTS}`,
    `ASSUMPTIONS: ${values.ASSUMPTIONS}`,
    `PROOF: ${values.PROOF}`,
    `UNKNOWN: ${values.UNKNOWN}`,
    `DECISION: ${values.DECISION}`,
  ].join('\n')
}

export function evidenceRecordLines(records = []) {
  return records.map(record => `EVIDENCE_RECORD: ${JSON.stringify(record)}`)
}

export function intentText({ fields = {}, evidence = {}, records = [] } = {}) {
  const values = {
    GOAL: 'the failing login is diagnosed',
    NON_GOALS: 'none',
    SUCCESS_CRITERIA: 'the reproduction fails before the change and passes after it',
    UNKNOWNS: 'none',
    ...fields,
  }
  return [
    'INTENT',
    `GOAL: ${values.GOAL}`,
    `NON_GOALS: ${values.NON_GOALS}`,
    `SUCCESS_CRITERIA: ${values.SUCCESS_CRITERIA}`,
    `UNKNOWNS: ${values.UNKNOWNS}`,
    ...evidenceRecordLines(records),
    '',
    evidenceBlock(evidence),
  ].join('\n')
}

export function decisionText({ fields = {}, records = [], evidence = {} } = {}) {
  const values = {
    CONTEXT: 'the request must be rate limited before it reaches the handler',
    OPTIONS: 'in-memory token bucket',
    CHOSEN: 'in-memory token bucket',
    RATIONALE: 'it needs no new dependency and the p95 overhead stays under one millisecond',
    REJECTED: 'redis-backed counter — it adds an operational dependency for a single-node limit',
    CONSEQUENCES: 'the limit resets whenever the process restarts',
    REVISED_BY: 'the service runs on more than one node',
    ...fields,
  }
  return [
    'DECISION',
    `CONTEXT: ${values.CONTEXT}`,
    `OPTIONS: ${values.OPTIONS}`,
    `CHOSEN: ${values.CHOSEN}`,
    `RATIONALE: ${values.RATIONALE}`,
    `REJECTED: ${values.REJECTED}`,
    `CONSEQUENCES: ${values.CONSEQUENCES}`,
    `REVISED_BY: ${values.REVISED_BY}`,
    ...evidenceRecordLines(records),
    '',
    evidenceBlock(evidence),
  ].join('\n')
}

export function specText({ fields = {}, records = [], evidence = {} } = {}) {
  const values = {
    INTERFACES: 'POST /login returns 200 with a session cookie',
    BOUNDARIES: 'no change to the password hashing boundary',
    TEST_STRATEGY: 'integration test against the real router',
    ACCEPTANCE: 'the login regression test passes and existing tests stay green',
    ...fields,
  }
  return [
    'SPEC',
    `INTERFACES: ${values.INTERFACES}`,
    `BOUNDARIES: ${values.BOUNDARIES}`,
    `TEST_STRATEGY: ${values.TEST_STRATEGY}`,
    `ACCEPTANCE: ${values.ACCEPTANCE}`,
    ...evidenceRecordLines(records),
    '',
    evidenceBlock(evidence),
  ].join('\n')
}

export function sliceText({ records = [], evidence = {} } = {}) {
  return [
    'SLICEPLAN',
    'SLICE 1: reproduce',
    '  SCOPE: add the failing regression test',
    '  PROOF: the test fails on the current code',
    '  ROLLBACK: delete the test file',
    ...evidenceRecordLines(records),
    '',
    evidenceBlock(evidence),
  ].join('\n')
}

export function diagnosisText({ fields = {}, records = [], evidence = {} } = {}) {
  const values = {
    SYMPTOM: 'login returns 500 after a fresh deploy',
    REPRO: 'node --test tests/login.test.mjs fails with one assertion error',
    ROOT_CAUSE: 'the session serializer drops the user id before the cookie is signed',
    FIX: 'none recorded yet',
    PREVENTION: 'regression test that asserts the signed cookie carries the user id',
    CONFIDENCE: 'high',
    ...fields,
  }
  return [
    'DIAGNOSIS',
    `SYMPTOM: ${values.SYMPTOM}`,
    `REPRO: ${values.REPRO}`,
    `ROOT_CAUSE: ${values.ROOT_CAUSE}`,
    `FIX: ${values.FIX}`,
    `PREVENTION: ${values.PREVENTION}`,
    `CONFIDENCE: ${values.CONFIDENCE}`,
    ...evidenceRecordLines(records),
    '',
    evidenceBlock(evidence),
  ].join('\n')
}

export function proofText({ fields = {}, records = [], evidence = {} } = {}) {
  const values = {
    WHAT_IS_PROVEN: 'the reproduction fails before the fix and passes after it',
    HOW: 'node --test tests/login.test.mjs',
    FAILING_BEFORE: 'observed: one failing assertion on the unpatched code',
    PASSING_AFTER: 'observed: the same test passes on the patched code',
    EDGE_CASES: 'an expired session cookie still redirects to the login page',
    ...fields,
  }
  return [
    'PROOF',
    `WHAT_IS_PROVEN: ${values.WHAT_IS_PROVEN}`,
    `HOW: ${values.HOW}`,
    `FAILING_BEFORE: ${values.FAILING_BEFORE}`,
    `PASSING_AFTER: ${values.PASSING_AFTER}`,
    `EDGE_CASES: ${values.EDGE_CASES}`,
    ...evidenceRecordLines(records),
    '',
    evidenceBlock(evidence),
  ].join('\n')
}

export function reviewText({ fields = {}, records = [], evidence = {} } = {}) {
  const values = { UNREVIEWED: 'none', ...fields }
  return [
    'REVIEW',
    'FINDING 1:',
    '  SEVERITY: low',
    '  LOCATION: tests/login.test.mjs:42',
    '  ISSUE: the assertion message does not name the cookie field',
    '  FIX: include the field name in the assertion message',
    `UNREVIEWED: ${values.UNREVIEWED}`,
    ...evidenceRecordLines(records),
    '',
    evidenceBlock(evidence),
  ].join('\n')
}

export function handoffText({ fields = {}, records = [], evidence = {} } = {}) {
  const values = {
    STATUS: 'the diagnosis is complete and the next session can act on it',
    CHANGED: 'none',
    VERIFIED: 'the reproduction fails on demand',
    NOT_VERIFIED: 'the fix is not implemented in this run',
    RISKS: 'the failing test covers only the happy-path login',
    OPEN_ITEMS: 'implement the fix in the next session',
    NEXT_ACTION: 'start a bugfix workflow for the session serializer',
    ...fields,
  }
  return [
    'HANDOFF',
    `STATUS: ${values.STATUS}`,
    `CHANGED: ${values.CHANGED}`,
    `VERIFIED: ${values.VERIFIED}`,
    `NOT_VERIFIED: ${values.NOT_VERIFIED}`,
    `RISKS: ${values.RISKS}`,
    `OPEN_ITEMS: ${values.OPEN_ITEMS}`,
    `NEXT_ACTION: ${values.NEXT_ACTION}`,
    ...evidenceRecordLines(records),
    '',
    evidenceBlock(evidence),
  ].join('\n')
}

export const LOGIN_COMMAND = 'node --test tests/login.test.mjs'

export function recordIntent(controller, run, overrides = {}) {
  return controller.recordStageOutput(run.run_id, intentText(overrides))
}

export function recordDecision(controller, run, { records } = {}) {
  return controller.recordStageOutput(run.run_id, decisionText({
    records: records ?? [
      { id: 'options_recorded', type: 'declared_evidence', result: 'declared' },
      { id: 'rationale_recorded', type: 'declared_evidence', result: 'declared' },
    ],
  }))
}

export function recordDiagnosis(controller, run, { reproResult = 'fail', withoutObservation = false, records } = {}) {
  if (!withoutObservation) {
    controller.recordObservation(run.run_id, {
      command: LOGIN_COMMAND,
      exit_code: reproResult === 'fail' ? 1 : 0,
      is_error: reproResult === 'fail',
      excerpt: reproResult === 'fail' ? '1 failing assertion' : '1 passing test',
    })
  }
  return controller.recordStageOutput(run.run_id, diagnosisText({
    records: records ?? [
      { id: 'repro_observed', type: 'command_execution', command: LOGIN_COMMAND, result: reproResult },
      { id: 'root_cause_recorded', type: 'artifact_inspection', result: 'declared' },
    ],
  }))
}

export function recordProof(controller, run, { records, withoutObservations = false } = {}) {
  if (!withoutObservations) {
    controller.recordObservation(run.run_id, {
      command: LOGIN_COMMAND,
      exit_code: 1,
      is_error: true,
      excerpt: '1 failing assertion',
    })
    controller.recordObservation(run.run_id, {
      command: LOGIN_COMMAND,
      exit_code: 0,
      is_error: false,
      excerpt: '1 passing test',
    })
  }
  return controller.recordStageOutput(run.run_id, proofText({
    records: records ?? [
      { id: 'failing_before_observed', type: 'test_execution', command: LOGIN_COMMAND, result: 'fail' },
      { id: 'passing_after_observed', type: 'test_execution', command: LOGIN_COMMAND, result: 'pass' },
    ],
  }))
}

export function recordReview(controller, run, overrides = {}) {
  return controller.recordStageOutput(run.run_id, reviewText(overrides))
}

export function recordSpec(controller, run, { records, withoutDeclaration = false } = {}) {
  return controller.recordStageOutput(run.run_id, specText({
    records: withoutDeclaration
      ? []
      : records ?? [{ id: 'acceptance_recorded', type: 'artifact_inspection', result: 'declared' }],
  }))
}

export function recordHandoff(controller, run, { records } = {}) {
  return controller.recordStageOutput(run.run_id, handoffText({
    records: records ?? [{ id: 'state_recorded', type: 'declared_evidence', result: 'declared' }],
  }))
}

export function runStatus(controller, run) {
  return controller.status(run.run_id)
}

export function gateOf(run, skill) {
  return run.gates.find(gate => gate.stage === skill)
}

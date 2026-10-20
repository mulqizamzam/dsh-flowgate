import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { canonical, digestOf } from './canonical.js'
import { FlowgateError, CODES } from './errors.js'
import { parseJsonStrict } from './json-file.js'
import { validateValue } from './schema.js'
import { ENGINE_VERSION } from './catalog.js'

export const STATE_SCHEMA_VERSION = 2
const LOCK_STALE_MS = 60_000
const LOCK_FILE = 'state.lock'

/**
 * Where durable state lives. DSH exposes no plugin state-directory API, so the
 * order is: explicit config, documented environment override, DSH home.
 */
export function resolveStateDir(config = {}) {
  if (typeof config.stateDir === 'string' && config.stateDir !== '') return resolve(config.stateDir)
  if (typeof process.env.DSH_FLOWGATE_STATE_DIR === 'string' && process.env.DSH_FLOWGATE_STATE_DIR !== '') {
    return resolve(process.env.DSH_FLOWGATE_STATE_DIR)
  }
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'flowgate-state')
}

export function runDir(stateDir, runId) {
  return join(stateDir, 'runs', runId)
}

export function stateFile(stateDir, runId) {
  return join(runDir(stateDir, runId), 'state.json')
}

export function saveRun(stateDir, run, { now } = {}) {
  const envelope = {
    schema_version: STATE_SCHEMA_VERSION,
    checksum: digestOf(run),
    state: run,
  }
  const file = stateFile(stateDir, run.run_id)
  mkdirSync(dirname(file), { recursive: true })
  atomicWrite(file, `${JSON.stringify(envelope, null, 2)}\n`)
  return file
}

export function loadRun(stateDir, runId, { schemas, now = () => new Date().toISOString() } = {}) {
  const file = stateFile(stateDir, runId)
  if (!existsSync(file)) {
    throw new FlowgateError(CODES.RUN_NOT_FOUND, `no run "${runId}" under ${stateDir}`, 'Check the run id; `/flowgate --status` only reads runs this installation created.')
  }
  const text = readFileSync(file, 'utf8')
  let envelope
  try {
    envelope = parseJsonStrict(text, file)
  } catch (error) {
    throw new FlowgateError(CODES.STATE_CORRUPT, `run ${runId}: state file is not valid JSON (${error.message})`, 'Preserve the file for inspection. Flowgate will not reset or overwrite unreadable state.')
  }
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new FlowgateError(CODES.STATE_CORRUPT, `run ${runId}: state envelope must be an object`, 'Preserve the file for inspection.')
  }
  if (envelope.schema_version === 1) {
    return migrateLegacyState(envelope, { file, runId, schemas, now })
  }
  if (envelope.schema_version !== STATE_SCHEMA_VERSION) {
    throw new FlowgateError(
      CODES.STATE_VERSION_UNSUPPORTED,
      `run ${runId}: state schema_version ${String(envelope.schema_version)} is not supported (supported: 1 migrated, ${STATE_SCHEMA_VERSION} current)`,
      'Upgrade Flowgate or export the run; Flowgate refuses to resume state it cannot interpret.',
    )
  }
  if (typeof envelope.checksum !== 'string' || envelope.checksum !== digestOf(envelope.state)) {
    throw new FlowgateError(CODES.STATE_CORRUPT, `run ${runId}: state checksum does not match its contents`, 'Preserve the file for inspection. Flowgate will not treat corrupted state as a completed run.')
  }
  assertStateShape(envelope.state, schemas, `run ${runId}`)
  return envelope.state
}

function assertStateShape(state, schemas, source) {
  if (schemas === undefined) return state
  const schema = schemas.get('run-state')
  if (schema === undefined) return state
  const result = validateValue(state, schema, schema)
  if (!result.ok) {
    const first = result.errors[0]
    throw new FlowgateError(
      CODES.STATE_CORRUPT,
      `${source}: persisted state does not match the run-state schema: ${first.message} at ${first.path}`,
      'Preserve the file for inspection; do not delete it and report success.',
    )
  }
  return state
}

/**
 * v1 never persisted runs. This migration accepts the one legacy shape a user
 * could have exported by hand: a pre-v2 run record with artifacts but no
 * freshness/versions. Nothing is assumed current; every legacy artifact and
 * evidence record requires revalidation and the run is blocked.
 */
export function migrateLegacyState(envelope, { file, runId, schemas, now }) {
  const legacy = envelope.state
  if (legacy === null || typeof legacy !== 'object' || Array.isArray(legacy)) {
    throw new FlowgateError(CODES.STATE_CORRUPT, `${file}: legacy state must be an object`)
  }
  const at = typeof now === 'function' ? now() : new Date().toISOString()
  const migrated = {
    schema_version: 2,
    engine_version: ENGINE_VERSION,
    run_id: String(legacy.run_id ?? runId),
    session_id: legacy.session_id ?? null,
    created_at: String(legacy.created_at ?? at),
    updated_at: at,
    request: legacy.request ?? { bytes: 0, digest: digestOf(''), excerpt: '' },
    routing: legacy.routing ?? { scores: [], selected: String(legacy.workflow?.name ?? 'unknown'), reason: 'migrated from schema_version 1', fallback: false },
    workflow: legacy.workflow ?? { name: 'unknown', contract_version: 1, stage_count: 1 },
    enforcement: legacy.enforcement ?? { level: 'validated', pre_step: 'not_used', limitations: ['migrated state cannot assert runtime enforcement'] },
    status: 'blocked',
    stages: (legacy.stages ?? []).map((stage, index) => ({
      position: stage.position ?? index + 1,
      skill: String(stage.skill),
      artifact: String(stage.artifact ?? 'Intent'),
      required: stage.required !== false,
      contract_version: 1,
      attempts: (stage.attempts ?? []).map((attempt, attemptIndex) => ({
        attempt_id: String(attempt.attempt_id ?? `att-legacy-${index + 1}-${attemptIndex + 1}`),
        state: 'blocked',
        started_at: String(attempt.started_at ?? at),
        ended_at: String(attempt.ended_at ?? at),
        artifact_ids: [...(attempt.artifact_ids ?? [])],
        evidence_ids: [...(attempt.evidence_ids ?? [])],
        checks: [],
        gate: { status: 'blocked', reasons: [{ code: CODES.EVIDENCE_IMPACT_UNKNOWN, message: 'legacy state has no version bindings' }] },
        reason: 'migrated from schema_version 1; requires revalidation',
      })),
    })),
    artifacts: (legacy.artifacts ?? []).map((record, index) => ({
      artifact_id: String(record.artifact_id ?? `art-legacy-${index + 1}`),
      artifact_type: String(record.artifact_type),
      schema_version: 1,
      producer: record.producer ?? { stage: 'legacy', attempt_id: 'att-legacy' },
      status: 'present',
      freshness: { status: 'needs_revalidation', reason: 'migrated from schema_version 1 without version bindings' },
      digest: typeof record.content === 'string' ? digestOf(record.content) : digestOf(record),
      content: typeof record.content === 'string' ? record.content : '',
      content_bytes: typeof record.content === 'string' ? Buffer.byteLength(record.content, 'utf8') : 0,
      inputs: [],
      validation: { ok: false, checks: [], errors: [{ path: '#', message: 'legacy artifact has no v2 validation' }] },
      evidence_ids: [],
      created_at: String(record.created_at ?? at),
      validated_at: null,
    })),
    evidence: (legacy.evidence ?? []).map((record, index) => ({
      evidence_id: String(record.evidence_id ?? `ev-legacy-${index + 1}`),
      contract_evidence_id: String(record.contract_evidence_id ?? 'legacy_evidence'),
      evidence_type: 'declared_evidence',
      supports: [...(record.supports ?? ['legacy'])],
      provenance: { kind: 'agent_statement', observation_id: null, command: null },
      observed: { result: 'declared', excerpt: '' },
      binds_to: [],
      validation: { method: 'structural', ok: false, errors: [{ path: '#', message: 'legacy evidence has no v2 validation' }] },
      status: 'needs_revalidation',
      freshness_reason: 'migrated from schema_version 1 without version bindings',
      producer: record.producer ?? { stage: 'legacy', attempt_id: 'att-legacy' },
      created_at: String(record.created_at ?? at),
    })),
    observations: [],
    approvals: [],
    gates: (legacy.gates ?? []).map(gate => ({
      stage: String(gate.stage),
      status: 'blocked',
      reasons: [{ code: CODES.EVIDENCE_IMPACT_UNKNOWN, message: 'legacy gate cannot be treated as passed' }],
      checked_at: at,
    })),
    review: legacy.review ?? { required: false, status: 'not_required', reason: 'migrated state carries no review policy' },
    checkpoints: [],
    invalidations: [],
    errors: [{
      code: 'STATE_MIGRATED',
      message: 'state was migrated from schema_version 1; every legacy artifact and evidence record requires revalidation',
      remediation: 'Rerun the affected stages; v1 records are never assumed current under v2.',
      at,
    }],
    completion: { status: 'blocked', reasons: ['migrated state requires revalidation'], decided_at: null },
  }
  assertStateShape(migrated, schemas, `run ${runId} (migrated)`)
  return migrated
}

/** Serialize updates through a per-run lock; refuse rather than risk a corrupt write. */
export function withRunLock(stateDir, runId, fn) {
  const dir = runDir(stateDir, runId)
  mkdirSync(dir, { recursive: true })
  const lock = join(dir, LOCK_FILE)
  let fd
  try {
    fd = openSync(lock, 'wx', 0o600)
  } catch (error) {
    if (error.code === 'EEXIST' && isStale(lock)) {
      rmSync(lock, { force: true })
      try {
        fd = openSync(lock, 'wx', 0o600)
      } catch (retryError) {
        throw lockError(runId, retryError)
      }
    } else {
      throw lockError(runId, error)
    }
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
    return fn()
  } finally {
    closeSync(fd)
    rmSync(lock, { force: true })
  }
}

function lockError(runId, error) {
  if (error.code !== 'EEXIST') return error
  return new FlowgateError(
    CODES.STATE_LOCKED,
    `run ${runId}: another controller holds the state lock`,
    'Wait for the other update to finish; Flowgate refuses concurrent state writes rather than risk corruption.',
  )
}

function isStale(lock) {
  try {
    return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS
  } catch {
    return false
  }
}

/**
 * Durable replace: write a sibling temp file, fsync it, rename over the target,
 * then fsync the directory. A crash leaves either the old file or the new one.
 */
export function atomicWrite(file, text) {
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true })
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  const fd = openSync(temp, 'wx', 0o600)
  try {
    writeFileSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temp, file)
  const dirFd = openSync(dir, 'r')
  try {
    fsyncSync(dirFd)
  } finally {
    closeSync(dirFd)
  }
  return file
}

/** Canonical text of a run, useful for report digests and tests. */
export function stateDigest(run) {
  return digestOf(run)
}

export function readEnvelope(stateDir, runId) {
  const file = stateFile(stateDir, runId)
  if (!existsSync(file)) return undefined
  return readFileSync(file, 'utf8')
}

export function writeRawRunFile(stateDir, runId, text) {
  const file = stateFile(stateDir, runId)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  return file
}

export { canonical }

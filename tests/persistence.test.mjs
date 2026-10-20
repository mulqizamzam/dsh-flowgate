import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { digestOf } from '../lib/canonical.js'
import { SCHEMAS_DIR } from '../lib/catalog.js'
import { loadSchemas } from '../lib/schema.js'
import {
  STATE_SCHEMA_VERSION,
  loadRun,
  readEnvelope,
  resolveStateDir,
  runDir,
  saveRun,
  stateDigest,
  stateFile,
  withRunLock,
  writeRawRunFile,
} from '../lib/persistence.js'
import { recordIntent, startRun, tempStateDir } from './helpers.mjs'

const schemas = loadSchemas(SCHEMAS_DIR)
const LOCK = 'state.lock'

function readText(file) {
  return readFileSync(file, 'utf8')
}

test('the state directory follows config, then environment, then DSH home', () => {
  const previous = process.env.DSH_FLOWGATE_STATE_DIR
  const previousHome = process.env.DSH_HOME
  try {
    delete process.env.DSH_FLOWGATE_STATE_DIR
    process.env.DSH_HOME = '/tmp/flowgate-home'
    assert.equal(resolveStateDir({}), '/tmp/flowgate-home/flowgate-state')
    assert.equal(resolveStateDir({ stateDir: '/tmp/explicit' }), '/tmp/explicit')
    process.env.DSH_FLOWGATE_STATE_DIR = '/tmp/from-env'
    assert.equal(resolveStateDir({}), '/tmp/from-env')
    assert.equal(resolveStateDir({ stateDir: '/tmp/explicit' }), '/tmp/explicit')
  } finally {
    if (previous === undefined) delete process.env.DSH_FLOWGATE_STATE_DIR
    else process.env.DSH_FLOWGATE_STATE_DIR = previous
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

test('a saved run round-trips with a verified checksum', async () => {
  const stack = await startRun()
  recordIntent(stack.controller, stack.run)
  const stored = stack.controller.status(stack.run.run_id)
  const file = stateFile(stack.stateDir, stack.run.run_id)
  assert.equal(existsSync(file), true)
  const text = readEnvelope(stack.stateDir, stack.run.run_id)
  const envelope = JSON.parse(text)
  assert.equal(envelope.schema_version, STATE_SCHEMA_VERSION)
  assert.equal(envelope.schema_version, 2)
  assert.equal(envelope.checksum, digestOf(envelope.state))
  assert.equal(envelope.checksum, stateDigest(stored))
  const loaded = loadRun(stack.stateDir, stack.run.run_id, { schemas })
  assert.deepEqual(loaded, stored)
})

test('an unsupported schema version is refused, not migrated', async () => {
  const stateDir = tempStateDir()
  const runId = 'run-future'
  writeRawRunFile(stateDir, runId, `${JSON.stringify({ schema_version: 99, checksum: 'sha256:x', state: {} })}\n`)
  assert.throws(() => loadRun(stateDir, runId, { schemas }), error => {
    assert.equal(error.code, 'STATE_VERSION_UNSUPPORTED')
    assert.match(error.message, /schema_version 99/)
    return true
  })
})

test('a truncated or malformed state file is reported as corrupt', async () => {
  const stack = await startRun()
  recordIntent(stack.controller, stack.run)
  const file = stateFile(stack.stateDir, stack.run.run_id)
  const text = readText(file)
  writeFileSync(file, text.slice(0, Math.floor(text.length / 2)))
  assert.throws(() => loadRun(stack.stateDir, stack.run.run_id, { schemas }), error => {
    assert.equal(error.code, 'STATE_CORRUPT')
    assert.match(error.message, /not valid JSON/)
    return true
  })
})

test('a tampered state body fails the checksum guard', async () => {
  const stack = await startRun()
  recordIntent(stack.controller, stack.run)
  const file = stateFile(stack.stateDir, stack.run.run_id)
  const envelope = JSON.parse(readText(file))
  envelope.state.status = 'completed'
  writeFileSync(file, `${JSON.stringify(envelope)}\n`)
  assert.throws(() => loadRun(stack.stateDir, stack.run.run_id, { schemas }), error => {
    assert.equal(error.code, 'STATE_CORRUPT')
    assert.match(error.message, /checksum/)
    return true
  })
})

test('a run that does not exist is reported without inventing one', async () => {
  const stateDir = tempStateDir()
  assert.throws(() => loadRun(stateDir, 'run-ghost', { schemas }), error => {
    assert.equal(error.code, 'RUN_NOT_FOUND')
    return true
  })
})

test('writes leave no temporary file behind', async () => {
  const stack = await startRun()
  recordIntent(stack.controller, stack.run)
  saveRun(stack.stateDir, stack.controller.status(stack.run.run_id), { now: '2026-01-01T00:00:00.000Z' })
  const files = readdirSync(runDir(stack.stateDir, stack.run.run_id))
  assert.deepEqual(files, ['state.json'])
})

test('a lock blocks a concurrent writer and is released afterwards', async () => {
  const stateDir = tempStateDir()
  const runId = 'run-lock'
  let inner
  withRunLock(stateDir, runId, () => {
    assert.throws(() => withRunLock(stateDir, runId, () => 'unreachable'), error => {
      assert.equal(error.code, 'STATE_LOCKED')
      return true
    })
    inner = readText(join(runDir(stateDir, runId), LOCK))
    return 'outer'
  })
  assert.match(inner, /"pid":/)
  assert.equal(existsSync(join(runDir(stateDir, runId), LOCK)), false)
  assert.equal(withRunLock(stateDir, runId, () => 'after'), 'after')
})

test('a stale lock is recovered instead of blocking forever', async () => {
  const stateDir = tempStateDir()
  const runId = 'run-stale'
  const dir = runDir(stateDir, runId)
  withRunLock(stateDir, runId, () => 'seed')
  writeFileSync(join(dir, LOCK), '{"pid":1}')
  const old = Date.now() / 1000 - 300
  utimesSync(join(dir, LOCK), old, old)
  assert.equal(statSync(join(dir, LOCK)).mtimeMs < Date.now() - 60_000, true)
  assert.equal(withRunLock(stateDir, runId, () => 'recovered'), 'recovered')
  assert.equal(existsSync(join(dir, LOCK)), false)
})

test('schema_version 1 state is migrated to v2 and marked as requiring revalidation', async () => {
  const stateDir = tempStateDir()
  const runId = 'run-legacy'
  const legacy = {
    run_id: runId,
    session_id: 'session-legacy',
    created_at: '2025-01-01T00:00:00.000Z',
    request: { bytes: 8, digest: digestOf('legacy'), excerpt: 'legacy' },
    routing: { scores: [], selected: 'investigation', reason: 'legacy', fallback: false },
    workflow: { name: 'investigation', contract_version: 1, stage_count: 1 },
    stages: [{ position: 1, skill: 'intent', artifact: 'Intent', required: true, attempts: [] }],
    artifacts: [],
    evidence: [],
    gates: [{ stage: 'intent', status: 'pending' }],
    review: { required: false, status: 'not_required', reason: null },
  }
  writeRawRunFile(stateDir, runId, `${JSON.stringify({ schema_version: 1, state: legacy })}\n`)
  const migrated = loadRun(stateDir, runId, { schemas, now: () => '2026-03-03T00:00:00.000Z' })
  assert.equal(migrated.schema_version, 2)
  assert.equal(migrated.run_id, runId)
  assert.equal(migrated.status, 'blocked')
  assert.equal(migrated.errors[0].code, 'STATE_MIGRATED')
  assert.match(migrated.errors[0].message, /requires revalidation/)
  assert.equal(migrated.completion.status, 'blocked')
  assert.equal(migrated.gates[0].status, 'blocked', 'a legacy gate is never trusted as passed')
  assert.deepEqual(migrated.approvals, [])
  assert.deepEqual(migrated.checkpoints, [])
})

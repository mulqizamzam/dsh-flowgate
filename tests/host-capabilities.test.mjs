import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  declaredHook,
  enforcementRecord,
  hostCapabilityMatrix,
  capabilitySummary,
  readDeclaration,
} from '../lib/host.js'

const RUNTIME = { commands: { register() {} }, skills: { get() {} } }
const EXPECTED_ORDER = [
  'commands.register',
  'commands.execute',
  'skills.resolve',
  'skills.render',
  'steering',
  'session.events',
  'tool.observation',
  'agent.pre-step',
  'host.state-directory',
  'continuation.block',
]

function matrixById(matrix) {
  return new Map(matrix.map(entry => [entry.id, entry]))
}

test('the matrix records every capability the plugin depends on, in a fixed order', () => {
  const matrix = hostCapabilityMatrix(RUNTIME)
  assert.deepEqual(matrix.map(entry => entry.id), EXPECTED_ORDER)
  for (const entry of matrix) {
    assert.equal(typeof entry.evidence, 'string')
    assert.ok(entry.evidence.length > 0, `${entry.id}: evidence must be recorded`)
    assert.equal(typeof entry.effect, 'string')
    assert.ok(entry.effect.length > 0, `${entry.id}: product effect must be recorded`)
    assert.ok(['verified', 'unsupported', 'unknown'].includes(entry.status), `${entry.id}: unknown status`)
  }
})

test('capabilities the live host exposes are verified only with a runtime method', () => {
  const byId = matrixById(hostCapabilityMatrix(RUNTIME))
  assert.equal(byId.get('commands.register').status, 'verified')
  assert.equal(byId.get('skills.resolve').status, 'verified')
  assert.equal(capabilitySummary(hostCapabilityMatrix(RUNTIME)), '8 verified, 2 unsupported, 0 unknown')
})

test('a capability without a runtime method is unsupported, never guessed verified', () => {
  const byId = matrixById(hostCapabilityMatrix())
  assert.equal(byId.get('commands.register').status, 'unsupported')
  assert.equal(byId.get('skills.resolve').status, 'unsupported')
  assert.equal(capabilitySummary(hostCapabilityMatrix()), '6 verified, 4 unsupported, 0 unknown')
})

test('declared API checks read the installed declaration files, not memory', () => {
  for (const [key, needle] of [
    ['session', "'session/event'"],
    ['sessionTypes', "'tool/result'"],
    ['agent', "'agent/pre-step'"],
    ['skill', 'SkillRegistry'],
  ]) {
    const result = declaredHook(key, needle)
    assert.equal(result.declared, true, `${key}: ${needle} must be declared by the installed package`)
    assert.ok(result.evidence.includes('node_modules/@deepseek-ai/'), `${key}: evidence must name the declaration file`)
  }
})

test('an unknown declaration key or missing needle is reported, never assumed', () => {
  assert.equal(readDeclaration('does-not-exist'), undefined)
  const unknownFile = declaredHook('does-not-exist', 'anything')
  assert.equal(unknownFile.declared, false)
  assert.match(unknownFile.evidence, /declaration file not installed/)
  const missingNeedle = declaredHook('session', 'not-a-real-session-event')
  assert.equal(missingNeedle.declared, false)
  assert.equal(missingNeedle.evidence.includes('node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts'), true)
})

test('enforcement is reported as validated, and pre-step is documented as unused', () => {
  const record = enforcementRecord()
  assert.equal(record.level, 'validated')
  assert.notEqual(record.level, 'enforced')
  assert.equal(record.pre_step, 'available_not_used')
  assert.equal(record.limitations.length >= 2, true)
  assert.equal(record.limitations.some(line => line.includes('no verified host control prevents an agent from continuing')), true)
  assert.equal(record.limitations.some(line => line.includes('so it is not used as a gate lock')), true)
})

test('the capability document records every entry and the live summary verbatim', () => {
  const doc = readFileSync(fileURLToPath(new URL('../docs/host-capability-matrix.md', import.meta.url)), 'utf8')
  for (const entry of hostCapabilityMatrix(RUNTIME)) {
    assert.ok(doc.includes(`\`${entry.id}\``), `docs/host-capability-matrix.md must name ${entry.id}`)
  }
  assert.ok(doc.includes(capabilitySummary(hostCapabilityMatrix(RUNTIME))), 'the document must record the verified/unsupported counts')
  assert.ok(doc.includes(capabilitySummary(hostCapabilityMatrix())), 'the document must record the bare-host counts')
  assert.ok(doc.includes('validated'), 'the document must state the enforcement level')
  assert.ok(doc.includes('available_not_used'), 'the document must state that pre-step is not used')
})

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readJsonFileSync, parseJsonStrict } from '../lib/json-file.js'
import { loadWorkflowFile, loadWorkflows, validateWorkflow } from '../lib/workflows.js'

const SOURCE = 'workflows.test.mjs'

const EXPECTED = {
  feature: {
    keywords: ['add', 'implement', 'build', 'create', 'feature'],
    order: ['intent', 'decide', 'spec', 'slice', 'prove', 'review'],
    optional: ['decide', 'review'],
  },
  bugfix: {
    keywords: ['fix', 'broken', 'regression', 'crash', 'bug'],
    order: ['recover', 'prove', 'review'],
    optional: [],
  },
  investigation: {
    keywords: ['investigate', 'why', 'diagnose', 'failing', 'understand'],
    order: ['intent', 'recover', 'handoff'],
    optional: [],
  },
  migration: {
    keywords: ['migrate', 'upgrade', 'deprecate', 'port', 'refactor'],
    order: ['intent', 'decide', 'spec', 'slice', 'prove', 'review', 'handoff'],
    optional: ['decide', 'review'],
  },
  release: {
    keywords: ['release', 'deploy', 'ship', 'production', 'launch'],
    order: ['intent', 'constrain', 'decide', 'prove', 'review', 'handoff'],
    optional: ['decide'],
  },
}

function workflows() {
  return loadWorkflows()
}

test('workflows.json loader returns exactly the five shipped workflows', () => {
  const loaded = workflows()
  assert.deepEqual([...loaded.keys()].sort(), Object.keys(EXPECTED).sort())
})

test('every workflow validates against the shipped assets', () => {
  for (const [name, workflow] of workflows()) {
    assert.equal(workflow.schema_version, 1, `${name}: schema_version must be 1`)
    assert.equal(workflow.match.keywords.length > 0, true, `${name}: keywords must be non-empty`)
    assert.equal(Number.isInteger(workflow.match.priority), true, `${name}: priority must be an integer`)
    assert.equal(workflow.stages.length > 0, true, `${name}: stages must be non-empty`)
    assert.equal(Array.isArray(workflow.rules) && workflow.rules.length > 0, true, `${name}: rules must be a non-empty array`)
    assert.equal(typeof workflow.completion === 'string' && workflow.completion.length > 0, true, `${name}: completion must be a non-empty string`)
    assert.ok(['skip', 'fail'].includes(workflow.on_optional_missing), `${name}: on_optional_missing must be skip or fail`)
  }
})

test('every workflow matches the PRD stage order and required flags', () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const workflow = workflows().get(name)
    assert.deepEqual(workflow.stages.map(stage => stage.skill), expected.order, `${name}: stage order`)
    for (const stage of workflow.stages) {
      const shouldBeRequired = !expected.optional.includes(stage.skill)
      assert.equal(stage.required, shouldBeRequired, `${name}: stage "${stage.skill}" required flag`)
      assert.equal(typeof stage.purpose === 'string' && stage.purpose.length > 0, true, `${name}: stage "${stage.skill}" purpose must be a non-empty string`)
    }
  }
})

test('every workflow carries its PRD keyword set', () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const workflow = workflows().get(name)
    assert.deepEqual(workflow.match.keywords, expected.keywords, `${name}: keywords`)
  }
})

test('bugfix expresses the second prove pass as a rule, not a duplicate stage', () => {
  const workflow = workflows().get('bugfix')
  const proveStages = workflow.stages.filter(stage => stage.skill === 'prove')
  assert.equal(proveStages.length, 1, 'bugfix must list prove exactly once')
  const rule = workflow.rules.find(candidate => /prove/i.test(candidate) && /twice/i.test(candidate))
  assert.notEqual(rule, undefined, 'bugfix rules must state the double prove pass')
})

test('strict JSON reader rejects duplicate keys', () => {
  assert.throws(() => parseJsonStrict('{ "a": 1, "a": 2 }', SOURCE), /duplicate key "a"/)
})

test('strict JSON reader rejects malformed JSON', () => {
  assert.throws(() => parseJsonStrict('{ "a": 1,', SOURCE), /invalid JSON/)
})

test('strict JSON reader accepts duplicate-free JSON', () => {
  assert.deepEqual(parseJsonStrict('{ "a": 1, "b": { "c": 2, "d": 3 } }', SOURCE), { a: 1, b: { c: 2, d: 3 } })
})

function workflowFixture() {
  return {
    schema_version: 1,
    name: 'fixture',
    description: 'Fixture workflow.',
    match: { keywords: ['fixture'], priority: 50 },
    stages: [{ skill: 'intent', required: true, purpose: 'Capture intent.' }],
    rules: ['Rule one.'],
    on_optional_missing: 'skip',
    completion: 'Done when the artifact is complete.',
  }
}

test('workflow validator rejects an unknown stage skill', () => {
  const data = workflowFixture()
  data.stages.push({ skill: 'ghost', required: true, purpose: 'Unknown.' })
  assert.throws(() => validateWorkflow(data, SOURCE), /names unknown skill "ghost"/)
})

test('workflow validator rejects a duplicated stage skill', () => {
  const data = workflowFixture()
  data.stages.push({ skill: 'intent', required: false, purpose: 'Twice.' })
  assert.throws(() => validateWorkflow(data, SOURCE), /skill "intent" appears twice in stages/)
})

test('workflow validator rejects a non-integer priority', () => {
  const data = workflowFixture()
  data.match.priority = 1.5
  assert.throws(() => validateWorkflow(data, SOURCE), /expected integer/)
})

test('workflow validator rejects empty or blank keyword lists', () => {
  const empty = workflowFixture()
  empty.match.keywords = []
  assert.throws(() => validateWorkflow(empty, SOURCE), /array has fewer than 1 items at #\/match\/keywords/)
  const blank = workflowFixture()
  blank.match.keywords = ['']
  assert.throws(() => validateWorkflow(blank, SOURCE), /string is shorter than 1 characters at #\/match\/keywords\/0/)
})

test('workflow validator rejects an out-of-range on_optional_missing', () => {
  const data = workflowFixture()
  data.on_optional_missing = 'stop'
  assert.throws(() => validateWorkflow(data, SOURCE), /value is not one of "skip", "fail"/)
})

test('workflow validator rejects empty stages, rules, and completion', () => {
  const noStages = workflowFixture()
  noStages.stages = []
  assert.throws(() => validateWorkflow(noStages, SOURCE), /array has fewer than 1 items at #\/stages/)
  const noRules = workflowFixture()
  noRules.rules = []
  assert.throws(() => validateWorkflow(noRules, SOURCE), /array has fewer than 1 items at #\/rules/)
  const noCompletion = workflowFixture()
  noCompletion.completion = ''
  assert.throws(() => validateWorkflow(noCompletion, SOURCE), /string is shorter than 1 characters at #\/completion/)
})

test('workflow validator rejects a missing or wrong schema_version', () => {
  const missing = workflowFixture()
  delete missing.schema_version
  assert.throws(() => validateWorkflow(missing, SOURCE), /missing required property "schema_version"/)
  const wrong = workflowFixture()
  wrong.schema_version = 3
  assert.throws(() => validateWorkflow(wrong, SOURCE), /expected constant 1/)
})

test('workflow loader rejects a name that does not match the file stem', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-flowgate-stem-'))
  const file = join(dir, 'wrong-stem.json')
  const data = workflowFixture()
  writeFileSync(file, JSON.stringify(data))
  assert.throws(() => loadWorkflowFile(file, 'wrong-stem'), /does not match file stem/)
})

test('workflow loader reads a file through the strict JSON reader', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-flowgate-read-'))
  const file = join(dir, 'fixture.json')
  writeFileSync(file, '{ "schema_version": 1, "schema_version": 1 }')
  assert.throws(() => readJsonFileSync(file), /duplicate key "schema_version"/)
})
